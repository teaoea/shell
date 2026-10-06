import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const code = readFileSync(new URL('../XianyuLogger.js', import.meta.url), 'utf8');
const plugin = readFileSync(new URL('../XianyuPushNetwork.plugin', import.meta.url), 'utf8');
const KEY = 'xianyu.logger.v1';
// Synthetic fixtures test recognition, not the User-Agent of any installed iPhone version.
const UA = 'Mozilla/5.0 (iPhone) AliApp(Fish/7.20.0) WindVane/8.0.0';
const baseRequest = {url:'https://acs.m.goofish.com/gw/ad.test/1.0/?ad=1', method:'POST', headers:{'User-Agent':UA, 'Content-Type':'application/json'}, body:'{"ad":{"type":"splash","enabled":true}}'};
function harness(args = {}, options = {}) {
  const store = new Map(), logs = [], notifications = [];
  let hook;
  const settings = {log_enabled:true, capture_budget:'32', body_limit_kb:'1024', raw_binary:true, media_body:false, ...args};
  function run(request = baseRequest, response) {
    const completed = [];
    const context = {$argument:settings, $persistentStore:{read:k=>store.get(k), write:(value,k)=>{
      if (hook && hook(value,k) === false) return false;
      if (value == null) store.delete(k); else store.set(k,value);
      return true;
    }}, $notification:{post:(...a)=>notifications.push(a)}, $done:value=>completed.push(value), console:{log:v=>logs.push(v)}, Uint8Array, ArrayBuffer};
    if (request) context.$request = request;
    if (response) context.$response = response;
    if (!options.noDecoder) context.TextDecoder = TextDecoder;
    vm.runInNewContext(code, context, {timeout:2000});
    assert.equal(completed.length, 1, 'exactly one completion per invocation');
    return JSON.parse(JSON.stringify(completed[0]));
  }
  const config = ()=>JSON.parse(store.get(KEY));
  const get = path=>run({url:'http://xianyu-logs.invalid'+path, method:'GET', headers:{}}).response;
  const post = (path, fields = {}, headers = {})=>run({url:'http://xianyu-logs.invalid'+path, method:'POST', headers, body:new URLSearchParams({csrf:config().csrf, ...fields}).toString()}).response;
  const events = ()=>config().entries.map(ref=>JSON.parse(Array.from({length:ref.chunks},(_,i)=>store.get(`${KEY}.${config().session}.${ref.id}.${i}`)).join('')));
  return {store, logs, notifications, settings, run, config, get, post, events, setHook:f=>hook=f};
}

test('disabled traffic is unchanged and does not initialize storage',()=>{
  const h=harness({log_enabled:false});
  assert.deepEqual(h.run(),{}); assert.equal(h.store.size,0);
  h.run(null); assert.equal(h.store.size,0);
  assert.equal(h.notifications[0][3].openUrl,'http://xianyu-logs.invalid/');
});

test('only explicit client markers are captured, regardless of hostname',()=>{
  const h=harness();
  for (const ua of [undefined, '', 'Mozilla/5.0 Safari/605.1', 'AliApp(TB/10.0.0)', 'AliApp(FishFake/7.20)', 'NotAliApp(Fish/7.20.0)', 'AliApp(Fish/7.20.0)evil']) {
    h.run({...baseRequest,headers:{'User-Agent':ua}});
    h.run({...baseRequest,headers:{'User-Agent':ua}}, {status:200,headers:{},body:'{}'});
  }
  assert.equal(h.store.size,0, 'known Xianyu domain alone never grants attribution');
  h.run({...baseRequest,url:'https://shared.example/advertisement'});
  assert.equal(h.events().length,1);
  assert.equal(h.events()[0].source.method,'user-agent-marker');
  assert.equal(h.events()[0].source.processVerified,false);
  for (const ua of ['闲鱼/7.20.0 CFNetwork/1', '%E9%97%B2%E9%B1%BC/7.20.0 CFNetwork/1', 'com.taobao.fleamarket/7.20.0', 'Goofish/7.20.0', 'IdleFish/7.20.0']) h.run({...baseRequest,headers:{'user-agent':ua}});
  assert.equal(h.events().length,6);
});

