import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const root = new URL('../', import.meta.url);
const sources = Object.fromEntries(['YouTubeLogger','YouTubePlayback','YouTubeFeed','YouTubeConfig'].map(name => [name,fs.readFileSync(new URL('src/' + name + '.js',root),'utf8')]));
const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root),'utf8');
const configKey = 'ytads.logger.config.v1', indexKey = 'ytads.logger.entries.v2';
const api = 'https://youtubei.googleapis.com/youtubei/v1/player?key=SIGNED';
const media = 'https://rr5.googlevideo.com/videoplayback?sabr=1&sig=SIGNED';
function run(name, store, extra = {}, failingKey = '') {
  let result, calls = 0;
  const logs = [];
  const context = {
    $persistentStore:{read:key=>store.get(key),write(value,key){if (key === failingKey) return false; if(value===undefined)store.delete(key);else store.set(key,value);return true;}},
    $argument:{script_debug:false,log_enabled:true,log_level:'info',capture_raw:true,capture_budget:'32',ump_mode:'inspect',media_capture_mode:'full'},
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
function checksum(text){let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return 'fnv1a32-utf16:'+('00000000'+(hash>>>0).toString(16)).slice(-8);}
function exportData(store){
  const config=JSON.parse(store.get(configKey)||'null'),state=JSON.parse(store.get(indexKey)||'null');
  const rows=state&&config&&state.session===config.session?state.entries:[],issues=[];
  const events=rows.map(summary=>{
    if(!summary.captureRef)return {summary,capture:null};
    try{const text=Array.from({length:summary.captureRef.chunks},(_,i)=>store.get(summary.captureRef.prefix+i)).join('');if(text.length!==summary.captureRef.chars||checksum(text)!==summary.captureRef.checksum)throw new Error();return {summary,capture:JSON.parse(text)};}
    catch{issues.push({time:summary.time,source:summary.source});return {summary,capture:null,captureError:'capture-unavailable-or-corrupt'};}
  });
  return {events,completeness:{allReferencedSamplesReadable:issues.length===0,issues,stoppedDueToLimitOrError:!!config?.haltReason}};
}
function player(store,body='{"playabilityStatus":{},"adSlots":[],"videoDetails":{"id":"ORIGINAL"}}',extra={}) {
  return run('YouTubePlayback',store,{
    $request:{url:api,method:'POST',headers:{Authorization:'Bearer SECRET','Content-Encoding':'br'}},
    $response:{status:200,headers:{'Content-Type':'application/json'},body},...extra
  });
}
test('native initialization logger only observes headers and cannot synthesize a second response or read the body',()=>{
 const store=started(),request={url:'https://rr4.googlevideo.com/initplayback?sig=PRIVATE_SIGNATURE',method:'POST',headers:{'User-Agent':'com.google.ios.youtube/21.39.4',Cookie:'PRIVATE_COOKIE'}};
 Object.defineProperty(request,'body',{get(){throw Error('native blank video logger must not read body');}});
 const line=plugin.split('\n').find(line=>line.includes('tag=YouTube 日志记录与导出'));
 assert.ok(new RegExp(line.split(' ')[1]).test(request.url));assert.ok(line.includes('requires-body=false'));
 const output=run('YouTubeLogger',store,{$request:request,$argument:{log_enabled:true,log_level:'info',media_capture_mode:'headers'}}).result;
 assert.deepEqual(Object.keys(output),[]);
 const event=exportData(store).events[0];assert.equal(event.summary.endpoint,'initplayback');
 assert.equal(event.capture.request.body.available,false);assert.equal(event.capture.responseAfter,undefined);
 const saved=[...store.values()].join('');assert.ok(!saved.includes('PRIVATE_SIGNATURE'));assert.ok(!saved.includes('PRIVATE_COOKIE'));
});
test('binary feed capture uses temporary views and persists only redacted structures',()=>{
 const store=started();
 const text='{"contents":[{"adSlotRenderer":{}},{"videoRenderer":{"videoId":"PRIVATE_VIDEO","title":"PRIVATE_TITLE"}}],"authorization":"PRIVATE_TOKEN"}';
 const bytes=new TextEncoder().encode(text),padded=new Uint8Array(bytes.length+4);padded.set(bytes,2);
 const body=new DataView(padded.buffer,2,bytes.length),before=Buffer.from(padded);
 const exchange={$request:{url:'https://youtubei.googleapis.com/youtubei/v1/next'},$response:{status:200,headers:{'Content-Type':'application/json'},body}};
 const enabled=run('YouTubeFeed',store,exchange).result;
 const disabled=run('YouTubeFeed',store,{...exchange,$argument:{log_enabled:false,capture_raw:false}}).result;
 assert.deepEqual(Buffer.from(enabled.body),Buffer.from(disabled.body));assert.deepEqual(Buffer.from(padded),before);
 const captured=exportData(store).events[0].capture;
 assert.equal(captured.responseBefore.body.bytes,bytes.length);
 assert.ok(captured.responseBefore.body.structure.contents[0].adSlotRenderer);
 assert.equal(captured.responseAfter.body.structure.contents.length,1);
 const persisted=Array.from(store.values()).join('');
 for(const privateValue of ['PRIVATE_VIDEO','PRIVATE_TITLE','PRIVATE_TOKEN','memoryBytes','utf8-text','base64'])assert.ok(!persisted.includes(privateValue));
});

test('feed timings include sample preparation and writes and appear in the single log download',async()=>{
 const store=started();let clock=Date.now();
 class DiagnosticClock extends Date {static now(){return ++clock;}}
 run('YouTubeFeed',store,{
  $request:{url:'https://youtubei.googleapis.com/youtubei/v1/next'},
  $response:{status:200,headers:{'Content-Type':'application/json'},body:'{"contents":[{"adSlotRenderer":{}},{"videoRenderer":{}}]}'},Date:DiagnosticClock,
  $persistentStore:{read:key=>store.get(key),write(value,key){clock+=50;if(value===undefined)store.delete(key);else store.set(key,value);return true;}}
 });
 const timing=exportData(store).events[0].summary.timing;
 assert.ok(timing.capturePrepareMs>=0);assert.ok(timing.sampleWriteMs>=50);assert.ok(timing.scriptBeforeIndexCommitMs>=timing.capturePrepareMs+timing.sampleWriteMs);
 page(store,'pause','POST');const script=page(store,'export').body.match(/<script>([\s\S]*)<\/script>/)[1];let blob;
 const save={hidden:true,click(){}},status={textContent:''};
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,URL:{createObjectURL:value=>{blob=value;return 'blob:local';}},async fetch(path){const response=page(store,path.slice(1));return {ok:response.status===200,status:response.status,json:async()=>JSON.parse(response.body)};}},{timeout:5000});
 assert.ok(blob);const log=await blob.text();assert.ok(log.includes('Capture-Timing-Ms:'));assert.ok(log.includes('sampleWriteMs: '+timing.sampleWriteMs));
});
test('the single log switch enables full-chain capture without buffering request bodies',()=>{
  assert.ok(!plugin.includes('capture_raw = switch'));
  const line=plugin.split('\n').find(x=>x.includes('tag=YouTube 日志记录与导出'));
  assert.ok(line.includes('enable={log_enabled}')&&line.includes('requires-body=false'));
  const regex=new RegExp(line.split(' ')[1]);
  assert.ok(!regex.test(api)&&regex.test(media));
  const playerLine=plugin.split('\n').find(x=>x.includes('tag=YouTube 播放请求与广告配置处理'));
  assert.ok(playerLine.includes('{log_enabled}')&&playerLine.includes('{capture_budget}'));
  assert.ok(new RegExp(playerLine.split(' ')[1]).test(api));
  assert.ok(!regex.test('https://youtubei.googleapis.com.evil/youtubei/v1/player'));
  const onesie=plugin.split('\n').find(x=>x.includes('tag=YouTube 配置请求处理'));
  const init=plugin.split('\n').find(x=>x.startsWith('http-request ')&&x.includes('googlevideo\\.com\\/initplayback'));
  const onesieRegex=new RegExp(onesie.split(' ')[1]),initRegex=new RegExp(init.split(' ')[1]);
  assert.ok(!onesie.includes('enable=')&&onesie.includes('requires-body=true,binary-body-mode=true'));
  assert.ok(init.includes('enable={log_enabled}')&&init.includes('requires-body=false')&&!init.includes('binary-body-mode=true'));
  assert.ok(initRegex.test('https://rr5.googlevideo.com/initplayback?ack=1&oad=5500'));
  assert.ok(onesieRegex.test('https://youtubei.googleapis.com/youtubei/v1/log_event'));
  assert.ok(!onesieRegex.test('https://rr5.googlevideo.com/initplayback?ack=1'));
  assert.ok(plugin.includes('then reject_video(200)'));
  const store=started();
  player(store,undefined,{$argument:{script_debug:false,log_enabled:true,log_level:'debug',capture_raw:false}});
  assert.equal(exportData(store).events[0].capture,null);
  assert.ok(!exportData(store).events[0].summary.captureRef);
  const unifiedStore=started();
  player(unifiedStore,undefined,{$argument:{log_enabled:true,log_level:'debug',capture_budget:'32'}});
  assert.ok(exportData(unifiedStore).events[0].capture,'log_enabled must imply complete capture when the removed capture_raw switch is absent');
  const previous=store.get(indexKey);
  const disabled=run('YouTubeLogger',store,{$request:{url:api,method:'POST',body:new Uint8Array([1,2])},$argument:{log_enabled:false,capture_raw:true}});
  assert.equal(Object.keys(disabled.result).length,0);
  assert.equal(store.get(indexKey),previous);
});
test('request capture removes credentials and query values without changing outgoing request',()=>{
  const store=started();
  const body=new Uint8Array([0,255,17,128]);
  const r=run('YouTubeLogger',store,{$request:{url:media,method:'POST',headers:{Authorization:'Bearer SECRET','Content-Encoding':'br'},body}});
  assert.equal(Object.keys(r.result).length,0);
  const capture=exportData(store).events[0].capture;
  assert.equal(capture.phase,'request');
  assert.equal(capture.request.url,media.split('?')[0]);
  assert.equal(capture.request.headers.Authorization,undefined);
  assert.equal(capture.request.body.data,undefined);assert.equal(capture.request.body.available,false);
  assert.equal(capture.processing.bodyBuffering,false);
  assert.equal(capture.correlation.exactPairing,false);
  assert.equal(capture.processing.executionScript,'YouTubeLogger');
});
test('response event preserves before/after redacted structure independently of severity filter',()=>{
  const store=started();
  const r=player(store);
  const data=exportData(store);
  assert.equal(data.events.length,1);
  const c=data.events[0].capture;
  assert.equal(c.runtime,'test-device test-os test-build');
  assert.ok(!c.request.url.includes('SIGNED'));
  assert.equal(c.request.body.available,false);
  assert.equal(c.responseBefore.body.reason,'privacy-structure-only');
  assert.deepEqual(c.responseBefore.body.structure.adSlots,[]);
  assert.ok(c.responseAfter.body.structure);
  assert.equal(c.responseAfter.body.structure.adSlots,undefined);
  assert.ok(c.processing.messages[0].startsWith('changed:'));
  assert.equal(c.responseAfter.transportHeadersRecomputedByLoon,true);
  assert.equal(data.completeness.allReferencedSamplesReadable,true);
});
test('UMP response records length, part summaries and output reference without raw media',()=>{
  const store=started();
  const body=new Uint8Array([21,5,0,255,128,32,10]);
  const r=run('YouTubePlayback',store,{$request:{url:media,method:'POST',headers:{}},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump','Alt-Svc':'h3=":443"'},body}});
  assert.equal(Object.keys(r.result).length,0);
  const c=exportData(store).events[0].capture;
  assert.equal(c.responseBefore.body.data,undefined);assert.equal(c.responseBefore.body.bytes,Buffer.byteLength(body));
  assert.equal(c.responseBefore.headers['Alt-Svc'],undefined);
  assert.equal(c.responseAfter.body.reference,'responseBefore.body');
  assert.ok(c.processing.messages[0].includes('parts=21:1'));
});
test('modified UMP records before/after lengths while media processing stays byte exact',()=>{
  const store=started();
  const original=new Uint8Array([69,8,10,6,10,4,8,1,16,6]);
  const r=run('YouTubePlayback',store,{
    $request:{url:media,method:'POST'},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'},body:original},
    $argument:{log_enabled:true,capture_raw:true,ump_mode:'clean_prefetch'}
  });
  const c=exportData(store).events[0].capture;
  assert.equal(c.responseBefore.body.data,undefined);assert.equal(c.responseBefore.body.bytes,original.length);
  assert.equal(c.responseAfter.body.data,undefined);assert.equal(c.responseAfter.body.bytes,r.result.body.length);
  assert.deepEqual(Array.from(original),[69,8,10,6,10,4,8,1,16,6]);
});
test('redacted diagnostics record binary view lengths and Unicode string lengths',()=>{
  for (const body of [new DataView(new Uint8Array([9,0,255,8]).buffer,1,2),new Uint8Array(),'{"playabilityStatus":{},"title":"广告😀"}']) {
    const store=started();player(store,body);
    const c=exportData(store).events[0].capture.responseBefore.body;
    if (typeof body === 'string') {assert.equal(c.data,undefined);assert.equal(c.bytes,Buffer.byteLength(body));}
    else {assert.equal(c.data,undefined);assert.equal(c.bytes,body.byteLength);}
  }
});
test('large samples span storage chunks and missing chunks are reported without discarding other events',()=>{
  const store=started();
  const body=JSON.stringify({playabilityStatus:{},rows:Array.from({length:7000},()=>({value:'PRIVATE'}))});
  player(store,body);player(store);
  const index=JSON.parse(store.get(indexKey));
  assert.ok(index.entries[0].captureRef.chunks>=2);
  assert.equal(exportData(store).events[0].capture.responseBefore.body.bytes,Buffer.byteLength(body));
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
  store.set(key,store.get(key).replace('privacy-structure-only','privacy-structure-onlX'));
  const data=exportData(store);
  assert.equal(data.completeness.allReferencedSamplesReadable,false);
  assert.equal(data.events[0].captureError,'capture-unavailable-or-corrupt');
});
test('Unicode sample records character length without preserving original text',()=>{
  const store=started();
  const original='{"playabilityStatus":{},"title":"'+'😀'.repeat(100000)+'"}';
  player(store,original);
  const ref=JSON.parse(store.get(indexKey)).entries[0].captureRef;
  for(let i=0;i<ref.chunks;i++) {
    const chunk=store.get(ref.prefix+i);
    const last=chunk.charCodeAt(chunk.length-1);
    assert.ok(!(last>=0xd800&&last<=0xdbff));
  }
  assert.equal(exportData(store).events[0].capture.responseBefore.body.data,undefined);assert.equal(exportData(store).events[0].capture.responseBefore.body.structure.title.chars,200000);
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
  const failed=run('YouTubePlayback',store,{
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
test('diagnostics remove exception details that may reveal original text',()=>{
  const store=started();
  const r=player(store,'{"playabilityStatus":{},"SECRET":"broken');
  const c=exportData(store).events[0].capture;
  assert.equal(c.processing.exception.code,'processing-failed');
  assert.ok(!JSON.stringify(c).includes('SECRET'));
  assert.ok(!r.logs.join('\n').includes('SECRET'));
});
test('missing runtime body is explicit; legacy JSON routes are gone; unmatched requests stay untouched',()=>{
  const store=started();
  run('YouTubeLogger',store,{$request:{url:api,method:'POST',headers:{}}});
  assert.equal(exportData(store).events[0].capture.request.body.available,false);
  assert.equal(page(store,'download.json').status,404);
  assert.equal(page(store,'download-feed.json').status,404);
  assert.equal(page(store,'export-feed').status,404);
  const before=store.get(indexKey);
  const r=run('YouTubeLogger',store,{$request:{url:'https://example.com/',method:'GET'}});
  assert.equal(Object.keys(r.result).length,0);
  assert.equal(store.get(indexKey),before);
});

test('feed request and before/after response samples share the one full-chain cache',()=>{
  const store=started();
  sources.YouTubeFeed=fs.readFileSync(new URL('src/YouTubeFeed.js',root),'utf8');
  const url='https://youtubei.googleapis.com/youtubei/v1/browse?key=FEED';
  const body='{"contents":[{"adSlotRenderer":{"title":"Robinhood"}},{"videoRenderer":{"title":"NORMAL"}}]}';
  run('YouTubeLogger',store,{$request:{url,method:'POST',body:new Uint8Array([1,2,3])}});
  run('YouTubeFeed',store,{$request:{url,method:'POST'},$response:{status:200,headers:{'Content-Type':'application/json'},body}});
  player(store);page(store,'mark-ad','POST');
  const all=exportData(store);assert.equal(all.events.length,4);
  assert.equal(all.events[0].capture.source,'YouTubeFeed');assert.equal(all.events[0].capture.endpoint,'browse');
  assert.equal(all.events[1].capture.responseBefore.body.structure.contents.length,2);
  assert.equal(all.events[1].capture.responseAfter.changed,true);
  assert.equal(all.events[1].capture.responseAfter.body.structure.contents.length,1);
  assert.equal(all.events[2].capture.source,'YouTubePlayback');
  assert.equal([...store.keys()].filter(k=>k==='ytads.logger.entries.v2').length,1);
  assert.ok(![...store.keys()].some(k=>k==='ytads.logger.YouTubeFeed.v1'));
});

test('large export reads bounded chunks and browser assembles exactly one complete full-chain log file',async()=>{
  const store=started();
  const original=JSON.stringify({playabilityStatus:{},data:Array.from({length:15000},()=>({value:'PRIVATE'}))});
  player(store,original);page(store,'pause','POST');
  assert.equal(page(store,'download.json').status,404,'JSON log interface is removed');
  const html=page(store,'export');assert.equal(html.status,200);
  assert.ok(html.headers['Content-Security-Policy'].includes("connect-src 'self'"));
  const script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
  const status={textContent:''},save={hidden:true,click(){this.clicked=true;}};let savedBlob;const sizes=[];
  await vm.runInNewContext(script,{
    document:{getElementById:id=>id==='status'?status:save},Blob,
    URL:{createObjectURL(blob){savedBlob=blob;return 'blob:local-test';}},
    async fetch(path){const r=page(store,path.replace(/^\//,''));sizes.push(Buffer.byteLength(r.body));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}
  },{timeout:5000});
  assert.equal(save.hidden,false);assert.ok(save.download.endsWith('.log'));
  const exported=await savedBlob.text();assert.match(exported,/YouTube full diagnostic log/);assert.match(exported,/EVENT 1/);
  assert.ok(!exported.includes('PRIVATE'));assert.match(exported,/Structure:/);assert.match(exported,/Reference: responseBefore\.body/);assert.match(exported,/All-Referenced-Samples-Readable: true/);
  assert.ok(Math.max(...sizes)<1048576,'no large response generated by chunk route');
  assert.equal(page(store,'download.log').status,303,'old log bookmark redirects to the sole exporter');
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
 store.set(ref.prefix+'0',store.get(ref.prefix+'0').replace('privacy-structure-only','privacy-structure-onlX'));
 const html=page(store,'export'),script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={textContent:''},save={hidden:true,click(){this.clicked=true;}};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,URL:{createObjectURL:x=>{blob=x;}},async fetch(path){const r=page(store,path.slice(1));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}},{timeout:5000});
 assert.equal(blob,undefined);assert.equal(save.hidden,true);assert.ok(status.textContent.includes('校验失败'));
});

test('single browser export includes browse, refresh, player and binary media samples from the same cache',async()=>{
 const store=started();sources.YouTubeFeed=fs.readFileSync(new URL('src/YouTubeFeed.js',root),'utf8');
 player(store);run('YouTubeFeed',store,{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/browse'},$response:{status:200,headers:{'Content-Type':'application/json'},body:'{"contents":[{"adSlotRenderer":{}}]}'}});
 run('YouTubeLogger',store,{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/config',method:'POST'},$response:{status:200,headers:{'Content-Type':'application/x-protobuf'},body:new Uint8Array([8,1])}});
 run('YouTubePlayback',store,{$request:{url:media,method:'POST'},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'},body:new Uint8Array([21,3,1,2,3])}});
 page(store,'pause','POST');const html=page(store,'export'),script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={textContent:''},save={hidden:true,click(){this.clicked=true;}};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,URL:{createObjectURL:x=>{blob=x;return 'blob:local';}},async fetch(path){const r=page(store,path.slice(1));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}},{timeout:5000});
 assert.equal(save.hidden,false);assert.ok(save.download.startsWith('YouTube-')&&save.download.endsWith('.log'));
 const exported=await blob.text();assert.match(exported,/Source: YouTubePlayback/);assert.match(exported,/Source: YouTubeFeed/);assert.match(exported,/Source: YouTubeConfig/);assert.match(exported,/Endpoint: config/);assert.match(exported,/Source: YouTubePlayback/);assert.match(exported,/privacy-structure-only/);assert.ok(!exported.includes('FQMBAgM='));assert.match(exported,/Response-After:/);
});

test('privacy removes secrets from headers, URL, JSON, malformed bodies and exceptions before persistence',()=>{
 const store=started(),secret='NEVER-SAVE-ACCOUNT-TOKEN';
 const body=JSON.stringify({playabilityStatus:{},adSlots:[],authorization:secret,visitorData:secret,videoDetails:{title:secret},nested:{cookie:secret,username:secret}});
 player(store,body,{$request:{url:api+'&token='+secret,method:'POST',headers:{Authorization:secret,Cookie:secret,'X-Goog-Visitor-Id':secret,'Content-Type':'application/json'},body:secret}});
 player(store,'{"playabilityStatus":{},"bad":"'+secret);
 for(const [key,value] of store)if(key.startsWith('ytads.capture.')||key===indexKey)assert.ok(!value.includes(secret));
 const c=exportData(store).events[0].capture;
 assert.deepEqual(Object.keys(c.request.headers),['Content-Type']);assert.equal(c.request.url,api.split('?')[0]);
 assert.equal(c.request.body.data,undefined);assert.equal(c.responseBefore.body.structure.authorization,undefined);
 assert.equal(c.responseBefore.body.structure.videoDetails.title.markers.length,0);
});
test('privacy protobuf retains field paths and ad markers without retaining signed URLs or opaque binary secrets',()=>{
 const store=started(),secret='NEVER-SAVE-PROTO-TOKEN';
 const varint=n=>{const a=[];while(n>=128){a.push(n%128+128);n=Math.floor(n/128);}return [...a,n];};
 const text=new TextEncoder().encode('https://www.googleadservices.com/pagead/aclk?token='+secret);
 const body=Uint8Array.from([...varint(99*8+2),...varint(text.length),...text]);
 player(store,body,{$response:{status:200,headers:{'Content-Type':'application/x-protobuf'},body}});
 const c=exportData(store).events[0].capture.responseBefore.body;
 assert.equal(c.structure[0].field,99);assert.equal(c.structure[0].bytes,text.length);
 assert.ok(c.structure[0].markers.includes('googleadservices.com/pagead/'));
 assert.ok(![...store.values()].join('').includes(secret));assert.equal(c.data,undefined);
});
test('privacy removes raw config and media payloads even if they contain unrecognized binary credentials',()=>{
 const store=started(),secret=new TextEncoder().encode('NEVER-SAVE-ENCRYPTION-KEY');
 for(const endpoint of ['config','log_event','initplayback'])run('YouTubeLogger',store,{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/'+endpoint,method:'POST',headers:{Cookie:'PRIVATE'},body:secret},$response:{status:200,headers:{'Content-Type':'application/x-protobuf'},body:secret}});
 run('YouTubePlayback',store,{$request:{url:media},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'},body:secret}});
 const rows=exportData(store).events;assert.ok(rows.length>=3);
 for(const row of rows){assert.equal(row.capture.responseBefore.body.data,undefined);assert.equal(row.capture.responseBefore.body.structure,undefined);}
 assert.ok(![...store.values()].join('').includes(Buffer.from(secret).toString('base64')));
});
test('privacy migration deletes old raw chunks and keeps summaries and unrelated data',()=>{
 const store=started();store.delete('ytads.logger.privacy.v1');
 const config=JSON.parse(store.get(configKey)),prefix='ytads.capture.'+config.session+'.old-private.';
 store.set(prefix+'0','OLD-PRIVATE-RAW-DATA');store.set('other-app','KEEP');
 store.set(indexKey,JSON.stringify({session:config.session,captureBytes:20,entries:[{source:'YouTubeFeed',version:'2.2.0',endpoint:'browse',time:'2026-10-04T00:00:00.000Z',level:'info',message:'old',captureRef:{prefix,chunks:1}}]}));
 page(store,'');assert.equal(store.has(prefix+'0'),false);assert.equal(store.get('other-app'),'KEEP');
 const state=JSON.parse(store.get(indexKey));assert.equal(state.entries[0].captureRef,undefined);assert.equal(state.captureBytes,0);
});
test('privacy deletion failure blocks new capture without changing playback processing',()=>{
 const store=started();store.delete('ytads.logger.privacy.v1');
 const config=JSON.parse(store.get(configKey)),prefix='ytads.capture.'+config.session+'.old-private.';
 store.set(prefix+'0','OLD-PRIVATE');store.set(indexKey,JSON.stringify({session:config.session,entries:[{captureRef:{prefix,chunks:1}}]}));
 const before=store.get(indexKey);
 const result=run('YouTubePlayback',store,{$request:{url:api},$response:{status:200,headers:{'Content-Type':'application/json'},body:'{"playabilityStatus":{},"adSlots":[]}'}},prefix+'0');
 assert.equal(JSON.parse(result.result.body).adSlots,undefined);assert.equal(store.get(indexKey),before);assert.equal(store.has('ytads.logger.privacy.v1'),false);
});

test('sample chunk writes preserve an event appended by another writer before final commit',()=>{
  const store=started();
  const originalSet=store.set.bind(store);let injected=false;
  store.set=(key,value)=>{
    originalSet(key,value);
    if(!injected&&key.startsWith('ytads.capture.')) {
      injected=true;
      assert.equal(page(store,'mark-ad','POST').status,303);
    }
    return store;
  };
  player(store);
  const rows=JSON.parse(store.get(indexKey)).entries;
  assert.equal(rows.length,2);
  assert.ok(rows.some(row=>row.message==='user mark: ad-playing'));
  assert.ok(rows.some(row=>row.endpoint==='player'));
  assert.equal(exportData(store).completeness.allReferencedSamplesReadable,true);
});

for(const action of ['pause','clear'])test(`an in-flight capture cannot undo ${action} or leave its sample chunks`,()=>{
  const store=started();
  const originalSet=store.set.bind(store);let injected=false;
  store.set=(key,value)=>{
    originalSet(key,value);
    if(!injected&&key.startsWith('ytads.capture.')) {
      injected=true;
      assert.equal(page(store,action,'POST').status,303);
    }
    return store;
  };
  player(store);
  assert.equal(JSON.parse(store.get(configKey)).enabled,false);
  assert.equal([...store.keys()].filter(key=>key.startsWith('ytads.capture.')).length,0);
  const state=JSON.parse(store.get(indexKey)||'null');
  assert.equal(state?.entries?.length||0,0);
});

test('all four standalone scripts use the same final-commit implementation',()=>{
  const names=['YouTubeLogger','YouTubeFeed','YouTubePlayback','YouTubeConfig'];
  const helpers=names.map(name=>fs.readFileSync(new URL('src/'+name+'.js',root),'utf8').split('function ytDiagnosticCommitEntry(pending, budget) {')[1].split('\n}\n')[0]);
  for(const helper of helpers)assert.equal(helper,helpers[0]);
});

test('info records unchanged requests and responses, error omits normal samples and retains failures',()=>{
 for(const level of ['info','error']) {
  const store=started(),argument={log_enabled:true,log_level:level,capture_budget:'32'};
  player(store,'{"playabilityStatus":{}}',{$argument:argument});
  run('YouTubeLogger',store,{$argument:argument,$request:{url:media,method:'POST'}});
  const normal=exportData(store);
  assert.equal(normal.events.length,level==='info'?2:0);
  if(level==='info')assert.ok(normal.events.every(x=>x.summary.level==='info'));
  player(store,'{INVALID_PRIVATE_BODY',{$argument:argument});
  const all=exportData(store);
  assert.equal(all.events.length,level==='info'?3:1);
  assert.equal(all.events.at(-1).summary.level,'error');
  assert.ok(!JSON.stringify([...store.values()]).includes('INVALID_PRIVATE_BODY'));
 }
});

test('main-page download pauses recording and triggers one file download without page navigation',async()=>{
 const store=started();player(store);
 const html=page(store,'');assert.ok(!html.body.includes('href="/export"'));
 assert.ok(html.headers['Content-Security-Policy'].includes("script-src 'unsafe-inline'"));
 assert.ok(html.headers['Content-Security-Policy'].includes("connect-src 'self'"));
 assert.ok(html.body.includes('[hidden]{display:none!important}'));
 const script=html.body.match(/<script>([\s\S]*)<\/script>/)[1];
 const button={},status={textContent:''},save={hidden:true,clicks:0,click(){this.clicks++;}};let blob;
 const context={document:{getElementById:id=>id==='download'?button:id==='status'?status:save},Blob,
  URL:{createObjectURL(value){blob=value;return 'blob:local-test';},revokeObjectURL(){}},
  async fetch(path,options={}) {let r=page(store,path.replace(/^\//,''),options.method||'GET');if(r.status===303)r=page(store,'');return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}};
 vm.runInNewContext(script,context,{timeout:5000});
 await button.onclick({preventDefault(){}});
 assert.equal(JSON.parse(store.get(configKey)).enabled,false);
 assert.equal(save.clicks,1);assert.ok(save.download.endsWith('.log'));
 assert.match(await blob.text(),/EVENT 1/);assert.match(await blob.text(),/Media-Capture-Mode-At-Export: full/);assert.equal(save.hidden,false);
});

test('uppercase INFO captures initialization UMP response structure without reading request body',()=>{
 const store=started(),init='https://rr5.googlevideo.com/initplayback?sig=PRIVATE';
 const line=plugin.split('\n').find(x=>x.startsWith('http-response')&&x.includes('tag=YouTube 日志媒体响应记录'));
 assert.ok(new RegExp(line.split(' ')[1]).test(init));assert.ok(line.includes('requires-body=false'));
 const full=plugin.split('\n').find(x=>x.startsWith('response if '));
 assert.ok(full.includes('${media_capture_mode} == "full"')&&full.includes('requires_body=true, binary_body_mode=true'));
 const request={url:init,method:'POST',headers:{Authorization:'PRIVATE'}};
 const response={status:200,headers:{'Content-Type':'application/vnd.yt-ump','Transfer-Encoding':'chunked','Set-Cookie':'PRIVATE'}};
 Object.defineProperty(request,'body',{get(){throw new Error('request body should not be buffered');}});
 response.body=new Uint8Array([69,4,10,2,8,1,21,3,1,2,3]);
 run('YouTubeLogger',store,{$request:request,$response:response,$argument:{log_enabled:true,log_level:'INFO',media_capture_mode:'full'}});
 const event=exportData(store).events[0];
 assert.equal(event.summary.endpoint,'initplayback');assert.equal(event.summary.phase,'response');assert.equal(event.summary.level,'info');
 assert.equal(event.capture.responseBefore.headers['Transfer-Encoding'],'chunked');
 assert.equal(event.capture.responseBefore.status,200);assert.equal(event.capture.responseBefore.body.structure.format,'ump');assert.equal(event.capture.responseBefore.body.structure.parts[1].omitted,'media-content');
 assert.equal(event.capture.responseAfter.changed,false);assert.equal(event.capture.processing.bodyBuffering,true);
 assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE'));
 page(store,'pause','POST');
 const manifest=JSON.parse(page(store,'export-manifest.json').body);
 assert.equal(manifest.data.coverage.counts.initplayback,1);
 assert.equal(manifest.data.coverage.initializationVersions.length,0,'observer version is not an initialization cleaner version');
});

test('ERROR records HTTP failures but does not store successful initialization response samples',()=>{
 const store=started();
 for(const status of [200,503])run('YouTubeLogger',store,{$request:{url:'https://rr5.googlevideo.com/initplayback',method:'POST'},$response:{status,headers:{}},$argument:{log_enabled:true,log_level:'ERROR'}});
 const events=exportData(store).events;assert.equal(events.length,1);assert.equal(events[0].summary.level,'error');assert.equal(events[0].capture.responseBefore.status,503);
});

test('INFO preserves safe before/after player request structure while removing request credentials',()=>{
 const store=started();
 const payload={context:{adSignalsInfo:{params:[{key:'token',value:'PRIVATE_TOKEN'}]},client:{visitorData:'PRIVATE_VISITOR'}},videoId:'PRIVATE_VIDEO',playbackContext:{contentPlaybackContext:{adParams:'PRIVATE_SIGNATURE'}}};
 run('YouTubePlayback',store,{$request:{url:api,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},$argument:{log_enabled:true,log_level:'INFO'}});
 const capture=exportData(store).events[0].capture;
 assert.ok(capture.request.body.structure.context.adSignalsInfo);
 assert.equal(capture.requestAfter.body.structure.context.adSignalsInfo,undefined);
 assert.equal(capture.requestAfter.body.structure.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,true);
 assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE_'));
});

// 开发采样使用独立响应夹具，验证认证、结构保留及写入前去除私密信息。

function diagVarint(n){const out=[];do{const b=n%128;n=Math.floor(n/128);out.push(b+(n?128:0));}while(n);return out;}
function diagConcat(...parts){return new Uint8Array(parts.flatMap(p=>Array.from(p)));}
function diagMessage(n,b){return diagConcat(diagVarint(n*8+2),diagVarint(b.length),b);}
function diagScalar(n,v){return new Uint8Array([...diagVarint(n*8),...diagVarint(v)]);}
function diagUmpInt(n){const size=n<128?1:n<16384?2:n<2097152?3:n<268435456?4:5,out=[];if(size===5)out.push(240);else{const base=2**(8-size);out.push((size===1?0:256-2**(9-size))+n%base);n=Math.floor(n/base);}for(let i=1;i<size;i++){out.push(n%256);n=Math.floor(n/256);}return out;}
function diagPart(type,b){return diagConcat(diagUmpInt(type),diagUmpInt(b.length),b);}
function diagOnesie({tamper=false,gzip=false,protobuf=false}={}){
 const key=Uint8Array.from({length:32},(_,i)=>i+1),iv=new Uint8Array(16).fill(17);
 const body=protobuf?diagConcat(diagMessage(7,diagMessage(1,new TextEncoder().encode('googleadservices.com/pagead/PRIVATE_TOKEN'))),diagMessage(99,new TextEncoder().encode('PRIVATE_VIDEO_ID'))):new TextEncoder().encode(JSON.stringify({adPlacements:[{adPlacementRenderer:{config:{kind:1}}}],videoId:'PRIVATE_VIDEO_ID',authorization:'PRIVATE_TOKEN',opaque:'PRIVATE_UNKNOWN'}));
 const plain=diagConcat(diagScalar(1,1),diagScalar(2,200),diagMessage(3,diagMessage(2,new TextEncoder().encode('PRIVATE_COOKIE'))),diagMessage(4,body));
 const cipher=crypto.createCipheriv('aes-128-ctr',key.subarray(0,16),iv),encrypted=new Uint8Array(Buffer.concat([cipher.update(gzip?zlib.gzipSync(plain):plain),cipher.final()]));
 const mac=new Uint8Array(crypto.createHmac('sha256',key.subarray(16)).update(diagConcat(encrypted,iv)).digest());if(tamper)mac[0]^=1;
 const header=diagConcat(diagScalar(1,0),diagMessage(2,new TextEncoder().encode('PRIVATE_VIDEO_ID')),diagMessage(4,diagConcat(diagMessage(4,mac),diagMessage(5,iv),diagScalar(6,gzip?1:0))));
 return {key,bytes:diagConcat(diagPart(10,header),diagPart(11,encrypted),diagPart(21,new TextEncoder().encode('PRIVATE_MEDIA_BYTES')),diagPart(12,new TextEncoder().encode('PRIVATE_MEDIA_KEY')))};
}
function diagSample(store,body,extra={}){return run('YouTubeLogger',store,{$request:{url:'https://rr5.googlevideo.com/initplayback?sig=PRIVATE_SIGNATURE',method:'POST',headers:{Cookie:'PRIVATE_COOKIE'}},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'},body},$argument:{log_enabled:true,log_level:'INFO',media_capture_mode:'full'},...extra});}
for(const protobuf of [false,true])for(const gzip of [false,true])test(`development UMP locally authenticates ${gzip?'gzip':'plain'} ${protobuf?'protobuf':'JSON'} Onesie player response before persistence`,()=>{
 const store=started(),fixture=diagOnesie({gzip,protobuf});store.set('ytads.onesie.youtube.v1',JSON.stringify({schema:1,platform:'youtube',clientKey:Buffer.from(fixture.key).toString('base64'),expiresAt:Date.now()+60000}));
 const output=diagSample(store,fixture.bytes,{$utils:{ungzip:b=>new Uint8Array(zlib.gunzipSync(b))}}).result;
 assert.equal(Object.keys(output).length,0,'sampling does not replace the playback response');
 const e=exportData(store).events[0],parts=e.capture.responseBefore.body.structure.parts;
 assert.equal(e.summary.level,'info');assert.equal(parts[1].onesie.status,'authenticated');assert.equal(parts[1].onesie.httpStatus,200);
 if(protobuf)assert.equal(parts[1].onesie.player[0].field,7);else assert.ok(parts[1].onesie.player.adPlacements);
 assert.equal(parts[2].omitted,'media-content');assert.equal(parts[3].omitted,'encrypted-media');
 const saved=JSON.stringify([...store].filter(([k])=>k.startsWith('ytads.capture.')||k===indexKey));
 for(const secret of ['PRIVATE_VIDEO_ID','PRIVATE_TOKEN','PRIVATE_UNKNOWN','PRIVATE_COOKIE','PRIVATE_SIGNATURE','PRIVATE_MEDIA_BYTES','PRIVATE_MEDIA_KEY',Buffer.from(fixture.key).toString('base64'),Buffer.from(fixture.bytes).toString('base64')])assert.ok(!saved.includes(secret));assert.ok(!saved.includes('memoryBytes'));
});
test('UMP authentication failure records an error and does not decode or persist player contents',()=>{
 const store=started(),fixture=diagOnesie({tamper:true});store.set('ytads.onesie.youtube.v1',JSON.stringify({schema:1,platform:'youtube',clientKey:Buffer.from(fixture.key).toString('base64'),expiresAt:Date.now()+60000}));
 diagSample(store,fixture.bytes);const e=exportData(store).events[0];assert.equal(e.summary.level,'error');assert.equal(e.capture.responseBefore.body.structure.parts[1].onesie.status,'authentication-failed');assert.equal(e.capture.responseBefore.body.structure.parts[1].onesie.player,undefined);assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE_VIDEO_ID'));
});
test('UMP sampling reports missing local configuration without persisting encrypted data',()=>{
 const store=started();diagSample(store,diagOnesie().bytes);const p=exportData(store).events[0].capture.responseBefore.body.structure.parts;assert.equal(p[1].onesie.status,'config-absent');assert.equal(p[1].onesie.player,undefined);
});
test('UMP sampling preserves cue type and event but omits unknown parts and partial media',()=>{
 const store=started(),cue=diagMessage(1,diagMessage(1,diagConcat(diagScalar(1,1),diagScalar(2,6)))),b=diagConcat(diagPart(69,cue),diagPart(99,new TextEncoder().encode('PRIVATE_UNKNOWN')),new Uint8Array([21,9,1,2]));diagSample(store,b);
 const sample=exportData(store).events[0].capture.responseBefore.body.structure;assert.equal(sample.complete,false);assert.equal(sample.reason,'partial-part');assert.equal(sample.parts[0].cues[0].prefetch,true);assert.equal(sample.parts[0].cues[0].event,6);assert.equal(sample.parts[1].omitted,'unknown-or-sensitive-part');assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE_UNKNOWN'));
});
test('large media responses retain frame lengths without stopping the log or serializing media bytes',()=>{
 const store=started(),b=diagPart(21,new Uint8Array(9*1048576));diagSample(store,b);const e=exportData(store).events[0];assert.equal(e.capture.responseBefore.body.structure.parts[0].bytes,9*1048576);assert.equal(e.capture.responseBefore.body.structure.parts[0].omitted,'media-content');assert.equal(JSON.parse(store.get(configKey)).enabled,true);assert.ok([...store].filter(([k])=>k.startsWith('ytads.capture.')).reduce((n,[,v])=>n+v.length,0)<10000);
});

for (const selected of [undefined, 'headers', 'unknown']) test(`media ${selected ?? 'default'} sampling never reads request or response bodies`,()=>{
 const store=started();
 for(const path of ['initplayback','videoplayback']){
  const request={url:`https://rr5.googlevideo.com/${path}?sig=PRIVATE`,method:'POST',headers:{Cookie:'PRIVATE'}};
  const response={status:200,headers:{'Content-Type':'application/vnd.yt-ump','Content-Length':'1048576','Set-Cookie':'PRIVATE'}};
  Object.defineProperty(request,'body',{get(){throw Error('request must remain streaming');}});
  Object.defineProperty(response,'body',{get(){throw Error('response must remain streaming');}});
  const output=run('YouTubeLogger',store,{$request:request,$response:response,$argument:{log_enabled:true,log_level:'INFO',media_capture_mode:selected}}).result;
  assert.deepEqual(Object.keys(output),[]);
 }
 const events=exportData(store).events;
 assert.equal(events.length,2);
 for(const {capture,summary} of events){
  assert.equal(summary.level,'info');assert.equal(capture.processing.bodyBuffering,false);
  assert.equal(capture.responseBefore.body.reason,'headers-only-not-buffered');
  assert.equal(capture.responseBefore.headers['Content-Length'],'1048576');assert.equal(capture.responseAfter.changed,false);
  assert.equal(capture.processing.exception,null);
 }
 assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE'));
});

test('paused and disabled full media sampling do not read bodies or create new samples',()=>{
 for(const enabled of [true,false]){
  const store=started();page(store,'pause','POST');
  const response={status:200,headers:{}};Object.defineProperty(response,'body',{get(){throw Error('inactive capture must not read');}});
  const output=run('YouTubeLogger',store,{$request:{url:media,method:'POST'},$response:response,$argument:{log_enabled:enabled,log_level:'info',media_capture_mode:'full'}}).result;
  assert.deepEqual(Object.keys(output),[]);assert.equal(exportData(store).events.length,0);
 }
});

test('single export declares selected media mode without rewriting historical buffering evidence',()=>{
 const store=started();diagSample(store,diagPart(21,new Uint8Array([1,2,3])));page(store,'pause','POST');
 const manifest=run('YouTubeLogger',store,{$request:{url:'http://youtube-logs.invalid/export-manifest.json',method:'GET'},$argument:{log_enabled:true,log_level:'info',media_capture_mode:'headers'}}).result.response;
 const data=JSON.parse(manifest.body);
 assert.equal(data.data.settings.mediaCaptureMode,'headers');assert.equal(exportData(store).events[0].capture.processing.bodyBuffering,true);
 assert.ok(data.data.completeness.limitations.some(s=>s.includes('Each event records its actual bodyBuffering')));
});

for(const source of ['YouTubeConfig','YouTubePlayback','YouTubeFeed','YouTubeLogger'])test(`${source} timing includes sample writes and separates runtime origin from JS origin`,()=>{
 const store=started();let clock=Date.now();const runtimeStart=clock-1000;
 class DiagnosticClock extends Date {static now(){return ++clock;}}
 const exchange=source==='YouTubeConfig'?{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/log_event',method:'POST',headers:{'User-Agent':'com.google.ios.youtube/21.39.4'},body:new Uint8Array([8,1])}}:
 source==='YouTubePlayback'?{$request:{url:api,method:'POST',headers:{'Content-Type':'application/json'},body:'{"context":{"adSignalsInfo":{}},"playbackContext":{"contentPlaybackContext":{"adParams":"PRIVATE"}}}'}}:
 source==='YouTubeFeed'?{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/next'},$response:{status:200,headers:{'Content-Type':'application/json'},body:'{"contents":[{"adSlotRenderer":{}},{"videoRenderer":{}}]}'}}:
 {$request:{url:media},$response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'}}};
 const argument={log_enabled:true,log_level:'info',media_capture_mode:'headers'};
 const unmeasuredStore=started(),baseline=run(source,unmeasuredStore,{...exchange,$argument:argument}).result;
 const measured=run(source,store,{...exchange,$argument:argument,Date:DiagnosticClock,$script:{startTime:new Date(runtimeStart)},
  $persistentStore:{read:key=>store.get(key),write(value,key){clock+=50;if(value===undefined)store.delete(key);else store.set(key,value);return true;}}
 }).result;
 assert.deepEqual(JSON.parse(JSON.stringify(measured)),JSON.parse(JSON.stringify(baseline)),'timing must not change HTTP output');
 const event=exportData(store).events.at(-1);
 assert.ok(event);assert.ok(event.summary.timing.jsBeforeIndexCommitMs>=50,'includes actual diagnostic sample writes');
 assert.ok(event.summary.timing.runtimeBeforeIndexCommitMs>=event.summary.timing.jsBeforeIndexCommitMs+1000);
 assert.ok(Number.isFinite(event.capture.processing.elapsedMs));
 assert.ok(event.summary.timing.jsBeforeIndexCommitMs>event.capture.processing.elapsedMs);
 page(store,'pause','POST');const manifest=JSON.parse(page(store,'export-manifest.json').body);
 assert.equal(manifest.rows.at(-1).timing.runtimeBeforeIndexCommitMs,event.summary.timing.runtimeBeforeIndexCommitMs);
 assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE'));
});

for(const startTime of [undefined,new Date(NaN),new Date(Date.now()+600000),{getTime(){throw Error('PRIVATE');}}])test('unavailable or invalid runtime clock does not alter HTTP output or fabricate elapsed time',()=>{
 const store=started();
 const output=run('YouTubeLogger',store,{$request:{url:media},$response:{status:200,headers:{}},$argument:{log_enabled:true,log_level:'info',media_capture_mode:'headers'},$script:{startTime}}).result;
 assert.deepEqual(Object.keys(output),[]);const event=exportData(store).events[0];
 assert.ok(Number.isFinite(event.summary.timing.jsBeforeIndexCommitMs));assert.equal(event.summary.timing.runtimeBeforeIndexCommitMs,undefined);
 assert.ok(!JSON.stringify([...store.values()]).includes('PRIVATE'));
});

test('single log exports Shanghai milliseconds across midnight without altering UTC marker storage', async () => {
 const store=started();
 const utc='2026-10-06T16:00:00.123Z';
 class FixedDate extends Date { constructor(...args){super(...(args.length?args:[utc]));} static now(){return Date.parse(utc);} }
 run('YouTubeLogger',store,{$request:{url:'http://youtube-logs.invalid/mark-ad',method:'POST'},Date:FixedDate});
 page(store,'pause','POST');
 const stored=store.get(indexKey);
 assert.equal(JSON.parse(stored).entries[0].time,utc);
 const script=page(store,'export').body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={},save={click(){this.clicked=true;}};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,
  URL:{createObjectURL(value){blob=value;return 'blob:shanghai';}},
  async fetch(path){const r=page(store,path.slice(1));const data=JSON.parse(r.body);if(path==='/export-manifest.json')data.data.exportedAt=utc;return {ok:r.status===200,status:r.status,json:async()=>data};}
 },{timeout:5000});
 const text=await blob.text();
 assert.match(text,/Time-Zone: Asia\/Shanghai \(UTC\+08:00\)/);
 assert.match(text,/Exported-Time: 2026-10-07T00:00:00\.123\+08:00/);
 assert.match(text,/Time: 2026-10-07T00:00:00\.123\+08:00/);
 assert.match(text,/Summary: user mark: ad-playing/);
 assert.equal(save.download,'YouTube-2026-10-07T00-00-00-123+08-00.log');
 assert.equal(save.clicked,true);
 assert.equal(store.get(indexKey),stored,'export keeps original UTC index and capture references intact');
 assert.match(page(store,'').body,/上海时间/);
});

test('Shanghai export displays unavailable for malformed time without cancelling the download',async()=>{
 const store=started();page(store,'mark-content','POST');page(store,'pause','POST');
 const script=page(store,'export').body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={},save={click(){this.clicked=true;}};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,
  URL:{createObjectURL(value){blob=value;return 'blob:invalid-time';}},
  async fetch(path){const r=page(store,path.slice(1));const data=JSON.parse(r.body);if(path==='/export-manifest.json'){data.rows[0].time='bad-time';data.rows[0].captureError='missing';}return {ok:r.status===200,status:r.status,json:async()=>data};}
 },{timeout:5000});
 assert.match(await blob.text(),/Time: unavailable/);
 assert.match(await blob.text(),/Issue: unavailable YouTubeLogger missing/);
 assert.equal(save.clicked,true);
});

test('readable log includes a complete timeline and compact protobuf metadata with nested fields preserved',async()=>{
 const store=started();
 player(store,new Uint8Array([10,2,8,1]));
 page(store,'mark-content','POST');page(store,'pause','POST');
 const manifest=JSON.parse(page(store,'export-manifest.json').body);
 const script=page(store,'export').body.match(/<script>([\s\S]*)<\/script>/)[1];
 const status={},save={click(){}};let blob;
 await vm.runInNewContext(script,{document:{getElementById:id=>id==='status'?status:save},Blob,
  URL:{createObjectURL(value){blob=value;return 'blob:format';}},
  async fetch(path){const r=page(store,path.slice(1));return {ok:r.status===200,status:r.status,json:async()=>JSON.parse(r.body)};}
 },{timeout:5000});
 const text=await blob.text();
 assert.match(text,/Format-Version: 4/);
 assert.ok(text.indexOf('TIMELINE')<text.indexOf('DETAILS'));
 const timeline=text.split('TIMELINE')[1].split('DETAILS')[0];
 for(let i=0;i<manifest.rows.length;i++) {
  assert.ok(timeline.includes(`${i+1} | `));
  assert.ok(timeline.includes(manifest.rows[i].message));
  assert.ok(text.includes(`EVENT ${i+1} | ${manifest.rows[i].endpoint}`));
 }
 assert.match(timeline,/不是请求耗时/);
 assert.match(text,/field=1 wire=2 bytes=2/);
 assert.match(text,/field=1 wire=0/);
 assert.match(text,/Request-Inner-Before: unavailable/);
 assert.match(text,/Summary: user mark: content-playing/);
 assert.match(text,/All-Referenced-Samples-Readable: true/);
});
