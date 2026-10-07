import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
const source = readFileSync(new URL('../BilibiliEnhance.js', import.meta.url), 'utf8');
const plugin = readFileSync(new URL('../BilibiliEnhance.plugin', import.meta.url), 'utf8');
const vi = n => { const b=[]; do { const v=n%128;n=Math.floor(n/128);b.push(v+(n?128:0)); } while(n);return b; };
const msg = (n, b) => [...vi(n*8+2), ...vi(b.length), ...b];
const str = (n, s) => msg(n, [...Buffer.from(s)]);
const frame = (p, gzip=false) => { const b=gzip?[...gzipSync(Buffer.from(p))]:p;return Uint8Array.from([gzip?1:0,Math.floor(b.length/16777216),Math.floor(b.length/65536)%256,Math.floor(b.length/256)%256,b.length%256,...b]); };
function run(path, body, options={}) {
 let output;const store=new Map();const consoleOutput=[];
 const response=options.requestOnly?undefined:{status:options.status||200,headers:{'grpc-status':options.grpc||'0'},body};
 const req={url:(options.host||'https://app.bilibili.com')+path+'?token=PRIVATE_TOKEN',method:options.method||'POST',headers:{Authorization:'PRIVATE_TOKEN'}};
 Object.defineProperty(req,'body',{get(){throw Error('request body must not be read');}});
 vm.runInNewContext(source,{$request:req,$response:response,$argument:{log_enabled:true},$utils:options.noGzip?undefined:{ungzip: b=>new Uint8Array(gunzipSync(b))},
 $persistentStore:{read:k=>store.get(k),write:(v,k)=>{store.set(k,v);return true;}},console:{log:v=>consoleOutput.push(v)},$done:v=>{assert.equal(output,undefined);output=v;}},{timeout:1000});
 return { output, store, consoleOutput };
}
const view='/bilibili.app.view.v1.View/View';
const unite='/bilibili.app.viewunite.v1.View/View';

test('DefaultWords returns successful framed blank protobuf on all three hosts without reading credentials',()=>{
 const path='/bilibili.app.interface.v1.Search/DefaultWords';
 const regex=new RegExp(plugin.split('\n').find(l=>l.includes('tag=Bilibili 搜索框默认词清空')).split(' ')[1]);
 for(const host of ['https://app.bilibili.com','https://grpc.biliapi.net','https://app.biliapi.net']){
  const {output,store}=run(path,null,{host,requestOnly:true});
  assert.equal(output.response.status,200);assert.equal(output.response.headers['grpc-status'],'0');
  assert.equal(output.response.headers['Content-Type'],'application/grpc');
  assert.deepEqual([...output.response.body],[0,0,0,0,15,18,0,26,1,32,34,0,40,1,58,0,66,0,74,0]);
  assert.ok(regex.test(host+path));assert.ok(![...store.values()].join('').includes('PRIVATE_TOKEN'));
  assert.equal(JSON.parse(store.get('bilibili.enhance.logs.v1')).events[0].endpoint,path);
 }
 assert.ok(!regex.test('https://app.bilibili.com'+path+'/extra'));
 const metadata=new RegExp(plugin.split('\n').find(l=>l.includes('tag=Bilibili 开发元数据日志')).split(' ')[1]);
 assert.equal(metadata.test('https://app.bilibili.com'+path),false);
});

test('video view removes player banner and ad recommendations while preserving all other wire bytes',()=>{
 const regular=str(3,'普通视频');const unknown=[...vi(100*8),255,255,255,255,255,255,255,255,127];
 const preserved=[...str(1,'视频简介'),...msg(10,regular),...unknown];
 const payload=[...preserved,...msg(30,str(1,'广告')),...msg(31,[8,1]),...msg(41,[8,1]),...msg(48,str(1,'播放器下方广告')),...msg(10,[...str(3,'广告'),...msg(28,[8,1])])];
 const {output,store}=run(view,frame(payload));assert.deepEqual([...output.body],[...frame(preserved)]);
 const event=JSON.parse(store.get('bilibili.enhance.logs.v1')).events[0];assert.equal(event.removed,5);assert.equal(event.outcome,'modified');
 assert.ok(![...store.values()].join('').includes('普通视频'));
});

test('unified view filters nested ad cards and keeps unknown modules, title and normal recommendations',()=>{
 const regular=[8,1,...msg(2,str(1,'普通视频'))];const unknownCard=[8,99,...msg(99,[1,2,3])];
 const cards=[...msg(1,regular),...msg(1,unknownCard)];
 const nest=cards=>msg(5,msg(1,msg(2,[...str(1,'简介'),...msg(2,[8,22,...msg(22,cards)]),...msg(2,[8,99,...msg(99,[1,2])])])));
 const payload=[...str(1,'保留视频信息'),...nest([...cards,...msg(1,[8,5,...msg(6,[8,1])]),...msg(1,[...regular,...msg(11,[8,1])])]),...msg(7,[8,1])];
 const expected=[...str(1,'保留视频信息'),...nest(cards)];
 assert.deepEqual([...run(unite,frame(payload)).output.body],[...frame(expected)]);
});

