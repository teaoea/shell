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
function execute(name, args, request, store, response, notification) {
  let result, calls = 0;
  vm.runInNewContext(source(name), {
    $argument: args, ...(request ? { $request: request } : {}), ...(response ? { $response: response } : {}), $persistentStore: store,
    $done: value => { result = JSON.parse(JSON.stringify(value)); calls++; },
    $httpClient: { get: (_req, callback) => callback('secret-server-error-with-user-token', null, null) },
    $notification: notification || { post() {} }
  }, { timeout: 1500 });
  assert.equal(calls, 1);
  return result;
}
const args = { log_enabled: true, enabled: true, query_exclusion: false, google_enabled: true, blocked_domains: 'domain-suffix: privateblacklist.net' };
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
  assert.match(page.response.body, /开发日志 v1\.0\.4/);
  assert.match(page.response.body, /最近记录/);
  assert.doesNotMatch(page.response.body, /<form|Location:|location\.|window\.open|href="\/export"/);
  assert.match(page.response.headers['Content-Security-Policy'], /connect-src 'self'; script-src 'nonce-/);
  assert.equal(page.response.headers.Location, undefined);
  const token = JSON.parse(store.read('search-filter.logs.v1')).token;
  const post = (path, origin, body) => execute('SearchFilterLogger.js', args, { method: 'POST', url: 'http://search-filter-logs.invalid' + path, headers: { Origin: origin }, body }, store);
  assert.equal(post('/pause', 'https://www.google.com', 'token=' + token).response.status, 403);
  assert.equal(post('/pause', 'http://search-filter-logs.invalid', 'token=wrong').response.status, 403);
  assert.equal(post('/pause', 'http://search-filter-logs.invalid', 'token=' + token).response.status, 200);
  execute('SearchFilter.js', args, request, store);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 0);
  assert.equal(post('/start', 'http://search-filter-logs.invalid', 'token=' + token).response.status, 200);
  execute('SearchFilter.js', args, request, store);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 1);
  assert.match(get('/').response.body, /请求发出/);
  assert.equal(post('/clear', 'http://search-filter-logs.invalid', 'token=' + token).response.status, 200);
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
  for (const name of ['SearchFilter.js', 'SearchFilterResponse.js', 'SearchFilterSubscription.js', 'SearchFilterLogger.js', 'SearchFilterLogWatch.js', 'SearchFilterEditor.js']) {
    const embedded = source(name).match(/\/\/ BEGIN GENERATED SEARCH LOG CORE\n([\s\S]*?)\n\/\/ END GENERATED SEARCH LOG CORE/)[1];
    assert.equal(embedded, core.trim(), name);
  }
});

