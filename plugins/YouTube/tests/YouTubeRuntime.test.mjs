import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const runtime=fs.readFileSync(new URL('../src/YouTubeRuntime.js',import.meta.url),'utf8');
const bundle=phase=>fs.readFileSync(new URL(`../dist/${phase}.min.js`,import.meta.url),'utf8');
function context(extra={}) { const outputs=[];return {outputs,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,console:{log(){}},$done(v){outputs.push(v);},...extra}; }
function qx(extra={}) {return context({$prefs:{valueForKey(){return null;},setValueForKey(){return true;},removeValueForKey(){return true;}},$task:{},...extra});}
function run(code,c){vm.runInNewContext(code,c,{timeout:2000});return c;}
test('QX published response removes protobuf ads and preserves unknown bytes',()=>{
 const bytes=Uint8Array.from([18,2,8,0,58,0,162,4,0,154,6,1,7]);
 const c=qx({$request:{url:'https://youtubei.googleapis.com/youtubei/v1/player'},$response:{statusCode:200,headers:{'Content-Type':'application/x-protobuf'},bodyBytes:bytes.buffer},$environment:{sourcePath:'response.min.js#log_enabled=false'}});
 run(bundle('response'),c);assert.equal(c.outputs.length,1);assert.deepEqual([...new Uint8Array(c.outputs[0].bodyBytes)],[18,2,8,0,154,6,1,7]);assert.equal(c.outputs[0].body,undefined);
});
test('QX subtitle output changes path and preserves credentials',()=>{
 const c=qx({$request:{url:'https://www.youtube.com/api/timedtext?v=x&lang=ja&sig=abc%2Fdef',method:'GET'},$environment:{sourcePath:'request.min.js#translation_enabled=true&translation_target=en-US'}});
 run(bundle('request'),c);assert.equal(c.outputs[0].path,'/api/timedtext?v=x&lang=ja&sig=abc%2Fdef&tlang=en');assert.equal(c.outputs[0].url,undefined);
});
test('QX ad break echo uses a status line, ordinary request cannot echo',()=>{
 for(const echo of [true,false]){const c=qx({$request:{url:'https://youtubei.googleapis.com/youtubei/v1/player/ad_break',method:'POST'},$environment:{sourcePath:`request.min.js#echo_response=${echo}`}});run(bundle('request'),c);assert.equal(c.outputs.length,1);if(echo)assert.match(c.outputs[0].status,/^HTTP\/1.1 200/);else assert.deepEqual(Object.keys(c.outputs[0]),[]);}
});
test('binary output slices views to avoid exposing adjacent bytes',()=>{
 const c=qx();run(runtime,c);c.bytes=Uint8Array.from([99,1,2,88]).subarray(1,3);run('ytRuntimeFinish({body:bytes},{})',c);assert.deepEqual([...new Uint8Array(c.outputs[0].bodyBytes)],[1,2]);
});
test('storage deletion touches only specified keys on QX and Surge',()=>{
 const calls=[];const c=qx({$prefs:{removeValueForKey(k){calls.push(k);return true;}}});run(runtime,c);run("ytRuntimeStore().write(undefined,'own-key')",c);assert.deepEqual(calls,['own-key']);
 const d=context({$environment:{'surge-version':'6'},$persistentStore:{write(v,k){calls.push([v,k]);return true;}}});run(runtime,d);run("ytRuntimeStore().write(undefined,'own-key')",d);assert.deepEqual(calls[1],[null,'own-key']);
});
test('disabled media sampling never touches body, keeps headers and clears Alt-Svc on QX, Surge and Stash',()=>{
 for(const platform of ['qx','surge','stash']){const response={headers:{'alt-svc':'h3=":443"','Content-Type':'video/mp4'}};for(const key of ['body','bodyBytes'])Object.defineProperty(response,key,{get(){throw Error('body accessed');}});
 const extra={$request:{url:'https://rr1.googlevideo.com/videoplayback?x=1'},$response:response,$argument:'log_enabled=false&media_capture_mode=full'};
 const c=platform==='qx'?qx(extra):context({...extra,$environment:{[platform==='stash'?'stash-version':'surge-version']:'6'}});run(bundle('response'),c);assert.equal(c.outputs.length,1);assert.equal(c.outputs[0].headers['Alt-Svc'],'clear');assert.equal(c.outputs[0].headers['Content-Type'],'video/mp4');assert.equal(c.outputs[0].headers['alt-svc'],undefined);}
});
test('Surge string parameters route captions through same published core',()=>{
 const c=context({$environment:{'surge-version':'6'},$argument:'translation_enabled=true&translation_target=zh-CN',$request:{url:'https://www.youtube.com/api/timedtext?lang=de&v=x',method:'GET'}});run(bundle('request'),c);assert.equal(c.outputs[0].url,'https://www.youtube.com/api/timedtext?lang=de&v=x&tlang=zh-Hans');
});
test('runtime options reject prototype keys and respect explicit argument precedence',()=>{
 const c=qx({$environment:{sourcePath:'x#translation_enabled=true&translation_target=zh-CN&constructor=x',variables:{translation_target:'en-US'}},$argument:'translation_enabled=true&translation_target=zh-CN&__proto__=x'});run(runtime,c);run('result=ytRuntimeOptions()',c);assert.equal(c.result.translation_target,'zh-CN');assert.equal(Object.getPrototypeOf(c.result),null);assert.equal(c.result.constructor,undefined);
});
test('platform configurations reuse exactly the two bundles and never mock initplayback',()=>{
 for(const file of ['YouTubeNoAds.snippet','YouTubeNoAds.sgmodule','YouTubeNoAds.stoverride']) {const s=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.ok(s.includes('request.min.js'));assert.ok(s.includes('response.min.js'));assert.ok(!s.includes('reject-200'));assert.ok(!s.includes('status:204'));}
});

