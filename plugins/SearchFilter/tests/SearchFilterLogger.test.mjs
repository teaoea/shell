import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const source = name => fs.readFileSync(new URL(name, root), 'utf8');
const core = source('src/SearchFilterLogCore.js');
function memory() {
  const values = new Map();
  return { values, read: key => values.get(key) || '', write: (value, key) => { values.set(key, value); return true; } };
}
function execute(name, args, request, store, response) {
  let result, calls = 0;
  vm.runInNewContext(source(name), {
    $argument: args, ...(request ? { $request: request } : {}), ...(response ? { $response: response } : {}), $persistentStore: store,
    $done: value => { result = JSON.parse(JSON.stringify(value)); calls++; },
    $httpClient: { get: (_req, callback) => callback('secret-server-error-with-user-token', null, null) },
    $notification: { post() {} }
  }, { timeout: 1500 });
  assert.equal(calls, 1);
  return result;
}
const args = { log_enabled: true, enabled: true, query_exclusion: false, google_enabled: true, blocked_domains: 'privateblacklist.net' };
const sensitive = 'PRIVATE-SEARCH-TOKEN-USER-IDENTIFIER';
const request = { method: 'GET', url: `https://www.google.com/search?q=${sensitive}&email=user%40private.com#${sensitive}`, headers: { Cookie: sensitive, Authorization: sensitive, Referer: sensitive, 'User-Agent': sensitive }, body: sensitive };
const response = { status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': sensitive }, body: `<html><body><div>${sensitive}</div></body></html>` };

test('request and response logs exclude query, fragment, headers, body, blacklist and subscription URL', () => {
  const store = memory();
  execute('SearchFilter.js', args, request, store);
  execute('SearchFilterResponse.js', { ...args, subscription_url: `https://private.example/list?token=${sensitive}` }, request, store, response);
  const raw = store.read('search-filter.logs.v1');
  for (const forbidden of [sensitive, 'user@private.com', 'privateblacklist.net', 'private.example', 'Cookie', 'Authorization', 'User-Agent', '?q=', '#']) assert.equal(raw.includes(forbidden), false, forbidden);
  const state = JSON.parse(raw);
  assert.deepEqual(state.events.map(event => [event.phase, event.reason]), [['request', 'query-disabled'], ['response', 'injected']]);
  assert.equal(state.events[1].rules, 1);
});
test('logs are default-off and storage failures leave filtering operational', () => {
  const store = memory();
  execute('SearchFilter.js', { ...args, log_enabled: false }, request, store);
  execute('SearchFilterResponse.js', { ...args, log_enabled: false }, request, store, response);
  assert.equal(store.values.size, 0);
  const result = execute('SearchFilterResponse.js', args, request, { read() { throw new Error(sensitive); }, write() { throw new Error(sensitive); } }, response);
  assert.match(result.body, /loon-search-filter/);
});
test('CSP denial and missing rules are distinct events without raw policy', () => {
  const store = memory();
  execute('SearchFilterResponse.js', args, request, store, { ...response, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': `script-src 'nonce-${sensitive}'` } });
  execute('SearchFilterResponse.js', { ...args, blocked_domains: '' }, request, store, response);
  const raw = store.read('search-filter.logs.v1');
  assert.equal(raw.includes(sensitive), false);
  assert.deepEqual(JSON.parse(raw).events.map(event => event.reason), ['csp-blocked', 'no-rules']);
});
test('subscription errors record fixed outcome without remote URL or error message', () => {
  const store = memory();
  execute('SearchFilterSubscription.js', { log_enabled: true, subscription_url: `https://private.example/list?token=${sensitive}` }, null, store);
  const raw = store.read('search-filter.logs.v1');
  assert.equal(raw.includes('private.example'), false);
  assert.equal(raw.includes(sensitive), false);
  assert.equal(raw.includes('secret-server-error'), false);
  assert.equal(JSON.parse(raw).events[0].reason, 'download-failed');
});
test('export revalidates stored fields and excludes internal control token', () => {
  const store = memory();
  execute('SearchFilter.js', args, request, store);
  const state = JSON.parse(store.read('search-filter.logs.v1'));
  state.events[0].url = sensitive;
  state.events[0].headers = { Cookie: sensitive };
  state.events[0].host = sensitive;
  state.events[0].time = sensitive;
  state.events[0].rules = sensitive;
  store.write(JSON.stringify(state), 'search-filter.logs.v1');
  const result = execute('SearchFilterLogger.js', { log_enabled: false }, { method: 'GET', url: 'http://search-filter-logs.invalid/export' }, store);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.body.includes(sensitive), false);
  assert.equal(result.response.body.includes(state.token), false);
  assert.equal(result.response.headers['Access-Control-Allow-Origin'], undefined);
});
test('local page pause/start/clear controls require same-origin and token', () => {
  const store = memory();
  const get = path => execute('SearchFilterLogger.js', args, { method: 'GET', url: 'http://search-filter-logs.invalid' + path }, store);
  const page = get('/');
  assert.match(page.response.body, /开发日志 v1\.0\.1/);
  assert.match(page.response.body, /阶段/);
  const token = JSON.parse(store.read('search-filter.logs.v1')).token;
  const post = (path, origin, body) => execute('SearchFilterLogger.js', args, { method: 'POST', url: 'http://search-filter-logs.invalid' + path, headers: { Origin: origin }, body }, store);
  assert.equal(post('/pause', 'https://www.google.com', 'token=' + token).response.status, 403);
  assert.equal(post('/pause', 'http://search-filter-logs.invalid', 'token=wrong').response.status, 403);
  assert.equal(post('/pause', 'http://search-filter-logs.invalid', 'token=' + token).response.status, 303);
  execute('SearchFilter.js', args, request, store);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 0);
  assert.equal(post('/start', 'http://search-filter-logs.invalid', 'token=' + token).response.status, 303);
  execute('SearchFilter.js', args, request, store);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 1);
  assert.match(get('/').response.body, /请求发出/);
  assert.equal(post('/clear', 'http://search-filter-logs.invalid', 'token=' + token).response.status, 303);
  const state = JSON.parse(store.read('search-filter.logs.v1'));
  assert.equal(state.active, false);
  assert.equal(state.events.length, 0);
  assert.notEqual(state.token, token);
});
test('metadata ring caps storage at 300 entries and drops excess events', () => {
  const store = memory();
  vm.runInNewContext(core + '\nfor(var i=0;i<305;i++)sfLogRecord({log_enabled:true},{phase:"response",reason:"injected",engine:"google",rules:1});', { $persistentStore: store });
  const state = JSON.parse(store.read('search-filter.logs.v1'));
  assert.equal(state.events.length, 300);
  assert.equal(state.evicted, 5);
});
test('generated scripts contain the identical privacy allowlist core', () => {
  for (const name of ['SearchFilter.js', 'SearchFilterResponse.js', 'SearchFilterSubscription.js', 'SearchFilterLogger.js']) {
    const embedded = source(name).match(/\/\/ BEGIN GENERATED SEARCH LOG CORE\n([\s\S]*?)\n\/\/ END GENERATED SEARCH LOG CORE/)[1];
    assert.equal(embedded, core.trim(), name);
  }
});