test('state refresh returns sanitized JSON and disabled logging cannot be started', () => {
  const store = memory();
  execute('SearchFilter.js', args, request, store);
  const state = JSON.parse(store.read('search-filter.logs.v1'));
  state.events[0].removed = sensitive;
  state.events[0].recognized = -1;
  state.events[0].unresolved = 0;
  state.events[0].url = sensitive;
  store.write(JSON.stringify(state), 'search-filter.logs.v1');
  const refreshed = execute('SearchFilterLogger.js', { log_enabled: false }, { method: 'GET', url: 'http://search-filter-logs.invalid/state' }, store).response;
  const view = JSON.parse(refreshed.body);
  assert.equal(view.allowed, false);
  assert.equal(refreshed.headers.Location, undefined);
  assert.equal(refreshed.body.includes(sensitive), false);
  assert.equal(view.events[0].removed, undefined);
  assert.equal(view.events[0].recognized, undefined);
  assert.equal(view.events[0].unresolved, 0);
  const started = execute('SearchFilterLogger.js', { log_enabled: false }, { method: 'POST', url: 'http://search-filter-logs.invalid/start', body: 'token=' + state.token }, store).response;
  assert.equal(started.status, 409);
});
test('clearing rotates controls without a redirect and rejects stale token and foreign referer', () => {
  const store = memory();
  execute('SearchFilterLogger.js', args, { method: 'GET', url: 'http://search-filter-logs.invalid/' }, store);
  const token = JSON.parse(store.read('search-filter.logs.v1')).token;
  const post = (path, control, headers = {}) => execute('SearchFilterLogger.js', args, { method: 'POST', url: 'http://search-filter-logs.invalid' + path, body: 'token=' + control, headers }, store).response;
  assert.equal(post('/clear', token, { Referer: 'http://search-filter-logs.invalid.evil.test/' }).status, 403);
  const cleared = post('/clear', token);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.headers.Location, undefined);
  const view = JSON.parse(cleared.body);
  assert.equal(view.active, false);
  assert.notEqual(view.token, token);
  assert.equal(post('/start', token).status, 403);
  assert.equal(post('/start', view.token).status, 200);
});
test('native removal logs counts only, without target names or HTML', () => {
  const store = memory();
  const body = source('tests/fixtures/google-goto.html');
  execute('SearchFilterResponse.js', { ...args, blocked_domains: 'domain-keyword: csdn' }, request, store, { ...response, body });
  const raw = store.read('search-filter.logs.v1');
  assert.equal(raw.includes('csdn'), false);
  assert.equal(raw.includes('developer.mozilla'), false);
  assert.equal(raw.includes('Blocked'), false);
  const event = JSON.parse(raw).events[0];
  assert.equal(event.reason, 'static-and-injected');
  assert.equal(event.recognized, 4);
  assert.equal(event.removed, 2);
  assert.equal(event.unresolved, 0);
});
test('logger embeds the exact UI source and export uses a download instead of navigation', () => {
  const ui = source('src/SearchFilterLogUI.js');
  const embedded = source('SearchFilterLogger.js').match(/\/\/ BEGIN GENERATED SEARCH LOG UI\n([\s\S]*?)\n\/\/ END GENERATED SEARCH LOG UI/)[1];
  assert.equal(embedded, ui.trim());
  assert.match(ui, /URL\.createObjectURL/);
  assert.match(ui, /anchor\.download = 'search-filter-development\.log'/);
  assert.doesNotMatch(ui, /location\.|window\.open|innerHTML|\.reload\(/);
});

test('watcher automatically starts a legacy paused log and posts one fixed local entry notification', () => {
  const store = memory(), notices = [];
  store.write(JSON.stringify({ schema: 1, active: false, token: 'legacytoken123', evicted: 0, events: [{ time: '2026-10-08T10:00:00Z', version: '1.0.3', phase: 'response', reason: 'injected', rules: 2 }] }), 'search-filter.logs.v1');
  const notification = { post: (...values) => notices.push(values) };
  const watch = enabled => execute('SearchFilterLogWatch.js', { log_enabled: enabled }, null, store, null, notification);
  watch(true);
  let state = JSON.parse(store.read('search-filter.logs.v1'));
  assert.equal(state.active, true);
  assert.equal(state.switchOn, true);
  assert.equal(state.announced, true);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].version, '1.0.3');
  assert.equal(notices.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(notices[0][3])), { openUrl: 'http://search-filter-logs.invalid/' });
  assert.match(notices[0][1], /自动开始记录/);
  watch(true);
  watch(true);
  assert.equal(notices.length, 1);
  watch(false);
  state = JSON.parse(store.read('search-filter.logs.v1'));
  assert.equal(state.switchOn, false);
  assert.equal(state.announced, false);
  watch('true');
  assert.equal(notices.length, 2);
});
test('first captured search starts recording and notifies once without query or header data', () => {
  const store = memory(), notices = [];
  const notification = { post: (...values) => notices.push(values) };
  execute('SearchFilter.js', args, request, store, null, notification);
  execute('SearchFilterResponse.js', args, request, store, response, notification);
  execute('SearchFilterLogWatch.js', args, null, store, null, notification);
  assert.equal(notices.length, 1);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 2);
  const raw = JSON.stringify(notices);
  for (const forbidden of [sensitive, 'privateblacklist.net', 'Cookie', '?q=', 'www.google.com']) assert.equal(raw.includes(forbidden), false, forbidden);
  execute('SearchFilter.js', { ...args, log_enabled: false }, request, store, null, notification);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 2);
  execute('SearchFilter.js', args, request, store, null, notification);
  assert.equal(notices.length, 2);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 3);
});
test('watcher respects manual pause and clear until an observed switch off/on transition', () => {
  const store = memory(), notices = [];
  const notification = { post: (...values) => notices.push(values) };
  const watch = enabled => execute('SearchFilterLogWatch.js', { log_enabled: enabled }, null, store, null, notification);
  watch(true);
  const token = JSON.parse(store.read('search-filter.logs.v1')).token;
  const post = path => execute('SearchFilterLogger.js', args, { method: 'POST', url: 'http://search-filter-logs.invalid' + path, body: 'token=' + token }, store, null, notification);
  assert.equal(post('/pause').response.status, 200);
  watch(true);
  execute('SearchFilter.js', args, request, store, null, notification);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).active, false);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).events.length, 0);
  assert.equal(notices.length, 1);
  assert.equal(post('/clear').response.status, 200);
  watch(true);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).active, false);
  assert.equal(notices.length, 1);
  watch(false);
  watch(true);
  assert.equal(JSON.parse(store.read('search-filter.logs.v1')).active, true);
  assert.equal(notices.length, 2);
});
test('default-off watcher does not collect events, write storage, or notify', () => {
  const store = memory();
  let count = 0;
  execute('SearchFilterLogWatch.js', { log_enabled: false }, null, store, null, { post() { count++; } });
  assert.equal(store.values.size, 0);
  assert.equal(count, 0);
  assert.doesNotMatch(source('SearchFilterLogWatch.js'), /\$httpClient|fetch\(|XMLHttpRequest/);
});
test('notification failures leave the search result modification and sanitized recording intact', () => {
  const store = memory();
  const result = execute('SearchFilterResponse.js', args, request, store, response, { post() { throw new Error(sensitive); } });
  assert.match(result.body, /loon-search-filter/);
  const raw = store.read('search-filter.logs.v1');
  assert.equal(raw.includes(sensitive), false);
  assert.equal(JSON.parse(raw).events[0].reason, 'injected');
});
test('auto-start control state is excluded from exported logs', () => {
  const store = memory();
  execute('SearchFilterLogWatch.js', args, null, store);
  execute('SearchFilter.js', args, request, store);
  const result = execute('SearchFilterLogger.js', args, { method: 'GET', url: 'http://search-filter-logs.invalid/export' }, store).response;
  assert.equal(result.status, 200);
  assert.doesNotMatch(result.body, /switchOn|announced|legacytoken|PRIVATE/);
});
