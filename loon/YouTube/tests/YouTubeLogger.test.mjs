import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const logger = fs.readFileSync(new URL('YouTubeLogger.js', root), 'utf8');
const playback = fs.readFileSync(new URL('YouTubePlaybackAds.js', root), 'utf8');
const stream = fs.readFileSync(new URL('YouTubeStreamAds.js', root), 'utf8');
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
    $argument: {log_enabled:true, log_level:"debug"},
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

test('main plugin contains ad rules, function-specific Onesie scripts and one disabled logger entry; no separate plugin', () => {
  assert.equal(fs.existsSync(new URL('YouTubeLogger.plugin', root)), false);
  assert.equal(plugin.split('\n').filter(x => x.startsWith('http-response')).length, 5);
  assert.ok(plugin.includes('log_enabled = switch,false'));
  assert.ok(plugin.includes('script_debug = switch,false'));
  assert.ok(plugin.includes('log_level = select,"info","debug","warn","error"'));
  const loggerLines = plugin.split('\n').filter(x => x.includes('script-path=') && x.includes('YouTubeLogger.js'));
  assert.equal(loggerLines.length, 3);
  assert.equal(plugin.split('\n').filter(x => x.includes('YouTubeOnesieConfig.js')).length, 2);
  assert.equal(plugin.split('\n').filter(x => x.includes('YouTubeInitPlayback.js')).length, 1);
  assert.ok(loggerLines.find(x => x.includes('开发请求抓包')).includes('requires-body=true,binary-body-mode=true'));
  assert.ok(plugin.includes('DOMAIN-SUFFIX,googlevideo.com'));
  const line = plugin.split('\n').find(x => x.startsWith('http-request') && x.includes('youtube-logs'));
  const regex = new RegExp(line.split(' ')[1]);
  assert.ok(regex.test(base + '/download.log'));
  assert.ok(!regex.test('http://youtube-logs.invalid.evil/'));
  assert.ok(plugin.includes('generic script-path='));
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
    ['YouTubeLogger','initplayback','request'],['YouTubeLogger','config','response']
  ]);
  const data = JSON.parse(request(store, '/download.json').body);
  assert.equal(data.events[0].capture.request.url, init);
  assert.equal(data.events[1].capture.responseBefore.body.bytes, 2);
});
test('shared exports retain function-specific Onesie summaries', () => {
  const session = 'onesie-session';
  const store = new Map([
    [configKey, JSON.stringify({enabled:false,session})],
    [cacheKey, JSON.stringify({session,captureBytes:0,entries:[
      {source:'YouTubeOnesieConfig',version:'1.0.0',endpoint:'config',level:'info',time:'2026-10-04T01:00:00.000Z',phase:'response',message:'updated: lifetime_seconds=600 hot_config=true'},
      {source:'YouTubeInitPlayback',version:'1.1.0',endpoint:'initplayback',level:'warn',time:'2026-10-04T01:00:01.000Z',phase:'request',message:'mismatch: config cleared refresh=true'}
    ]})]
  ]);
  const data = JSON.parse(request(store, '/download.json').body);
  assert.deepEqual(data.events.map(event => event.summary.source), ['YouTubeOnesieConfig','YouTubeInitPlayback']);
  assert.match(request(store, '/download.log').body, /YouTubeInitPlayback 1\.1\.0/);
});
test('manual entry points to the local page without silently enabling recording', () => {
  const store = new Map();
  const r = execute(logger, store);
  assert.ok(r.output.content.includes(base));
  assert.equal(r.notices[0][3].openUrl, base + '/');
  assert.equal(store.size, 0);
});
test('recording is off by default; export supplies an actual attachment and empty-state explanation', () => {
  const store = new Map();
  play(store);
  assert.equal(store.size, 0);
  const r = request(store, '/download.log');
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Disposition'], /^attachment; filename="YouTube-.*\.log"$/);
  assert.ok(r.body.includes('No entries.'));
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
  const exportLog = request(store, '/download.log');
  assert.ok(exportLog.body.includes('Entries: 1'));
  assert.ok(exportLog.body.includes('[YouTubePlaybackAds 2.1.0] player changed'));
  assert.ok(!exportLog.body.includes('PRIVATE') && !exportLog.body.includes('SECRET'));
});
test('playback and stream summaries append to the same buffer and one file', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  play(store);
  const media = new Uint8Array([21, 3, 1, 2, 3]);
  const r = execute(stream, store, {
    $request:{url:'https://rr5.googlevideo.com/videoplayback?sig=PRIVATE'},
    $response:{status:200, headers:{'Content-Type':'application/vnd.yt-ump'}, body:media},
    $argument:{script_debug:false, log_enabled:true, log_level:"debug", ump_enabled:true, ump_mode:'inspect'}
  });
  assert.equal(Object.keys(r.output).length, 0);
  const exported = request(store, '/download.log').body;
  assert.ok(exported.includes('Entries: 2'));
  assert.ok(exported.includes('[YouTubeStreamAds 1.4.0] ump pass: mode=inspect'));
  assert.ok(exported.includes('parts=21:1'));
  assert.ok(!exported.includes('PRIVATE'));
  const entries = JSON.parse(store.get(cacheKey)).entries;
  assert.deepEqual(entries.map(r => r.source), ['YouTubePlaybackAds', 'YouTubeStreamAds']);
  assert.ok(!store.has('ytads.logger.YouTubePlaybackAds.v1') && !store.has('ytads.logger.YouTubeStreamAds.v1'));
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

test('each save level includes its own severity and higher levels only', () => {
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
      $argument:{script_debug:false,log_enabled:true,log_level:minimum}
    });
    const levels = JSON.parse(store.get(cacheKey)).entries.map(r => r.level);
    const all = ['debug','info','warn','error'];
    assert.deepEqual(levels, all.slice(all.indexOf(minimum)));
    const exported = request(store, '/download.log').body;
    assert.ok(!exported.includes('SECRET'));
    assert.ok(exported.includes('[ERROR]'));
  }
});

