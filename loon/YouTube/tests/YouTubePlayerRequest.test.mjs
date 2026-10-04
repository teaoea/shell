import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../YouTubePlayback.js',import.meta.url),'utf8');
const plugin=fs.readFileSync(new URL('../YouTubeNoAds.plugin',import.meta.url),'utf8');
const logger=fs.readFileSync(new URL('../YouTubeLogger.js',import.meta.url),'utf8');
const u8=value=>Uint8Array.from(value);
const concat=(...parts)=>u8(parts.flatMap(part=>Array.from(part)));
function v(n){const out=[];do{const b=n%128;n=Math.floor(n/128);out.push(b+(n?128:0));}while(n);return out;}
function msg(field,payload){return concat(v(field*8+2),v(payload.length),payload);}
function scalar(field,value){return concat(v(field*8),v(value));}

function run(body,{endpoint='player',type='application/x-protobuf',enabled=true,debug=false,raw=false,store=new Map()}={}){
  let output,calls=0;const logs=[];
  const context={
    $request:{url:`https://youtubei.googleapis.com/youtubei/v1/${endpoint}?prettyPrint=false`,method:'POST',
      headers:{'Content-Type':type,'content-encoding':'gzip','Content-Length':'99','X-Test':'kept'},body},
    $argument:{suppress_player_ads:enabled,script_debug:debug,log_enabled:true,log_level:'info',capture_raw:raw,capture_budget:16},
    $persistentStore:{read:k=>store.get(k),write(value,key){if(value===undefined)store.delete(key);else store.set(key,value);return true;}},
    $done(value){output=value;calls++;},console:{log:value=>logs.push(value)},
    Uint8Array,ArrayBuffer,TextEncoder,TextDecoder
  };
  vm.runInNewContext(source,context,{timeout:1000});
  assert.equal(calls,1);
  return {output,logs,store};
}

test('plugin keeps the standalone player request cleaner always enabled without a settings switch',()=>{
  assert.ok(!plugin.includes('suppress_player_ads = switch'));
  const line=plugin.split('\n').find(x=>x.includes('tag=YouTube 播放器请求广告协商清理'));
  assert.ok(line&&!line.includes('enable='));
  assert.ok(line.includes('requires-body=true,binary-body-mode=true'));
  assert.ok(line.includes('{log_enabled}')&&line.includes('{capture_budget}'));
  const regex=new RegExp(line.split(' ')[1],'i');
  assert.ok(regex.test('https://youtubei.googleapis.com/youtubei/v1/player?id=x'));
  assert.ok(regex.test('https://www.youtube.com/youtubei/v1/get_watch'));
  assert.ok(!regex.test('https://youtubei.googleapis.com/youtubei/v1/player/ad_break'));
  assert.ok(!regex.test('https://rr5.googlevideo.com/videoplayback?ctier=L'));
  assert.ok(logger.includes('"YouTubePlayback"'));
});

test('protobuf player strips exact ad negotiation fields and preserves siblings',()=>{
  const context=concat(msg(1,u8([1,2,3])),msg(9,msg(1,u8([4,5]))),msg(10,u8([6])));
  const content=concat(scalar(4,0),msg(12,new TextEncoder().encode('output=xml_vast2')),msg(25,u8([9])),msg(31,u8([7])),scalar(44,1));
  const playback=concat(msg(1,content),msg(8,u8([8])));
  const input=concat(msg(1,context),msg(2,new TextEncoder().encode('video-id')),msg(4,playback),scalar(5,1));
  const expectedContext=concat(msg(1,u8([1,2,3])),msg(10,u8([6])));
  const expectedContent=concat(scalar(4,0),msg(31,u8([7])),scalar(44,1),scalar(50,1));
  const expected=concat(msg(1,expectedContext),msg(2,new TextEncoder().encode('video-id')),
    msg(4,concat(msg(1,expectedContent),msg(8,u8([8])))),scalar(5,1));
  const {output}=run(input);
  assert.deepEqual(Array.from(output.body),Array.from(expected));
  assert.equal(output.headers['X-Test'],'kept');
  assert.equal(Object.keys(output.headers).some(k=>k.toLowerCase()==='content-encoding'),false);
  assert.equal(Object.keys(output.headers).some(k=>k.toLowerCase()==='content-length'),false);
});

