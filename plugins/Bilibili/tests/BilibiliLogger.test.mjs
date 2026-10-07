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
  const notifications = [];
  const auxiliary = new Map();
  function run(overrides = {}) {
    const outputs = [];
    vm.runInNewContext(source, {
      $request: { url: 'https://app.bilibili.com/x/v2/feed/index?access_key=' + secret, method: 'GET', headers: { Authorization: secret, Cookie: secret } },
      $response: { status: 200, headers: { 'Set-Cookie': secret }, body: JSON.stringify({ code: 0, data: { items: [{ is_ad: 1, title: secret, args: { up_id: secret }, ad_info: { token: secret }, [secret]: secret }] }, token: secret }) },
      $argument: { log_enabled: true, blocked_keywords: secret, blocked_uids: secret },
      $persistentStore: {
        read(key) { if (broken) throw Error(secret); if (key !== KEY) return auxiliary.get(key); reads++; return stored; },
        write(value, key) { if (broken) return false; if (key !== KEY) { auxiliary.set(key, value); return true; } writes++; stored = value; return true; }
      },
      $notification: { post(...args) { notifications.push(JSON.parse(JSON.stringify(args))); } },
      console: { log(value) { consoleOutput.push(value); } },
      $done(value) { outputs.push(JSON.parse(JSON.stringify(value))); },
      ...overrides
    }, { timeout: 1000 });
    assert.equal(outputs.length, 1);
    return outputs[0];
  }
  const page = (path = '/', method = 'GET', headers = {}) => run({ $request: { url: 'http://bilibili-logs.invalid' + path, method, headers }, $response: undefined });
  return { run, page, stored: () => stored, reads: () => reads, writes: () => writes, consoleOutput, notifications, fail() { broken = true; } };
}
test('default search content is not retained in logs or export', () => {
  const h = harness();
  h.run({ $request: { url: 'https://app.bilibili.com/x/v2/search/defaultwords?token=' + secret },
    $response: { status: 200, body: JSON.stringify({ code: 0, data: { show: secret, word: secret, param: secret, trackid: secret } }) } });
  assert.equal(JSON.parse(h.stored()).events[0].outcome, 'modified');
  assert.ok(!h.stored().includes(secret));
  assert.ok(!h.page('/export').response.body.includes(secret));
});
test('manual tab manager notification links to tab page without enabling logging', () => {
  const h = harness();
  h.run({ $request: undefined, $response: undefined, $argument: {}, $script: { name: 'Bilibili 首页标签管理' } });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0][3].openUrl, 'http://bilibili-logs.invalid/tabs');
  assert.equal(h.stored(), undefined);
  assert.match(h.page('/tabs').response.body, /首页标签管理/);
});
test('disabled logger checks cleanup without creating or appending logs', () => {
  const h = harness();
  h.run({ $argument: {} });
  h.run({ $argument: 'log_enabled=false' });
  assert.equal(h.reads(), 2); assert.equal(h.writes(), 0);
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
test('mine promotion logs record module counts and types without profile or promotion values', () => {
  const h = harness();
  h.run({ $request: { url: 'https://app.bilibili.com/x/v2/account/mine?access_key=' + secret },
    $response: { body: JSON.stringify({ code: 0, data: {
      vip_section: { title: secret, token: secret }, vip_section_v2: { url: secret },
      modular_vip_section: { button: secret }, vip: { due_date: secret }, name: secret, mid: secret
    } }) } });
  const event = JSON.parse(h.stored()).events[0];
  assert.equal(event.endpoint, '/x/v2/account/mine');
  assert.equal(event.outcome, 'modified');
  assert.equal(event.before, 3); assert.equal(event.after, 0); assert.equal(event.removed, 3);
  assert.deepEqual(event.data_schema, { vip_section: 'object', vip_section_v2: 'object', modular_vip_section: 'object' });
  assert.ok(!h.stored().includes(secret));
  assert.ok(!h.page('/export').response.body.includes(secret));
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
test('turning logging off clears prior entries and exports an empty file', () => {
  const h = harness(); h.run();
  h.run({ $argument: { log_enabled: false } });
  assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
  const result = h.run({ $request: { url: 'http://bilibili-logs.invalid/export' }, $response: undefined, $argument: { log_enabled: false } });
  assert.equal(JSON.parse(result.response.body.split('\n')[0]).count, 0);
  assert.match(result.response.headers['Content-Disposition'], /bilibili-development\.log/);
});
test('export before disabling preserves the downloaded snapshot', () => {
  const h = harness(); h.run();
  const file = h.page('/export').response.body;
  assert.equal(JSON.parse(file.split('\n')[0]).count, 1);
  h.run({ $argument: { log_enabled: false } });
  assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
  assert.equal(JSON.parse(file.split('\n')[0]).count, 1);
});
test('timer and page access independently clear logs while disabled', () => {
  for (const entry of ['timer', 'page']) {
    const h = harness(); h.run();
    if (entry === 'timer') h.run({ $request: undefined, $response: undefined, $argument: { log_enabled: false } });
    else h.run({ $request: { url: 'http://bilibili-logs.invalid/' }, $response: undefined, $argument: { log_enabled: false } });
    assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
    const writes = h.writes();
    h.run({ $request: undefined, $response: undefined, $argument: { log_enabled: false } });
    assert.equal(h.writes(), writes, 'empty state is not written repeatedly');
  }
});
test('disabling removes legacy or corrupt logs without parsing them', () => {
  const h = harness('broken_' + secret);
  const result = h.run({ $request: { url: 'http://bilibili-logs.invalid/export' }, $response: undefined, $argument: {} });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
  assert.ok(!result.response.body.includes(secret));
});
test('cleanup failures preserve data and do not interfere with ad filtering', () => {
  const h = harness(); h.run();
  const previous = h.stored(); h.fail();
  const result = h.run({ $argument: { log_enabled: false } });
  assert.deepEqual(JSON.parse(result.body).data.items, []);
  assert.equal(h.stored(), previous);
  const page = h.run({ $request: { url: 'http://bilibili-logs.invalid/export' }, $response: undefined, $argument: {} });
  assert.equal(page.response.status, 503);
});
test('re-enabling starts fresh and records without a manual start script', () => {
  const h = harness(); h.run();
  h.run({ $request: undefined, $response: undefined, $argument: {} });
  h.run();
  assert.equal(JSON.parse(h.stored()).events.length, 1);
  assert.equal(h.notifications.length, 2);
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
test('clear works without nonce and tolerates Safari null or absent origin', () => {
  for (const headers of [{}, { Origin: 'null' }, { Origin: 'http://bilibili-logs.invalid' }, { Origin: 'http://bilibili-logs.invalid:80' }]) {
    const h = harness(); h.run();
    const result = h.page('/clear', 'POST', headers);
    assert.equal(result.response.status, 200);
    assert.match(result.response.body, /记录已清空/);
    assert.doesNotMatch(result.response.body, /请刷新日志页后重试|nonce=/);
    assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
  }
});
test('clear remains compatible with a cached old page and repeated clearing', () => {
  const h = harness(); h.run();
  assert.equal(h.page('/clear?nonce=stale', 'POST').response.status, 200);
  assert.equal(h.page('/clear', 'POST').response.status, 200);
  assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
});
test('clear does not accept GET or an explicit foreign origin', () => {
  const h = harness(); h.run();
  assert.equal(h.page('/clear').response.status, 405);
  assert.equal(h.page('/clear', 'POST', { Origin: 'https://evil.test' }).response.status, 403);
  assert.equal(JSON.parse(h.stored()).events.length, 1);
});
test('clear can recover a corrupt stored log', () => {
  const h = harness('broken_' + secret);
  assert.equal(h.page('/clear', 'POST').response.status, 200);
  assert.deepEqual(JSON.parse(h.stored()), { events: [], evicted: 0 });
});
test('mobile page previews safe records and indicates empty and disabled state', () => {
  const h = harness(); h.run();
  const result = h.page();
  assert.match(result.response.body, /最近记录/);
  assert.match(result.response.body, /已过滤/);
  assert.match(result.response.body, /form method="post" action="\/clear"/);
  assert.match(result.response.body, /class="brand-icon"/);
  assert.match(result.response.body, /rel="icon" type="image\/svg\+xml"/);
  assert.match(plugin, /#!icon = https:\/\/raw\.githubusercontent\.com\/teaoea\/shell\/main\/plugins\/Bilibili\/assets\/bilibili\.png/);
  assert.equal(readFileSync(new URL('../assets/bilibili.png', import.meta.url)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(!result.response.body.includes(secret));
  assert.match(h.page('/clear', 'POST').response.body, /还没有记录/);
  const off = h.run({ $request: { url: 'http://bilibili-logs.invalid/' }, $response: undefined, $argument: {} });
  assert.match(off.response.body, /已关闭/);
});
test('newly enabled logging notifies once with browser URL and does not leak secrets', () => {
  const h = harness(); h.run(); h.run();
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0][3].openUrl, 'http://bilibili-logs.invalid/');
  assert.ok(!JSON.stringify(h.notifications).includes(secret));
  h.run({ $argument: { log_enabled: false } });
  h.run();
  assert.equal(h.notifications.length, 2);
});
test('cron detects switch without traffic; manual entry always offers log page', () => {
  const h = harness();
  const task = { $request: undefined, $response: undefined, $script: { name: 'Bilibili 日志开启提醒' } };
  h.run({ ...task, $argument: {} });
  assert.equal(h.notifications.length, 0);
  h.run(task); h.run(task);
  assert.equal(h.notifications.length, 1);
  h.run({ ...task, $script: { name: 'Bilibili 打开日志页' }, $argument: {} });
  assert.equal(h.notifications.length, 2);
  assert.equal(h.writes(), 0);
});
test('search module filtering logs safe counts without search words or history', () => {
  const h = harness();
  h.run({
    $request: { url: 'https://app.bilibili.com/x/v2/search/square?token=' + secret, method: 'GET' },
    $response: { status: 200, body: JSON.stringify({ code: 0, data: [
      { type: 'trending', data: { list: [{ keyword: secret }] } },
      { type: 'recommend', data: { list: [{ keyword: secret }] } },
      { type: 'history', title: secret }
    ] }) },
    $argument: { log_enabled: true, hide_search_discovery: true }
  });
  const event = JSON.parse(h.stored()).events[0];
  assert.equal(event.endpoint, '/x/v2/search/square');
  assert.equal(event.outcome, 'modified');
  assert.equal(event.before, 3); assert.equal(event.after, 1); assert.equal(event.removed, 2);
  assert.equal(event.data_schema.data, 'array');
  assert.ok(!h.stored().includes(secret));
});
test('logger routes are disjoint and optional metadata hook does not buffer body', () => {
  const lines = plugin.split('\n').filter(line => line.startsWith('http-response '));
  assert.equal(lines.length, 6);
  const [filter, metadata] = lines.map(line => new RegExp(line.split(' ')[1]));
  for (const path of ['/x/v2/feed/index', '/x/v2/feed/index/story', '/x/v2/splash/show', '/x/v2/splash/brand/list', '/x/v2/splash/event/list2', '/x/resource/show/tab/v2',
    '/x/v2/search/square', '/x/v2/search/trending/ranking', '/x/v2/account/mine', '/x/v2/account/mine/ipad', '/x/v2/search/default', '/x/v2/search/defaultwords']) {
    for (const suffix of ['', '?token=' + secret]) {
      const url = 'https://app.bilibili.com' + path + suffix;
      assert.equal(filter.test(url), true); assert.equal(metadata.test(url), false);
    }
  }
  assert.equal(metadata.test('https://app.bilibili.com/bilibili.app.dynamic.v2.Dynamic/DynAll'), true);
  assert.match(lines[1], /requires-body=false/); assert.match(lines[1], /enable=\{log_enabled\}/);
  const pageLine = plugin.split('\n').find(line => line.startsWith('http-request ^http://bilibili-logs'));
  assert.doesNotMatch(pageLine, /enable=/);
});

test('brand splash logging identifies registered path without retaining credentials or image contents',()=>{
 const h=harness();
 h.run({$request:{url:'https://app.bilibili.com/x/v2/splash/brand/list?access_key='+secret,method:'GET'},
  $response:{status:200,body:JSON.stringify({code:0,data:{list:[{thumb:secret,thumb_name:secret},{is_ad:1,ad_info:{token:secret}}]}})}});
 const event=JSON.parse(h.stored()).events[0];
 assert.equal(event.endpoint,'/x/v2/splash/brand/list');assert.equal(event.outcome,'modified');
 assert.equal(event.before,2);assert.equal(event.after,0);assert.equal(event.removed,2);
 assert.ok(!h.stored().includes(secret));assert.ok(!h.page('/export').response.body.includes(secret));
});

test('rare splash records survive ordinary requests, with only the latest 20 protected and all limits intact',()=>{
 const paths=['/x/v2/splash/list','/x/v2/splash/show','/x/v2/splash/event/list2','/x/v2/splash/brand/list'];
 const events=Array.from({length:300},(_,index)=>({time:new Date(Date.UTC(2026,9,7,0,0,index)).toISOString(),endpoint:index<25?paths[index%4]:'/x/v2/feed/index',outcome:'unchanged',method:'GET',status:200}));
 const h=harness(JSON.stringify({events,evicted:0}));
 for(let i=0;i<280;i++)h.run();
 const state=JSON.parse(h.stored());
 assert.equal(state.events.length,300);assert.equal(state.evicted,280);assert.ok(h.stored().length<=262144);
 assert.deepEqual(state.events.filter(event=>paths.includes(event.endpoint)).map(event=>event.time),events.slice(5,25).map(event=>event.time));
 const exported=h.page('/export').response.body;assert.ok(exported.includes(events[24].time));assert.ok(!exported.includes(events[0].time));
 h.run({$argument:{log_enabled:false}});assert.deepEqual(JSON.parse(h.stored()),{events:[],evicted:0});
});

test('unknown splash paths expose only fixed segments and data metadata never reads bodies',()=>{
 const h=harness();
 const response={status:200};
 Object.defineProperty(response,'body',{get(){throw Error('must not read body');}});
 for(const host of ['app.bilibili.com','data.bilibili.com']){
  h.run({$request:{url:'https://'+host+'/x/v3/splash/'+secret+'/%31%32%33?token='+secret,method:'POST'},$response:response});
 }
 const events=JSON.parse(h.stored()).events;
 assert.equal(events.length,2);
 for(const event of events){assert.equal(event.route_hint,'/x/v3/splash/{other}/{other}');assert.equal(event.outcome,'metadata_only');}
 assert.equal(events[1].host,'data.bilibili.com');
 for(const text of [h.stored(),h.page('/export').response.body,h.page().response.body])assert.ok(!text.includes(secret));
 assert.match(plugin,/http-response \^https:\/\/data/);
});

test('export identifies exporter and actual producer versions without relabeling old records',()=>{
 const old={time:'2026-10-07T10:00:00.000Z',endpoint:'other_api',outcome:'metadata_only',method:'GET',status:200};
 const h=harness(JSON.stringify({events:[old],evicted:0}));
 h.run({$request:{url:'https://app.bilibili.com/x/v3/splash/config?token='+secret,method:'POST'},$response:{status:200}});
 const exported=h.page('/export').response.body.trim().split('\n').map(JSON.parse);
 assert.equal(exported[0].script_version,'1.11.9');
 assert.equal(exported[1].script_version,undefined);
 assert.equal(exported[2].script_version,'1.11.9');
 assert.equal(exported[2].route_hint,'/x/v3/splash/config');
 assert.equal(exported[2].host,'app.bilibili.com');
 assert.ok(!JSON.stringify(exported).includes(secret));
 const scripts=plugin.split('\n').filter(line=>line.includes('script-path='));
 assert.ok(scripts.length>0);for(const line of scripts)assert.match(line,/BilibiliEnhance\.js\?v=1\.11\.9,/);
});

test('impression request and response logging never reads bodies or secrets and has no reject rule',()=>{
 const h=harness();const request={url:'https://impression.biligame.com/api/impression/bilibili_pc?mid='+secret,method:'GET'};
 Object.defineProperty(request,'body',{get(){throw Error('request body');}});
 const response={status:204};Object.defineProperty(response,'body',{get(){throw Error('response body');}});
 assert.deepEqual(h.run({$request:request,$response:undefined}),{});
 assert.deepEqual(h.run({$request:request,$response:response}),{});
 const events=JSON.parse(h.stored()).events;
 assert.deepEqual(events.map(e=>e.phase),['request','response']);assert.equal(events[0].status,null);assert.equal(events[1].status,204);
 for(const event of events){assert.equal(event.host,'impression.biligame.com');assert.equal(event.route_hint,'/api/impression/bilibili_pc');}
 assert.ok(!h.page('/export').response.body.includes(secret));
 assert.doesNotMatch(plugin,/DOMAIN,impression\.biligame\.com,REJECT/);
 for(const kind of ['http-request','http-response']){
  const line=plugin.split('\n').find(line=>line.startsWith(kind+' ') && line.includes('tag=Bilibili 游戏服务'));
  assert.ok(line);assert.match(line,/requires-body=false/);assert.match(line,/enable=\{log_enabled\}/);
  const re=new RegExp(line.split(' ')[1]);assert.ok(re.test(request.url));assert.ok(!re.test(request.url.replace('impression.biligame.com','impression.biligame.com.evil.test')));
 }
});

test('additional biligame diagnostic hosts record both phases with exact host boundaries',()=>{
 for(const host of ['static.biligame.com','game-data-api.biligame.com']){
  const h=harness();const request={url:'https://'+host+'/api/'+secret+'/12345?token='+secret,method:'GET'};
  const response={status:200};Object.defineProperty(response,'body',{get(){throw Error('body must not be read');}});
  assert.deepEqual(h.run({$request:request,$response:undefined}),{});
  assert.deepEqual(h.run({$request:request,$response:response}),{});
  const events=JSON.parse(h.stored()).events;
  assert.deepEqual(events.map(e=>e.phase),['request','response']);
  for(const e of events){assert.equal(e.host,host);assert.equal(e.route_hint,'/api/{other}/{other}');}
  assert.ok(!h.page('/export').response.body.includes(secret));
  for(const kind of ['http-request','http-response']){
   const line=plugin.split('\n').find(line=>line.startsWith(kind+' ')&&line.includes('tag=Bilibili 游戏服务'));
   const re=new RegExp(line.split(' ')[1]);assert.ok(re.test(request.url));assert.ok(!re.test(request.url.replace(host,host+'.evil.test')));
  }
  const disabled=harness();disabled.run({$request:request,$response:response,$argument:{log_enabled:false}});assert.equal(disabled.writes(),0);
 }
});

test('log page places version beside title and exposes request response phases',()=>{
 const h=harness();const request={url:'https://impression.biligame.com/api/impression/bilibili?token='+secret,method:'GET'};
 h.run({$request:request,$response:undefined});h.run({$request:request,$response:{status:200}});
 const html=h.page().response.body;
 assert.match(html,/<h1>开发日志<span class="page-version">v1\.11\.9<\/span><\/h1>/);
 assert.match(html,/<footer>时间显示为北京时间<\/footer>/);
 assert.match(html,/请求发出/);assert.match(html,/响应返回/);
 assert.equal(JSON.parse(h.stored()).events[0].route_hint,'/api/impression/bilibili');
 assert.ok(!html.includes(secret));
});
