import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const requestSource = fs.readFileSync(new URL('../SearchFilter.js', import.meta.url), 'utf8');
const responseSource = fs.readFileSync(new URL('../SearchFilterResponse.js', import.meta.url), 'utf8');
const subscriptionSource = fs.readFileSync(new URL('../SearchFilterSubscription.js', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../SearchFilter.plugin', import.meta.url), 'utf8');
const defaults = { enabled: true, query_exclusion: true, google_enabled: true, bing_enabled: true, baidu_enabled: true, blocked_domains: 'domain-suffix: csdn.net' };
function run(source, url, args = {}, request = {}, response = {}, globals = {}) {
  const completions = [];
  vm.runInNewContext(source, {
    $argument: { ...defaults, ...args }, $request: { url, method: 'GET', ...request },
    $response: { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<html><body></body></html>', ...response },
    $done: value => completions.push(JSON.parse(JSON.stringify(value))), ...globals
  }, { timeout: 1000 });
  assert.equal(completions.length, 1, 'must finish exactly once');
  return completions[0];
}
const google = 'https://www.google.com/search?q=%E6%97%85%E8%A1%8C+guide&start=10&hl=zh-CN#anchor';

test('three engines append exclusion and preserve other URL bytes', () => {
  for (const [url, key] of [[google, 'q'], ['https://cn.bing.com/search?q=travel&first=11', 'q'], ['https://www.baidu.com/s?wd=travel&pn=10', 'wd'], ['https://m.baidu.com/s?word=travel&pn=10', 'word']]) {
    const result = run(requestSource, url, { blocked_domains: 'DOMAIN-SUFFIX: CSDN.NET\ndomain-suffix: csdn.net\ndomain-suffix: blog.example.com' });
    const next = new URL(result.url);
    assert.match(next.searchParams.get(key), / -site:csdn.net -site:blog.example.com$/);
    assert.ok(result.url.includes(url.slice(url.indexOf('&'))));
    assert.deepEqual(run(requestSource, result.url, { blocked_domains: 'domain-suffix: csdn.net\ndomain-suffix: blog.example.com' }), {});
  }
});
test('quoted exclusions do not suppress an actual exclusion', () => {
  const result = run(requestSource, 'https://www.google.com/search?q=%22-site%3Acsdn.net%22');
  assert.equal(new URL(result.url).searchParams.get('q'), '"-site:csdn.net" -site:csdn.net');
});
test('unknown, disabled, non-web, ambiguous and malformed requests pass through', () => {
  for (const url of ['https://evil.google.com/search?q=x', 'https://www.google.com.evil/search?q=x', 'https://www.google.com/searching?q=x', 'https://www.google.com/search?q=x&tbm=isch', 'https://www.google.com/search?q=x&udm=2', 'https://www.google.com/search?q=a&q=b', 'https://www.google.com/search?q=%ZZ', 'https://www.google.com/search?q=%22oops', 'https://www.baidu.com/s?wd=a&word=b', 'https://www.baidu.com/s?wd=a&tn=news', 'https://m.baidu.com/from=abc/s?word=x', 'https://www.google.com/search?q=', 'http://www.google.com/search?q=x']) {
    assert.deepEqual(run(requestSource, url), {}, url);
  }
  assert.deepEqual(run(requestSource, google, { enabled: false }), run(requestSource, google));
  assert.deepEqual(run(requestSource, google, { query_exclusion: false }), {});
  assert.deepEqual(run(requestSource, google, { google_enabled: false }), {});
  assert.deepEqual(run(requestSource, google, {}, { method: 'POST' }), {});
  for (const blocked_domains of ['', 'csdn *.csdn.*', 'https://user:pw@example.com/ localhost 127.0.0.1 *.com example.com:443 中文.com', 'a'.repeat(8193)]) {
    assert.deepEqual(run(requestSource, google, { blocked_domains }), {});
  }
});

// A small DOM harness verifies host extraction/matching and card boundaries.
// It does not claim live engine markup, CSP enforcement or browser integration.
function cardsFilter(engine, rules, specs, { nonce = '', headers, cache, subscription_url = '' } = {}) {
  const url = engine === 'google' ? 'https://www.google.com/search?q=x' : engine === 'bing' ? 'https://www.bing.com/search?q=x' : 'https://m.baidu.com/s?word=x';
  const body = '<html><body>' + (nonce ? `<script nonce="${nonce}"></script>` : '') + '</body></html>';
  const result = run(responseSource, url, { blocked_domains: rules, subscription_url }, {}, { body, ...(headers ? { headers } : {}) }, cache ? { $persistentStore: { read: () => JSON.stringify(cache) } } : {});
  if (!result.body) return { result, cards: [] };
  const injected = result.body.match(/<script id="loon-search-filter"[^>]*>([\s\S]*?)<\/script>/)[1];
  let observer, timer;
  const cards = specs.map(spec => {
    const attrs = {}, styles = {};
    const link = {
      getAttribute: key => key === 'href' ? spec.url : key === 'data-landurl' ? spec.landurl || '' : '',
      querySelector: () => spec.linkCite ? { textContent: spec.linkCite } : null,
      querySelectorAll: () => spec.linkCite ? [{ textContent: spec.linkCite }] : []
    };
    const card = {
      attrs, styles,
      getAttribute: key => key === 'data-landurl' ? spec.landurl || '' : attrs[key] ?? null,
      setAttribute: (key, value) => { attrs[key] = value; },
      removeAttribute: key => { delete attrs[key]; },
      style: {
        setProperty: (key, value, priority) => { styles[key] = [value, priority]; },
        getPropertyValue: key => styles[key]?.[0] || '',
        getPropertyPriority: key => styles[key]?.[1] || '',
        removeProperty: key => { delete styles[key]; }
      },
      querySelectorAll: selector => selector.includes('cite') ? (spec.cite ? [{ textContent: spec.cite }] : []) : Array(spec.headings || 1).fill({}),
      querySelector: () => spec.cite ? { textContent: spec.cite } : null
    };
    card.heading = { closest: selector => selector === 'a' ? link : card, querySelector: () => link };
    return card;
  });
  const context = {
    URL, location: new URL(url), atob: value => Buffer.from(value, 'base64').toString('binary'),
    document: { querySelectorAll: () => cards.map(card => card.heading), documentElement: {} },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    setTimeout: callback => { timer = callback; }
  };
  vm.runInNewContext(injected, context, { timeout: 1000 });
  return { result, cards, rescan: () => { observer(); timer(); } };
}
function hidden(card) { return card.attrs['data-loon-search-filter'] === 'hidden'; }

test('explicit newline blacklist lists match consistently on all engines', () => {
  const hosts = ['blog.csdn.net', 'example.net', 'sub.example.net', 'blog.example.org', 'example.org', 'normal.org'];
  const lists = ['\ndomain-keyword: csdn\n\ndomain-suffix: example.net\ndomain-suffix: blog.example.org\n', '\r\ndomain-keyword: csdn\r\ndomain-suffix: example.net\r\ndomain-suffix: blog.example.org\r\n'];
  for (const engine of ['google', 'bing', 'baidu']) {
    for (const rules of lists) {
      const { cards } = cardsFilter(engine, rules, hosts.map(host => ({ url: `https://${host}/` })));
      assert.deepEqual(cards.map(hidden), [true, true, true, true, false, false]);
    }
  }
  for (const rules of ['\ndomain-suffix: example.net\n\ndomain-suffix: blog.example.org\n', 'domain-suffix: example.net\r\ndomain-suffix: blog.example.org']) {
    for (const [url, key] of [[google, 'q'], ['https://cn.bing.com/search?q=travel', 'q'], ['https://m.baidu.com/s?word=travel', 'word']]) {
      const result = run(requestSource, url, { blocked_domains: rules });
      assert.match(new URL(result.url).searchParams.get(key), / -site:example.net -site:blog.example.org$/);
    }
  }
});

test('keyword csdn matches the second-level label across TLDs and subdomains', () => {
  const { cards } = cardsFilter('google', 'domain-keyword: csdn', ['csdn.com', 'csdn.net', 'blog.csdn.net', 'notcsdn.com', 'csdn.example.org', 'example.org'].map(host => ({ url: `https://${host}/` })));
  assert.deepEqual(cards.map(hidden), [true, true, true, false, false, false]);
});
test('untyped entries, wildcard rules and missing colon spaces do not match', () => {
  for (const rules of ['csdn', 'csdn.net', '*.csdn.*', 'domain-keyword:csdn', 'domain-keyword:\tcsdn', 'domain-suffix:csdn.net', 'domain-suffix: *.csdn.net', 'domain-suffix: https://csdn.net/', 'domain-keyword: csdn domain-suffix: csdn.net']) {
    for (const engine of ['google', 'bing', 'baidu']) assert.deepEqual(cardsFilter(engine, rules, [{ url: 'https://csdn.net/' }]).result, {}, rules);
    assert.deepEqual(run(requestSource, google, { blocked_domains: rules }), {}, rules);
  }
  const { cards } = cardsFilter('google', 'csdn\ndomain-suffix: normal.org', [{ url: 'https://csdn.net/' }, { url: 'https://normal.org/' }]);
  assert.deepEqual(cards.map(hidden), [false, true]);
});
test('keyword aliases and suffix rules retain strict domain boundaries', () => {
  for (const prefix of ['domain-keyword', 'domian-keyword', 'domain-keywrod', 'domian-keywrod']) {
    const { cards } = cardsFilter('google', prefix + ': csdn', ['csdn.com', 'blog.csdn.net', 'notcsdn.net', 'csdn.example.com'].map(host => ({ url: `https://${host}/` })));
    assert.deepEqual(cards.map(hidden), [true, true, false, false]);
  }
  const { cards } = cardsFilter('google', 'domain-suffix: csdn.com', ['csdn.com', 'blog.csdn.com', 'a.blog.csdn.com', 'csdn.net', 'notcsdn.com', 'csdn.com.evil.net'].map(host => ({ url: `https://${host}/` })));
  assert.deepEqual(cards.map(hidden), [true, true, true, false, false, false]);
});
test('typed local rules share one generated parser and legacy wildcard cache cannot filter', () => {
  const core = fs.readFileSync(new URL('../src/SearchFilterRulesCore.js', import.meta.url), 'utf8').trim();
  const editorSource = fs.readFileSync(new URL('../SearchFilterEditor.js', import.meta.url), 'utf8');
  for (const source of [requestSource, responseSource, subscriptionSource, editorSource]) assert.equal(source.match(/\/\/ BEGIN GENERATED SEARCH RULES CORE\n([\s\S]*?)\n\/\/ END GENERATED SEARCH RULES CORE/)[1], core);
  const downloadCore = fs.readFileSync(new URL('../src/SearchFilterSubscriptionCore.js', import.meta.url), 'utf8').trim();
  for (const source of [subscriptionSource, editorSource]) assert.equal(source.match(/\/\/ BEGIN GENERATED SEARCH SUBSCRIPTION CORE\n([\s\S]*?)\n\/\/ END GENERATED SEARCH SUBSCRIPTION CORE/)[1], downloadCore);
  const cache = { source: 'https://example.org/list.txt', rules: [{ kind: 'url', value: '*.csdn.com' }, { kind: 'url', value: 'bad..com' }] };
  assert.deepEqual(cardsFilter('google', '', [{ url: 'https://csdn.com/' }], { cache, subscription_url: cache.source }).result, {});
});
test('explicit suffix subdomain stays narrow', () => {
  const { cards } = cardsFilter('google', 'domain-suffix: blog.csdn.net', ['csdn.net', 'blog.csdn.net', 'x.blog.csdn.net', 'notblog.csdn.net'].map(host => ({ url: `https://${host}/` })));
  assert.deepEqual(cards.map(hidden), [false, true, true, false]);
});
test('Google redirects and Bing encoded redirects reveal destination host', () => {
  assert.equal(hidden(cardsFilter('google', 'domain-keyword: csdn', [{ url: '/url?q=https%3A%2F%2Fblog.csdn.net%2Fa' }]).cards[0]), true);
  const u = 'a1' + Buffer.from('https://csdn.com/article').toString('base64url');
  assert.equal(hidden(cardsFilter('bing', 'domain-keyword: csdn', [{ url: `/ck/a?u=${u}` }]).cards[0]), true);
});
test('Google opaque goto links use explicit displayed target domains', () => {
  const { cards } = cardsFilter('google', 'domain-keyword: csdn', [
    { url: '/goto?url=CAESeQHrOzAVopaque', linkCite: 'https://blog.csdn.net › user › article › details' },
    { url: '/goto?url=CAESYQHrOzAVopaque', linkCite: 'https://bbs.csdn.net › forums › JavaScript' },
    { url: '/goto?url=CAESTgHrOzAVopaque', cite: 'https://i.csdn.net' },
    { url: '/goto?url=CAEScgHrOzAVopaque', linkCite: 'https://developer.mozilla.org › en-US › JavaScript' },
    { url: '/goto?url=opaque', cite: 'CSDN博客' },
    { url: 'https://normal.org/article', linkCite: 'https://blog.csdn.net › mentioned site' }
  ]);
  assert.deepEqual(cards.map(hidden), [true, true, true, false, false, false]);
});
test('Google url redirect with opaque target falls back to its citation', () => {
  const { cards } = cardsFilter('google', 'domain-keyword: csdn', [
    { url: '/url?url=opaque-token&sa=t', cite: 'blog.csdn.net › article' },
    { url: '/goto?url=opaque', cite: 'https://csdn.net.evil.com › article' },
    { url: '/goto?url=opaque', cite: 'https://notcsdn.net › article' }
  ]);
  assert.deepEqual(cards.map(hidden), [true, false, false]);
});
test('opaque Google links retain csdn.net for a csdn.com-only suffix', () => {
  const { cards } = cardsFilter('google', 'domain-suffix: csdn.com', [
    { url: '/goto?url=opaque', cite: 'https://blog.csdn.com › article' },
    { url: '/goto?url=opaque', cite: 'https://blog.csdn.net › article' }
  ]);
  assert.deepEqual(cards.map(hidden), [true, false]);
});
test('Baidu opaque redirects need explicit target or displayed domain', () => {
  const { cards } = cardsFilter('baidu', 'domain-keyword: csdn', [
    { url: 'https://www.baidu.com/link?url=opaque', cite: 'blog.csdn.net › article' },
    { url: 'https://www.baidu.com/link?url=opaque', landurl: 'https://csdn.com/a' },
    { url: 'https://www.baidu.com/link?url=opaque', cite: 'CSDN 官方网站' },
    { url: 'https://example.org/', cite: 'csdn.net' }
  ]);
  assert.deepEqual(cards.map(hidden), [true, true, false, false]);
});
test('unknown multi-result containers retained and dynamic cards rescanned', () => {
  const dynamic = { url: 'https://example.org/' };
  const fixture = cardsFilter('google', 'domain-keyword: csdn', [{ url: 'https://csdn.net', headings: 2 }, dynamic]);
  assert.deepEqual(fixture.cards.map(hidden), [false, false]);
  dynamic.url = 'https://blog.csdn.com/new-result';
  fixture.rescan();
  assert.deepEqual(fixture.cards.map(hidden), [false, true]);
  dynamic.url = 'https://normal.org/new-result';
  fixture.rescan();
  assert.deepEqual(fixture.cards.map(hidden), [false, false]);
  assert.deepEqual(fixture.cards[1].styles, {});
});
test('blocking a result retains adjacent normal cards and their content', () => {
  for (const engine of ['google', 'bing', 'baidu']) {
    const { cards } = cardsFilter(engine, 'domain-keyword: csdn\ndomain-suffix: example.net', [
      { url: 'https://blog.csdn.net/article' }, { url: 'https://normal.org/article' },
      { url: 'https://example.net/article' }, { url: 'https://notcsdn.com/article' }
    ]);
    assert.deepEqual(cards.map(hidden), [true, false, true, false]);
    assert.deepEqual(cards[1].styles, {});
    assert.deepEqual(cards[1].attrs, {});
    assert.deepEqual(cards[0].styles.display, ['none', 'important']);
  }
});
test('response injection preserves CSP and reuses permitted nonce only', () => {
  const headers = { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'nonce-abc123'" };
  assert.deepEqual(run(responseSource, google, { blocked_domains: 'domain-keyword: csdn' }, {}, { headers }), {});
  const { result } = cardsFilter('google', 'domain-keyword: csdn', [], { nonce: 'abc123', headers });
  assert.match(result.body, /id="loon-search-filter" nonce="abc123"/);
  assert.equal(result.headers, undefined, 'CSP headers are unchanged');
  const metaBody = '<html><body><meta http-equiv="Content-Security-Policy" content="script-src &#39;none&#39;"></body></html>';
  assert.deepEqual(run(responseSource, google, { blocked_domains: 'domain-keyword: csdn' }, {}, { body: metaBody }), {});
});
test('response passes JSON, errors, non-web searches, unknown hosts and empty lists', () => {
  for (const response of [{ headers: { 'Content-Type': 'application/json' } }, { status: 302 }, { body: '<html>fragment' }, { body: '<body><script id="loon-search-filter"></script></body>' }]) {
    assert.deepEqual(run(responseSource, google, {}, {}, response), {});
  }
  for (const url of ['https://evil.google.com/search?q=x', 'https://www.google.com/search?q=x&tbm=isch', 'https://www.google.com/search?q=x&udm=2', 'https://www.baidu.com/s?wd=x&word=y', 'https://www.google.com/search?hl=en']) {
    assert.deepEqual(run(responseSource, url), {});
  }
  assert.deepEqual(run(responseSource, google, { blocked_domains: '' }), {});
  assert.deepEqual(run(responseSource, google, { enabled: false }), run(responseSource, google));
  assert.deepEqual(run(responseSource, google, { blocked_domains: 'https://user:pw@example.com/ 中文.com localhost:443' }), {});
});
test('plugin registers request/response pairs only for declared MitM hosts', () => {
  const version = plugin.match(/#!desc = v([0-9.]+)/)[1];
  for (const match of plugin.matchAll(/script-path=([^,]+)/g)) assert.ok(match[1].endsWith('?v=' + version), 'script cache version must match plugin');
  const hosts = plugin.match(/^hostname = (.*)$/m)[1].split(', ');
  const lines = plugin.split('\n').filter(line => /^http-(?:request|response) \^https:/.test(line));
  assert.equal(lines.length, 6);
  assert.match(plugin, /^#!system = iOS,iPadOS,macOS$/m);
  assert.equal(/^query_exclusion =|^subscription_url =|^(?:google|bing|baidu)_enabled =/m.test(plugin), false);
  for (const line of lines) {
    const pattern = new RegExp(line.split(' ')[1]);
    for (const host of hosts) {
      const engine = host.includes('google.') ? 'google' : host.includes('bing.') ? 'bing' : 'baidu';
      const url = `https://${host}/${engine === 'baidu' ? 's?wd' : 'search?q'}=x`;
      if (line.includes(`${engine === 'google' ? 'Google' : engine === 'bing' ? 'Bing' : '百度'} 搜索`)) assert.ok(pattern.test(url), url);
    }
    assert.equal(pattern.test('https://www.google.com.evil/search?q=x'), false);
    assert.equal(pattern.test('https://www.baidu.com/link?url=x'), false);
  }
});

function updateSubscription(body, { status = 200, error = null, source = 'https://example.org/list.txt' } = {}) {
  const writes = [], completions = [], calls = [];
  vm.runInNewContext(subscriptionSource, {
    $argument: { subscription_url: source },
    $httpClient: { get: (request, callback) => { calls.push(request); callback(error, { status }, body); } },
    $persistentStore: { write: (value, key) => { writes.push({ value: JSON.parse(value), key }); return true; } },
    $done: value => completions.push(value)
  }, { timeout: 1000 });
  assert.equal(completions.length, 1);
  return { writes, completions, calls };
}
test('subscription parses typed rules, comments, case and duplicates', () => {
  const result = updateSubscription('\uFEFF# list\ndomain-keyword: csdn\ndomain-suffix: csdn.com\n[KEY: CSDN]\n// end');
  assert.deepEqual(result.writes[0].value.rules, [{ kind: 'key', value: 'csdn' }, { kind: 'url', value: 'csdn.com' }]);
  assert.equal(result.writes[0].key, 'search-filter.subscription.v1');
  assert.deepEqual(JSON.parse(JSON.stringify(result.calls[0].headers)), { Accept: 'text/plain' });
});
test('invalid subscription and failed downloads keep last cache untouched', () => {
  for (const body of ['<html>error</html>', '[key: csdn]\n[url: bad..com]', '[url: *]', '[url: *.csdn.com]', 'domain-keyword:csdn', 'domain-suffix: *.csdn.com', 'csdn', '[key: csdn.net]', '[url: https://csdn.com]', 'x'.repeat(256 * 1024 + 1)]) {
    assert.equal(updateSubscription(body).writes.length, 0, body.slice(0, 80));
  }
  assert.equal(updateSubscription('[key: csdn]', { status: 404 }).writes.length, 0);
  assert.equal(updateSubscription('[key: csdn]', { error: 'timeout' }).writes.length, 0);
  for (const source of ['', 'http://example.org/list', 'https://user:pw@example.org/list', 'https://example.org/list\n']) {
    const result = updateSubscription('[key: csdn]', { source });
    // Surrounding whitespace is trimmed, as in plugin settings.
    if (source.endsWith('\n')) assert.equal(result.writes.length, 1);
    else { assert.equal(result.writes.length, 0); assert.equal(result.calls.length, 0); }
  }
  assert.deepEqual(updateSubscription('# intentional empty list').writes[0].value.rules, []);
});
test('remote suffix excludes csdn.com while retaining csdn.net', () => {
  const source = 'https://example.org/list.txt';
  const cache = updateSubscription('domain-suffix: csdn.com').writes[0].value;
  const specs = ['csdn.com', 'blog.csdn.com', 'csdn.net', 'blog.csdn.net', 'notcsdn.com'].map(host => ({ url: `https://${host}/` }));
  for (const engine of ['google', 'bing', 'baidu']) {
    const { cards } = cardsFilter(engine, '', specs, { cache, subscription_url: source });
    assert.deepEqual(cards.map(hidden), [true, true, false, false, false]);
  }
});
test('remote key excludes csdn second-level domains without touching other labels', () => {
  const cache = updateSubscription('[key: csdn]').writes[0].value;
  const { cards } = cardsFilter('google', 'domain-suffix: normal.org', ['csdn.com', 'csdn.net', 'blog.csdn.net', 'csdn.example.com', 'normal.org'].map(host => ({ url: `https://${host}/` })), { cache, subscription_url: cache.source });
  assert.deepEqual(cards.map(hidden), [true, true, true, false, true]);
});
test('changing or clearing subscription URL stops using the old cache', () => {
  const cache = updateSubscription('[key: csdn]').writes[0].value;
  for (const subscription_url of ['', 'https://example.org/another-list.txt']) {
    const fixture = cardsFilter('google', '', [{ url: 'https://csdn.net/' }], { cache, subscription_url });
    assert.deepEqual(fixture.result, {});
  }
});
test('optional query exclusion uses only exact remote url rules', () => {
  const cache = updateSubscription('[key: csdn]\ndomain-suffix: csdn.com\n[url: example.net]').writes[0].value;
  const result = run(requestSource, google, { blocked_domains: '', subscription_url: cache.source }, {}, {}, { $persistentStore: { read: () => JSON.stringify(cache) } });
  assert.equal(new URL(result.url).searchParams.get('q'), '旅行 guide -site:csdn.com -site:example.net');
});
test('filter behavior has no browser or User-Agent restriction', () => {
  const agents = ['Safari/605.1.15', 'Chrome/140.0', 'Firefox/143.0', 'Edg/140.0', 'UnknownBrowser/1.0', ''];
  for (const agent of agents) {
    const request = { headers: { 'User-Agent': agent } };
    const rewritten = run(requestSource, google, {}, request);
    assert.match(rewritten.url, /site%3Acsdn.net/);
    const filtered = run(responseSource, google, { blocked_domains: 'domain-keyword: csdn' }, request);
    assert.match(filtered.body, /id="loon-search-filter"/);
  }
  assert.equal(/User-Agent|user-agent/.test(plugin), false);
});
test('plugin hides result cards without blocking access to blacklisted sites', () => {
  assert.equal(plugin.match(/^DOMAIN,.*$/gm).join('\n'), 'DOMAIN,search-filter-logs.invalid,DIRECT\nDOMAIN,search-filter-list.invalid,DIRECT');
  assert.equal(/\bREJECT\b/.test(plugin), false);
  assert.deepEqual(run(requestSource, 'https://csdn.net/article'), {});
  assert.deepEqual(run(responseSource, 'https://csdn.net/article'), {});
});

test('browser bootstrap is inserted before page scripts and listens across document replacement', () => {
  const body = '<html><head><meta charset="utf-8"><script nonce="testnonce">/* Google bootstrap */</script></head><body></body></html>';
  const result = run(responseSource, google, { query_exclusion: false }, {}, { body });
  assert.ok(result.body.indexOf('id="loon-search-filter"') < result.body.indexOf('/* Google bootstrap */'));
  assert.ok(result.body.indexOf('<meta charset="utf-8">') < result.body.indexOf('id="loon-search-filter"'));
  assert.match(result.body, /\.observe\(document,/);
  assert.match(result.body, /DOMContentLoaded/);
  assert.match(result.body, /pageshow/);
  assert.match(result.body, /aria-level/);
  assert.match(result.body, /ob9lvb/);
  assert.doesNotMatch(result.body, /id="loon-search-filter-status"/);
});
test('page execution diagnostic is visible only with logging enabled and sends no network telemetry', () => {
  const result = run(responseSource, google, { query_exclusion: false, log_enabled: true });
  assert.match(result.body, /<aside id="loon-search-filter-status"/);
  assert.match(result.body, /脚本尚未执行/);
  assert.match(result.body, /search-filter-browser.log/);
  const browserCore = fs.readFileSync(new URL('../src/SearchFilterBrowserCore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(browserCore, /\bfetch\(|XMLHttpRequest|sendBeacon|console\./);
  const embedded = responseSource.match(/\/\/ BEGIN GENERATED SEARCH BROWSER CORE\n([\s\S]*?)\n\/\/ END GENERATED SEARCH BROWSER CORE/)[1];
  assert.equal(embedded, browserCore.trim());
});
