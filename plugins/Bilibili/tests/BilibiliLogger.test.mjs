import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../BilibiliEnhance.js', import.meta.url), 'utf8');
const plugin = readFileSync(new URL('../BilibiliEnhance.plugin', import.meta.url), 'utf8');
const KEY = 'bilibili.enhance.logs.v1';
const secret = 'PRIVATE_CANARY_TOKEN_abc123';
function harness(initial) {
  let stored = initial;
  let reads = 0;
  let writes = 0;
  let broken = false;
  const consoleOutput = [];
  function run(overrides = {}) {
    const outputs = [];
    vm.runInNewContext(source, {
      $request: { url: 'https://app.bilibili.com/x/v2/feed/index?access_key=' + secret, method: 'GET', headers: { Authorization: secret, Cookie: secret } },
      $response: { status: 200, headers: { 'Set-Cookie': secret }, body: JSON.stringify({ code: 0, data: { items: [{ is_ad: 1, title: secret, args: { up_id: secret }, ad_info: { token: secret }, [secret]: secret }] }, token: secret }) },
      $argument: { log_enabled: true, blocked_keywords: secret, blocked_uids: secret },
      $persistentStore: {
        read(key) { assert.equal(key, KEY); reads++; if (broken) throw Error(secret); return stored; },
        write(value, key) { assert.equal(key, KEY); writes++; if (broken) return false; stored = value; return true; }
      },
      console: { log(value) { consoleOutput.push(value); } },
      $done(value) { outputs.push(JSON.parse(JSON.stringify(value))); },
      ...overrides
    }, { timeout: 1000 });
    assert.equal(outputs.length, 1);
    return outputs[0];
  }
  const page = (path = '/', method = 'GET', headers = {}) => run({ $request: { url: 'http://bilibili-logs.invalid' + path, method, headers }, $response: undefined });
  return { run, page, stored: () => stored, reads: () => reads, writes: () => writes, consoleOutput, fail() { broken = true; } };
}
test('disabled logger does not read or write persistent storage', () => {
  const h = harness();
  h.run({ $argument: {} });
  h.run({ $argument: 'log_enabled=false' });
  assert.equal(h.reads(), 0); assert.equal(h.writes(), 0);
});
test('storage and export exclude secrets from headers, queries, values and keys', () => {
  const h = harness(); h.run();
  const event = JSON.parse(h.stored()).events[0];
  assert.equal(event.endpoint, '/x/v2/feed/index');
  assert.equal(event.outcome, 'modified');
  assert.equal(event.before, 1); assert.equal(event.after, 0); assert.equal(event.removed, 1);
  assert.equal(event.item_schema.title, 'string');
  assert.equal(event.item_schema.ad_info, 'object');
  for (const text of [h.stored(), h.page('/export').response.body, JSON.stringify(h.consoleOutput), h.page().response.body]) assert.ok(!text.includes(secret));
});
test('unknown card types and destinations are mapped to fixed other category', () => {
  const h = harness();
  h.run({ $response: { body: JSON.stringify({ code: 0, data: { items: [{ card_type: secret, card_goto: secret, title: secret }] } }) } });
  assert.deepEqual(JSON.parse(h.stored()).events[0].cards, [{ type: 'other', goto: 'other', count: 1 }]);
  assert.ok(!h.stored().includes(secret));
});
test('unregistered endpoint paths are never persisted; metadata scripts do not read body', () => {
  const h = harness();
  const response = { status: 200 };
  Object.defineProperty(response, 'body', { get() { throw Error('body must not be accessed'); } });
  h.run({ $request: { url: 'https://app.bilibili.com/account/' + secret + '?token=' + secret, method: 'POST' }, $response: response });
  let event = JSON.parse(h.stored()).events[0];
  assert.equal(event.endpoint, 'other_api'); assert.equal(event.outcome, 'metadata_only');
  h.run({ $request: { url: 'https://app.bilibili.com/bilibili.app.dynamic.v2.Dynamic/DynAll', method: 'POST' }, $response: response });
  event = JSON.parse(h.stored()).events[1];
  assert.equal(event.endpoint, '/bilibili.app.dynamic.v2.Dynamic/DynAll');
  assert.ok(!h.stored().includes(secret));
});
test('other hosts are excluded from developer logs', () => {
  const h = harness();
  for (const host of ['api.bilibili.com', 'grpc.biliapi.net', 'app.bilibili.com.evil.test']) {
    assert.deepEqual(h.run({ $request: { url: 'https://' + host + '/x/v2/feed/index' } }), {});
  }
  assert.equal(h.writes(), 0);
});
test('malformed response errors do not include exception text or raw body', () => {
  const h = harness();
  h.run({ $response: { body: '{' + secret } });
  assert.equal(JSON.parse(h.stored()).events[0].outcome, 'invalid_json');
  assert.ok(!h.stored().includes(secret));
  assert.deepEqual(h.consoleOutput, []);
});
test('turning logging off keeps prior entries and page can export them', () => {
  const h = harness(); h.run();
  const previous = h.stored();
  h.run({ $argument: { log_enabled: false } });
  assert.equal(h.stored(), previous);
  const result = h.run({ $request: { url: 'http://bilibili-logs.invalid/export' }, $response: undefined, $argument: { log_enabled: false } });
  assert.equal(JSON.parse(result.response.body.split('\n')[0]).count, 1);
  assert.match(result.response.headers['Content-Disposition'], /bilibili-development\.log/);
});
test('entry count is bounded and oldest event is evicted', () => {
  const h = harness();
  for (let i = 0; i < 305; i++) h.run();
  const state = JSON.parse(h.stored());
  assert.equal(state.events.length, 300); assert.equal(state.evicted, 5);
  assert.ok(h.stored().length <= 262144);
});
test('polluted stored events are projected again before export', () => {
  const event = {
    endpoint: '/x/v2/feed/index', outcome: 'unchanged', method: secret, status: secret, time: secret,
    token: secret, data_schema: { [secret]: secret, title: secret, items: 'array' },
    cards: [{ type: secret, goto: secret, count: secret, token: secret }]
  };
  const h = harness(JSON.stringify({ events: [event, { token: secret }], evicted: secret, nonce: secret }));
  const exported = h.page('/export').response.body;
  assert.ok(!exported.includes(secret));
  const rows = exported.trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].count, 1); assert.equal(rows[1].method, 'OTHER');
  assert.deepEqual(rows[1].data_schema, { items: 'array' });
});
test('serialized storage limit can evict entries before count limit', () => {
  const h = harness();
  const items = Array.from({ length: 20 }, (_, index) => ({
    card_type: ['cm_v2', 'cm_double_v9', 'banner_v8', 'small_cover_v2'][index % 4],
    card_goto: ['av', 'game', 'live', 'banner', 'ad_av'][Math.floor(index / 4)],
    title: secret, args: { up_id: secret }, ad_info: {}, is_ad: false, banner_item: []
  }));
  const response = { body: JSON.stringify({ code: 0, data: { items, list: [], show: [], top: [], bottom: [] } }) };
  for (let i = 0; i < 305; i++) h.run({ $response: response });
  const state = JSON.parse(h.stored());
  assert.ok(h.stored().length <= 262144);
  assert.ok(state.events.length < 300);
  assert.equal(state.events.length + state.evicted, 305);
  assert.ok(!h.stored().includes(secret));
});
test('storage failures never change normal filtering result or leak exception', () => {
  const h = harness(); h.fail();
  const result = h.run();
  assert.deepEqual(JSON.parse(result.body).data.items, []);
  assert.equal(h.page().response.status, 503);
  assert.deepEqual(h.consoleOutput, []);
});
test('corrupt store is preserved, filtering continues and page reports failure', () => {
  const h = harness('broken_' + secret);
  assert.deepEqual(JSON.parse(h.run().body).data.items, []);
  assert.equal(h.stored(), 'broken_' + secret);
  const result = h.page('/export');
  assert.equal(result.response.status, 503); assert.ok(!result.response.body.includes(secret));
});
test('clear requires POST, current nonce and same origin; export excludes nonce', () => {
  const h = harness(); h.run(); h.page();
  const nonce = JSON.parse(h.stored()).nonce;
  assert.ok(!h.page('/export').response.body.includes(nonce));
  assert.equal(h.page('/clear?nonce=' + nonce).response.status, 405);
  assert.equal(h.page('/clear?nonce=bad', 'POST').response.status, 403);
  assert.equal(h.page('/clear?nonce=' + nonce, 'POST', { Origin: 'https://evil.test' }).response.status, 403);
  assert.equal(JSON.parse(h.stored()).events.length, 1);
  assert.equal(h.page('/clear?nonce=' + nonce, 'POST', { Origin: 'http://bilibili-logs.invalid' }).response.status, 303);
  assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
});
test('logger routes are disjoint and optional metadata hook does not buffer body', () => {
  const lines = plugin.split('\n').filter(line => line.startsWith('http-response '));
  assert.equal(lines.length, 2);
  const [filter, metadata] = lines.map(line => new RegExp(line.split(' ')[1]));
  for (const path of ['/x/v2/feed/index', '/x/v2/feed/index/story', '/x/v2/splash/show', '/x/resource/show/tab/v2']) {
    for (const suffix of ['', '?token=' + secret]) {
      const url = 'https://app.bilibili.com' + path + suffix;
      assert.equal(filter.test(url), true); assert.equal(metadata.test(url), false);
    }
  }
  assert.equal(metadata.test('https://app.bilibili.com/bilibili.app.dynamic.v2.Dynamic/DynAll'), true);
  assert.match(lines[1], /requires-body=false/); assert.match(lines[1], /enable=\{log_enabled\}/);
  const pageLine = plugin.split('\n').find(line => line.startsWith('http-request '));
  assert.doesNotMatch(pageLine, /enable=/);
});
