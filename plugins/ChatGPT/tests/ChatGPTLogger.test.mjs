import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../ChatGPTLogger.js', import.meta.url), 'utf8');
const KEY = 'chatgpt.network.logger.v1';
const local = 'http://chatgpt-logs.invalid';
function runtime(platform) {
  const data = new Map();
  let fail = false;
  function run(request, response) {
    const done = [];
    const context = { $request: request, console: { log() {} }, $done: v => done.push(v) };
    const write = (v, k) => { if (fail) return false; data.set(k, v); return true; };
    if (platform === 'qx') context.$prefs = { valueForKey: k => data.get(k), setValueForKey: write };
    else context.$persistentStore = { read: k => data.get(k), write };
    if (platform === 'loon') context.$loon = 'test';
    if (platform === 'stash') context.$environment = { 'stash-version': 'test' };
    if (platform === 'surge') context.$environment = { 'surge-version': 'test' };
    if (response) context.$response = response;
    vm.runInNewContext(source, context);
    assert.equal(done.length, 1, 'complete exactly once');
    return JSON.parse(JSON.stringify(done[0]));
  }
  function reply(result) { return platform === 'qx' ? result : result.response; }
  function state() { return JSON.parse(data.get(KEY)); }
  function control(action, extra = {}) {
    return reply(run({ url: local + '/' + action + '?token=' + state().token, method: 'POST', headers: { Origin: local }, ...extra }));
  }
  return { data, run, reply, state, control, fail: () => { fail = true; } };
}
for (const platform of ['loon', 'qx', 'stash', 'surge']) {
  test(platform + ': page controls, privacy, pass-through and export', () => {
    const rt = runtime(platform);
    const untouched = rt.run({ url: 'https://chatgpt.com/backend-api/conversation/secret?token=credential', method: 'POST' });
    assert.deepEqual(untouched, {});
    assert.equal(rt.data.size, 0, 'default off does not write business traffic');
    assert.match(rt.reply(rt.run({ url: local + '/', method: 'GET' })).body, /已暂停/);
    assert.match(String(rt.control('start').status), /303/);
    const req = { url: 'https://chatgpt.com/backend-api/conversation/SECRET-ID?token=SECRET-TOKEN', method: 'POST', headers: { Authorization: 'SECRET-AUTH', Cookie: 'SECRET-COOKIE' } };
    Object.defineProperty(req, 'body', { get() { throw Error('must never access request body'); } });
    assert.deepEqual(rt.run(req), {});
    const resp = { status: platform === 'qx' ? undefined : 429, statusCode: platform === 'qx' ? 429 : undefined, headers: { 'Set-Cookie': 'SECRET-RESPONSE-COOKIE' } };
    Object.defineProperty(resp, 'body', { get() { throw Error('must never access response body'); } });
    assert.deepEqual(rt.run(req, resp), {});
    assert.equal(rt.state().events.length, 2);
    assert.equal(rt.state().events[1].status, 429);
    assert.equal(rt.state().events[0].endpoint, 'api');
    const out = rt.reply(rt.run({ url: local + '/export', method: 'GET' }));
    assert.equal(out.headers['Content-Disposition'], 'attachment; filename="chatgpt-network.log"');
    assert.doesNotMatch(out.body, /SECRET/);
    const lines = out.body.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].count, 2);
    assert.equal(lines.length, 3);
    assert.equal(lines[1].host, 'chatgpt.com');
    assert.match(String(rt.control('pause').status), /303/);
    rt.run(req);
    assert.equal(rt.state().events.length, 2);
    rt.control('clear');
    assert.equal(rt.state().events.length, 0);
    assert.equal(rt.state().enabled, false);
  });
  test(platform + ': host boundaries, capacity and local-only controls', () => {
    const rt = runtime(platform);
    rt.run({ url: local + '/', method: 'GET' });
    rt.control('start');
    for (const host of ['chatgpt.com.evil.test', 'evilchatgpt.com', 'openai.com@evil.test', 'challenges.cloudflare.com']) {
      assert.deepEqual(rt.run({ url: 'https://' + host + '/', method: 'GET' }), {});
    }
    assert.equal(rt.state().events.length, 0);
    for (let i = 0; i < 302; i++) rt.run({ url: 'https://files.oaiusercontent.com/private-id', method: 'GET' });
    assert.equal(rt.state().events.length, 300);
    assert.equal(rt.state().evicted, 2);
    assert.match(String(rt.control('clear', { headers: { Origin: 'https://evil.test' } }).status), /403/);
    assert.equal(rt.state().events.length, 300);
    assert.match(String(rt.reply(rt.run({ url: local + '/clear', method: 'GET' })).status), /405/);
    assert.match(String(rt.reply(rt.run({ url: local + '/clear?token=wrong', method: 'POST' })).status), /403/);
    assert.match(String(rt.reply(rt.run({ url: local + '/unknown', method: 'GET' })).status), /404/);
    rt.fail();
    assert.deepEqual(rt.run({ url: 'https://chatgpt.com/', method: 'GET' }), {});
    assert.match(String(rt.control('pause').status), /503/);
    assert.equal(rt.state().enabled, true, 'failed write must not report successful pause');
  });
  test(platform + ': malformed storage is preserved and errors do not block business traffic', () => {
    const rt = runtime(platform);
    rt.data.set(KEY, 'corrupted');
    assert.deepEqual(rt.run({ url: 'https://chatgpt.com/', method: 'GET' }), {});
    assert.match(String(rt.reply(rt.run({ url: local + '/', method: 'GET' })).status), /503/);
    assert.equal(rt.data.get(KEY), 'corrupted');
  });
}