test('existing inline no-ad field is normalized once',()=>{
  const content=concat(scalar(50,0),scalar(50,1),msg(12,u8([1])));
  const input=msg(4,msg(1,content));
  const expected=msg(4,msg(1,scalar(50,1)));
  assert.deepEqual(Array.from(run(input).output.body),Array.from(expected));
});

test('get_watch cleans top-level context and nested player request',()=>{
  const topContext=concat(msg(9,u8([1])),msg(5,u8([2])));
  const player=concat(msg(1,concat(msg(9,u8([3])),msg(3,u8([4])))),msg(4,msg(1,msg(12,u8([5])))));
  const input=concat(msg(1,topContext),msg(2,player),msg(3,u8([6])));
  const expected=concat(msg(1,msg(5,u8([2]))),msg(2,concat(msg(1,msg(3,u8([4]))),msg(4,msg(1,scalar(50,1))))),msg(3,u8([6])));
  assert.deepEqual(Array.from(run(input,{endpoint:'get_watch'}).output.body),Array.from(expected));
});

test('JSON player and get_watch use named schema fields only',()=>{
  const player={context:{client:{name:'IOS'},adSignalsInfo:{params:[1]}},playbackContext:{contentPlaybackContext:{adParams:'vast',forceAdParameters:{x:1},other:true}},opaque:{adSignalsInfo:{keep:true}}};
  const direct=run(JSON.stringify(player),{type:'application/json'}).output;
  const changed=JSON.parse(direct.body);
  assert.equal(changed.context.adSignalsInfo,undefined);
  assert.equal(changed.playbackContext.contentPlaybackContext.adParams,undefined);
  assert.equal(changed.playbackContext.contentPlaybackContext.forceAdParameters,undefined);
  assert.equal(changed.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,true);
  assert.deepEqual(changed.opaque,{adSignalsInfo:{keep:true}});
  const wrapped=JSON.parse(run(JSON.stringify({context:{adSignalsInfo:{}},playerRequest:player,sibling:1}),{endpoint:'get_watch',type:'application/json'}).output.body);
  assert.equal(wrapped.context.adSignalsInfo,undefined);
  assert.equal(wrapped.playerRequest.context.adSignalsInfo,undefined);
  assert.equal(wrapped.sibling,1);
});

test('disabled, unrelated, empty and malformed requests pass through',()=>{
  assert.deepEqual(Object.keys(run(msg(1,u8([1])),{enabled:false}).output),[]);
  assert.deepEqual(Object.keys(run(new Uint8Array(),{}).output),[]);
  assert.deepEqual(Object.keys(run(u8([0]),{}).output),[]);
  assert.deepEqual(Object.keys(run('{bad',{type:'application/json'}).output),[]);
});

test('changed request writes a secret-free summary to the shared cache',()=>{
  const store=new Map([['ytads.logger.config.v1',JSON.stringify({enabled:true,session:'test-session'})]]);
  const body=concat(msg(1,msg(9,u8([1]))),msg(4,msg(1,msg(12,u8([2])))));
  run(body,{store,debug:true});
  const state=JSON.parse(store.get('ytads.logger.entries.v2'));
  assert.equal(state.entries.length,1);
  assert.equal(state.entries[0].source,'YouTubePlayback');
  assert.match(state.entries[0].message,/context_ad_signals=1 playback_ad_params=1 inline_no_ad=1/);
  assert.equal(JSON.stringify(state).includes('youtubei.googleapis.com'),false);
});

test('development capture stores original and modified player requests in one event',()=>{
  const store=new Map([['ytads.logger.config.v1',JSON.stringify({enabled:true,session:'test-session'})]]);
  const body=concat(msg(1,msg(9,u8([1]))),msg(4,msg(1,msg(12,u8([2])))));
  run(body,{store,raw:true});
  const state=JSON.parse(store.get('ytads.logger.entries.v2')),entry=state.entries[0];
  assert.equal(entry.source,'YouTubePlayback');
  assert.equal(entry.message,'development capture: changed=true');
  const payload=JSON.parse(Array.from({length:entry.captureRef.chunks},(_,i)=>store.get(entry.captureRef.prefix+i)).join(''));
  assert.equal(payload.request.body.reason,'privacy-structure-only');
  assert.equal(payload.requestAfter.changed,true);
  assert.equal(payload.requestAfter.body.reason,'privacy-structure-only');
  assert.ok(payload.request.body.bytes>payload.requestAfter.body.bytes);
  assert.equal(payload.processing.arguments.suppress_player_ads,true);
});
