import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const BASE = 'http://search-filter-list.invalid';
function memory() {
  const data = new Map();
  return { data, read: key => data.get(key) || '', write: (value, key) => { data.set(key, value); return true; } };
}
function execute(name, store, request, args = {}, response, client) {
  let result, done = 0, notices = [];
  vm.runInNewContext(source(name), { $persistentStore: store, $argument: args, ...(request ? { $request: request } : {}), ...(response ? { $response: response } : {}), ...(client ? { $httpClient: client } : {}), $notification: { post: (...items) => notices.push(JSON.parse(JSON.stringify(items))) }, $done: value => { result = JSON.parse(JSON.stringify(value)); done++; } }, { timeout: 1000 });
  assert.equal(done, 1);
  return { result, notices };
}
function page(store, path = '/state') { return execute('SearchFilterEditor.js', store, { method: 'GET', url: BASE + path }).result.response; }
function save(store, text, token = JSON.parse(page(store).body).token, headers = { Origin: BASE }) {
  return execute('SearchFilterEditor.js', store, { method: 'POST', url: BASE + '/save', headers, body: JSON.stringify({ token, text }) }).result.response;
}
function settings(store, changes) {
  const state = JSON.parse(page(store).body);
  return execute('SearchFilterEditor.js', store, { method: 'POST', url: BASE + '/settings', headers: { Origin: BASE }, body: JSON.stringify({ token: state.token, settings: { ...state.settings, ...changes } }) }).result.response;
}
test('native input and filter master switch are removed and local entry has a manual button', () => {
  const plugin = source('SearchFilter.plugin');
  assert.equal(/^blocked_domains =|^enabled =/m.test(plugin), false);
  assert.equal(/^(?:google|bing|baidu)_enabled =|^subscription_url =|^query_exclusion =/m.test(plugin), false);
  assert.match(plugin, /^generic .*SearchFilterEditor\.js\?v=1\.0\.5.*tag=添加黑名单/m);
  assert.match(plugin, /^http-request .*search-filter-list.*requires-body=true/m);
  const store = memory(), manual = execute('SearchFilterEditor.js', store);
  assert.equal(store.data.size, 0);
  assert.equal(manual.notices[0][3].openUrl, BASE + '/');
});
test('local page embeds its exact source, prefix buttons, secure headers and no external requests', () => {
  const store = memory(), response = page(store, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /id="keyword"[^>]*>domain-keyword/);
  assert.match(response.body, /id="suffix"[^>]*>domain-suffix/);
  assert.equal(source('SearchFilterEditor.js').match(/\/\/ BEGIN GENERATED SEARCH EDITOR UI\n([\s\S]*?)\n\/\/ END GENERATED SEARCH EDITOR UI/)[1], source('src/SearchFilterEditorUI.js').trim());
  assert.match(response.headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(/\$httpClient|console\.|sendBeacon|https:\/\/|<script src=/.test(source('src/SearchFilterEditorUI.js')), false);
  assert.equal(store.data.has('search-filter.logs.v1'), false);
});
test('web saves normalize and deduplicate typed rules and reject stale tokens and foreign origins', () => {
  const store = memory(), token = JSON.parse(page(store).body).token;
  const saved = save(store, 'DOMAIN-KEYWORD: CSDN\ndomain-suffix: csdn.com\ndomain-keyword: csdn', token);
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.body).rules, [{ kind: 'key', value: 'csdn' }, { kind: 'url', value: 'csdn.com' }]);
  assert.notEqual(JSON.parse(saved.body).token, token);
  const before = store.read('search-filter.blacklist.v1');
  assert.equal(save(store, '', token).status, 403);
  assert.equal(save(store, '', JSON.parse(saved.body).token, { Origin: 'https://evil.example' }).status, 403);
  assert.equal(save(store, '', JSON.parse(saved.body).token, { Referer: 'http://search-filter-list.invalid.evil/' }).status, 403);
  assert.equal(store.read('search-filter.blacklist.v1'), before);
  assert.equal(save(store, '').status, 200);
  assert.deepEqual(JSON.parse(page(store).body).rules, []);
});
test('malformed rules, untyped entries, wildcards and excessive lists cannot replace saved rules', () => {
  const store = memory(); save(store, 'domain-suffix: normal.org');
  const before = store.read('search-filter.blacklist.v1');
  for (const text of ['csdn', 'domain-keyword:csdn', 'domain-suffix: *.csdn.com', 'domain-keyword: csdn\ncsdn.net', 'domain-keyword: csdn.net', Array.from({ length: 101 }, (_, i) => 'domain-suffix: d' + i + '.example').join('\n'), 'x'.repeat(8193)]) {
    assert.equal(save(store, text).status, 400, text.slice(0, 50));
    assert.equal(store.read('search-filter.blacklist.v1'), before);
  }
});
test('saving and deleting local rules immediately changes native filtering and optional query conditions', () => {
  const store = memory(); save(store, 'domain-keyword: csdn\ndomain-suffix: example.net');
  const request = { method: 'GET', url: 'https://www.google.com/search?q=sample' };
  const response = { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'none'" }, body: '<html><body><div id="rso"><div class="g"><a href="https://csdn.net/"><h3>Blocked</h3></a></div><div class="g"><a href="https://normal.org/"><h3>Normal</h3></a></div></div></body></html>' };
  const filtered = execute('SearchFilterResponse.js', store, request, { google_enabled: true }, response).result;
  assert.equal(filtered.body.includes('Blocked'), false);
  assert.equal(filtered.body.includes('Normal'), true);
  assert.equal(settings(store, { query_exclusion: true }).status, 200);
  const rewritten = execute('SearchFilter.js', store, request).result;
  assert.equal(new URL(rewritten.url).searchParams.get('q'), 'sample -site:example.net');
  save(store, '');
  assert.deepEqual(execute('SearchFilterResponse.js', store, request, { google_enabled: true }, response).result, {});
});
test('saved engine checkboxes govern the entire local and remote blacklist in request and response', () => {
  const store = memory(); save(store, 'domain-suffix: csdn.net');
  store.write(JSON.stringify({ source: 'https://example.org/list', rules: [{ kind: 'url', value: 'remote.example' }] }), 'search-filter.subscription.v1');
  const selected = { google: true, bing: false, baidu: false };
  assert.equal(settings(store, { engines: selected, query_exclusion: true, subscription_url: 'https://example.org/list' }).status, 200);
  for (const [engine, url] of [['google', 'https://www.google.com/search?q=sample'], ['bing', 'https://www.bing.com/search?q=sample'], ['baidu', 'https://m.baidu.com/s?word=sample']]) {
    const req = { method: 'GET', url }, res = { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body></body></html>' };
    const outgoing = execute('SearchFilter.js', store, req).result;
    const incoming = execute('SearchFilterResponse.js', store, req, {}, res).result;
    if (selected[engine]) { assert.match(outgoing.url, /site%3Acsdn.net/); assert.match(outgoing.url, /site%3Aremote.example/); assert.match(incoming.body, /loon-search-filter/); }
    else { assert.deepEqual(outgoing, {}); assert.deepEqual(incoming, {}); }
  }
  settings(store, { engines: { google: false, bing: false, baidu: false } });
  assert.deepEqual(execute('SearchFilter.js', store, { method: 'GET', url: 'https://www.google.com/search?q=sample' }).result, {});
});
test('subscription settings require valid public HTTPS and settings updates preserve saved rules', () => {
  const store = memory(); save(store, 'domain-keyword: csdn');
  const before = store.read('search-filter.blacklist.v1');
  for (const subscription_url of ['http://example.org/list', 'https://user:pw@example.org/list', 'https://example.org/list#secret', 'https://example.org:8443/list']) {
    assert.equal(settings(store, { subscription_url }).status, 400);
    assert.equal(store.read('search-filter.blacklist.v1'), before);
  }
  assert.equal(settings(store, { subscription_url: 'https://example.org/list' }).status, 200);
  assert.deepEqual(JSON.parse(page(store).body).rules, [{ kind: 'key', value: 'csdn' }]);
});
test('web subscription refresh uses configured URL and shared parser without copying browser headers', () => {
  const store = memory(); settings(store, { subscription_url: 'https://example.org/list' });
  let call;
  const client = { get: (req, callback) => { call = JSON.parse(JSON.stringify(req)); callback(null, { status: 200 }, 'domain-suffix: csdn.com\ndomain-keyword: csdn'); } };
  let state = JSON.parse(page(store).body);
  const request = { method: 'POST', url: BASE + '/subscription', headers: { Origin: BASE, Cookie: 'secret-cookie', Authorization: 'secret-auth' }, body: JSON.stringify({ token: state.token }) };
  const response = execute('SearchFilterEditor.js', store, request, { log_enabled: true }, undefined, client).result.response;
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).subscription.count, 2);
  assert.deepEqual(call.headers, { Accept: 'text/plain' });
  assert.equal(call['auto-cookie'], false);
  for (const forbidden of ['secret-cookie', 'secret-auth', 'csdn', 'https://example.org/list']) assert.equal(store.read('search-filter.logs.v1').includes(forbidden), false);
  const before = store.read('search-filter.subscription.v1');
  const failed = execute('SearchFilterEditor.js', store, request, {}, undefined, { get: (_req, callback) => callback(null, { status: 200 }, 'domain-suffix: *.csdn.com') }).result.response;
  assert.equal(failed.status, 502); assert.equal(store.read('search-filter.subscription.v1'), before);
  settings(store, { subscription_url: '' });
  assert.equal(JSON.parse(page(store).body).subscription.count, 0);
  assert.deepEqual(execute('SearchFilterResponse.js', store, { method: 'GET', url: 'https://www.google.com/search?q=x' }, {}, { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body></body></html>' }).result, {});
});
test('editor errors keep private values out of diagnostic logs and finish safely', () => {
  const store = memory(); save(store, 'domain-keyword: privatekeyword');
  const req = { method: 'GET', url: 'https://www.google.com/search?q=private-search' };
  execute('SearchFilter.js', store, req, { google_enabled: true, log_enabled: true });
  assert.equal(store.read('search-filter.logs.v1').includes('privatekeyword'), false);
  assert.equal(store.read('search-filter.logs.v1').includes('blacklist.v1'), false);
  const broken = { read: () => { throw new Error('private-store-detail'); }, write: () => false };
  const failed = execute('SearchFilterEditor.js', broken, { method: 'GET', url: BASE + '/' }).result.response;
  assert.equal(failed.status, 500);
  assert.equal(failed.body.includes('private-store-detail'), false);
});
