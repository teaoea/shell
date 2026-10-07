import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../src/YouTubeChannelList.js',import.meta.url),'utf8');
const bundle=fs.readFileSync(new URL('../dist/request.min.js',import.meta.url),'utf8');
const plugin=fs.readFileSync(new URL('../YouTubeNoAds.plugin',import.meta.url),'utf8');
const key='ytads.channels.remote.v1',url='https://raw.githubusercontent.com/example/lists/main/channels.txt';
const id='UC'+'A'.repeat(22);
function execute({code=source,store=new Map(),args={blocked_channels_url:url},data=`# channels\n${id}\n@blocked`,status=200,type='text/plain; charset=utf-8',error=null,extra={},defer=false,writeFail=false}={}){
 const state={calls:0,fetches:0,writes:0,logs:[],timer:null,result:null,request:null,store};
 const context={$loon:'test-loon',$argument:args,console:{log:value=>state.logs.push(value)},
  $done(value){state.calls++;state.result=value;},setTimeout(callback){state.timer=callback;return 1;},clearTimeout(){state.timer=null;},
  $persistentStore:{read:k=>store.get(k),write(value,k){state.writes++;if(writeFail)return false;store.set(k,value);return true;}},
  $httpClient:{get(options,callback){state.fetches++;state.request=options;state.respond=()=>callback(error,{status,headers:{'Content-Type':type}},data);if(!defer)state.respond();}},...extra};
 vm.runInNewContext(code,context,{timeout:2000});return state;
}
test('remote channel list downloads only in the Loon task and atomically stores deduplicated plain text',()=>{
 const state=execute({data:`\uFEFF# 注释\r\n${id}\n@blocked @blocked\thttps://www.youtube.com/@other\n`});
 assert.equal(state.calls,1);assert.equal(state.fetches,1);assert.equal(state.writes,1);
 const cached=JSON.parse(state.store.get(key));assert.equal(cached.url,url);assert.equal(cached.schema,1);assert.equal(cached.text,`${id} @blocked https://www.youtube.com/@other`);assert.ok(Number.isFinite(cached.fetchedAt));
 assert.equal(state.request.timeout,5000);assert.equal(state.request['auto-cookie'],false);assert.equal(state.request['auto-redirect'],false);assert.equal(state.request.insecure,false);
 const output=JSON.stringify([state.result,state.logs]);assert.match(output,/3 条/);assert.ok(!output.includes(id)&&!output.includes(url)&&!output.includes('@blocked'));assert.equal(state.timer,null);
});
test('empty or comments-only remote file deliberately clears the remote list',()=>{
 const state=execute({data:'# now empty\n\n'});assert.equal(state.calls,1);assert.equal(JSON.parse(state.store.get(key)).text,'');assert.match(state.result.content,/0 条/);
});
for(const [name,options] of [
 ['HTTP error',{status:404}],['network error',{error:'SECRET_FAILURE_URL'}],['redirect',{status:302}],
 ['HTML',{data:'<html>@blocked</html>'}],['wrong content type',{type:'application/json'}],['JSON',{data:'["@blocked"]'}],
 ['script',{data:'alert("@blocked");'}],['invalid channel link',{data:'https://youtube.com/watch?v=VIDEO'}],
 ['too many entries',{data:Array(257).fill('@blocked').join(' ')}],['oversized file',{data:'x'.repeat(65537)}],
 ['oversized UTF-8 file',{data:'# '+'中'.repeat(22000)}],['invalid UTF-8',{data:'@broken\ud800'}],
 ['non-text body',{data:new Uint8Array([1,2])}],['save failure',{writeFail:true}]
])test(`remote list ${name} retains the last known good cache without leaking data`,()=>{
 const previous=JSON.stringify({schema:1,url,text:'@old',fetchedAt:1}),store=new Map([[key,previous]]);
 const state=execute({...options,store});assert.equal(state.calls,1);assert.equal(store.get(key),previous);assert.equal(state.timer,null);assert.ok(!JSON.stringify(state.logs).includes('SECRET'));
});
for(const address of ['', 'http://example.com/list.txt','https://user:password@example.com/list.txt','https://example.com/list.txt?token=SECRET','https://example.com/list.txt#fragment','https://localhost/list.txt'])test('invalid or empty remote URL does not download: '+address.split('?')[0],()=>{
 const state=execute({args:{blocked_channels_url:address}});assert.equal(state.calls,1);assert.equal(state.fetches,0);assert.equal(state.writes,0);assert.ok(!JSON.stringify(state.result).includes('SECRET'));
});
test('remote module ignores other platforms and HTTP rewrite contexts',()=>{
 for(const extra of [{$loon:undefined},{$request:{url:'https://youtube.com/youtubei/v1/browse'}},{$response:{status:200}}]){
  const state=execute({extra});assert.equal(state.calls,1);assert.equal(state.fetches,0);assert.equal(state.writes,0);assert.deepEqual(Object.keys(state.result),[]);
 }
});
test('remote timeout ignores late callback and completes exactly once',()=>{
 const state=execute({defer:true});assert.equal(state.calls,0);state.timer();assert.equal(state.calls,1);state.respond();assert.equal(state.calls,1);assert.equal(state.writes,0);
});
test('request bundle routes manual and scheduled remote refresh independently of logging',()=>{
 const state=execute({code:bundle,args:{blocked_channels_url:url,log_enabled:false}});assert.equal(state.calls,1);assert.equal(state.fetches,1);assert.equal(state.writes,1);
 const disabled=execute({code:bundle,args:{blocked_channels_url:''}});assert.equal(disabled.calls,1);assert.equal(disabled.fetches,0);
 assert.match(plugin,/blocked_channels_url = input,""/);
 assert.match(plugin,/cron "0 \* \* \* \*" .*request\.min\.js.*argument=\[\{blocked_channels_url\}\]/);
 assert.match(plugin,/generic .*request\.min\.js.*argument=\[\{blocked_channels_url\}\]/);
});
