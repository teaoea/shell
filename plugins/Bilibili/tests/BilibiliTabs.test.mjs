import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../BilibiliEnhance.js', import.meta.url), 'utf8');
const KEY = 'bilibili.enhance.tabs.v1';
const varint = n => { const result = []; do { const next = n % 128; n = Math.floor(n / 128); result.push(next + (n ? 128 : 0)); } while (n); return result; };
const string = (number, value) => { const bytes = Buffer.from(value); return [number * 8 + 2, ...varint(bytes.length), ...bytes]; };
const nested = (number, bytes) => [number * 8 + 2, ...varint(bytes.length), ...bytes];
const icon = (id, name, uri) => [...string(2, name), ...string(3, uri), 32, ...varint(id)];
function frame(icons, extra = []) {
  const body = [...nested(2, [...string(1, '全部分区'), ...icons.flatMap(bytes => nested(2, bytes))]), ...extra];
  return Uint8Array.from([0, 0, 0, Math.floor(body.length / 256), body.length % 256, ...body]);
}
function harness(raw, failure = null, status = 200, homepage = undefined) {
  const store = new Map(); const requests = []; let writes = 0; let broken = false;
  function run(request, response, options = {}) {
    const results = [];
    vm.runInNewContext(source, {
      $request: request, $response: response, $argument: options,
      $persistentStore: { read: key => store.get(key), write: (value, key) => { if (broken) return false; store.set(key, value); writes++; return true; } },
      $httpClient: { post: (options, callback) => { requests.push(options); callback(failure, { status, headers: { 'grpc-status': '0' } }, raw); },
        ...(homepage !== undefined ? { get: (options, callback) => { requests.push(options); callback(null, { status: 200 }, homepage); } } : {}) },
      $done: value => results.push(JSON.parse(JSON.stringify(value)))
    }, { timeout: 1000 });
    assert.equal(results.length, 1);
    return results[0];
  }
  const page = (path, method = 'GET', body, headers) => run({ url: 'http://bilibili-logs.invalid' + path, method, body, headers }).response;
  const home = tabs => run({ url: 'https://app.bilibili.com/x/resource/show/tab/v2', method: 'GET' }, { status: 200, body: JSON.stringify({ code: 0, data: { tab: tabs, bottom: [{ name: '我的' }] } }) });
  return { store, requests, page, home, writes: () => writes, fail: () => { broken = true; } };
}
const current = [{ id: 40, tab_id: '推荐tab', name: '推荐', uri: 'bilibili://pegasus/promo', default_selected: 1, pos: 1 }];

test('full region fetch adds hidden choices without changing current selection or sending credentials', () => {
  const h = harness(frame([icon(1003, '音乐', 'bilibili://main/regionv2/detail/1003'), icon(1011, '人工智能', 'bilibili://main/regionv2/detail/1011')]));
  h.home(current);
  const page = h.page('/tabs/load', 'POST');
  assert.equal(page.status, 200); assert.match(page.body, /已获取 2 个/);
  assert.match(page.body, /value="tab:1003"><span>音乐/);
  assert.match(page.body, /value="tab:推荐tab" checked/);
  assert.deepEqual(h.home(current), {});
  const request = h.requests[0];
  assert.equal(request.url, 'https://app.bilibili.com/bilibili.app.show.v1.Mixture/RegionList');
  assert.equal(request['auto-cookie'], false); assert.equal(request['auto-redirect'], false); assert.equal(request['binary-mode'], true);
  assert.equal(request.insecure, false); assert.equal(request.alpn, 'h2');
  assert.equal(request.headers['grpc-accept-encoding'], 'identity');
  assert.deepEqual(Object.keys(request.headers).sort(), ['Content-Type', 'grpc-accept-encoding']);
  assert.deepEqual([...request.body], [0, 0, 0, 0, 0]);
  h.page('/tabs/save', 'POST', 'tab=tab%3A1003&tab=tab%3A1011');
  const data = JSON.parse(h.home(current).body).data;
  assert.deepEqual(data.tab, [{ id: 1003, tab_id: '1003', name: '音乐', uri: 'bilibili://main/regionv2/detail/1003', pos: 1, default_selected: 1 },
    { id: 1011, tab_id: '1011', name: '人工智能', uri: 'bilibili://main/regionv2/detail/1011', pos: 2, default_selected: 0 }]);
  assert.deepEqual(data.bottom, [{ name: '我的' }]);
  assert.deepEqual(h.home(data.tab), {});
  h.page('/tabs/reset', 'POST'); assert.deepEqual(h.home(current), {});
});