test('recommendation pagination removes only known advertising cards',()=>{
 const regular=str(3,'普通');
 assert.deepEqual([...run('/bilibili.app.view.v1.View/RelatesFeed',frame([...msg(1,regular),...msg(1,msg(28,[8,1]))])).output.body],[...frame(msg(1,regular))]);
 assert.deepEqual([...run('/bilibili.app.viewunite.v1.View/RelatesFeed',frame([...msg(1,[8,1]),...msg(1,[8,5])])).output.body],[...frame(msg(1,[8,1]))]);
});

test('gzip, no-op, invalid frames and API errors behave safely',()=>{
 assert.deepEqual([...run(view,frame([...str(1,'keep'),...msg(30,[8,1])],true)).output.body],[...frame(str(1,'keep'))]);
 for(const body of [frame(str(1,'keep')),new Uint8Array([0,0,0,0,2,255]),frame([255]),frame(msg(30,[8,1]),true)]){
  assert.deepEqual(JSON.parse(JSON.stringify(run(view,body,{noGzip:true}).output)),{});
 }
 assert.deepEqual(JSON.parse(JSON.stringify(run(view,frame(msg(30,[8,1])),{status:500}).output)),{});
 assert.deepEqual(JSON.parse(JSON.stringify(run(view,frame(msg(30,[8,1])),{grpc:'2'}).output)),{});
});

test('video rules are exact and encoding negotiation preserves headers without touching body',()=>{
 const lines=plugin.split('\n').filter(l=>l.includes('tag=Bilibili 视频'));
 assert.equal(lines.length,2);assert.match(lines[1],/binary-body-mode=true/);
 const regex=new RegExp(lines[1].split(' ')[1]);
 for(const path of [view,unite,'/bilibili.app.view.v1.View/RelatesFeed','/bilibili.app.viewunite.v1.View/RelatesFeed']){
  for(const host of ['app.bilibili.com','grpc.biliapi.net','app.biliapi.net'])assert.ok(regex.test('https://'+host+path));
  assert.ok(!regex.test('https://app.bilibili.com'+path+'/extra'));
 }
 assert.ok(!regex.test('https://app.bilibili.com.evil.test'+view));assert.ok(!regex.test('https://app.bilibili.com/bilibili.app.playerunite.v1.Player/PlayViewUnite'));
 const output=run(view,null,{requestOnly:true}).output;
 assert.equal(output.headers.Authorization,'PRIVATE_TOKEN');assert.equal(output.headers['grpc-accept-encoding'],'identity');
});

test('playback progress removes only triple and follow prompts, preserving chapters, comments and playback metadata',()=>{
 const oldGuide=[...msg(2,str(5,'互动弹幕')),...msg(3,str(4,'其他运营卡')),...msg(99,[8,1])];
 const newGuide=[...msg(1,str(2,'其他素材')),...msg(2,msg(1,str(4,'章节'))),...msg(99,[8,1])];
 const other=[...msg(2,str(1,'chronos')),...msg(3,str(1,'视频快照')),...msg(4,str(1,'弹幕')),...str(100,'unknown')];
 for(const [path,guide,prompts] of [
  ['/bilibili.app.view.v1.View/ViewProgress',oldGuide,[...msg(1,[8,1]),...msg(5,[32,1])]],
  ['/bilibili.app.viewunite.v1.View/ViewProgress',newGuide,msg(3,[32,1])]
 ]){
  const {output,store}=run(path,frame([...msg(1,[...guide,...prompts]),...other]));
  assert.deepEqual([...output.body],[...frame([...msg(1,guide),...other])]);
  assert.equal(JSON.parse(store.get('bilibili.enhance.logs.v1')).events[0].endpoint,path);
  assert.deepEqual(JSON.parse(JSON.stringify(run(path,frame([...msg(1,guide),...other])).output)),{});
  const regex=new RegExp(plugin.split('\n').find(l=>l.includes('tag=Bilibili 视频页广告过滤')).split(' ')[1]);
  const meta=new RegExp(plugin.split('\n').find(l=>l.includes('tag=Bilibili 开发元数据日志')).split(' ')[1]);
  for(const host of ['app.bilibili.com','grpc.biliapi.net','app.biliapi.net'])assert.ok(regex.test('https://'+host+path));
  assert.equal(meta.test('https://app.bilibili.com'+path),false);
  assert.ok(!regex.test('https://app.bilibili.com'+path+'/extra'));
 }
 const regex=new RegExp(plugin.split('\n').find(l=>l.includes('tag=Bilibili 视频页广告过滤')).split(' ')[1]);
 for(const path of ['/x/web-interface/archive/like/triple','/bilibili.app.view.v1.View/Like'])assert.equal(regex.test('https://app.bilibili.com'+path),false);
 assert.ok(!plugin.includes('remove_triple'));
});
