import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../YouTubePlayback.js', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../YouTubeNoAds.plugin', import.meta.url), 'utf8');
const base = 'https://youtubei.googleapis.com/youtubei/v1/reel/reel_watch_sequence';
const u8 = value => Uint8Array.from(value);
const concat = (...parts) => u8(parts.flatMap(part => Array.from(part)));
function v(n) {const out=[]; while(n>=128){out.push((n%128)+128);n=Math.floor(n/128);} return [...out,n];}
function msg(no, payload) {return concat(v(no*8+2),v(payload.length),payload);}
function scalar(no, value) {return concat(v(no*8),v(value));}
function entry(isAd, marker) {
  const params = isAd === null ? scalar(2, 1) : scalar(1, isAd ? 1 : 0);
  const endpoint = concat(msg(16, params), msg(30, u8([marker])));
  return msg(2, msg(1, msg(139608561, endpoint)));
}
function run(body,{url=base,type='application/x-protobuf',status=200,enabled=true,response=true,debug=false}={}) {
  let output,calls=0; const logs=[];
  const context={$request:{url},$argument:{script_debug:debug,remove_shorts_ads:enabled},$done(value){calls++;output=value;},console:{log(v){logs.push(v);}},Uint8Array,ArrayBuffer,TextDecoder,TextEncoder};
  if(response) context.$response={body,status,headers:{'Content-Type':type}};
  vm.runInNewContext(source,context,{timeout:1000});
  assert.equal(calls,1);
  return {output,logs};
}
function passed(r){assert.deepEqual(Object.keys(r.output),[]);}

test('plugin keeps Shorts playback ad cleaning enabled without a settings switch',()=>{
  const line=plugin.split('\n').find(x=>x.includes('tag=YouTube 播放响应与后台播放'));
  assert.ok(line);
  assert.ok(!plugin.includes('remove_shorts_ads = switch'));
  assert.ok(!line.includes('enable='));
  const regex=new RegExp(line.split(' ')[1],'i');
  assert.ok(regex.test(base+'?prettyPrint=false'));
  assert.ok(!regex.test('https://youtubei.googleapis.com/youtubei/v1/browse'));
});

test('Protobuf removes only entries with explicit isAd=true and preserves all other bytes',()=>{
  const normal=entry(false,1), ad=entry(true,2), unknown=entry(null,3), sibling=msg(9,u8([7,8,9]));
  const input=concat(sibling,normal,ad,unknown,ad);
  const expected=concat(sibling,normal,unknown);
  assert.deepEqual(Array.from(run(input).output.body),Array.from(expected));
});

test('JSON removes explicit ad entries through a response wrapper',()=>{
  const normal={command:{reelWatchEndpoint:{adClientParams:{isAd:false},videoId:'keep'}}};
  const ad={command:{reelWatchEndpoint:{adClientParams:{isAd:true},videoId:'drop'}}};
  const unrelated={adClientParams:{isAd:true},title:'keep'};
  const payload={reelWatchSequenceResponse:{entries:[normal,ad,unrelated]},tracking:'keep'};
  const output=JSON.parse(run(JSON.stringify(payload),{type:'application/json'}).output.body);
  assert.deepEqual(output,{reelWatchSequenceResponse:{entries:[normal,unrelated]},tracking:'keep'});
});

test('binary JSON round-trips UTF-8 and view offsets',()=>{
  const payload={entries:[{command:{reelWatchEndpoint:{adClientParams:{isAd:true}}}},{title:'普通短片'}]};
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const padded=concat(u8([1,2]),bytes,u8([3]));
  const result=run(new DataView(padded.buffer,2,bytes.length),{type:'application/json; charset=utf-8'});
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result.output.body)),{entries:[{title:'普通短片'}]});
});

test('ambiguous, malformed and disabled responses pass through whole',()=>{
  passed(run(entry(false,1)));
  passed(run(entry(true,1),{enabled:false}));
  passed(run(concat(entry(true,1),u8([0x12,0xff])),{}));
  passed(run(entry(true,1),{status:500}));
  passed(run(entry(true,1),{url:'https://youtubei.googleapis.com/youtubei/v1/player'}));
  passed(run('<html>ad</html>',{type:'text/html'}));
});

test('logs contain counts only and can be disabled',()=>{
  const r=run(concat(entry(true,1),entry(false,2)),{debug:true});
  assert.ok(r.logs.some(line=>line.includes('removed=1 entries=2 format=protobuf')));
  assert.ok(r.logs.every(line=>line.startsWith('[YouTubePlayback 1.0.0]')));
  assert.equal(run(entry(true,1),{debug:false}).logs.length,0);
});