test('full list supports large frame sizes, UTF-8, unknown fields, deduplication and safe URL parameters', () => {
  const h = harness(frame([icon(13, '番剧', 'bilibili://pgc/partition_page?page_name=bangumi-operation&title=%E7%95%AA%E5%89%A7&select_id=1&access_key=PRIVATE_TOKEN'),
    icon(13, '重复', 'bilibili://pgc/home'), icon(65549, '工房集市', 'https://mall.bilibili.com/neul-next/index.html?page=mall-up_market&token=PRIVATE_TOKEN'),
    icon(9, '不支持', 'https://evil.example/?token=PRIVATE_TOKEN'), icon(10, '坏编码', 'bilibili://pgc/home?title=%XX')], nested(99, Array(256).fill(1))));
  assert.equal(h.page('/tabs/load', 'POST').status, 200);
  const state = JSON.parse(h.store.get(KEY));
  assert.equal(state.catalog.length, 2); assert.equal(state.catalog[0].name, '番剧');
  assert.ok(state.catalog[0].uri.includes('page_name=bangumi-operation'));
  assert.ok(!h.store.get(KEY).includes('PRIVATE_TOKEN')); assert.ok(!h.store.get(KEY).includes('access_key'));
  assert.ok(!h.page('/tabs').body.includes('PRIVATE_TOKEN'));
});

test('fetch failures and malformed frames preserve previous catalog and selection', () => {
  const malformed = [new Uint8Array(), new Uint8Array([0, 0, 0, 0, 8, 1]), frame([]), frame([icon(1, '音乐', 'bilibili://main/regionv2/detail/1')])];
  malformed[3][0] = 1;
  for (const raw of malformed) {
    const h = harness(raw); h.home(current); h.page('/tabs/save', 'POST', 'tab=tab%3A推荐tab');
    const previous = h.store.get(KEY);
    assert.equal(h.page('/tabs/load', 'POST').status, 503); assert.equal(h.store.get(KEY), previous);
  }
  for (const [error, status] of [['PRIVATE_ERROR', 200], [null, 403]]) {
    const h = harness(frame([]), error, status); h.home(current); const previous = h.store.get(KEY);
    const response = h.page('/tabs/load', 'POST'); assert.equal(response.status, 503); assert.equal(h.store.get(KEY), previous);
    assert.ok(!response.body.includes('PRIVATE_ERROR'));
  }
});

test('fetch requires local POST and does not fetch on ordinary page access; failed writes report failure', () => {
  const h = harness(frame([icon(1003, '音乐', 'bilibili://main/regionv2/detail/1003')]));
  h.page('/tabs'); assert.equal(h.requests.length, 0);
  assert.equal(h.page('/tabs/load').status, 405);
  assert.equal(h.page('/tabs/load', 'POST', '', { Origin: 'https://evil.example' }).status, 403); assert.equal(h.requests.length, 0);
  h.home(current); const previous = h.store.get(KEY); h.fail();
  assert.equal(h.page('/tabs/load', 'POST').status, 503); assert.equal(h.store.get(KEY), previous);
});

test('anonymous homepage supplement restores hidden basic tabs with original tab ID and safe public URI', () => {
  const live = { id: 39, tab_id: '直播tab', name: '直播', uri: 'bilibili://live/home?access_key=PRIVATE_TOKEN' };
  const h = harness(frame([icon(1003, '音乐', 'bilibili://main/regionv2/detail/1003')]), null, 200,
    JSON.stringify({ code: 0, data: { tab: [live, ...current] } }));
  h.home(current); assert.equal(h.page('/tabs/load', 'POST').status, 200);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]['auto-cookie'], false);
  assert.equal(h.requests[1].headers, undefined);
  assert.ok(!h.store.get(KEY).includes('PRIVATE_TOKEN'));
  assert.match(h.page('/tabs').body, /value="tab:直播tab"><span>直播/);
  assert.match(h.page('/tabs').body, /value="tab:推荐tab" checked/);
  h.page('/tabs/save', 'POST', 'tab=' + encodeURIComponent('tab:直播tab'));
  const tabs = JSON.parse(h.home(current).body).data.tab;
  assert.deepEqual(tabs, [{ id: 39, tab_id: '直播tab', name: '直播', uri: 'bilibili://live/home', pos: 1, default_selected: 1 }]);
});

test('failed homepage supplement retains full regions and reports partial success', () => {
  const h = harness(frame([icon(1003, '音乐', 'bilibili://main/regionv2/detail/1003')]), null, 200, '{broken');
  const page = h.page('/tabs/load', 'POST');
  assert.equal(page.status, 200); assert.match(page.body, /基础首页标签补充失败/);
  assert.equal(JSON.parse(h.store.get(KEY)).catalog.length, 1);
});

