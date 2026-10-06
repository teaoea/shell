import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const logger = fs.readFileSync(new URL('src/YouTubeLogger.js', root), 'utf8');
const playback = fs.readFileSync(new URL('src/YouTubePlayback.js', root), 'utf8');
const stream = fs.readFileSync(new URL('src/YouTubePlayback.js', root), 'utf8');
const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root), 'utf8');
const configKey = 'ytads.logger.config.v1';
const cacheKey = 'ytads.logger.entries.v2';
const base = 'http://youtube-logs.invalid';
function execute(source, store = new Map(), extra = {}, failure = '') {
  let output;
  let calls = 0;
  const logs = [];
  const notices = [];
  const context = {
    $persistentStore: {
      read(key) { if (failure === 'read') throw new Error('secret read detail'); return store.get(key); },
      write(value, key) { if (failure === 'write') return false; if (value === undefined) store.delete(key); else store.set(key, value); return true; }
    },
    $notification: { post(...args) { notices.push(args); } },
    $done(value) { output = value; calls++; },
    console: { log(value) { logs.push(value); } },
    Uint8Array, ArrayBuffer, TextDecoder, TextEncoder,
    $argument: {log_enabled:true, log_level:"debug", media_capture_mode:"full"},
    ...extra
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  assert.equal(calls, 1);
  return { output, logs, notices };
}
function request(store, path = '/', method = 'GET', failure = '', headers = {}) {
  return execute(logger, store, { $request: { url:base + path, method, headers } }, failure).output.response;
}
function play(store, debug = false, failure = '') {
  return execute(playback, store, {
    $request: { url:'https://youtubei.googleapis.com/youtubei/v1/player?token=PRIVATE' },
    $response: {status:200, headers:{'Content-Type':'application/json'}, body:'{"playabilityStatus":{},"adPlacements":[{}],"videoDetails":{"videoId":"SECRET"}}'},
    $argument: {script_debug:debug,log_enabled:true,log_level:"debug"}
  }, failure);
}
function events(store) {
  const state=JSON.parse(store.get(cacheKey)||'{"entries":[]}');
  return state.entries.map(summary=>{if(!summary.captureRef)return {summary,capture:null};const text=Array.from({length:summary.captureRef.chunks},(_,i)=>store.get(summary.captureRef.prefix+i)).join('');return {summary,capture:JSON.parse(text)};});
}

test('main plugin exposes exactly four switches and keeps function-specific scripts in one plugin', () => {
  assert.equal(fs.existsSync(new URL('YouTubeLogger.plugin', root)), false);
  assert.equal(plugin.split('\n').filter(x => x.startsWith('http-response')).length, 4);
  assert.ok(plugin.includes('log_enabled = switch,false'));
  assert.ok(plugin.includes('background_playback = switch,false'));
  assert.ok(plugin.includes('hide_home_shorts = switch,false'));
  assert.deepEqual(plugin.split('\n').filter(x=>/ = switch,/.test(x)).map(x=>x.split(' = ')[0]),['background_playback','translation_enabled','hide_home_shorts','log_enabled']);
  assert.ok(!plugin.includes('script_debug = switch'));
  assert.ok(!plugin.includes('capture_raw = switch'));
  assert.ok(plugin.includes('log_level = select,"info","debug","warn","error"'));
  const loggerLines = plugin.split('\n').filter(x => (x.includes('script-path=') || x.startsWith('response if ')) && /tag=(?:"?YouTube )(?:日志记录与导出|日志媒体响应记录|完整媒体开发采样)/.test(x));
  assert.equal(loggerLines.length, 3);
  assert.equal(plugin.split('\n').filter(x => /tag=YouTube (?:配置请求处理|Onesie 配置缓存)/.test(x)).length, 2);
  assert.equal(plugin.split('\n').filter(x => /tag=YouTube 播放(?:请求与广告配置处理|响应与后台播放)/.test(x)).length, 2);
  assert.equal(plugin.split('\n').filter(x => x.includes('tag=YouTube 信息流广告与首页 Shorts 处理')).length, 1);
  assert.ok(loggerLines.find(x => x.includes('日志记录与导出')).includes('requires-body=false'));
  assert.ok(plugin.includes('DOMAIN-SUFFIX,googlevideo.com'));
  const line = plugin.split('\n').find(x => x.startsWith('http-request') && x.includes('tag=YouTube 日志记录与导出'));
  const regex = new RegExp(line.split(' ')[1]);
  assert.ok(regex.test(base + '/download.log'));
  assert.ok(!regex.test('http://youtube-logs.invalid.evil/'));
  assert.ok(!plugin.includes('generic script-path='));
  assert.ok(!logger.includes('$httpClient') && !logger.includes('$persistentStore.remove'));
});

test('modern playback logger captures initplayback requests and config responses in the shared cache', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const init = 'https://rr5.googlevideo.com/initplayback?ack=1&oad=5500&sig=PRIVATE';
  execute(logger, store, {
    $request:{url:init,method:'POST',headers:{'X-Playback-Key':'SECRET'},body:new Uint8Array([1,2,3])},
    $argument:{log_enabled:true,log_level:'debug',capture_raw:true,capture_budget:'32'}
  });
  execute(logger, store, {
    $request:{url:'https://youtubei.googleapis.com/youtubei/v1/config',method:'POST',headers:{}},
    $response:{status:200,headers:{'Content-Type':'application/x-protobuf'},body:new Uint8Array([8,1])},
    $argument:{log_enabled:true,log_level:'debug',capture_raw:true,capture_budget:'32'}
  });
  const rows = JSON.parse(store.get(cacheKey)).entries;
  assert.deepEqual(rows.map(row => [row.source,row.endpoint,row.phase]), [
    ['YouTubeConfig','initplayback','request'],['YouTubeConfig','config','response']
  ]);
  const data = events(store);
  assert.equal(data[0].capture.request.url, init.split('?')[0]);
  assert.equal(data[1].capture.responseBefore.body.bytes, 2);
});
test('shared exports retain function-specific Onesie summaries', () => {
  const session = 'onesie-session';
  const store = new Map([
    [configKey, JSON.stringify({enabled:false,session})],
    [cacheKey, JSON.stringify({session,captureBytes:0,entries:[
      {source:'YouTubeConfig',version:'1.0.0',endpoint:'config',level:'info',time:'2026-10-04T01:00:00.000Z',phase:'response',message:'updated: lifetime_seconds=600 hot_config=true'},
      {source:'YouTubeConfig',version:'1.3.0',endpoint:'initplayback',level:'warn',time:'2026-10-04T01:00:01.000Z',phase:'request',message:'mismatch: config cleared refresh=true'}
    ]})]
  ]);
  assert.deepEqual(events(store).map(event => event.summary.source), ['YouTubeConfig','YouTubeConfig']);
  assert.match(request(store).body, /保留 2 条/);
});
test('manual entry points to the local page without silently enabling recording', () => {
  const store = new Map();
  const r = execute(logger, store);
  assert.ok(r.output.content.includes(base));
  assert.ok(r.output.content.includes('复现后下载日志'));
  assert.equal(r.notices[0][3].openUrl, base + '/');
  assert.equal(store.size, 0);
});
test('recording is off by default and only the complete log export is exposed', () => {
  const store = new Map();
  play(store);
  assert.equal(store.size, 0);
  const rootPage=request(store);
  assert.equal(rootPage.status,200);assert.ok(rootPage.body.includes('下载日志'));
  assert.equal((rootPage.body.match(/href="\/export"/g)||[]).length,0);
  assert.ok(!rootPage.body.includes('href="/download.json"')&&!rootPage.body.includes('export-feed'));
  assert.equal(request(store,'/download.log').status,303);
  assert.equal(request(store,'/download.json').status,404);
});
test('start, collect with console off, pause and export playback results without request secrets', () => {
  const store = new Map();
  assert.equal(request(store, '/start', 'POST').status, 303);
  const r = play(store);
  assert.equal(r.logs.length, 0);
  assert.equal(JSON.parse(r.output.body).adPlacements, undefined);
  assert.equal(JSON.parse(store.get(cacheKey)).entries.length, 1);
  request(store, '/pause', 'POST');
  play(store);
  assert.equal(JSON.parse(store.get(cacheKey)).entries.length,1);
  assert.match(JSON.parse(store.get(cacheKey)).entries[0].message,/changed/);
});
test('playback and stream summaries append to the same buffer and one file', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  play(store);
  const media = new Uint8Array([21, 3, 1, 2, 3]);
  const r = execute(stream, store, {
    $request:{url:'https://rr5.googlevideo.com/videoplayback?sig=PRIVATE'},
    $response:{status:200, headers:{'Content-Type':'application/vnd.yt-ump'}, body:media},
    $argument:{script_debug:false, log_enabled:true, log_level:"debug", capture_raw:true, capture_budget:'32', ump_mode:'inspect'}
  });
  assert.equal(Object.keys(r.output).length, 0);
  const entries = JSON.parse(store.get(cacheKey)).entries;
  assert.equal(entries.length,2);assert.ok(entries[1].message.includes('development capture: response'));
  const streamCapture=events(store)[1].capture;assert.ok(streamCapture.processing.messages[0].includes('pass: mode=inspect'));assert.ok(streamCapture.processing.messages[0].includes('parts=21:1'));
  assert.deepEqual(entries.map(r => r.source), ['YouTubePlayback', 'YouTubePlayback']);
  assert.ok(!store.has('ytads.logger.YouTubePlayback.v1') && !store.has('ytads.logger.YouTubePlayback.v1'));
});

test('main logging switch blocks all cache writes and manual entry when disabled', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const before = Array.from(store);
  const r = execute(playback, store, {
    $request:{url:'https://youtubei.googleapis.com/youtubei/v1/player'},
    $response:{status:200,headers:{'Content-Type':'application/json'},body:'{"playabilityStatus":{},"adSlots":[]}'},
    $argument:{script_debug:false,log_enabled:false}
  });
  assert.equal(JSON.parse(r.output.body).adSlots, undefined);
  assert.deepEqual(Array.from(store), before);
  const manual = execute(logger, store, {$argument:{log_enabled:false}});
  assert.ok(manual.output.content.includes('手动开启'));
  assert.equal(manual.notices.length, 0);
});

