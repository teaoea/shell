import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../XianyuHeartbeat.js',import.meta.url),'utf8');
const plugin=readFileSync(new URL('../XianyuPushNetwork.plugin',import.meta.url),'utf8');
const KEY='xianyu.heartbeat.v1';
function run(args={}, options={}) {
  const requests=[], done=[], logs=[], timers=[];
  const store=options.store || new Map();
  const context={
    $argument:args,
    $httpClient:{head:(request,callback)=>{requests.push({request,callback});if(options.throwRequest)throw Error('secret-token');}},
    $persistentStore:{read:k=>store.get(k),write:(v,k)=>{if(options.failStore)return false;store.set(k,v);return true;}},
    $done:v=>done.push(JSON.parse(JSON.stringify(v))), console:{log:s=>logs.push(s)},
    setTimeout:(callback,delay)=>timers.push({callback,delay})
  };
  if(options.request)context.$request={url:'https://goofish.com/'};
  vm.runInNewContext(code,context);
  return {requests,done,logs,timers,store, event:()=>JSON.parse(store.get(KEY)).events.at(-1)};
}

test('disabled or accidentally invoked HTTP script never sends a request or writes',()=>{
  for(const args of [{},{heartbeat_enabled:false},{heartbeat_enabled:'false'}]) {
    const h=run(args);assert.equal(h.requests.length,0);assert.equal(h.store.size,0);assert.equal(h.done.length,1);assert.equal(h.timers.length,0);
  }
  const h=run({heartbeat_enabled:true},{request:true});assert.equal(h.requests.length,0);assert.deepEqual(h.done,[{}]);
});

test('enabled heartbeat makes one HEAD to exact apex without credentials or redirection',()=>{
  const h=run({heartbeat_enabled:true,heartbeat_timeout:'10'});
  assert.equal(h.requests.length,1);assert.equal(h.done.length,0);
  const request=h.requests[0].request;
  assert.equal(request.url,'https://goofish.com/');assert.equal(request.timeout,10000);
  assert.equal(request['auto-redirect'],false);assert.equal(request['auto-cookie'],false);assert.equal(request.insecure,false);
  assert.equal(request.body,undefined);assert.equal(request.node,undefined);assert.equal(request.headers.Cookie,undefined);
  assert.ok(request.headers['User-Agent'].startsWith('Loon-'));assert.ok(!request.headers['User-Agent'].includes('AliApp(Fish'));
  h.requests[0].callback(null,{status:200,headers:{'Set-Cookie':'secret'}},'private response');
  assert.equal(h.done.length,1);assert.equal(h.event().homepageOK,true);assert.equal(h.event().httpReachable,true);
  assert.equal(h.event().actor,'Loon');assert.equal(h.event().appKeepalive,false);assert.equal(h.event().accountOnlineVerified,false);
  assert.ok(!h.logs.join('').includes('secret'));assert.ok(!h.logs.join('').includes('private response'));
});

test('redirect and error statuses are recorded as HTTP responses, not homepage success',()=>{
  for(const status of [301,302,403,405,500]) {
    const h=run({heartbeat_enabled:'true'});h.requests[0].callback(null,{status});
    assert.equal(h.event().status,status);assert.equal(h.event().httpReachable,true);assert.equal(h.event().homepageOK,false);assert.equal(h.requests.length,1);
  }
});

test('invalid HTTP responses and network errors are never marked reachable',()=>{
  for(const response of [undefined,{}, {status:0},{status:999},{status:'bad'}]) {
    const h=run({heartbeat_enabled:true});h.requests[0].callback(null,response);
    assert.equal(h.event().httpReachable,false);assert.equal(h.event().error,'invalid-response');
  }
  const h=run({heartbeat_enabled:true});h.requests[0].callback('failed secret-cookie', {status:200});
  assert.equal(h.event().homepageOK,false);assert.equal(h.event().error,'network-error');assert.ok(!h.logs.join('').includes('secret-cookie'));
});

test('watchdog and late or repeated callbacks complete exactly once',()=>{
  const h=run({heartbeat_enabled:true});assert.equal(h.timers[0].delay,6500);
  h.timers[0].callback();assert.equal(h.event().error,'WATCHDOG_TIMEOUT');
  h.requests[0].callback(null,{status:200});h.timers[0].callback();assert.equal(h.done.length,1);assert.equal(h.logs.length,1);
  const success=run({heartbeat_enabled:true});success.requests[0].callback(null,{status:200});success.timers[0].callback();
  assert.equal(success.done.length,1);assert.equal(success.event().homepageOK,true);
});

test('timeout is bounded and unavailable client completes without leaking errors',()=>{
  for(const value of ['-1','99','NaN',null,'5']) {const h=run({heartbeat_enabled:true,heartbeat_timeout:value});assert.equal(h.requests[0].request.timeout,5000);}
  const h=run({heartbeat_enabled:true},{throwRequest:true});assert.equal(h.done.length,1);assert.equal(h.event().error,'REQUEST_START_FAILED');assert.ok(!h.logs.join('').includes('secret-token'));
});

test('recent history remains bounded and separate from app capture storage',()=>{
  const store=new Map([['xianyu.logger.v1','app-capture-sentinel']]);
  for(let i=0;i<25;i++){const h=run({heartbeat_enabled:true},{store});h.requests[0].callback(null,{status:200});}
  assert.equal(JSON.parse(store.get(KEY)).events.length,20);assert.equal(store.get('xianyu.logger.v1'),'app-capture-sentinel');
  store.set(KEY,'not-json');const h=run({heartbeat_enabled:true},{store});h.requests[0].callback(null,{status:200});assert.equal(JSON.parse(store.get(KEY)).events.length,1);
});

test('storage failure does not hide request outcome or prevent completion',()=>{
  const h=run({heartbeat_enabled:true},{failStore:true});h.requests[0].callback(null,{status:200});assert.equal(h.done.length,1);assert.ok(h.done[0].content.includes('保存失败'));assert.ok(h.logs[0].includes('"saved":false'));
});

test('Cron is opt-in, has documented frequencies, and receives switch and timeout',()=>{
  assert.match(plugin,/heartbeat_enabled = switch,false/);
  assert.match(plugin,/heartbeat_cron = select,"\*\/5 \* \* \* \*","\*\/10 \* \* \* \*","\*\/15 \* \* \* \*","0 \* \* \* \*"/);
  const cron=plugin.split('\n').find(s=>s.startsWith('cron '));
  assert.match(cron,/cron \$\{heartbeat_cron\} then script/);assert.match(cron,/enable=\$\{heartbeat_enabled\}/);assert.match(cron,/\{\$\{heartbeat_enabled\}, \$\{heartbeat_timeout\}\}/);assert.match(cron,/timeout=20/);
  assert.match(plugin,/#!system = iOS,iPadOS/);
});