test('old per-source caches migrate once to one cache without duplicating export', () => {
  const store = new Map([[configKey, JSON.stringify({enabled:true,session:'legacy-session'})]]);
  for (const source of ['YouTubePlaybackAds','YouTubeStreamAds']) store.set(`ytads.logger.${source}.v1`, JSON.stringify({session:'legacy-session',entries:[{
    time:'2026-10-02T01:00:00.000Z',version:'1.2.1',endpoint:source === 'YouTubePlaybackAds' ? 'player' : 'ump',message:'changed: removed=1'
  }]}));
  assert.ok(request(store, '/download.log').body.includes('Entries: 2'));
  assert.ok(request(store, '/download.log').body.includes('Entries: 2'));
  assert.equal(JSON.parse(store.get(cacheKey)).entries.length, 2);
  assert.ok(!store.has('ytads.logger.YouTubePlaybackAds.v1') && !store.has('ytads.logger.YouTubeStreamAds.v1'));
});

test('failed migration preserves old caches for retry', () => {
  const legacy = 'ytads.logger.YouTubePlaybackAds.v1';
  const store = new Map([[configKey, JSON.stringify({enabled:true,session:'legacy-session'})], [legacy,JSON.stringify({session:'legacy-session',entries:[]})]]);
  assert.equal(request(store, '/download.log', 'GET', 'write').status, 503);
  assert.ok(store.has(legacy));
  assert.equal(store.has(cacheKey), false);
});
test('disabled UMP produces no stream entries', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  execute(stream, store, {$request:{url:'https://rr5.googlevideo.com/videoplayback?x=1'}, $response:{}, $argument:{ump_enabled:false}});
  assert.equal(JSON.parse(store.get(cacheKey)).entries.length, 0);
});
test('shared buffer stops at 600 entries and preserves every prior entry', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const session = JSON.parse(store.get(configKey)).session;
  store.set(cacheKey, JSON.stringify({session, entries:Array.from({length:600}, (_, n) => ({time:'2026-10-02T00:00:00.000Z',source:'YouTubePlaybackAds',level:'debug',version:'1.4.0',endpoint:'player',message:'old-' + n}))}));
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
  const row = {time:'2026-10-02T00:00:00.000Z',source:'YouTubePlaybackAds',level:'debug',version:'1.4.0',endpoint:'player',message:'a'.repeat(600)};
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
  assert.ok(request(store, '/download.log').body.includes('Entries: 0'));
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
      $argument:{script_debug:true,log_enabled:true,log_level:"debug",ump_enabled:true,ump_mode:'clean_prefetch'}
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
  const row = time => ({time,source:'YouTubePlaybackAds',level:'debug',version:'1.4.0',endpoint:'player',message:'pass: removed=0'});
  store.set(cacheKey, JSON.stringify({session,entries:[row('2026-10-02T02:00:00.000Z'),row('2026-10-02T01:00:00.000Z'), {...row('2026-10-02T01:00:00.000Z'),message:'bad\nline'}]}));
  const valid = store.get(cacheKey);
  store.set(cacheKey, JSON.stringify({session:'stale',entries:[row('2026-10-02T00:00:00.000Z')]}));
  assert.ok(request(store, '/download.log').body.includes('Entries: 0'));
  store.set(cacheKey, valid);
  const body = request(store, '/download.log').body;
  assert.ok(body.includes('Entries: 2'));
  assert.ok(body.indexOf('01:00:00') < body.indexOf('02:00:00'));
  assert.ok(!body.includes('bad\nline'));
});
