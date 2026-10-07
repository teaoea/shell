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

test('default search text is blanked for public app schema without touching metadata', () => {
  for (const path of ['/x/v2/search/default', '/x/v2/search/defaultwords']) {
    const data = { show: '推荐文字', word: '推荐词', param: '推荐跳转', trackid: 'keep', future: 1 };
    assert.deepEqual(parsed(run(data, {}, path)), { ...data, show: '', word: '', param: '' });
    assert.deepEqual(run({ show: '', word: '', param: '' }, {}, path), {});
  }
  assert.deepEqual(parsed(run([{ word: '推荐' }], {}, '/x/v2/search/defaultwords')), []);
  assert.deepEqual(parsed(run({ show_name: '推荐', list: [{ word: '词' }], history: ['输入'] }, {}, '/x/v2/search/default')),
    { show_name: '', list: [], history: ['输入'] });
  for (const path of ['/x/v2/search', '/x/v2/search/suggest', '/x/v2/search/history'])
    assert.deepEqual(run({ show: '手动输入', word: '输入' }, {}, path), {});
});

test('legacy default search clears target links and alternate API host is supported', () => {
  const data = { show: '推荐', uri: 'bilibili://video/123', goto: 'av', value: '123', trackid: 'keep' };
  const result = run(data, {}, '/x/v2/search/defaultwords', { $request: { url: 'https://app.biliapi.net/x/v2/search/defaultwords', method: 'GET' } });
  assert.deepEqual(parsed(result), { show: '', uri: '', goto: '', value: '', trackid: 'keep' });
});

test('mine membership cleanup covers alternate host while preserving identity and normal services', () => {
  const data = { vip_section: { title: '我的大会员' }, vip_section_v2: { title: '续费' }, modular_vip_section: { title: '会员中心' },
    vip: { status: 1, type: 2, label: { text: '年度大会员' } }, sections_v2: [{ items: [{ title: '历史记录' }] }] };
  for (const path of ['/x/v2/account/mine', '/x/v2/account/mine/ipad']) {
    const result = run(data, {}, path, { $request: { url: 'https://app.biliapi.net' + path, method: 'GET' } });
    assert.deepEqual(parsed(result), { vip: data.vip, sections_v2: data.sections_v2 });
    const regex = new RegExp(plugin.split('\n').find(line => line.startsWith('http-response ')).split(' ')[1]);
    assert.equal(regex.test('https://app.biliapi.net' + path), true);
    assert.equal(regex.test('https://app.biliapi.net.evil.test' + path), false);
  }
});

test('homepage tab collection, selection, fallback, restoration and privacy', () => {
  const store = new Map();
  const overrides = { $persistentStore: { read: key => store.get(key), write: (value, key) => { store.set(key, value); return true; } } };
  const tabs = [{ id: 39, tab_id: '直播tab', name: '直播', pos: 1, default_selected: 1, uri: 'bilibili://live/?token=SECRET' },
    { id: 40, tab_id: '推荐tab', name: '推荐', pos: 2 }, { id: 41, tab_id: 'hottopic', name: '热门', pos: 3 }];
  const path = '/x/resource/show/tab/v2';
  const page = (path, method = 'GET', body, headers) => run({}, {}, path, { ...overrides,
    $request: { url: 'http://bilibili-logs.invalid' + path, method, body, headers }, $response: undefined }).response;
  assert.deepEqual(run({ tab: tabs }, {}, path, overrides), {});
  assert.ok(![...store.values()].join('').includes('SECRET'));
  assert.match(page('/tabs').body, /直播/);
  assert.equal(page('/tabs/save', 'POST', '').status, 400);
  assert.equal(page('/tabs/save', 'POST', 'tab=unknown').status, 400);
  assert.equal(page('/tabs/save', 'GET').status, 405);
  assert.equal(page('/tabs/save', 'POST', 'tab=tab%3A推荐tab', { Origin: 'https://evil.example' }).status, 403);
  assert.equal(page('/tabs/save', 'POST', 'tab=' + encodeURIComponent('tab:推荐tab')).status, 200);
  const selected = parsed(run({ tab: tabs, top: [{ name: '消息' }], bottom: [{ name: '我的' }] }, {}, path, overrides));
  assert.deepEqual(selected.tab, [{ ...tabs[1], pos: 1, default_selected: 1 }]);
  assert.deepEqual(selected.bottom, [{ name: '我的' }]);
  assert.deepEqual(run({ tab: [tabs[0]] }, {}, path, overrides), {});
  const fresh = { id: 9, tab_id: 'new', name: '新标签' };
  assert.deepEqual(parsed(run({ tab: [...tabs, fresh] }, {}, path, overrides)).tab, selected.tab);
  assert.match(page('/tabs').body, /新标签/);
  assert.equal(page('/tabs/reset', 'POST').status, 200);
  assert.deepEqual(run({ tab: tabs }, {}, path, overrides), {});
  assert.match(page('/tabs').body, /新标签/);
});

