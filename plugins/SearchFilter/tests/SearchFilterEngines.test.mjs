import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const source = name => fs.readFileSync(new URL(name, root), 'utf8');
const fixtures = JSON.parse(source('tests/fixtures/engines.json'));
const context = {};
vm.runInNewContext(source('src/SearchFilterEnginesCore.js') + '\n' + source('src/SearchFilterHTMLCore.js'), context);
const clone = value => JSON.parse(JSON.stringify(value));
function execute(name, url, body, extra = {}) {
  let result, calls = 0;
  vm.runInNewContext(source(name), {
    $argument: { blocked_domains: 'domain-suffix: example.com', ...Object.fromEntries(context.sfEngines.map(entry => [entry.id + '_enabled', true])), ...extra.args },
    $request: { method: 'GET', url, ...extra.request },
    $response: { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'none'" }, body, ...extra.response },
    ...(extra.store ? { $persistentStore: extra.store } : {}),
    $done: value => { result = clone(value); calls++; }
  }, { timeout: 1500 });
  assert.equal(calls, 1);
  return result;
}
for (const [index, fixture] of fixtures.entries()) {
  test(`native ${fixture.engine} layout ${index}: removes target, preserves adjacent normal and lookalike results without JavaScript`, () => {
    const card = fixture.body.match(/<body>([\s\S]*)<\/body>/)[1];
    const normal = card.replaceAll('blog.example.com', 'normal.example.org').replaceAll('Sample', 'Normal mentioning example.com');
    const lookalike = card.replaceAll('blog.example.com', 'notexample.com').replaceAll('Sample', 'Lookalike');
    const input = fixture.body.replace('</body>', normal + lookalike + '</body>');
    const native = clone(context.sfFilterHTML(input, fixture.engine, new URL(fixture.url).hostname, [{ kind: 'url', value: 'example.com' }]));
    assert.equal(native.removed, 1);
    assert.equal(native.body.includes(normal), true);
    assert.equal(native.body.includes(lookalike), true);
    const incoming = execute('SearchFilterResponse.js', fixture.url, input);
    assert.equal(incoming.body, native.body, 'CSP prevents injection but native result removal remains active');
    assert.equal(incoming.headers, undefined);
    assert.deepEqual(execute('SearchFilter.js', fixture.url, input), {}, 'query exclusion stays off by default');
    assert.deepEqual(execute('SearchFilterResponse.js', fixture.url, input, { args: { [fixture.engine + '_enabled']: false } }), {});
  });
}
test('expanded engines use their own query parameter and only supported engines append optional exclusion', () => {
  for (const fixture of fixtures) {
    const result = execute('SearchFilter.js', fixture.url + '&offset=10&lang=zh#sample', '', { args: { query_exclusion: true } });
    const entry = context.sfEngine(fixture.engine);
    if (entry.queryExclusion) {
      const key = entry.query.find(key => new URL(fixture.url).searchParams.has(key));
      assert.equal(new URL(result.url).searchParams.get(key), 'sample -site:example.com');
      assert.equal(result.url.endsWith('&offset=10&lang=zh#sample'), true);
      assert.deepEqual(execute('SearchFilter.js', result.url, '', { args: { query_exclusion: true } }), {});
    } else assert.deepEqual(result, {});
  }
});
test('specialty searches, duplicate parameters and foreign hosts stay untouched', () => {
  for (const url of ['https://duckduckgo.com/?q=x&ia=images', 'https://duckduckgo.com/?q=x&ia=chat', 'https://search.brave.com/images?q=x', 'https://yandex.com/images/search?text=x', 'https://www.sogou.com/web?query=x&query=y', 'https://www.sogou.com/web?query=x&keyword=y', 'https://www.startpage.com/sp/search?query=x&cat=images', 'https://www.so.com/s?q=%ZZ', 'https://m.sm.cn/s?q=', 'https://www.ecosia.org/login?q=x', 'https://news.search.yahoo.com/search?p=x', 'https://search.yahoo.com.evil.net/search?p=x']) {
    assert.deepEqual(execute('SearchFilter.js', url, '', { args: { query_exclusion: true } }), {}, url);
    assert.deepEqual(execute('SearchFilterResponse.js', url, '<html><body></body></html>', { response: { headers: { 'Content-Type': 'text/html' } } }), {}, url);
  }
});
test('opaque links cannot be resolved from a brand name or a citation outside the result', () => {
  for (const fixture of fixtures) {
    let unknown = fixture.body.replaceAll('blog.example.com', 'SAMPLE').replaceAll('https://SAMPLE/article', 'javascript:void(0)');
    assert.equal(context.sfFilterHTML(unknown, fixture.engine, new URL(fixture.url).hostname, [{ kind: 'url', value: 'example.com' }]).removed, 0, fixture.engine);
  }
  for (const engine of ['duckduckgo', 'yahoo', 'sogou', 'so', 'ecosia', 'startpage']) {
    const f = fixtures.find(f => f.engine === engine);
    // Multiple destination citations never provide an inferred domain.
    const unknown = f.body.replaceAll('blog.example.com', 'SAMPLE').replace('</body>', '<cite>example.com</cite></body>');
    assert.equal(context.sfFilterHTML(unknown, engine, new URL(f.url).hostname, [{ kind: 'url', value: 'example.com' }]).removed, 0);
  }
});
test('old three-engine settings migrate without changing rules or enabling new engines', () => {
  const values = new Map([['search-filter.blacklist.v1', JSON.stringify({ schema: 1, override: true, token: 'testmigrationtoken123', rules: [{ kind: 'key', value: 'example' }], settings: { engines: { google: false, bing: true, baidu: false }, query_exclusion: false, subscription_url: '' } })]]);
  const store = { read: key => values.get(key) || '', write: (value, key) => { values.set(key, value); return true; } };
  const state = JSON.parse(execute('SearchFilterEditor.js', 'http://search-filter-list.invalid/state', '', { store }).response.body);
  assert.deepEqual(state.rules, [{ kind: 'key', value: 'example' }]);
  assert.equal(state.engines.length, 12);
  assert.deepEqual(Object.entries(state.settings.engines).filter(([, enabled]) => enabled).map(([id]) => id), ['bing']);
  const settings = { ...state.settings, engines: { ...state.settings.engines, duckduckgo: true, yahoo: true } };
  const saved = execute('SearchFilterEditor.js', 'http://search-filter-list.invalid/settings', '', { store, request: { method: 'POST', headers: { Origin: 'http://search-filter-list.invalid' }, body: JSON.stringify({ token: state.token, settings }) } });
  assert.equal(saved.response.status, 200);
  for (const fixture of fixtures.filter(f => ['duckduckgo', 'yahoo', 'brave'].includes(f.engine))) {
    const result = execute('SearchFilterResponse.js', fixture.url, fixture.body, { store });
    if (fixture.engine === 'brave') assert.deepEqual(result, {});
    else assert.equal(result.body.includes('Sample'), false);
  }
});
test('expanded logs preserve only fixed engine host/path metadata and original versions', () => {
  const c = {}; vm.runInNewContext(source('src/SearchFilterEnginesCore.js') + '\n' + source('src/SearchFilterLogCore.js'), c);
  for (const f of fixtures) {
    const url = new URL(f.url);
    const event = clone(c.sfLogClean({ phase: 'response', reason: 'static-removed', engine: f.engine, host: url.hostname, path: url.pathname, rules: 1, removed: 1, query: 'PRIVATE', url: f.url, body: 'PRIVATE', target: 'PRIVATE', version: '1.0.5' }));
    assert.equal(event.engine, f.engine); assert.equal(event.host, url.hostname); assert.equal(event.path, url.pathname);
    assert.equal(event.version, '1.0.5'); assert.equal(JSON.stringify(event).includes('PRIVATE'), false);
    const rejected = c.sfLogClean({ ...event, host: 'PRIVATE', path: '/PRIVATE', engine: 'PRIVATE' });
    assert.equal(rejected.host, undefined); assert.equal(rejected.path, undefined); assert.equal(rejected.engine, undefined);
  }
});

test('mixed containers, malformed result cards and SVG icons preserve safe native boundaries', () => {
  const blocked = '<li class="b_algo"><h2><a href="https://example.com">Blocked</a></h2></li>';
  const normal = '<li class="b_algo"><h2><a href="https://normal.org">Normal</a></h2></li>';
  for (const card of [blocked.replace('</li>', normal + '</li>'), blocked.replace('</h2>', '<span></h2>'), blocked.replace('</li>', '')]) {
    const input = '<html><body><ul id="b_results">' + card + '</ul></body></html>';
    assert.equal(context.sfFilterHTML(input, 'bing', 'www.bing.com', [{ kind: 'url', value: 'example.com' }]).body, input);
  }
  const svg = blocked.replace('<h2>', '<svg><path d="sample" /></svg><h2>');
  const input = '<html><body><ul id="b_results">' + svg + normal + '</ul></body></html>';
  const result = context.sfFilterHTML(input, 'bing', 'www.bing.com', [{ kind: 'url', value: 'example.com' }]);
  assert.equal(result.removed, 1); assert.equal(result.body.includes(normal), true);
  const direct = '<li class="b_algo"><h2><a href="https://normal.org/article?id=1&id=2">Normal</a></h2><cite>example.com</cite></li>';
  assert.equal(context.sfFilterHTML('<ul id="b_results">' + direct + '</ul>', 'bing', 'www.bing.com', [{ kind: 'url', value: 'example.com' }]).removed, 0);
});
