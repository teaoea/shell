import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const core = source('src/SearchFilterHTMLCore.js');
const context = vm.createContext({});
vm.runInContext(source('src/SearchFilterEnginesCore.js') + '\n' + core, context);
const rules = [{ kind: 'key', value: 'csdn' }];
const filter = (html, list = rules) => JSON.parse(JSON.stringify(context.sfFilterHTML(html, 'google', 'www.google.com', list)));
const card = (href, cite = '', title = 'Sample result') => `<div class="MjjYud"><div class="tF2Cxc"><a href="${href}">${cite ? `<cite>${cite}</cite>` : ''}<h3>${title}</h3></a><p>Preserve other content</p></div></div>`;
const page = content => `<html><body><div id="rso">${content}</div></body></html>`;

test('native Google filter removes opaque csdn.net results and preserves adjacent normal HTML bytes', () => {
  const normal = card('https://developer.mozilla.org/', '', 'Normal page about csdn');
  const lookalike = card('/goto?url=FAKE', 'https://notcsdn.net');
  const blocked = card('/goto?url=FAKE', 'https://blog.csdn.net › article');
  const result = filter(page(blocked + normal + lookalike));
  assert.equal(result.removed, 1);
  assert.equal(result.recognized, 3);
  assert.equal(result.unresolved, 0);
  assert.equal(result.body.includes('blog.csdn.net'), false);
  assert.equal(result.body.includes(normal), true);
  assert.equal(result.body.includes(lookalike), true);
});
test('native suffix csdn.com retains csdn.net and unknown branded destinations', () => {
  const com = card('/goto?url=FAKE', 'https://a.blog.csdn.com');
  const net = card('/goto?url=FAKE', 'https://csdn.net');
  const brand = card('/goto?url=FAKE', 'CSDN');
  const result = filter(page(com + net + brand), [{ kind: 'url', value: 'csdn.com' }]);
  assert.equal(result.removed, 1);
  assert.equal(result.unresolved, 1);
  assert.equal(result.body.includes(net + brand), true);
});
test('native redirect/entity parsing and known normal destination precedence', () => {
  const blocked = card('/url?url=https%3A%2F%2Fcsdn.net%2Fpost&amp;other=fake');
  const normal = card('https://normal.example/', 'https://csdn.net');
  assert.equal(filter(page(blocked + normal)).body, page('<div class="MjjYud"></div>' + normal));
  const entity = card('/goto?url=fake', 'https://&#99;sdn.net');
  assert.equal(filter(page(entity)).removed, 1);
});
test('native tokenizer ignores fake headings inside scripts, comments, nested templates and raw text', () => {
  const fake = card('https://csdn.net/');
  const inert = `<script>var sample='${fake}';</script><!--${fake}--><style>${fake}</style><textarea>${fake}</textarea><template><template>${fake}</template>${fake}</template><noscript>${fake}</noscript>`;
  const input = page(inert + card('https://normal.example/'));
  assert.equal(filter(input).body, input);
  assert.equal(filter(input).recognized, 1);
});
test('native filter retains unknown roots, malformed cards, mixed cards and conflicting citations', () => {
  const blocked = card('https://csdn.net/');
  const inputs = [
    `<html><body>${blocked}</body></html>`,
    page('<div class="tF2Cxc"><a href="https://csdn.net"><h3>Sample</h3></a><span></div>'),
    page('<div class="tF2Cxc"><a href="https://csdn.net"><h3>Sample</h3></a>'),
    page('<div class="tF2Cxc"><a href="https://csdn.net"><h3>Sample</h3></a><a href="https://normal.example"><h3>Other</h3></a></div>'),
    page(card('/goto?url=fake', 'https://csdn.net</cite><cite>https://normal.example')),
  ];
  for (const input of inputs) assert.equal(filter(input).body, input);
});
test('response removes initial Google results with query exclusion off even when scripts are forbidden', () => {
  let result;
  const input = page(card('/goto?url=fake', 'https://csdn.net') + card('https://normal.example'));
  vm.runInNewContext(source('SearchFilterResponse.js'), {
    $argument: { enabled: true, google_enabled: true, query_exclusion: false, blocked_domains: 'domain-keyword: csdn' },
    $request: { method: 'GET', url: 'https://www.google.com/search?q=sample' },
    $response: { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'none'" }, body: input },
    $done: value => { result = value; }
  });
  assert.equal(result.body.includes('https://csdn.net'), false);
  assert.equal(result.body.includes('https://normal.example'), true);
  assert.equal(result.body.includes('loon-search-filter'), false);
  assert.equal(result.headers, undefined);
});
test('response embeds the same native HTML core', () => {
  const embedded = source('SearchFilterResponse.js').match(/\/\/ BEGIN GENERATED SEARCH HTML CORE\n([\s\S]*?)\n\/\/ END GENERATED SEARCH HTML CORE/)[1];
  assert.equal(embedded, core.trim());
});

test('native Google observed structure removes two csdn results without touching normal neighbors', () => {
  const fixture = source('tests/fixtures/google-goto.html');
  const result = filter(fixture);
  assert.equal(result.recognized, 4);
  assert.equal(result.removed, 2);
  assert.equal(result.body.includes('blog.csdn.net'), false);
  assert.equal(result.body.includes('bbs.csdn.net'), false);
  assert.equal(result.body.includes('developer.mozilla.org'), true);
  assert.equal(result.body.includes('Keep normal result description'), true);
  assert.equal(result.body.includes('notcsdn.net'), true);
});
test('native URL parser does not confuse credentials or invalid authorities with a target domain', () => {
  const cases = ['https://csdn.net:secret@normal.example/', 'https://csdn.net@normal.example/', 'https://csdn.net:invalid/', 'https://csdn.net:999999/'];
  for (const href of cases) {
    const html = page(card(href));
    assert.equal(filter(html).body, html);
  }
  assert.equal(filter(page(card('https://csdn.net:443/post'))).removed, 1);
});

test('native Google mobile role headings and ob9lvb URLs are filtered without h3 or cite', () => {
  const input = source('tests/fixtures/google-mobile.html');
  const result = filter(input);
  assert.equal(result.recognized, 4);
  assert.equal(result.removed, 2);
  assert.equal(result.unresolved, 0);
  assert.equal(result.body.includes('Blocked mobile fixture'), false);
  assert.equal(result.body.includes('Blocked com mobile fixture'), false);
  assert.equal(result.body.includes('Keep normal description'), true);
  assert.equal(result.body.includes('Keep lookalike description'), true);
  const narrow = filter(input, [{ kind: 'url', value: 'csdn.com' }]);
  assert.equal(narrow.removed, 1);
  assert.equal(narrow.body.includes('blog.csdn.net'), true);
});
test('native mobile sibling links resolve only one unambiguous presentation link', () => {
  const title = '<div role="heading" aria-level="3">Sample</div>';
  const known = '<div class="vt6azd"><a class="UBFage" href="https://csdn.net/">Link</a>' + title + '</div>';
  assert.equal(filter(page(known)).removed, 1);
  const mixed = '<div class="vt6azd"><a class="UBFage" href="https://csdn.net/">One</a><a role="presentation" href="https://normal.example/">Other</a>' + title + '<div class="ob9lvb">https://csdn.net</div></div>';
  assert.equal(filter(page(mixed)).body, page(mixed));
  const normal = '<div class="Ww4FFb"><a href="https://normal.example"><div role="heading" aria-level="3">Sample</div></a><div class="ob9lvb">https://csdn.net</div></div>';
  assert.equal(filter(page(normal)).body, page(normal));
});
test('native mobile mixed normal and blacklisted headings in one container are retained', () => {
  const html = page('<div class="Ww4FFb"><a href="https://csdn.net"><div role="heading" aria-level="3">One</div></a><a href="https://normal.example"><h3>Other</h3></a></div>');
  assert.equal(filter(html).body, html);
});
