import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
const sources = Object.fromEntries(['YouTubeLogger','YouTubePlaybackAds','YouTubeStreamAds'].map(name => [name,fs.readFileSync(new URL(name + '.js',root),'utf8')]));
const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root),'utf8');
const configKey = 'ytads.logger.config.v1', indexKey = 'ytads.logger.entries.v2';
const api = 'https://youtubei.googleapis.com/youtubei/v1/player?key=SIGNED';
const media = 'https://rr5.googlevideo.com/videoplayback?sabr=1&sig=SIGNED';
function run(name, store, extra = {}, failingKey = '') {
  let result, calls = 0;
  const logs = [];
  const context = {
    $persistentStore:{read:key=>store.get(key),write(value,key){if (key === failingKey) return false; if(value===undefined)store.delete(key);else store.set(key,value);return true;}},
    $argument:{script_debug:false,log_enabled:true,log_level:'error',capture_raw:true,capture_budget:'32',ump_enabled:true,ump_mode:'inspect'},
    $loon:'test-device test-os test-build', $done(value){result=value;calls++;}, console:{log:value=>logs.push(value)},
    Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,...extra
  };
  vm.runInNewContext(sources[name],context,{timeout:5000});
  assert.equal(calls,1);
  return {result,logs};
}
function page(store,path,method='GET') {
  return run('YouTubeLogger',store,{$request:{url:'http://youtube-logs.invalid/'+path,method}}).result.response;
}
function started() {const store=new Map();assert.equal(page(store,'start','POST').status,303);return store;}
function exportData(store){return JSON.parse(page(store,'download.json').body);}
function player(store,body='{"playabilityStatus":{},"adSlots":[],"videoDetails":{"id":"ORIGINAL"}}',extra={}) {
  return run('YouTubePlaybackAds',store,{
    $request:{url:api,method:'POST',headers:{Authorization:'Bearer SECRET','Content-Encoding':'br'}},
    $response:{status:200,headers:{'Content-Type':'application/json'},body},...extra
  });
}
test('capture is opt-in, main plugin reads request bodies only for its opt-in request rule',()=>{
  assert.ok(plugin.includes('capture_raw = switch,false'));
  const line=plugin.split('\n').find(x=>x.includes('tag=YouTube 开发请求抓包'));
  assert.ok(line.includes('enable={capture_raw}')&&line.includes('requires-body=true,binary-body-mode=true'));
  const regex=new RegExp(line.split(' ')[1]);
  assert.ok(!regex.test(api)&&regex.test(media));
  const playerLine=plugin.split('\n').find(x=>x.includes('tag=YouTube 播放器请求广告协商清理'));
  assert.ok(playerLine.includes('{capture_raw}')&&playerLine.includes('{capture_budget}'));
  assert.ok(new RegExp(playerLine.split(' ')[1]).test(api));
  assert.ok(!regex.test('https://youtubei.googleapis.com.evil/youtubei/v1/player'));
  const onesie=plugin.split('\n').find(x=>x.includes('tag=YouTube Onesie 配置刷新'));
  const init=plugin.split('\n').find(x=>x.includes('tag=YouTube initplayback 广告协商清理'));
  const onesieRegex=new RegExp(onesie.split(' ')[1]),initRegex=new RegExp(init.split(' ')[1]);
  assert.ok(onesie.includes('enable={onesie_enabled}')&&onesie.includes('requires-body=true,binary-body-mode=true'));
  assert.ok(init.includes('enable={onesie_enabled}')&&init.includes('requires-body=true,binary-body-mode=true'));
  assert.ok(initRegex.test('https://rr5.googlevideo.com/initplayback?ack=1&oad=5500'));
  assert.ok(onesieRegex.test('https://youtubei.googleapis.com/youtubei/v1/log_event'));
  assert.ok(!initRegex.test('https://rr5.googlevideo.com/videoplayback?ack=1'));
  const store=started();
  player(store,undefined,{$argument:{script_debug:false,log_enabled:true,log_level:'debug',capture_raw:false}});
  assert.equal(exportData(store).events[0].capture,null);
  assert.ok(!exportData(store).events[0].summary.captureRef);
  const previous=store.get(indexKey);
  const disabled=run('YouTubeLogger',store,{$request:{url:api,method:'POST',body:new Uint8Array([1,2])},$argument:{log_enabled:false,capture_raw:true}});
  assert.equal(Object.keys(disabled.result).length,0);
  assert.equal(store.get(indexKey),previous);
});
test('request capture preserves URL, headers and body without changing outgoing request',()=>{
  const store=started();
  const body=new Uint8Array([0,255,17,128]);
  const r=run('YouTubeLogger',store,{$request:{url:media,method:'POST',headers:{Authorization:'Bearer SECRET','Content-Encoding':'br'},body}});
  assert.equal(Object.keys(r.result).length,0);
  const capture=exportData(store).events[0].capture;
  assert.equal(capture.phase,'request');
  assert.equal(capture.request.url,media);
  assert.equal(capture.request.headers.Authorization,'Bearer SECRET');
  assert.deepEqual(Buffer.from(capture.request.body.data,'base64'),Buffer.from(body));
  assert.equal(capture.correlation.exactPairing,false);
  assert.equal(capture.processing.executionScript,'YouTubeLogger');
});
test('response event preserves before/after text plus processing result independently of severity filter',()=>{
  const store=started();
  const r=player(store);
  const data=exportData(store);
  assert.equal(data.events.length,1);
  const c=data.events[0].capture;
  assert.equal(c.runtime,'test-device test-os test-build');
  assert.ok(c.request.url.includes('SIGNED'));
  assert.equal(c.request.body.available,false);
  assert.equal(c.responseBefore.body.encoding,'utf8-text');
  assert.deepEqual(JSON.parse(c.responseBefore.body.data).adSlots,[]);
  assert.equal(c.responseAfter.body.data,r.result.body);
  assert.equal(JSON.parse(c.responseAfter.body.data).adSlots,undefined);
  assert.ok(c.processing.messages[0].startsWith('changed:'));
  assert.equal(c.responseAfter.transportHeadersRecomputedByLoon,true);
  assert.equal(data.completeness.allReferencedSamplesReadable,true);
});
test('UMP response preserves exact raw binary, output reference and all headers',()=>{
  const store=started();
  const body=new Uint8Array([21,5,0,255,128,32,10]);
  const r=run('YouTubeStreamAds',store,{$request:{url:media,method:'POST',headers:{}},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump','Alt-Svc':'h3=":443"'},body}});
  assert.equal(Object.keys(r.result).length,0);
  const c=exportData(store).events[0].capture;
  assert.deepEqual(Buffer.from(c.responseBefore.body.data,'base64'),Buffer.from(body));
  assert.equal(c.responseBefore.headers['Alt-Svc'],'h3=":443"');
  assert.equal(c.responseAfter.body.reference,'responseBefore.body');
  assert.ok(c.processing.messages[0].includes('parts=21:1'));
});
test('modified UMP exports original and cleaned binary as independently recoverable samples',()=>{
  const store=started();
  const original=new Uint8Array([69,8,10,6,10,4,8,1,16,6]);
  const r=run('YouTubeStreamAds',store,{
    $request:{url:media,method:'POST'},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'},body:original},
    $argument:{log_enabled:true,capture_raw:true,ump_enabled:true,ump_mode:'clean_prefetch'}
  });
  const c=exportData(store).events[0].capture;
  assert.deepEqual(Buffer.from(c.responseBefore.body.data,'base64'),Buffer.from(original));
  assert.deepEqual(Buffer.from(c.responseAfter.body.data,'base64'),Buffer.from(r.result.body));
  assert.deepEqual(Array.from(original),[69,8,10,6,10,4,8,1,16,6]);
});
test('binary view offsets, empty binary bodies and UTF-8 text round-trip',()=>{
  for (const body of [new DataView(new Uint8Array([9,0,255,8]).buffer,1,2),new Uint8Array(),'{"playabilityStatus":{},"title":"广告😀"}']) {
    const store=started();player(store,body);
    const c=exportData(store).events[0].capture.responseBefore.body;
    if (typeof body === 'string') {assert.equal(c.data,body);assert.equal(c.bytes,Buffer.byteLength(body));}
    else {assert.deepEqual(Buffer.from(c.data,'base64'),Buffer.from(body.buffer,body.byteOffset,body.byteLength));assert.equal(c.bytes,body.byteLength);}
  }
});
test('large samples span storage chunks and missing chunks are reported without discarding other events',()=>{
  const store=started();
  const body=new Uint8Array(220000).fill(255);
  player(store,body);player(store);
  const index=JSON.parse(store.get(indexKey));
  assert.ok(index.entries[0].captureRef.chunks>=2);
  assert.equal(exportData(store).events[0].capture.responseBefore.body.bytes,body.length);
  store.delete(index.entries[0].captureRef.prefix+1);
  const data=exportData(store);
  assert.equal(data.completeness.allReferencedSamplesReadable,false);
  assert.equal(data.completeness.issues.length,1);
  assert.equal(data.events[0].capture,null);
  assert.ok(data.events[1].capture);
});
test('checksum detects modified storage even when sample length is unchanged',()=>{
  const store=started();player(store);
  const ref=JSON.parse(store.get(indexKey)).entries[0].captureRef;
  assert.match(ref.checksum,/^fnv1a32-utf16:[0-9a-f]{8}$/);
  const key=ref.prefix+'0';
  store.set(key,store.get(key).replace('ORIGINAL','ORIGINAQ'));
  const data=exportData(store);
  assert.equal(data.completeness.allReferencedSamplesReadable,false);
  assert.equal(data.events[0].captureError,'capture-unavailable-or-corrupt');
});
test('chunk boundaries never split UTF-16 surrogate pairs and Unicode sample restores exactly',()=>{
  const store=started();
  const original='{"playabilityStatus":{},"title":"'+'😀'.repeat(100000)+'"}';
  player(store,original);
  const ref=JSON.parse(store.get(indexKey)).entries[0].captureRef;
  for(let i=0;i<ref.chunks;i++) {
    const chunk=store.get(ref.prefix+i);
    const last=chunk.charCodeAt(chunk.length-1);
    assert.ok(!(last>=0xd800&&last<=0xdbff));
  }
  assert.equal(exportData(store).events[0].capture.responseBefore.body.data,original);
});
test('ad/content markers preserve user observations and require active recording',()=>{
  const store=started();
  assert.equal(page(store,'mark-ad','POST').status,303);
  player(store);
  assert.equal(page(store,'mark-content','POST').status,303);
  const events=exportData(store).events;
  assert.equal(events.length,3);
  assert.equal(events[0].summary.message,'user mark: ad-playing');
  assert.equal(events[2].summary.message,'user mark: content-playing');
  page(store,'pause','POST');
  assert.equal(page(store,'mark-ad','POST').status,409);
});
test('capacity stops new capture instead of deleting old evidence',()=>{
  const store=started();player(store);
  const previous=JSON.parse(store.get(indexKey));
  previous.captureBytes=32*1048576;
  store.set(indexKey,JSON.stringify(previous));
  player(store);
  assert.deepEqual(JSON.parse(store.get(indexKey)),previous);
  assert.equal(JSON.parse(store.get(configKey)).enabled,false);
  assert.equal(JSON.parse(store.get(configKey)).haltReason,'capture-budget-limit');
  assert.equal(exportData(store).completeness.stoppedDueToLimitOrError,true);
});
test('oversized body pauses capture with an explicit reason and never changes playback outcome',()=>{
  const store=started();
  const r=player(store,new Uint8Array(8388609));
  assert.equal(Object.keys(r.result).length,0);
  assert.equal(JSON.parse(store.get(configKey)).haltReason,'capture-body-limit');
  assert.equal(JSON.parse(store.get(indexKey)).entries.length,0);
});
test('failed manifest commit rolls back newly written sample chunks and preserves cleanup output',()=>{
  const store=started();
  const r=player(store,undefined); // Retain a valid previous capture first.
  assert.ok(r.result.body);
  const keys=Array.from(store.keys());
  const index=store.get(indexKey);
  const failed=run('YouTubePlaybackAds',store,{
    $request:{url:api,method:'POST'},$response:{status:200,headers:{'Content-Type':'application/json'},body:'{"playabilityStatus":{},"adSlots":[]}'},
  },indexKey);
  assert.equal(JSON.parse(failed.result.body).adSlots,undefined);
  assert.equal(store.get(indexKey),index);
  assert.deepEqual(Array.from(store.keys()),keys);
  assert.equal(JSON.parse(store.get(configKey)).haltReason,'storage-or-serialization-failed');
});
test('clear deletes referenced sample chunks while preserving unrelated storage',()=>{
  const store=started();player(store);store.set('other-app','keep');
  assert.ok(Array.from(store.keys()).some(k=>k.startsWith('ytads.capture.')));
  page(store,'clear','POST');
  assert.ok(!Array.from(store.keys()).some(k=>k.startsWith('ytads.capture.')));
  assert.equal(store.get('other-app'),'keep');
  assert.equal(exportData(store).events.length,0);
});
test('raw capture keeps exception details in development export without leaking into console',()=>{
  const store=started();
  const r=player(store,'{"playabilityStatus":{},"SECRET":"broken');
  const c=exportData(store).events[0].capture;
  assert.equal(c.processing.exception.name,'SyntaxError');
  assert.ok(c.responseBefore.body.data.includes('SECRET'));
  assert.ok(!r.logs.join('\n').includes('SECRET'));
});
test('missing runtime body is explicit; downloads are attachments; unmatched requests stay untouched',()=>{
  const store=started();
  run('YouTubeLogger',store,{$request:{url:api,method:'POST',headers:{}}});
  assert.equal(exportData(store).events[0].capture.request.body.available,false);
  const response=page(store,'download.json');
  assert.match(response.headers['Content-Disposition'],/attachment; filename="YouTube-.*\.json"/);
  const before=store.get(indexKey);
  const r=run('YouTubeLogger',store,{$request:{url:'https://example.com/',method:'GET'}});
  assert.equal(Object.keys(r.result).length,0);
  assert.equal(store.get(indexKey),before);
});

test('feed request and before/after response samples share the existing cache and filtered export',()=>{
  const store=started();
  sources.YouTubeFeedAds=fs.readFileSync(new URL('YouTubeFeedAds.js',root),'utf8');
  const url='https://youtubei.googleapis.com/youtubei/v1/browse?key=FEED';
  const body='{"contents":[{"adSlotRenderer":{"title":"Robinhood"}},{"videoRenderer":{"title":"NORMAL"}}]}';
  run('YouTubeLogger',store,{$request:{url,method:'POST',body:new Uint8Array([1,2,3])}});
  run('YouTubeFeedAds',store,{$request:{url,method:'POST'},$response:{status:200,headers:{'Content-Type':'application/json'},body}});
  player(store);page(store,'mark-ad','POST');
  const all=exportData(store);assert.equal(all.events.length,4);
  const feed=JSON.parse(page(store,'download-feed.json').body);
  assert.equal(feed.exportScope,'feed-with-user-marks');assert.equal(feed.events.length,3);
  assert.equal(feed.events[0].capture.source,'YouTubeFeedAds');assert.equal(feed.events[0].capture.endpoint,'browse');
  assert.equal(feed.events[1].capture.responseBefore.body.data,body);
  assert.equal(feed.events[1].capture.responseAfter.changed,true);
  assert.equal(JSON.parse(feed.events[1].capture.responseAfter.body.data).contents.length,1);
  assert.equal([...store.keys()].filter(k=>k==='ytads.logger.entries.v2').length,1);
  assert.ok(![...store.keys()].some(k=>k==='ytads.logger.YouTubeFeedAds.v1'));
});

test('large export reads bounded chunks and browser assembles exactly one complete JSON file',async()=>{
  const store=started();
  const original='{"playabilityStatus":{},"data":"'+'x'.repeat(4500000)+'"}';
  player(store,original);page(store,'pause','POST');
  assert.equal(page(store,'download.json').status,413,'direct response never silently truncates');
  const html=page(store,'export');assert.equal(html.status,200);
  assert.ok(html.headers['Content-Security-Policy'].includes("connect-src 'self'"));
  const script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
  const status={textContent:''},save={hidden:true};let savedBlob;const sizes=[];
  await vm.runInNewContext(script,{
    document:{getElementById:id=>id==='status'?status:save},Blob,
    URL:{createObjectURL(blob){savedBlob=blob;return 'blob:local-test';}},
    async fetch(path){const r=page(store,path.replace(/^\//,''));sizes.push(Buffer.byteLength(r.body));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}
  },{timeout:5000});
  assert.equal(save.hidden,false);assert.ok(save.download.endsWith('.json'));
  const exported=JSON.parse(await savedBlob.text());assert.equal(exported.events.length,1);
  assert.equal(exported.events[0].capture.responseBefore.body.data,original);
  assert.equal(exported.events[0].capture.responseAfter.body.reference,'responseBefore.body');
  assert.equal(exported.completeness.allReferencedSamplesReadable,true);
  assert.ok(Math.max(...sizes)<1048576,'no large response generated by chunk route');
  assert.equal(page(store,'download.log').status,200,'summaries remain available');
});

test('chunk exports require paused same-session records and reject missing, invalid and foreign chunks',()=>{
  const store=started();player(store);
  assert.equal(page(store,'export-manifest.json').status,409);
  page(store,'pause','POST');
  const manifest=JSON.parse(page(store,'export-manifest.json').body);
  const route=`export-chunk/${manifest.session}/0/0`;
  assert.equal(page(store,route).status,200);
  assert.equal(page(store,`export-chunk/wrong/0/0`).status,409);
  assert.equal(page(store,`export-chunk/${manifest.session}/599/0`).status,404);
  assert.equal(page(store,`export-chunk/${manifest.session}/0/256`).status,404);
  const ref=manifest.rows[0].captureRef;store.delete(ref.prefix+'0');
  assert.equal(page(store,route).status,503);
  assert.equal(page(store,'export-chunk/../../unrelated/0/0').status,404);
  page(store,'start','POST');assert.equal(page(store,route).status,409);
});

test('browser export refuses checksum-corrupt bytes instead of offering an incomplete file',async()=>{
 const store=started();player(store);page(store,'pause','POST');
 const manifest=JSON.parse(page(store,'export-manifest.json').body),ref=manifest.rows[0].captureRef;
 store.set(ref.prefix+'0',store.get(ref.prefix+'0').replace('ORIGINAL','TAMPERED'));
 const html=page(store,'export'),script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={textContent:''},save={hidden:true};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,URL:{createObjectURL:x=>{blob=x;}},async fetch(path){const r=page(store,path.slice(1));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}},{timeout:5000});
 assert.equal(blob,undefined);assert.equal(save.hidden,true);assert.ok(status.textContent.includes('校验失败'));
});

test('filtered browser export resolves feed chunks from the same cache, excluding media/player samples',async()=>{
 const store=started();sources.YouTubeFeedAds=fs.readFileSync(new URL('YouTubeFeedAds.js',root),'utf8');
 player(store);run('YouTubeFeedAds',store,{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/browse'},$response:{status:200,headers:{'Content-Type':'application/json'},body:'{"contents":[{"adSlotRenderer":{}}]}'}});
 page(store,'pause','POST');const html=page(store,'export-feed'),script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={textContent:''},save={hidden:true};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,URL:{createObjectURL:x=>{blob=x;return 'blob:local';}},async fetch(path){const r=page(store,path.slice(1));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}},{timeout:5000});
 assert.equal(save.hidden,false);assert.ok(save.download.startsWith('YouTube-Feed-'));
 const exported=JSON.parse(await blob.text());assert.equal(exported.exportScope,'feed-with-user-marks');assert.equal(exported.events.length,1);assert.equal(exported.events[0].capture.source,'YouTubeFeedAds');assert.equal(exported.events[0].capture.responseAfter.changed,true);
});
