import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../YouTubeFeedAds.js',import.meta.url),'utf8');
const plugin=fs.readFileSync(new URL('../YouTubeNoAds.plugin',import.meta.url),'utf8');
function run(body,{endpoint='browse',host='youtubei.googleapis.com',type='application/json',status=200,url=`https://${host}/youtubei/v1/${endpoint}`,extra={}}={}) {
 let output,calls=0;const logs=[];
 const original=ArrayBuffer.isView(body)?Buffer.from(new Uint8Array(body.buffer,body.byteOffset,body.byteLength)):null;
 vm.runInNewContext(source,{$request:{url},$response:{body,headers:{'Content-Type':type},status},$argument:{script_debug:true},Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,console:{log:x=>logs.push(x)},$done:x=>{output=x;calls++;},...extra},{timeout:2000});
 assert.equal(calls,1);if(original)assert.deepEqual(Buffer.from(new Uint8Array(body.buffer,body.byteOffset,body.byteLength)),original);
 return {output,logs};
}
const v=n=>{const a=[];while(n>=128){a.push(n%128+128);n=Math.floor(n/128);}return [...a,n];};
const cat=(...p)=>Uint8Array.from(p.flatMap(x=>Array.from(x)));
const msg=(f,p)=>cat(v(f*8+2),v(p.length),p);
const ad=msg(424701016,[255,1]); // opaque ad body must never be guessed as protobuf
const normal=msg(50195462,[255,254,0]);
const tracking=msg(4,[1,2,3]);
const initial=list=>msg(9,msg(49399797,list));
test('main plugin routes all feed endpoints exclusively to its own standalone script',()=>{
 const entry=plugin.split('\n').find(x=>x.startsWith('http-response ')&&x.includes('YouTubeFeedAds.js'));
 const re=new RegExp(entry.split(' ')[1]);
 for(const host of ['youtubei.googleapis.com','youtubei-att.googleapis.com','youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'])for(const ep of ['browse','next','search'])assert.ok(re.test(`https://${host}/youtubei/v1/${ep}?key=x`));
 for(const url of ['https://youtubei.googleapis.com.evil/youtubei/v1/browse','https://youtubei.googleapis.com/youtubei/v1/player','https://youtubei.googleapis.com/youtubei/v1/browse/extra','https://rr5.googlevideo.com/videoplayback?x=1'])assert.ok(!re.test(url));
 assert.ok(!source.includes('$httpClient')&&!source.includes('require('));
});
for(const endpoint of ['browse','next','search'])test(`${endpoint} JSON removes whole sponsored cards, retaining videos, Shorts and pagination`,()=>{
 const keep=[{videoRenderer:{title:'赞助商广告评测',videoId:'NORMAL'}},{reelItemRenderer:{title:'keep'}},{continuationItemRenderer:{continuationEndpoint:{token:'KEEP'}}},{elementRenderer:{eml:'UNKNOWN'}}];
 const payload={contents:{sectionListRenderer:{contents:[{adSlotRenderer:{value:'ad'},trackingParams:'discard'},keep[0],{richItemRenderer:{content:{promotedVideoRenderer:{title:'Robinhood'}}},trackingParams:'discard'},...keep.slice(1)]}},metadata:{promotedVideoRenderer:{title:'outside list'}}};
 const result=run(JSON.stringify(payload),{endpoint});
 const out=JSON.parse(result.output.body);assert.deepEqual(out.contents.sectionListRenderer.contents,keep);assert.deepEqual(out.metadata,payload.metadata);
 assert.ok(result.logs.some(x=>x.includes('removed=2')));assert.ok(!result.logs.join('').includes('Robinhood'));
});
test('JSON continuation action removes cards without deleting action or target ID',()=>{
 const data={onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'home',continuationItems:[{inFeedAdLayoutRenderer:{}},{videoRenderer:{videoId:'KEEP'}}]}}]};
 const out=JSON.parse(run(JSON.stringify(data)).output.body);
 assert.deepEqual(out,{onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'home',continuationItems:[{videoRenderer:{videoId:'KEEP'}}]}}]});
});
test('binary UTF-8 JSON respects view offsets and characters',()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({contents:[{adSlotRenderer:{}},{videoRenderer:{title:'中文😀'}}]}));
 const padded=cat([99],bytes,[98]);const body=new DataView(padded.buffer,1,bytes.length);
 const out=run(body).output.body;assert.deepEqual(JSON.parse(new TextDecoder().decode(out)),{contents:[{videoRenderer:{title:'中文😀'}}]});
});
test('known browse Protobuf removes whole ad items and preserves every non-ad byte',()=>{
 const list=cat(msg(1,normal),msg(1,cat(ad,tracking)),tracking,msg(2,[255,0]),msg(1,ad));
 const expected=initial(cat(msg(1,normal),tracking,msg(2,[255,0])));
 const body=initial(list);assert.deepEqual(Buffer.from(run(body,{type:'application/x-protobuf'}).output.body),Buffer.from(expected));
});
test('Protobuf continuation and secondary recommendations use verified separate paths',()=>{
 const section=msg(10,msg(49399797,cat(msg(1,ad),msg(1,normal))));
 assert.deepEqual(Buffer.from(run(section,{type:'application/x-protobuf'}).output.body),Buffer.from(msg(10,msg(49399797,msg(1,normal)))));
 const next=msg(8,msg(51779776,cat(msg(1,msg(73920376,[])),msg(1,msg(50630979,[255])))));
 assert.deepEqual(Buffer.from(run(next,{endpoint:'next',type:'application/x-protobuf'}).output.body),Buffer.from(msg(8,msg(51779776,msg(1,msg(50630979,[255]))))));
});
test('known single-column next envelope removes list ads and preserves unrelated playback metadata',()=>{
 const payload=cat(msg(7,msg(51779735,msg(1,msg(49399797,cat(msg(1,ad),msg(1,normal)))))),msg(47,[0]));
 const expected=cat(msg(7,msg(51779735,msg(1,msg(49399797,msg(1,normal))))),msg(47,[0]));
 assert.deepEqual(Buffer.from(run(payload,{endpoint:'next',type:'application/x-protobuf'}).output.body),Buffer.from(expected));
});
test('opaque Elements and unknown messages retain ad-looking bytes without recursive scanning',()=>{
 const payload=cat(msg(9,msg(153515154,cat(ad,[255]))),msg(99,initial(msg(1,ad))));
 const r=run(payload,{type:'application/x-protobuf'});assert.equal(Object.keys(r.output).length,0);assert.ok(r.logs.join('').includes('opaque_elements=1'));
});
test('nested lengths rebuild correctly across varint length boundaries',()=>{
 const list=cat(msg(1,ad),msg(1,msg(99,new Uint8Array(126).fill(255))),tracking);
 assert.deepEqual(Buffer.from(run(initial(list),{type:'application/x-protobuf'}).output.body),Buffer.from(initial(cat(msg(1,msg(99,new Uint8Array(126).fill(255))),tracking))));
});
for(const [name,body,options] of [
 ['no ads preserves formatting',' { "contents": [{"videoRenderer": {}}] } ',{}],
 ['sponsor text is normal content',JSON.stringify({contents:[{videoRenderer:{title:'广告',badge:'Sponsored',description:'Robinhood'}}]}),{}],
 ['invalid JSON after candidate','{"contents":[{"adSlotRenderer":{}}],',{}],
 ['ambiguous JSON renderer union',JSON.stringify({contents:[{adSlotRenderer:{},videoRenderer:{}}]}),{}],
 ['invalid UTF-8',Uint8Array.from([255,254]),{}],
 ['unknown content type',JSON.stringify({contents:[{adSlotRenderer:{}}]}),{type:'text/html'}],
 ['media URL','{"contents":[{"adSlotRenderer":{}}]}',{url:'https://rr5.googlevideo.com/videoplayback?x=1'}],
 ['non-200','{"contents":[{"adSlotRenderer":{}}]}',{status:500}],
 ['search protobuf unknown',initial(msg(1,ad)),{endpoint:'search',type:'application/x-protobuf'}],
 ['wrong ad wire',initial(msg(1,cat(v(424701016*8),[1]))),{type:'application/x-protobuf'}],
 ['mixed renderer union',initial(msg(1,cat(ad,normal))),{type:'application/x-protobuf'}],
 ['truncated tail discards earlier removal',cat(initial(msg(1,ad)),[0x12,0x04,0x01]),{type:'application/x-protobuf'}],
 ['unknown schema',msg(99,msg(1,ad)),{type:'application/x-protobuf'}],
 ['gzip body',Uint8Array.from([31,139,8,0]),{type:'application/x-protobuf'}],
 ['oversized body',new Uint8Array(4194305),{type:'application/x-protobuf'}],
 ['empty body','',{}],
 ['no body',undefined,{}],
])test(`pass-through: ${name}`,()=>assert.equal(Object.keys(run(body,options).output).length,0));
test('resource limits discard all JSON modifications',()=>{
 let deep={};for(let i=0;i<66;i++)deep={child:deep};
 assert.equal(Object.keys(run(JSON.stringify({contents:[{adSlotRenderer:{}}],deep})).output).length,0);
});

test('unknown browse Tab contents are not guessed as list messages',()=>{
 const body=msg(9,msg(58173949,msg(1,msg(58174010,initial(msg(1,ad))))));
 assert.equal(Object.keys(run(body,{type:'application/x-protobuf'}).output).length,0);
});
test('rich ad wrapper mixed with normal renderer preserves the whole response',()=>{
 const body=JSON.stringify({contents:[{richItemRenderer:{content:{adSlotRenderer:{}}},videoRenderer:{title:'KEEP'}}]});
 assert.equal(Object.keys(run(body).output).length,0);
});