test('all normal and failure responses are recorded without modifying traffic',()=>{
  const h=harness(); const before=JSON.stringify(baseRequest);
  assert.deepEqual(h.run(),{});
  for (const status of [200,204,302,403,500]) assert.deepEqual(h.run(baseRequest,{status,headers:{Location:'https://goofish.com/ad'},body:'{"ad":1}'}),{});
  assert.equal(JSON.stringify(baseRequest),before);
  assert.deepEqual(h.events().slice(1).map(e=>e.response.status),[200,204,302,403,500]);
  assert.equal(h.events()[0].request.body.data.ad.type,'splash');
  assert.equal(h.events()[1].correlationKey,h.events()[0].correlationKey);
});

test('URLs, literal IPv4/IPv6 and ports are preserved without DNS inference',()=>{
  const h=harness();
  for(const url of ['http://203.0.113.8:8080/ad?a=1','https://[2001:db8::8]:8443/ad?a=2','http://[::ffff:192.0.2.3]/','https://acs.m.goofish.com/path?key=value','http://999.1.2.3/']) h.run({...baseRequest,url});
  const e=h.events();
  assert.equal(e[0].network.urlIP,'203.0.113.8'); assert.equal(e[0].network.port,8080);
  assert.equal(e[1].network.urlIP,'2001:db8::8'); assert.equal(e[1].network.port,8443);
  assert.equal(e[2].network.urlIP,'::ffff:192.0.2.3');
  assert.equal(e[3].network.urlIP,null); assert.equal(e[3].request.url,'https://acs.m.goofish.com/path?key=value');
  assert.equal(e[4].network.urlIP,null);
  assert.equal(e[0].network.addressSource,'request-url');
  const unrelated=harness(); unrelated.run({...baseRequest,url:'http://203.0.113.8:8080/ad',headers:{}});
  assert.equal(unrelated.store.size,0, 'IP alone never attributes a request');
});

test('credentials are redacted, noncredential ad structure and URLs survive',()=>{
  const h=harness();
  h.run({...baseRequest,url:'https://acs.m.goofish.com/ad?sign=secret-sign&token=secret-token&adType=splash',headers:{'User-Agent':UA,Cookie:'secret-cookie',Authorization:'Bearer secret-auth','Content-Type':'application/json'},body:JSON.stringify({uid:123456,token:'secret-json',adType:'splash',asset:'https://img.alicdn.com/ad.jpg?ad=1&sign=secret-asset',nested:{enabled:true}})}, {status:200,headers:{'Set-Cookie':'secret-setcookie'},body:'{"token":"secret-json","adId":"123"}'});
  h.run({...baseRequest,headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:'sign=secret-form&data='+encodeURIComponent('{"uid":123456,"adType":"splash"}')});
  const stored=[...h.store.values()].join('');
  for (const secret of ['secret-sign','secret-token','secret-cookie','secret-auth','secret-json','secret-setcookie','secret-form','123456']) assert.ok(!stored.includes(secret), secret);
  assert.ok(stored.includes('adType')); assert.ok(stored.includes('splash')); assert.ok(stored.includes('adId'));
  assert.ok(h.events()[0].request.url.includes('adType=splash'));
});

test('UTF8 bytes, fallback decoder and JSONP keep usable ad data',()=>{
  for(const noDecoder of [false,true]) {
    const h=harness({}, {noDecoder});
    h.run({...baseRequest,body:new TextEncoder().encode('callback({"adType":"开屏😀","token":"hide"});')});
    const b=h.events()[0].request.body;
    assert.equal(b.encoding,'jsonp-json'); assert.equal(b.data.adType,'开屏😀'); assert.equal(b.data.token,'[REDACTED]');
  }
});

test('binary, media and oversized bodies have explicit capture behavior',()=>{
  const h=harness({body_limit_kb:'256'});
  h.run({...baseRequest,body:new Uint8Array([0,255,1,2]),headers:{'User-Agent':UA,'Content-Type':'application/octet-stream'}});
  assert.equal(h.events()[0].request.body.encoding,'base64'); assert.equal(h.events()[0].request.body.data,'AP8BAg==');
  h.settings.raw_binary=false;
  h.run({...baseRequest,body:new Uint8Array([0,255])});
  assert.equal(h.events()[1].request.body.reason,'binary-capture-disabled');
  h.run(baseRequest,{status:200,headers:{'Content-Type':'image/jpeg'}});
  assert.equal(h.events()[2].response.body.reason,'media-headers-only');
  h.run({...baseRequest,body:'x'.repeat(262145)});
  assert.equal(h.events()[3].request.body.reason,'body-limit');
  assert.equal(h.events()[3].request.body.bytes,262145);
  assert.equal(h.events()[3].request.body.data,undefined);
});

