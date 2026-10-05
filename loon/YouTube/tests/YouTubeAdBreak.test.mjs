import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../src/YouTubePlayback.js',import.meta.url),'utf8');
const plugin=fs.readFileSync(new URL('../YouTubeNoAds.plugin',import.meta.url),'utf8');
const base='https://youtubei.googleapis.com/youtubei/v1/player/ad_break';
const configKey='ytads.logger.config.v1', cacheKey='ytads.logger.entries.v2';
function run({url=base,enabled=true,response=false,store=new Map(),raw=false,debug=false}={}){
 let output,calls=0; const logs=[];
 const context={$request:{url,method:'POST',headers:{'Content-Type':'application/x-protobuf'},body:Uint8Array.from([8,1])},
  $argument:{block_ad_break:enabled,script_debug:debug,log_enabled:true,log_level:'debug',capture_raw:raw,capture_budget:16},
  $persistentStore:{read:k=>store.get(k),write(v,k){if(v===undefined)store.delete(k);else store.set(k,v);return true;}},
  $done(v){output=v;calls++;},console:{log:v=>logs.push(v)},Uint8Array,ArrayBuffer,TextEncoder,TextDecoder};
 if(response)context.$response={status:200,headers:{},body:''};
 vm.runInNewContext(source,context,{timeout:1000}); assert.equal(calls,1); return {output,logs,store};
}

test('plugin keeps ad-break configuration blocking enabled without a settings switch',()=>{
 assert.ok(!plugin.includes('block_ad_break = switch'));
 const line=plugin.split('\n').find(x=>x.includes('tag=YouTube 播放请求与广告配置处理'));
 assert.ok(line&&!line.includes('enable='));
 const regex=new RegExp(line.split(' ')[1],'i');
 assert.ok(regex.test(base+'?prettyPrint=false'));
 assert.ok(regex.test('https://www.youtube.com/youtubei/v1/player/ad_break'));
 assert.ok(regex.test('https://youtubei.googleapis.com/youtubei/v1/player'));
 assert.ok(!regex.test(base+'/extra'));
 assert.ok(!regex.test('https://rr5.googlevideo.com/videoplayback?ctier=L'));
});

test('ad-break request returns a successful empty Protobuf response without touching media',()=>{
 const r=run({debug:true});
 assert.equal(r.output.response.status,200);
 assert.equal(r.output.response.headers['Content-Type'],'application/x-protobuf');
 assert.equal(r.output.response.body.length,0);
 assert.ok(r.logs.some(x=>x.includes('blocked: empty-protobuf status=200')));
});

test('disabled, unrelated and response-phase executions pass through',()=>{
 assert.deepEqual(Object.keys(run({enabled:false}).output),[]);
 assert.deepEqual(Object.keys(run({url:'https://youtubei.googleapis.com/youtubei/v1/player'}).output),[]);
 assert.deepEqual(Object.keys(run({response:true}).output),[]);
});

test('summary uses the shared logger cache without storing request secrets',()=>{
 const store=new Map([[configKey,JSON.stringify({enabled:true,session:'test-session'})]]);
 run({store});
 const state=JSON.parse(store.get(cacheKey));
 assert.equal(state.entries.length,1);
 assert.equal(state.entries[0].source,'YouTubePlayback');
 assert.equal(state.entries[0].endpoint,'ad_break');
 assert.ok(!JSON.stringify(state).includes(base));
});

test('development capture records the exact request and synthetic result in the same shared cache',()=>{
 const store=new Map([[configKey,JSON.stringify({enabled:true,session:'test-session'})]]);
 run({store,raw:true});
 const state=JSON.parse(store.get(cacheKey)), entry=state.entries[0];
 assert.equal(entry.source,'YouTubePlayback');
 const chunks=Array.from({length:entry.captureRef.chunks},(_,i)=>store.get(entry.captureRef.prefix+i)).join('');
 const payload=JSON.parse(chunks);
 assert.equal(payload.request.url,base.split('?')[0]);
 assert.equal(payload.request.body.reason,'privacy-structure-only');
 assert.equal(payload.responseAfter.synthetic,true);
 assert.equal(payload.responseAfter.status,200);
 assert.equal(payload.responseAfter.body.bytes,0);
});