test('tab settings survive disabled logging and escape labels and reject failed saves', () => {
  const store = new Map();
  let fail = false;
  const overrides = { $persistentStore: { read: key => store.get(key), write: (value, key) => { if (fail) return false; store.set(key, value); return true; } } };
  run({ tab: [{ id: 1, name: '<img src=x>' }] }, {}, '/x/resource/show/tab', overrides);
  const page = (path, method = 'GET', body) => run({}, {}, path, { ...overrides,
    $request: { url: 'http://bilibili-logs.invalid' + path, method, body }, $response: undefined }).response;
  assert.match(page('/tabs').body, /&lt;img src=x&gt;/);
  assert.equal(page('/tabs/save', 'POST', 'tab=id%3A1').status, 200);
  assert.deepEqual(JSON.parse(store.get('bilibili.enhance.tabs.v1')).selected, ['id:1']);
  page('/');
  assert.deepEqual(JSON.parse(store.get('bilibili.enhance.tabs.v1')).selected, ['id:1']);
  fail = true;
  assert.equal(page('/tabs/reset', 'POST').status, 503);
});

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
test('large numeric IDs retain their exact literals while ads are filtered', () => {
  const result = run({}, {}, undefined, {
    $response: { body: '{"code":0,"data":{"items":[{"is_ad":1}],"id":1234567890123456789}}' }
  });
  assert.equal(result.body, '{"code":0,"data":{"items":[],"id":1234567890123456789}}');
});
test('search discovery is opt-in and preserves history and unknown modules', () => {
  const modules = [{ type: 'trending', title: '热搜', data: { list: [{ keyword: '词条' }] } },
    { type: 'history', title: '搜索历史' },
    { type: 'recommend', title: '搜索发现', data: { list: [{ keyword: '推荐' }] } },
    { type: 'future_module', title: '搜索发现' }, null];
  const path = '/x/v2/search/square';
  assert.deepEqual(run(modules, {}, path), {});
  assert.deepEqual(run(modules, { hide_search_discovery: 'false' }, path), {});
  for (const options of [{ hide_search_discovery: true }, 'hide_search_discovery=true', '{"hide_search_discovery":true}']) {
    assert.deepEqual(parsed(run(modules, options, path)), [modules[1], ...modules.slice(3)]);
  }
});
test('search ranking clears both hot lists and preserves metadata', () => {
  const data = { list: [{ keyword: '热搜' }], top_list: [{ keyword: '置顶' }], trackid: 'keep', future: [1] };
  const path = '/x/v2/search/trending/ranking';
  assert.deepEqual(run(data, {}, path), {});
  assert.deepEqual(parsed(run(data, { hide_search_discovery: true }, path)),
    { ...data, list: [], top_list: [] });
  assert.deepEqual(run({ list: [], top_list: [] }, { hide_search_discovery: true }, path), {});
});
test('search filtering ignores unexpected schemas and unrelated search APIs', () => {
  for (const [path, data] of [['/x/v2/search/square', { items: [{ type: 'recommend' }] }],
    ['/x/v2/search/trending/ranking', [{ type: 'trending' }]],
    ['/x/v2/search/square', [{ type: 'history' }, { title: '热搜' }]],
    ['/x/v2/search', { items: [{ type: 'recommend' }] }],
    ['/x/v2/search/suggest', { list: [{ keyword: '输入联想' }] }],
    ['/x/v2/search/default/extra', { show_name: '默认词' }],
    ['/x/v2/search/square/extra', [{ type: 'recommend' }]]]) {
    assert.deepEqual(run(data, { hide_search_discovery: true }, path), {});
  }
});
test('member shop switch filters merchandise in both feed routes independently of ads', () => {
  const products = [{ card_goto: 'mall' }, { uri: 'bilibili://mall/detail/123' },
    { uri: 'https://mall.bilibili.com/neul/index.html?id=123' },
    { rcmd_reason_style: { text: '会员购' } }, { desc_button: { text: '会员购' } }];
  const keep = [video({ title: '会员购商品评测', args: { up_name: '哔哩哔哩会员购' } }),
    { uri: 'https://mall.bilibili.com.evil.test/' }, { uri: 'bilibili://mallard/home' },
    { uri: 'https://www.bilibili.com/video/BV123?url=https://mall.bilibili.com/' },
    { rcmd_reason_style: { text: '会员购商品评测' } }, null];
  for (const path of ['/x/v2/feed/index', '/x/v2/feed/index/story']) {
    assert.deepEqual(run({ items: [...products, ...keep] }, { remove_feed_ads: false }, path), {});
    assert.deepEqual(parsed(run({ items: [...products, ...keep] },
      { hide_member_shop: true, remove_feed_ads: false }, path)).items, keep);
  }
});
test('lossless filtering preserves numbers, escaped strings and unknown keys', () => {
  const raw = '{"code":0,"data":{"items":[{"card_goto":"mall"}],"large":-1234567890123456789,"exp":1e999,"decimal":9007199254740993.25,"text":"\\u005f_bili_raw_number__0","__bili_raw_number___0":"keep","quoted":"\\\"1234567890123456789\\\""}}';
  const result = run({}, { hide_member_shop: true }, undefined, { $response: { body: raw } });
  assert.match(result.body, /"large":-1234567890123456789/);
  assert.match(result.body, /"exp":1e999/);
  assert.match(result.body, /"decimal":9007199254740993\.25/);
  const data = parsed(result);
  assert.equal(data.text, '__bili_raw_number__0');
  assert.equal(data.__bili_raw_number___0, 'keep');
  assert.equal(data.quoted, '"1234567890123456789"');
  assert.deepEqual(data.items, []);
});
test('large owner IDs can be blocked exactly without rounding', () => {
  const raw = '{"code":0,"data":{"items":[{"args":{"up_id":1234567890123456789}},{"args":{"up_id":1234567890123456788}}]}}';
  const result = run({}, { blocked_uids: '1234567890123456789' }, undefined, { $response: { body: raw } });
  assert.equal(result.body, '{"code":0,"data":{"items":[{"args":{"up_id":1234567890123456788}}]}}');
});
test('unmodified large numbers and malformed numeric JSON are passed through', () => {
  for (const raw of ['{"code":0,"data":{"items":[],"id":1234567890123456789}}',
    '{"code":0,"data":{"items":[{"is_ad":1}],"id":01234567890123456789}}',
    '{"code":0,"data":{"items":[{"is_ad":1}],"id":1234567890123456789e}}']) {
    assert.deepEqual(run({}, {}, undefined, { $response: { body: raw } }), {});
  }
});
test('Loon configuration passes every option and keeps optional filters disabled', () => {
  const names = [...plugin.matchAll(/^([a-z_]+) = (switch|input),([^,]+),/gm)];
  const line = plugin.split('\n').find(line => line.startsWith('http-response '));
  assert.equal(names.length, 10);
  for (const [, name, type, value] of names) {
    assert.ok(line.includes('{' + name + '}'));
    if (type === 'switch') assert.equal(value, name.startsWith('remove_') ? 'true' : 'false');
    else assert.equal(value, '""');
  }
  assert.match(plugin, /hostname = app\.bilibili\.com,grpc\.biliapi\.net,app\.biliapi\.net,api\.bilibili\.com,data\.bilibili\.com\s*$/);
});
for (const path of ['/x/v2/account/mine', '/x/v2/account/mine/ipad']) {
  test('mine membership promotion is removed by default without altering account or services: ' + path, () => {
    const data = {
      vip_section: { title: '续订会员' }, vip_section_v2: { title: '开通会员' },
      modular_vip_section: { button: { title: '会员中心' } },
      vip: { status: 1, type: 2, due_date: 1893456000000, label: { text: '年度大会员' } },
      vip_type: 2, name: '账号', mid: 123,
      sections_v2: [{ title: '创作中心', items: [{ title: '历史记录' }, { title: '我的收藏' }] }],
      future_section: { title: '续订会员' }
    };
    const { vip_section, vip_section_v2, modular_vip_section, ...keep } = data;
    assert.deepEqual(parsed(run(data, {}, path)), keep);
    assert.deepEqual(parsed(run(data, { remove_feed_ads: false, hide_member_shop: false }, path)), keep);
    assert.deepEqual(run(keep, {}, path), {});
  });
}
test('mine filtering only applies to registered endpoints and preserves large numeric account fields', () => {
  const raw = '{"code":0,"data":{"vip_section":{"title":"续订会员"},"mid":1234567890123456789,"vip":{"status":1}}}';
  const result = run({}, {}, '/x/v2/account/mine', { $response: { body: raw } });
  assert.equal(result.body, '{"code":0,"data":{"mid":1234567890123456789,"vip":{"status":1}}}');
  for (const path of ['/x/v2/account/myinfo', '/x/v2/account/mine/extra', '/x/v2/feed/index']) {
    assert.deepEqual(run({ vip_section: { title: '续订会员' } }, {}, path), {});
  }
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
  for (const path of ['/x/v2/splash/list', '/x/v2/splash/show', '/x/v2/splash/brand/list', '/x/v2/feed/index', '/x/v2/feed/index/story', '/x/resource/show/tab', '/x/resource/show/tab/v2', '/x/v2/search/square', '/x/v2/search/trending/ranking', '/x/v2/account/mine', '/x/v2/account/mine/ipad', '/x/v2/search/default', '/x/v2/search/defaultwords']) {
    for (const suffix of ['', '?build=1']) {
      const url = 'https://app.bilibili.com' + path + suffix;
      assert.equal(regex.test(url), true);
      assert.equal(regex.test(url.replace('.com/', '.com:443/')), true);
    }
    assert.equal(regex.test('https://app.bilibili.com' + path + '/extra'), false);
  }
  assert.equal(regex.test('https://app.bilibili.com.evil.test/x/v2/feed/index'), false);
});