test('saved selection order controls existing and hidden client tabs and survives fetch, refresh and logs closing',()=>{
 const h=harness(frame([icon(1003,'音乐','bilibili://main/regionv2/detail/1003')]));
 const popular={id:41,tab_id:'热门tab',name:'热门',pos:2,unknown:{preserve:true}};
 const unknown={future:'keep'};
 const home=[...current,unknown,popular];
 h.home(home);h.page('/tabs/load','POST');
 const ids=['tab:热门tab','tab:1003','tab:推荐tab'];
 const save=h.page('/tabs/save','POST',ids.map(id=>'tab='+encodeURIComponent(id)).join('&'));
 assert.equal(save.status,200);assert.match(save.body,/保存选择与排序/);
 const rendered=ids.map(id=>save.body.indexOf('value="'+id+'"'));
 assert.ok(rendered[0]<rendered[1]&&rendered[1]<rendered[2]);
 const result=JSON.parse(h.home(home).body).data.tab;
 assert.deepEqual(result,[{...popular,pos:1},unknown,{id:1003,tab_id:'1003',name:'音乐',uri:'bilibili://main/regionv2/detail/1003',pos:3},{...current[0],pos:4}]);
 assert.deepEqual(h.home(result),{});
 h.page('/tabs/load','POST');h.page('/');
 assert.deepEqual(JSON.parse(h.store.get(KEY)).selected,ids);
 assert.deepEqual(JSON.parse(h.home(home).body).data.tab,result);
 h.page('/tabs/reset','POST');assert.deepEqual(h.home(home),{});
});

test('live preview follows checkbox and order changes locally, safely displaying names and preventing empty saves',()=>{
 const h=harness(frame([]));h.home([...current,{id:41,tab_id:'热门tab',name:'热门',pos:2}]);
 const html=h.page('/tabs').body;
 assert.match(html,/首页标签预览/);assert.match(html,/class="preview-tab first">推荐/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|setInterval|setTimeout|innerHTML/);
 const rows=[],handlers={};
 function row(id){const r={id,input:{checked:true},name:{textContent:id},up:{dataset:{move:'up'},focus(){}},down:{dataset:{move:'down'},focus(){}}};
  Object.defineProperties(r,{previousElementSibling:{get:()=>rows[rows.indexOf(r)-1]},nextElementSibling:{get:()=>rows[rows.indexOf(r)+1]}});
  r.querySelector=s=>s.includes('up')?r.up:s.includes('down')?r.down:s.includes('input')?r.input:r.name;
  for(const b of [r.up,r.down])b.closest=s=>s.includes('tab-row')?r:b;
  return r;
 }
 rows.push(row('recommend'),row('<img src=x onerror=alert(1)>'));
 const preview={children:[],appendChild(item){this.children.push(item);}};
 Object.defineProperty(preview,'textContent',{set(){this.children=[];}});
 const status={},save={};
 const list={children:rows,contains:b=>rows.some(r=>r.up===b||r.down===b),addEventListener:(name,fn)=>{handlers[name]=fn;},
 insertBefore:(a,b)=>{rows.splice(rows.indexOf(a),1);rows.splice(rows.indexOf(b),0,a);}};
 vm.runInNewContext(script,{document:{getElementById:id=>({'tab-list':list,'tab-preview':preview,'preview-status':status,'tabs-save':save})[id],createElement:()=>({})}});
 assert.deepEqual(preview.children.map(x=>x.textContent),rows.map(r=>r.id));
 assert.equal(rows[0].up.disabled,true);assert.equal(rows[1].down.disabled,true);
 handlers.click({target:rows[1].up});assert.deepEqual(rows.map(r=>r.id),['<img src=x onerror=alert(1)>','recommend']);
 assert.deepEqual(preview.children.map(x=>x.textContent),rows.map(r=>r.id));
 assert.equal(preview.children[0].className,'preview-tab first');
 assert.equal(rows[0].up.disabled,true);assert.equal(rows[1].down.disabled,true);
 handlers.click({target:rows[0].down});assert.equal(rows[0].id,'recommend');
 rows[0].input.checked=false;handlers.change();assert.deepEqual(preview.children.map(x=>x.textContent),[rows[1].id]);
 rows[1].input.checked=false;handlers.change();assert.equal(save.disabled,true);assert.match(preview.children[0].textContent,/至少选择/);
 rows[0].input.checked=true;handlers.change();assert.equal(save.disabled,false);assert.match(status.textContent,/已选 1 项/);
});

test('unchanged homepage catalogs avoid persistent writes and saved settings survive independent script executions',()=>{
 const h=harness(frame([]));h.home(current);
 const first=h.writes();h.home(current);h.home(current);assert.equal(h.writes(),first);
 const popular={id:41,tab_id:'热门tab',name:'热门',pos:2};h.home([...current,popular]);
 assert.equal(h.writes(),first+1);
 const ids=['tab:热门tab','tab:推荐tab'];h.page('/tabs/save','POST',ids.map(id=>'tab='+encodeURIComponent(id)).join('&'));
 const saved=h.writes();const response=h.home([...current,popular]);h.home([...current,popular]);
 assert.equal(h.writes(),saved);assert.deepEqual(JSON.parse(h.store.get(KEY)).selected,ids);
 assert.deepEqual(JSON.parse(response.body).data.tab.map(x=>x.name),['热门','推荐']);
 assert.match(h.page('/tabs').body,/class="preview-tab first">热门/);
 assert.equal(h.writes(),saved);assert.equal(h.requests.length,0);
 h.home([...current,{...popular,name:'新热门'}]);assert.equal(h.writes(),saved+1);
 assert.deepEqual(JSON.parse(h.store.get(KEY)).selected,ids);
});
