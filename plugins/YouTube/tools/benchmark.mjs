/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 功能：用合成数据比较已有版本与当前 JS 的本地执行开销和输出；不代表手机或网络耗时。
 * 更新时间：2026-10-07
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const current = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 4 || process.argv[2] !== '--baseline') throw Error('用法：node tools/benchmark.mjs --baseline <保留 src/ 与 dist/ 的旧版目录>');
const baseline = path.resolve(process.argv[3]);
const id = 'UC'+'A'.repeat(22), keptId = 'UC'+'B'.repeat(22);
const text = s => new TextEncoder().encode(s);
const varint = n => {const a=[];while(n>=128){a.push(n%128+128);n=Math.floor(n/128);}return Uint8Array.from([...a,n]);};
const concat = (...parts) => {const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;};
const msg = (n,b) => concat(varint(n*8+2),varint(b.length),b);
const nested = (fields,b) => fields.reduceRight((data,n)=>msg(n,data),b);
const card = (channel) => {
  const command=msg(48687626,msg(2,text(channel)));
  const component=concat(msg(3,msg(172035250,msg(1,text('video_lockup_with_attachment.eml-fe|0123456789abcdef')))),msg(5,msg(232954548,command)));
  return msg(1,msg(50195462,msg(1,nested([153515154,172660663,1,168777401],component))));
};
const native= nested([9,58173949,1,58174010,4,49399797],concat(...Array.from({length:400},(_,i)=>i%40===0?msg(1,msg(424701016,new Uint8Array([255,1]))):card(i%9===0?id:keptId))));
const json = JSON.stringify({contents:Array.from({length:1000},(_,i)=>i%50===0?{adSlotRenderer:{}}:{videoRenderer:{videoId:'synthetic',ownerText:{runs:[{text:'合成频道',navigationEndpoint:{browseEndpoint:{browseId:i%9===0?id:keptId}}}]}}})});
const cases = [
  ['信息流 JSON / 1000 卡片','src/YouTubeFeed.js','browse',json,'application/json',true],
  ['信息流 Protobuf / 400 卡片','src/YouTubeFeed.js','browse',native,'application/x-protobuf',true],
  ['响应发布包 / 同一 Protobuf','dist/response.min.js','browse',native,'application/x-protobuf',true],
  ['请求发布包 / 普通 player','dist/request.min.js','player','{"context":{"adSignalsInfo":{}},"playbackContext":{"contentPlaybackContext":{"adParams":"synthetic"}}}','application/json',false]
];
function runner(directory,file,endpoint,body,type,response) {
  const script=new vm.Script(fs.readFileSync(path.join(directory,file),'utf8'),{filename:directory+'/'+file});
  let output,calls=0;
  const sandbox={$loon:'benchmark',Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,
    $argument:{log_enabled:false,blocked_channels:id},console:{log(){}},
    $request:{url:'https://youtubei.googleapis.com/youtubei/v1/'+endpoint,method:'POST',headers:{'Content-Type':type}},
    $done(value){calls++;output=value;}};
  if(response)sandbox.$response={status:200,headers:{'Content-Type':type},body};else sandbox.$request.body=body;
  const context=vm.createContext(sandbox);
  return ()=>{calls=0;const start=performance.now();script.runInContext(context,{timeout:2000});const ms=performance.now()-start;assert.equal(calls,1);return {ms,output:JSON.stringify(output,(_,value)=>ArrayBuffer.isView(value)?Array.from(value):value)};};
}
for(const [name,file,endpoint,body,type,response] of cases){
  const old=runner(baseline,file,endpoint,body,type,response),next=runner(current,file,endpoint,body,type,response);
  for(let i=0;i<10;i++)assert.equal(old().output,next().output);
  const times=[[],[]];
  for(let i=0;i<60;i++){
    const order=i%2?[1,0]:[0,1],results=[];
    for(const index of order){const result=[old,next][index]();times[index].push(result.ms);results[index]=result.output;}
    assert.equal(results[0],results[1]);
  }
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const before=median(times[0]),after=median(times[1]);
  console.log(JSON.stringify({case:name,fixtureBytes:typeof body==='string'?Buffer.byteLength(body):body.length,rounds:60,beforeMs:+before.toFixed(3),afterMs:+after.toFixed(3),changePercent:+((after/before-1)*100).toFixed(1),outputsEqual:true}));
}