test('info preserves all summaries while warn and error filter severity', () => {
  for (const minimum of ['debug','info','warn','error']) {
    const store = new Map();
    request(store, '/start', 'POST');
    const scenarios = [
      {status:200,headers:{'Content-Type':'application/json'},body:'{"playabilityStatus":{}}'},
      {status:200,headers:{'Content-Type':'application/json'},body:'{"playabilityStatus":{},"adSlots":[]}'},
      {status:503,headers:{},body:''},
      {status:200,headers:{'Content-Type':{toString(){throw new Error('SECRET');}}},body:''}
    ];
    for (const response of scenarios) execute(playback, store, {
      $request:{url:'https://youtubei.googleapis.com/youtubei/v1/player'}, $response:response,
      $argument:{script_debug:false,log_enabled:true,log_level:minimum,capture_raw:false}
    });
    const levels = JSON.parse(store.get(cacheKey)).entries.map(r => r.level);
    const all = ['debug','info','warn','error'];
    assert.deepEqual(levels, minimum==='info'?['info','info','warn','error']:all.slice(all.indexOf(minimum)));
    assert.ok(!JSON.stringify(JSON.parse(store.get(cacheKey)).entries).includes('SECRET'));
    assert.ok(levels.includes('error'));
  }
});

test('old per-source caches migrate once to one cache without duplicating export', () => {
  const store = new Map([[configKey, JSON.stringify({enabled:true,session:'legacy-session'})]]);
  for (const source of ['YouTubePlaybackAds','YouTubeFeedAds']) store.set(`ytads.logger.${source}.v1`, JSON.stringify({session:'legacy-session',entries:[{
    time:'2026-10-02T01:00:00.000Z',version:'1.2.1',endpoint:source === 'YouTubePlaybackAds' ? 'player' : 'browse',message:'changed: removed=1'
  }]}));
  assert.ok(request(store).body.includes('保留 2 条'));
  assert.ok(request(store).body.includes('保留 2 条'));
  assert.equal(JSON.parse(store.get(cacheKey)).entries.length, 2);
  assert.ok(!store.has('ytads.logger.YouTubePlaybackAds.v1') && !store.has('ytads.logger.YouTubeFeedAds.v1'));
});

