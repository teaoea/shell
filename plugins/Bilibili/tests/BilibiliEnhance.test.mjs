import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../BilibiliEnhance.js', import.meta.url), 'utf8');
const plugin = readFileSync(new URL('../BilibiliEnhance.plugin', import.meta.url), 'utf8');
function run(data, argument = {}, path = '/x/v2/feed/index', overrides = {}) {
  const outputs = [];
  const context = {
    $request: { url: 'https://app.bilibili.com' + path + '?build=1', method: 'GET' },
    $response: { status: 200, body: JSON.stringify({ code: 0, data }) },
    $argument: argument,
    $done: value => outputs.push(JSON.parse(JSON.stringify(value))),
    ...overrides
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  assert.equal(outputs.length, 1, 'complete exactly once');
  return outputs[0];
}
const parsed = result => JSON.parse(result.body).data;
const video = (extra = {}) => ({ card_type: 'small_cover_v2', card_goto: 'av', title: '普通视频', args: { up_id: 123 }, ...extra });

test('default filtering removes explicit ads and preserves ordinary / unknown cards', () => {
  const items = [video(), { card_type: 'cm_v2', card_goto: 'ad_av' }, { is_ad: 1 },
    { ad_info: { creative_id: 1 } }, { ad_info: {} }, { is_ad: 0 },
    { card_type: 'new_card', card_goto: 'new_destination' }, null];
  const result = parsed(run({ items, cursor: 'keep' }));
  assert.deepEqual(result.items, [items[0], ...items.slice(4)]);
  assert.equal(result.cursor, 'keep');
});
test('banner filtering preserves non-ad banner entries', () => {
  const items = [{ card_type: 'banner_v8', card_goto: 'banner', banner_item: [{ type: 'ad' }, { type: 'activity' }, null] }, video()];
  assert.deepEqual(parsed(run({ items })).items[0].banner_item, [{ type: 'activity' }, null]);
});
test('empty ad-only banners removed; unknown banners preserved', () => {
  const unknown = { card_type: 'banner_v8', card_goto: 'banner' };
  const items = [{ card_type: 'banner_v8', card_goto: 'banner', banner_item: [{ type: 'ad' }] }, unknown];
  assert.deepEqual(parsed(run({ items })).items, [unknown]);
});
test('ad switch disabled preserves exact response through no-op completion', () => {
  assert.deepEqual(run({ items: [{ is_ad: 1 }] }, { remove_feed_ads: false }), {});
});
test('live and game content remain by default and are independently optional', () => {
  const items = [video(), video({ card_goto: 'live' }), video({ card_goto: 'game' })];
  assert.deepEqual(run({ items }), {});
  assert.deepEqual(parsed(run({ items }, { hide_live: true })).items, [items[0], items[2]]);
  assert.deepEqual(parsed(run({ items }, { hide_game: true })).items, items.slice(0, 2));
});
test('UID matching is exact and only uses recognized owner field', () => {
  const items = [video(), video({ args: { up_id: 1234 } }), video({ args: { up_id: '456' } }), video({ args: {} }), { title: '123' }];
  assert.deepEqual(parsed(run({ items }, { blocked_uids: '123，456 invalid' })).items, [items[1], items[3], items[4]]);
});
test('keywords use literal matching and preserve unknown titles', () => {
  const items = [video({ title: '带货视频' }), video({ title: 'Hello WORLD' }), video({ title: 'a.*b' }), video(), { title: null }];
  assert.deepEqual(parsed(run({ items }, { blocked_keywords: '带货,world,a.*b' })).items, items.slice(3));
  assert.deepEqual(run({ items: [video({ title: 'axxxb' })] }, { blocked_keywords: 'a.*b' }), {});
});
test('Loon object, JSON string and query-string arguments produce same result', () => {
  const data = { items: [video({ title: '测试标题' }), video({ card_goto: 'live' }), video()] };
  const options = { hide_live: true, blocked_keywords: '测试' };
  const expected = run(data, options);
  assert.deepEqual(run(data, JSON.stringify(options)), expected);
  assert.deepEqual(run(data, 'hide_live=true&blocked_keywords=%E6%B5%8B%E8%AF%95'), expected);
});
test('false strings are parsed as false, invalid booleans retain defaults', () => {
  const data = { items: [{ is_ad: 1 }, video({ card_goto: 'live' })] };
  assert.deepEqual(run(data, 'remove_feed_ads=false&hide_live=false'), {});
  assert.deepEqual(parsed(run(data, 'remove_feed_ads=garbage&hide_live=garbage')).items, [data.items[1]]);
});
for (const path of ['/x/v2/splash/list', '/x/v2/splash/show']) {
  test('splash lists cleaned with startup configuration retained: ' + path, () => {
    const data = { list: [{ id: 1 }], show: [{ id: 2 }], min_interval: 100, unknown: true };
    assert.deepEqual(parsed(run(data, {}, path)), { ...data, list: [], show: [] });
    assert.deepEqual(run(data, { remove_splash_ads: false }, path), {});
    assert.deepEqual(run({ show: { unexpected: true } }, {}, path), {});
  });
}
test('navigation filtering is opt-in and reorders surviving numeric positions', () => {
  const data = {
    top: [{ name: '游戏中心', pos: 1 }, { name: '消息', pos: 2 }],
    bottom: [{ name: '首页', pos: 1 }, { name: '会员购', pos: 2 }, { name: '发布', pos: 3 }, { name: '我的', pos: 4 }, { name: '未知' }]
  };
  assert.deepEqual(run(data, {}, '/x/resource/show/tab/v2'), {});
  const result = parsed(run(data, { hide_game: true, hide_member_shop: true, hide_publish: true }, '/x/resource/show/tab/v2'));
  assert.deepEqual(result.top, [{ name: '消息', pos: 1 }]);
  assert.deepEqual(result.bottom, [{ name: '首页', pos: 1 }, { name: '我的', pos: 2 }, { name: '未知' }]);
});
test('schema drift is passed through', () => {
  for (const data of [null, [], {}, { items: {} }, { items: 'unexpected' }]) assert.deepEqual(run(data), {});
});
test('invalid / binary / oversized bodies and API failures pass through', () => {
  for (const body of ['{broken', '', new Uint8Array([1, 2]), 'x'.repeat(2097153), '{"code":-101,"data":{"items":[{"is_ad":1}]}}']) {
    assert.deepEqual(run({}, {}, undefined, { $response: { body } }), {});
  }
});
test('HTTP errors and requests without response are passed through', () => {
  for (const status of [302, 403, 500, 'HTTP/1.1 200 OK']) {
    assert.deepEqual(run({}, {}, undefined, { $response: { status, body: '{"code":0,"data":{"items":[{"is_ad":1}]}}' } }), {});
  }
  assert.deepEqual(run({}, {}, undefined, { $response: undefined }), {});
});
test('malformed parameters fail open without rewriting response', () => {
  assert.deepEqual(run({ items: [{ is_ad: 1 }] }, 'blocked_keywords=%ZZ'), {});
  assert.deepEqual(run({ items: [{ is_ad: 1 }] }, '{broken'), {});
});
test('large numeric IDs pass through to avoid precision loss', () => {
  assert.deepEqual(run({}, {}, undefined, {
    $response: { body: '{"code":0,"data":{"items":[{"is_ad":1}],"id":1234567890123456789}}' }
  }), {});
});
test('Loon configuration passes every option and keeps optional filters disabled', () => {
  const names = [...plugin.matchAll(/^([a-z_]+) = (switch|input),([^,]+),/gm)];
  const line = plugin.split('\n').find(line => line.startsWith('http-response '));
  assert.equal(names.length, 9);
  for (const [, name, type, value] of names) {
    assert.ok(line.includes('{' + name + '}'));
    if (type === 'switch') assert.equal(value, name.startsWith('remove_') ? 'true' : 'false');
    else assert.equal(value, '""');
  }
  assert.match(plugin, /hostname = app\.bilibili\.com\s*$/);
});
test('host/path/method boundaries protect other APIs and lookalike domains', () => {
  for (const url of ['https://app.bilibili.com.evil.test/x/v2/feed/index', 'https://api.bilibili.com/x/v2/feed/index',
    'https://app.bilibili.com/x/v2/feed/index/extra', 'https://app.bilibili.com/x/v2/feed/index/story/extra',
    'https://app.bilibili.com/bilibili.app.view.v1.View/View', 'http://app.bilibili.com/x/v2/feed/index']) {
    assert.deepEqual(run({ items: [{ is_ad: 1 }] }, {}, undefined, { $request: { url } }), {});
  }
  assert.deepEqual(run({ items: [{ is_ad: 1 }] }, {}, undefined, { $request: { url: 'https://app.bilibili.com/x/v2/feed/index', method: 'POST' } }), {});
});
test('plugin regex covers implemented endpoints and rejects extra suffixes', () => {
  const line = plugin.split('\n').find(line => line.startsWith('http-response '));
  const regex = new RegExp(line.split(' ')[1]);
  for (const path of ['/x/v2/splash/list', '/x/v2/splash/show', '/x/v2/feed/index', '/x/v2/feed/index/story', '/x/resource/show/tab', '/x/resource/show/tab/v2']) {
    for (const suffix of ['', '?build=1']) {
      const url = 'https://app.bilibili.com' + path + suffix;
      assert.equal(regex.test(url), true);
      assert.equal(regex.test(url.replace('.com/', '.com:443/')), true);
    }
    assert.equal(regex.test('https://app.bilibili.com' + path + '/extra'), false);
  }
  assert.equal(regex.test('https://app.bilibili.com.evil.test/x/v2/feed/index'), false);
});
