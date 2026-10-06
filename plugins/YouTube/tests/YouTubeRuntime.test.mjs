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
 const c=qx({$request:{url:'https://www.youtube.com/api/timedtext?v=x&lang=ja&sig=abc%2Fdef',method:'GET'},$environment:{sourcePath:'request.min.js#translation_target=en-US'}});
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
test('disabled media sampling never touches body, keeps headers and clears Alt-Svc on both platforms',()=>{
 for(const platform of ['qx','surge']){const response={headers:{'alt-svc':'h3=":443"','Content-Type':'video/mp4'}};for(const key of ['body','bodyBytes'])Object.defineProperty(response,key,{get(){throw Error('body accessed');}});
 const extra={$request:{url:'https://rr1.googlevideo.com/videoplayback?x=1'},$response:response,$argument:'log_enabled=false&media_capture_mode=full'};
 const c=platform==='qx'?qx(extra):context({...extra,$environment:{'surge-version':'6'}});run(bundle('response'),c);assert.equal(c.outputs.length,1);assert.equal(c.outputs[0].headers['Alt-Svc'],'clear');assert.equal(c.outputs[0].headers['Content-Type'],'video/mp4');assert.equal(c.outputs[0].headers['alt-svc'],undefined);}
});
test('Surge string parameters route captions through same published core',()=>{
 const c=context({$environment:{'surge-version':'6'},$argument:'translation_target=zh-CN',$request:{url:'https://www.youtube.com/api/timedtext?lang=de&v=x',method:'GET'}});run(bundle('request'),c);assert.equal(c.outputs[0].url,'https://www.youtube.com/api/timedtext?lang=de&v=x&tlang=zh-Hans');
});
test('runtime options reject prototype keys and respect explicit argument precedence',()=>{
 const c=qx({$environment:{sourcePath:'x#translation_target=zh-CN&constructor=x',variables:{translation_target:'en-US'}},$argument:'translation_target=zh-CN&__proto__=x'});run(runtime,c);run('result=ytRuntimeOptions()',c);assert.equal(c.result.translation_target,'zh-CN');assert.equal(Object.getPrototypeOf(c.result),null);assert.equal(c.result.constructor,undefined);
});
test('platform configurations reuse exactly the two bundles and never mock initplayback',()=>{
 for(const file of ['YouTubeNoAds.snippet','YouTubeNoAds.sgmodule']) {const s=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.ok(s.includes('request.min.js'));assert.ok(s.includes('response.min.js'));assert.ok(!s.includes('reject-200'));assert.ok(!s.includes('status:204'));}
});