test('failed migration preserves old caches for retry', () => {
  const legacy = 'ytads.logger.YouTubePlayback.v1';
  const store = new Map([[configKey, JSON.stringify({enabled:true,session:'legacy-session'})], [legacy,JSON.stringify({session:'legacy-session',entries:[]})]]);
  assert.equal(request(store, '/download.log', 'GET', 'write').status, 503);
  assert.ok(store.has(legacy));
  assert.equal(store.has(cacheKey), false);
});
test('disabled development capture produces no stream entries', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  execute(stream, store, {$request:{url:'https://rr5.googlevideo.com/videoplayback?x=1'}, $response:{}, $argument:{capture_raw:false}});
  assert.equal(JSON.parse(store.get(cacheKey)).entries.length, 0);
});
test('shared buffer stops at 600 entries and preserves every prior entry', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const session = JSON.parse(store.get(configKey)).session;
  store.set(cacheKey, JSON.stringify({session, entries:Array.from({length:600}, (_, n) => ({time:'2026-10-02T00:00:00.000Z',source:'YouTubePlayback',level:'debug',version:'1.4.0',endpoint:'player',message:'old-' + n}))}));
  play(store);
  const state = JSON.parse(store.get(cacheKey));
  assert.equal(state.entries.length, 600);
  assert.equal(state.entries[0].message, 'old-0');
  assert.equal(state.entries.at(-1).message, 'old-599');
  assert.equal(JSON.parse(store.get(configKey)).enabled, false);
  assert.equal(JSON.parse(store.get(configKey)).haltReason, 'entry-limit');
  assert.ok(store.get(cacheKey).length <= 131072);
});
test('index byte limit stops new entries without evicting old records', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const session = JSON.parse(store.get(configKey)).session;
  const row = {time:'2026-10-02T00:00:00.000Z',source:'YouTubePlayback',level:'debug',version:'1.4.0',endpoint:'player',message:'a'.repeat(600)};
  const entries = Array(170).fill(row);
  let seed = JSON.stringify({session, entries});
  entries.push({...row, message:'b'.repeat(131066 - seed.length - JSON.stringify({...row,message:''}).length - 1)});
  seed = JSON.stringify({session, entries});
  assert.equal(seed.length, 131066);
  store.set(cacheKey, seed);
  play(store);
  assert.ok(store.get(cacheKey).length <= 131072);
  assert.equal(store.get(cacheKey), seed, 'index remains unchanged');
  assert.equal(JSON.parse(store.get(configKey)).haltReason, 'log-index-limit');
});
test('clear rotates session and preserves other scripts storage', () => {
  const store = new Map([['unrelated', 'keep']]);
  request(store, '/start', 'POST');
  play(store);
  const old = store.get(cacheKey);
  assert.equal(request(store, '/clear', 'POST').status, 303);
  assert.equal(JSON.parse(store.get(configKey)).enabled, false);
  assert.equal(store.get('unrelated'), 'keep');
  // An in-flight writer from the previous session cannot resurrect old logs.
  store.set(cacheKey, old);
  assert.ok(request(store).body.includes('保留 0 条'));
});
test('clearing can recover corrupt owned storage', () => {
  const store = new Map([[configKey, '{invalid']]);
  assert.equal(request(store).status, 503);
  assert.equal(request(store, '/clear', 'POST').status, 303);
  assert.equal(request(store).status, 200);
});
test('all write/read failures leave ad cleanup operational, errors contain no raw exception', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  for (const failure of ['write', 'read']) {
    const r = play(store, true, failure);
    assert.equal(JSON.parse(r.output.body).adPlacements, undefined);
    assert.ok(!r.logs.join('\n').includes('secret'));
    const ump = execute(stream, store, {
      $request:{url:'https://rr5.googlevideo.com/videoplayback?sig=PRIVATE'},
      $response:{status:200,headers:{'Content-Type':'application/vnd.yt-ump'},body:new Uint8Array([69,8,10,6,10,4,8,1,16,6])},
      $argument:{script_debug:true,log_enabled:true,log_level:"debug",capture_raw:true,capture_budget:'32',ump_mode:'clean_prefetch'}
    }, failure);
    assert.deepEqual(Array.from(ump.output.body), [69,0]);
    assert.ok(!ump.logs.join('\n').includes('secret'));
    assert.equal(request(store, '/start', 'POST', failure).status, 503);
  }
});
test('control routes require POST and reject foreign origins; unknown routes do not leak store', () => {
  const store = new Map();
  assert.equal(request(store, '/start').status, 405);
  assert.equal(request(store, '/start', 'POST', '', {Origin:'http://evil.test'}).status, 403);
  assert.equal(store.size, 0);
  assert.equal(request(store, '/unknown').status, 404);
  assert.equal(request(store, '/download.log', 'POST').status, 405);
  const other = execute(logger, store, {$request:{url:'https://youtube.com/',method:'GET'}});
  assert.equal(Object.keys(other.output).length, 0);
});
test('export ignores stale sessions and malformed records and sorts timestamps', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const session = JSON.parse(store.get(configKey)).session;
  const row = time => ({time,source:'YouTubePlayback',level:'debug',version:'1.4.0',endpoint:'player',message:'pass: removed=0'});
  store.set(cacheKey, JSON.stringify({session,entries:[row('2026-10-02T02:00:00.000Z'),row('2026-10-02T01:00:00.000Z'), {...row('2026-10-02T01:00:00.000Z'),message:'bad\nline'}]}));
  const valid = store.get(cacheKey);
  store.set(cacheKey, JSON.stringify({session:'stale',entries:[row('2026-10-02T00:00:00.000Z')]}));
  assert.ok(request(store).body.includes('保留 0 条'));
  store.set(cacheKey, valid);
  request(store,'/pause','POST');
  const manifest=JSON.parse(request(store,'/export-manifest.json').body);
  assert.equal(manifest.rows.length,2);
  assert.ok(manifest.rows[0].time.includes('01:00:00')&&manifest.rows[1].time.includes('02:00:00'));
  assert.ok(!JSON.stringify(manifest.rows).includes('bad\\nline'));
});