test('pause, resume, marking and export after disabling preserve the session',()=>{
  const h=harness();h.run();
  assert.equal(h.get('/manifest').status,409);
  assert.equal(h.post('/mark-ad').status,303); assert.equal(h.post('/mark-content').status,303);
  assert.equal(h.post('/pause').status,303); const session=h.config().session;
  h.run(); assert.equal(h.events().length,3);
  h.settings.log_enabled=false;
  assert.equal(h.get('/').status,200); assert.equal(h.get('/manifest').status,200); assert.equal(h.post('/start').status,403);
  h.settings.log_enabled=true; assert.equal(h.post('/start').status,303); h.run();
  assert.equal(h.events().length,4); assert.equal(h.config().session,session);
  assert.deepEqual(h.events().slice(1,3).map(e=>e.label),['ad-visible','normal-content']);
});

test('controls reject cross-origin or invalid token and clear only this session',()=>{
  const h=harness(); h.run(); h.store.set('YouTube-sentinel','keep'); const session=h.config().session;
  assert.equal(h.post('/clear',{csrf:'invalid'}).status,403);
  assert.equal(h.post('/clear',{}, {Origin:'https://other.example'}).status,403);
  assert.equal(h.config().session,session);
  assert.equal(h.post('/clear').status,303);
  assert.equal(h.store.get('YouTube-sentinel'),'keep'); assert.equal(h.config().entries.length,0); assert.equal(h.config().active,false);
  assert.notEqual(h.config().session,session);
  assert.ok(![...h.store.keys()].some(k=>k.startsWith(KEY+'.'+session+'.')));
});

test('capacity and event-count stops retain earlier records and require clearing',()=>{
  for(const reason of ['capacity-limit','event-limit']) {
    const h=harness({capture_budget:'16'}); h.run(); const first=h.events()[0];
    const c=h.config(); if(reason==='capacity-limit') c.bytes=16*1048576-1; else c.entries=Array.from({length:4096},()=>({...c.entries[0]}));
    h.store.set(KEY,JSON.stringify(c)); h.run();
    assert.equal(h.config().active,false); assert.equal(h.config().haltReason,reason);
    assert.equal(h.post('/start').status,409);
    const ref=h.config().entries[0];const r=h.get(`/event/${c.session}/${ref.id}`);
    assert.equal(r.status,200); assert.equal(JSON.parse(r.body).id,first.id);
  }
});

test('chunking handles multibyte and surrogate pairs; corruption is reported',()=>{
  const h=harness();h.run({...baseRequest,body:JSON.stringify({data:'闲鱼😀'.repeat(20000)})}); h.post('/pause');
  const c=h.config(), ref=c.entries[0]; assert.ok(ref.chunks>1);
  const path=`/event/${c.session}/${ref.id}`;
  assert.equal(h.get(path).status,200);
  const key=`${KEY}.${c.session}.${ref.id}.1`;h.store.set(key,h.store.get(key).replace('闲','坏'));
  assert.equal(h.get(path).status,422);
  assert.equal(h.get(`/event/old-session/${ref.id}`).status,409);
});

test('storage write failures stop capture and still pass business traffic unchanged',()=>{
  const h=harness();h.run(); const before=h.events()[0].id;
  h.setHook((v,k)=> k!==KEY && v != null ? false : undefined);
  assert.deepEqual(h.run(),{});
  assert.equal(h.config().haltReason,'storage-error'); assert.equal(h.events().length,1); assert.equal(h.events()[0].id,before);
});

test('interleaved appends merge the latest committed index',()=>{
  const h=harness();h.run(); let entered=false;
  h.setHook((v,k)=>{if(!entered && k!==KEY && v!=null){entered=true;h.run({...baseRequest,url:'https://goofish.com/nested'});}});
  h.run({...baseRequest,url:'https://goofish.com/outer'});
  assert.equal(h.events().length,3); assert.equal(new Set(h.events().map(e=>e.id)).size,3);
});