test('Stash published response handles Uint8Array protobuf and preserves unknown fields',()=>{
 const c=context({$environment:{'stash-build':100},$argument:'log_enabled=false',$request:{url:'https://youtubei.googleapis.com/youtubei/v1/player'},$response:{status:200,headers:{'Content-Type':'application/x-protobuf'},body:Uint8Array.from([18,2,8,0,58,0,162,4,0,154,6,1,7])}});
 run(bundle('response'),c);assert.equal(c.outputs.length,1);assert.deepEqual([...c.outputs[0].body],[18,2,8,0,154,6,1,7]);assert.equal(c.outputs[0].bodyBytes,undefined);
});
test('Stash captions accept string arguments and preserve signed query parameters',()=>{
 const c=context({$environment:{'stash-version':'3'},$argument:'translation_enabled=true&translation_target=en-US',$request:{url:'https://www.youtube.com/api/timedtext?v=x&lang=ja&sig=abc%2Fdef',method:'GET'}});
 run(bundle('request'),c);assert.equal(c.outputs.length,1);assert.equal(c.outputs[0].url,'https://www.youtube.com/api/timedtext?v=x&lang=ja&sig=abc%2Fdef&tlang=en');
});
test('Stash request scripts return nested synthetic responses for ad breaks and log page',()=>{
 for(const url of ['https://youtubei.googleapis.com/youtubei/v1/player/ad_break','http://youtube-logs.invalid/']) {
 const c=context({$environment:{'stash-version':'3'},$argument:'log_enabled=true',$request:{url,method:url.startsWith('http:')?'GET':'POST'},$persistentStore:{read(){return null;},write(){return true;}}});
 run(bundle('request'),c);assert.equal(c.outputs.length,1);assert.equal(c.outputs[0].response.status,200);assert.ok(c.outputs[0].response.body);
 }
});

test('Stash page controls one-plugin logging across fresh invocations and pause stops media reads',()=>{
 const store=new Map();
 const invoke=(code,extra)=>{
   const c=context({$environment:{'stash-version':'3'},$argument:'log_enabled=false&log_control=page',$persistentStore:{read(k){return store.get(k);},write(v,k){if(v==null)store.delete(k);else store.set(k,v);return true;}},...extra});
   run(code,c);return c;
 };
 const options=()=>invoke(runtime+';result=ytRuntimeOptions()',{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/player'}}).result.log_enabled;
 assert.equal(options(),false);
 invoke(bundle('request'),{$request:{url:'http://youtube-logs.invalid/',method:'GET'}});
 assert.equal(options(),false);
 const start=invoke(bundle('request'),{$request:{url:'http://youtube-logs.invalid/start',method:'POST'}});assert.equal(start.outputs[0].response.status,303);assert.equal(options(),true);
 invoke(bundle('request'),{$request:{url:'https://youtubei.googleapis.com/youtubei/v1/browse',method:'GET'}});
 assert.ok(JSON.parse(store.get('ytads.logger.entries.v2')).entries.length>0);
 const pause=invoke(bundle('request'),{$request:{url:'http://youtube-logs.invalid/pause',method:'POST'}});assert.equal(pause.outputs[0].response.status,303);assert.equal(options(),false);
 const response={headers:{'Content-Type':'video/mp4'}};Object.defineProperty(response,'body',{get(){throw Error('paused media read');}});
 invoke(bundle('response'),{$request:{url:'https://rr1.googlevideo.com/videoplayback?x=1'},$response:response});
 store.set('ytads.logger.config.v1','broken');assert.equal(options(),false);
});