test('media request logging does not read body while response development capture reads UMP', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const req = {url:'https://rr5.googlevideo.com/videoplayback?sig=PRIVATE', method:'POST', headers:{'Content-Encoding':'br'}};
  const res = {status:200, headers:{'Content-Type':'application/vnd.yt-ump','Content-Length':'2129022'}};
  Object.defineProperty(req, 'body', {get(){throw new Error('must not read streaming request');}});
  res.body=new Uint8Array([20,2,8,0,21,3,1,2,3]);
  for (const extra of [{$request:req}, {$request:req,$response:res}]) {
    const result = execute(logger, store, extra);
    assert.deepEqual(Object.keys(result.output), []);
  }
  const rows = events(store);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.capture.processing.bodyBuffering, row.summary.phase==='response');
    assert.equal(row.capture.processing.exception, null);
    assert.ok(row.capture.processing.messages.includes(row.summary.phase==='response'?'media: development_response=true body_buffering=true':'media: headers_only=true body_buffering=false'));
    assert.equal(row.capture.request.body.available, false);
  }
  assert.equal(rows[1].capture.responseBefore.headers['Content-Length'], '2129022');
  assert.equal(rows[1].capture.responseBefore.body.available, false);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});

test('initialization coverage stays in export and is hidden from the page', () => {
 const store=new Map();request(store,'/start','POST');
 request(store,'/mark-ad','POST');request(store,'/pause','POST');
 const page=request(store).body;
 assert.ok(!page.includes('initplayback/player/get_watch'));
 const manifest=JSON.parse(request(store,'/export-manifest.json').body);
 assert.equal(manifest.data.coverage.hasPlaybackInitialization,false);
 assert.equal(manifest.data.coverage.counts.initplayback,0);
 play(store);
 request(store,'/start','POST');play(store);request(store,'/pause','POST');
 const complete=JSON.parse(request(store,'/export-manifest.json').body);
 assert.equal(complete.data.coverage.hasPlaybackInitialization,true);
 assert.equal(complete.data.coverage.counts.player,1);
 assert.ok(!request(store).body.includes('已记录播放初始化'));
});


test('googlevideo suffix explicitly rejects QUIC with UDP 443 fallback and no TCP rejection',()=>{
 const rules=plugin.split('[Rule]')[1].split('[Script]')[0].split('\n').filter(x=>x.startsWith('AND,'));
 const quic='AND,((DOMAIN-SUFFIX,googlevideo.com),(PROTOCOL,QUIC)),REJECT',fallback='AND,((DOMAIN-SUFFIX,googlevideo.com),(PROTOCOL,UDP),(DEST-PORT,443)),REJECT';
 assert.equal(rules.filter(x=>x===quic).length,1);assert.ok(rules.indexOf(quic)<rules.indexOf(fallback));assert.equal(rules.filter(x=>x===fallback).length,1);assert.ok(!rules.some(x=>/PROTOCOL,(TCP|HTTPS)/.test(x)));assert.ok(!rules.some(x=>/^DOMAIN-SUFFIX,googlevideo.com,REJECT$/.test(x)));
});