test('clearing during chunk writes prevents old session committing or leaking chunks',()=>{
  const h=harness();h.run(); const old=h.config().session; let entered=false;
  h.setHook((v,k)=>{if(!entered && k!==KEY && v!=null){entered=true;h.post('/clear');}});
  assert.deepEqual(h.run(),{});
  assert.notEqual(h.config().session,old);assert.equal(h.config().entries.length,0);
  assert.ok(![...h.store.keys()].some(k=>k.startsWith(KEY+'.'+old+'.')));
});

async function browserExport(h) {
  const html=h.get('/').body, source=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={status:{},download:{},save:{dataset:{},click(){this.clicked=true;}}};
  let output;
  vm.runInNewContext(source,{document:{getElementById:id=>elements[id]},Blob,URL:{createObjectURL:b=>{output=b;return 'blob:local';},revokeObjectURL(){}},fetch:async(path,init)=>{
    let result=init?.method==='POST' ? h.run({url:'http://xianyu-logs.invalid'+path,method:'POST',headers:init.headers,body:init.body}).response : h.get(path);
    if(result.status===303)result=h.get(result.headers.Location);
    return {ok:result.status>=200&&result.status<300,status:result.status,text:async()=>result.body,json:async()=>JSON.parse(result.body)};
  }});
  await elements.download.onclick();
  assert.equal(elements.save.clicked,true); assert.equal(elements.download.disabled,false);
  return {rows:(await output.text()).trim().split('\n').map(JSON.parse),elements};
}

test('browser creates one file with every event and only URL-literal IP inventory',async()=>{
  const h=harness();h.run();h.run({...baseRequest,url:'http://203.0.113.10:8080/path?ad=1'});h.run({...baseRequest,url:'https://[2001:db8::9]/image'});
  h.post('/mark-ad');
  const {rows}=await browserExport(h);
  assert.equal(rows[0].events,4);assert.equal(rows[0].attribution.processVerified,false);
  assert.equal(h.config().active,false);
  assert.equal(rows.filter(e=>e.phase).length,4);
  const inventory=rows.find(e=>e.type==='network-inventory');
  assert.equal(inventory.urls.length,3);
  assert.deepEqual(inventory.ips,[{address:'203.0.113.10',source:'request-url-literal'},{address:'2001:db8::9',source:'request-url-literal'}]);
  assert.equal(inventory.dns,undefined);
  assert.equal(rows.at(-1).exported,4);assert.deepEqual(rows.at(-1).issues,[]);
});

test('browser exports surviving events and a footer listing damaged events',async()=>{
  const h=harness();h.run();h.run();const c=h.config();h.store.delete(`${KEY}.${c.session}.${c.entries[1].id}.0`);
  const {rows,elements}=await browserExport(h);
  assert.equal(rows.at(-1).exported,1);assert.equal(rows.at(-1).issues[0].id,c.entries[1].id);
  assert.equal(rows.at(-1).issues[0].reason,'missing-chunk');assert.ok(elements.status.textContent.includes('1 条'));
});

test('plugin filters by client marker before buffering, and keeps portal available when disabled',()=>{
  const rules=plugin.split('[Script]')[1].split('[Mitm]')[0].split('\n').filter(s=>/^(request|response|generic) /.test(s));
  assert.equal(rules.length,6);
  assert.ok(!rules[0].includes('enable=${log_enabled}'));assert.ok(rules[0].includes('xianyu-logs'));
  for(const rule of rules.slice(1,5)) {
    assert.ok(rule.includes("${request.header['User-Agent']}"));assert.ok(rule.includes('enable=${log_enabled}'));assert.ok(rule.includes('${log_enabled} == true'));
    const pattern=rule.match(/\$\{request\.header\['User-Agent'\]\} ~= (\/(?:\\.|[^/])+\/i)/)[1];
    const matcher=vm.runInNewContext(pattern);
    assert.equal(matcher.test(UA),true);assert.equal(matcher.test('AliApp(TB/10.0.0)'),false);assert.equal(matcher.test('Mozilla/5.0 Safari/605.1'),false);
  }
  assert.ok(rules[1].includes('requires_body=false'));assert.ok(rules[2].includes('binary_body_mode=true'));
  assert.ok(rules[3].includes('requires_body=false'));assert.ok(rules[4].includes('binary_body_mode=true'));
  assert.ok(!plugin.includes('capture_all'));assert.ok(!code.includes('$dns'));assert.ok(!code.includes('$httpClient'));
  assert.ok(!plugin.split('[Mitm]')[1].includes('push.apple.com'));
});
