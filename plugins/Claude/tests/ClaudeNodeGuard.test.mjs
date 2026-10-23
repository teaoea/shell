import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../ClaudeNodeGuard.js', import.meta.url), 'utf8');
function run(options = {}) {
  const state = { requests: [], timers: [], results: [], logs: [] };
  let nested = options.nested || false;
  const context = {
    $argument: options.argument ?? { claude_node: options.node ?? '美国 01' },
    $request: options.noRequest ? undefined : new Proxy({}, {
      get() { throw new Error('不得读取业务请求字段'); }
    }),
    $config: {
      getSelectedPolicy() {
        if (options.configError) throw new Error('config error');
        return nested ? '子节点' : '';
      },
      setSelectPolicy() { throw new Error('不得修改全局策略'); }
    },
    $httpClient: { get(request, callback) {
      if (options.httpThrow) throw new Error('http error');
      state.requests.push({request, callback});
    } },
    setTimeout(callback, ms) { state.timers.push({callback, ms}); },
    console: { log(value) { state.logs.push(value); } },
    $done(result) { state.results.push(result); }
  };
  vm.runInNewContext(source, context);
  return { state,
    reply(error = null, status = 204) { state.requests.at(-1).callback(error, status === null ? null : {status}); },
    timeout() { state.timers.forEach(t => t.callback()); },
    nest() { nested = true; }
  };
}
const result = h => h.state.results.map(r => r.node);
test('原请求等待探测成功后才放行，并锁定相同单节点', () => {
  const h = run();
  assert.equal(h.state.results.length, 0);
  const {request} = h.state.requests[0];
  assert.equal(request.node, '美国 01');
  assert.equal(request.url, 'https://www.gstatic.com/generate_204');
  assert.equal(request.timeout, 3000);
  assert.equal(request.insecure, false);
  assert.equal(request['auto-cookie'], false);
  assert.equal(request['auto-redirect'], false);
  assert.equal(request.headers, undefined);
  assert.equal(request.body, undefined);
  h.reply(); h.timeout();
  assert.deepEqual(result(h), ['美国 01']);
});
for (const [name, error, status] of [
  ['连接失败','offline',204], ['403',null,403], ['重定向',null,302],
  ['非预期200',null,200], ['没有响应',null,null]
]) test(`${name} 只拒绝当前请求`, () => {
  const h = run(); h.reply(error,status);
  assert.deepEqual(result(h), ['REJECT']);
});
test('无回调超时拒绝，迟到成功不能放行', () => {
  const h = run(); h.timeout(); h.reply();
  assert.deepEqual(result(h), ['REJECT']);
});
test('重复成功回调只完成请求一次', () => {
  const h = run(); h.reply(); h.reply();
  assert.deepEqual(result(h), ['美国 01']);
});
test('并发请求分别探测，失败与成功不互相覆盖', () => {
  const a = run(); const b = run();
  b.reply('offline'); a.reply();
  assert.equal(a.state.requests.length,1);
  assert.equal(b.state.requests.length,1);
  assert.deepEqual(result(a), ['美国 01']);
  assert.deepEqual(result(b), ['REJECT']);
});
test('前次成功不能缓存跳过下一次请求探测', () => {
  const a = run(); a.reply();
  const b = run();
  assert.equal(b.state.requests.length,1);
  assert.equal(b.state.results.length,0);
  b.reply('offline');
  assert.deepEqual(result(b), ['REJECT']);
});
for (const options of [
  {node:''},{node:'DIRECT'},{node:'PROXY'},{node:'REJECT'},
  {node:'REJECT-DROP'},{node:'ss,example,443'},{node:'bad\nname'},
  {nested:true},{configError:true},{httpThrow:true},{noRequest:true},
  {argument:'invalid'}
]) test(`异常拒绝 ${JSON.stringify(options)}`, () => {
  const h = run(options);
  assert.deepEqual(result(h), ['REJECT']);
});
test('探测期间节点被改为策略组时拒绝', () => {
  const h = run(); h.nest(); h.reply();
  assert.deepEqual(result(h), ['REJECT']);
});
test('日志不含节点名称和底层错误信息', () => {
  const h = run(); h.reply('private-secret');
  assert.ok(!h.state.logs.join('').includes('private-secret'));
  assert.ok(!h.state.logs.join('').includes('美国 01'));
});
test('仅保留请求触发；全部规则目标与脚本及解密主机保持一致', () => {
  const plugin = readFileSync(new URL('../Claude.plugin', import.meta.url), 'utf8');
  const scripts = plugin.split('[Script]')[1].split('[Mitm]')[0].trim().split('\n');
  assert.equal(scripts.length,1);
  assert.ok(scripts[0].startsWith('request if '));
  assert.match(scripts[0], /requires_body=false, timeout=8/);
  assert.ok(!/^(?:cron|generic|network-changed) /m.test(plugin));
  assert.ok(!plugin.includes('#!system ='));
  const pattern = scripts[0].match(/~= \/(.*)\/i then/)[1];
  const match = new RegExp(pattern,'i');
  const rules = plugin.split('[Rule]')[1].split('[Script]')[0].split('\n')
    .map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
  assert.equal(rules.length,42);
  const targets = rules.filter(s=>s.endsWith(',PROXY'));
  assert.equal(targets.length,14);
  const hosts = plugin.split('hostname = ')[1].trim().split(',');
  for (const line of targets) {
    const [kind,domain] = line.split(',');
    assert.ok(match.test(`https://${domain}/api`));
    assert.ok(match.test(`http://${domain}:8080/path`));
    assert.ok(hosts.includes(domain));
    if (kind==='DOMAIN-SUFFIX') {
      assert.ok(match.test(`https://a.b.${domain}/api`));
      assert.ok(hosts.includes(`*.${domain}`));
    }
    assert.ok(!match.test(`https://${domain}.evil.test/`));
    for (const protocol of ['UDP','QUIC']) {
      const guard = `AND,((${kind},${domain}),(PROTOCOL,${protocol})),REJECT`;
      assert.ok(rules.indexOf(guard)>=0 && rules.indexOf(guard)<rules.indexOf(line));
    }
  }
  for (const url of ['https://evilclaude.ai/','https://claude.ai@evil.test/',
    'https://www.gstatic.com/generate_204','https://example.com/?q=claude.ai',
    'https://other.jsdelivr.net/']) assert.ok(!match.test(url),url);
  assert.ok(!source.includes('$persistentStore'));
  assert.ok(!source.includes('setSelectPolicy'));
});