test('splash event list is cleared along with display schedule, while unknown startup settings and switch are preserved',()=>{
 const path='/x/v2/splash/event/list2';
 const data={event_list:[{id:1}],show:[{id:1}],pull_interval:1800,future:{keep:1}};
 assert.deepEqual(parsed(run(data,{},path)),{...data,event_list:[],show:[]});
 assert.deepEqual(run(data,{remove_splash_ads:false},path),{});
 assert.deepEqual(run({...data,event_list:[],show:[]},{},path),{});
 assert.deepEqual(run({event_list:{unknown:1},show:'unknown'},{},path),{});
 const filter=new RegExp(plugin.split('\n').find(l=>l.startsWith('http-response ')).split(' ')[1]);
 const meta=new RegExp(plugin.split('\n').find(l=>l.includes('tag=Bilibili 开发元数据日志')).split(' ')[1]);
 assert.equal(filter.test('https://app.bilibili.com'+path),true);assert.equal(meta.test('https://app.bilibili.com'+path),false);
 assert.equal(filter.test('https://app.bilibili.com'+path+'/extra'),false);
 const store=new Map();run(data,{log_enabled:true},path,{$persistentStore:{read:k=>store.get(k),write:(v,k)=>{store.set(k,v);return true;}}});
 const event=JSON.parse(store.get('bilibili.enhance.logs.v1')).events[0];assert.equal(event.removed,2);assert.equal(event.data_schema.event_list,'array');
});

test('brand splash filters explicit ads only and preserves ordinary illustrations and startup configuration',()=>{
 const path='/x/v2/splash/brand/list';
 const illustration={thumb:'https://example.com/illustration.jpg',thumb_name:'普通插画'};
 const data={list:[illustration,{is_ad:1},{is_ad:'1'},{ad_info:{campaign:1}},null],show:[{is_ad:true},illustration],min_interval:100,future:{keep:true}};
 assert.deepEqual(parsed(run(data,{},path)),{...data,list:[illustration,null],show:[illustration]});
 assert.deepEqual(run(data,{remove_splash_ads:false},path),{});
 assert.deepEqual(run({list:[illustration],unknown:true},{},path),{});
 assert.deepEqual(run({list:{unknown:true}},{},path),{});
});
