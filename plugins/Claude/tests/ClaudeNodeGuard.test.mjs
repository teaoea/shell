import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ClaudeNodeGuard.js', import.meta.url), 'utf8');
const group = 'Claude固定出口';
function harness(options = {}) {
  const shared = options.shared || { selected: 'REJECT', storage: new Map() };
  const state = { requests: [], timers: [], changes: [], done: 0, logs: [] };
  const context = {
    $argument: { claude_node: options.node ?? '测试节点' },
    $config: {
      getSelectedPolicy(name) {
        if (name === group) return shared.selected;
        return options.nested ? '子节点' : '';
      },
      setSelectPolicy(name, value) {
        assert.equal(name, group);
        state.changes.push(value);
        if (options.selectionFailure === value) return false;
        shared.selected = value;
        return true;
      },
      getSubPolicies(name, callback) {
        assert.equal(name, group);
        if (options.noPoliciesCallback) return;
        callback(options.rawPolicies ?? JSON.stringify(['REJECT', '测试节点']));
      }
    },
    $persistentStore: {
      write(value, key) {
        if (options.writeFailure) return false;
        shared.storage.set(key, value); return true;
      },
      read(key) { return shared.storage.get(key); }
    },
    $httpClient: { get(request, callback) { state.requests.push({ request, callback }); } },
    setTimeout(callback, ms) { state.timers.push({ callback, ms }); },
    console: { log(value) { state.logs.push(value); } },
    $done() { state.done++; }
  };
  vm.runInNewContext(source, context);
  return { state, shared, reply(error = null, status = 204) {
    state.requests.at(-1).callback(error, { status });
  }, timeout() { for (const timer of state.timers) timer.callback(); } };
}

test('成功只选择指定节点，探测锁定节点并验证 TLS，不发送凭据', () => {
  const h = harness();
  const request = h.state.requests[0].request;
  assert.equal(request.node, '测试节点');
  assert.equal(request.timeout, 3000);
  assert.equal(request.insecure, false);
  assert.equal(request['auto-redirect'], false);
  assert.equal(request['auto-cookie'], false);
  assert.equal(request.headers, undefined);
  h.reply();
  assert.equal(h.shared.selected, '测试节点');
  h.timeout();
  assert.equal(h.state.done, 1);
});

for (const [name, error, status] of [
  ['网络错误', 'connection failed', 204], ['403', null, 403],
  ['重定向', null, 302], ['非预期200', null, 200]
]) test(`${name} 自动将已放行的组切到 REJECT`, () => {
  const shared = { selected: '测试节点', storage: new Map() };
  const h = harness({ shared });
  h.reply(error, status);
  assert.equal(shared.selected, 'REJECT');
  assert.equal(h.state.done, 1);
});

test('无回调超时也选择 REJECT，迟到成功不能重新放行', () => {
  const h = harness({ shared: { selected: '测试节点', storage: new Map() } });
  h.timeout();
  h.reply();
  assert.equal(h.shared.selected, 'REJECT');
  assert.equal(h.state.done, 1);
});

test('失败后下次检测成功可自动恢复，探测不依赖业务组', () => {
  const a = harness(); a.reply('offline');
  const b = harness({ shared: a.shared }); b.reply();
  assert.equal(b.shared.selected, '测试节点');
});

test('旧检测成功不能覆盖新检测失败', () => {
  const a = harness();
  const b = harness({ shared: a.shared });
  b.reply('offline'); a.reply(); a.timeout(); b.timeout();
  assert.equal(a.shared.selected, 'REJECT');
  assert.equal(a.state.done, 1);
  assert.equal(b.state.done, 1);
});

for (const options of [
  { node: '' }, { node: 'DIRECT' }, { node: 'PROXY' }, { node: 'REJECT' },
  { node: group }, { node: 'ss,example,443' }, { nested: true },
  { writeFailure: true }, { rawPolicies: 'invalid' },
  { rawPolicies: '["REJECT"]' },
  { rawPolicies: '["REJECT","测试节点","DIRECT"]' }
]) test(`异常配置拒绝且不发起探测 ${JSON.stringify(options)}`, () => {
  const h = harness({ ...options, shared: { selected: '测试节点', storage: new Map() } });
  assert.equal(h.shared.selected, 'REJECT');
  assert.equal(h.state.requests.length, 0);
  assert.equal(h.state.done, 1);
});

test('组成员读取无回调时看门狗拒绝', () => {
  const h = harness({ noPoliciesCallback: true, shared: { selected: '测试节点', storage: new Map() } });
  h.timeout();
  assert.equal(h.shared.selected, 'REJECT');
  assert.equal(h.state.done, 1);
});

test('放行接口拒绝时仍选择 REJECT', () => {
  const h = harness({ selectionFailure: '测试节点' }); h.reply();
  assert.equal(h.shared.selected, 'REJECT');
});

test('敏感节点名及网络错误不进入日志', () => {
  const h = harness(); h.reply('secret credential');
  assert.ok(!h.state.logs.join('').includes('secret'));
  assert.ok(!h.state.logs.join('').includes('测试节点'));
});

test('插件入口接入定时及手动守卫，所有业务域名前都有 UDP/QUIC 拒绝', () => {
  const plugin = readFileSync(new URL('../Claude.plugin', import.meta.url), 'utf8');
  const rules = plugin.split('[Rule]')[1].split('[Script]')[0].split('\n')
    .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  assert.equal(rules.length, 42);
  assert.equal(new Set(rules).size, rules.length);
  const targets = rules.filter(s => s.endsWith(',PROXY'));
  assert.equal(targets.length, 14);
  for (const line of targets) {
    const [type, domain] = line.split(',');
    for (const protocol of ['UDP', 'QUIC']) {
      const guard = `AND,((${type},${domain}),(PROTOCOL,${protocol})),REJECT`;
      assert.ok(rules.indexOf(guard) >= 0 && rules.indexOf(guard) < rules.indexOf(line));
    }
  }
  assert.match(plugin, /cron "\*\/15 \* \* \* \* \*" then script\(/);
  assert.equal((plugin.match(/ClaudeNodeGuard\.js", \{\$\{claude_node\}\}/g) || []).length, 2);
  assert.ok(!plugin.includes('[Mitm]'));
  const conf = readFileSync(new URL('../Claude.loon.conf', import.meta.url), 'utf8');
  assert.match(conf, /^Claude固定出口 = select,REJECT,YOUR_CLAUDE_NODE$/m);
});
