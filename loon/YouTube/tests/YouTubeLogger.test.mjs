import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const logger = fs.readFileSync(new URL('YouTubeLogger.js', root), 'utf8');
const playback = fs.readFileSync(new URL('YouTubePlaybackAds.js', root), 'utf8');
const stream = fs.readFileSync(new URL('YouTubeStreamAds.js', root), 'utf8');
const plugin = fs.readFileSync(new URL('YouTubeLogger.plugin', root), 'utf8');
const configKey = 'ytads.logger.config.v1';
const sourceKey = name => `ytads.logger.${name}.v1`;
const base = 'http://youtube-logs.invalid';
function execute(source, store = new Map(), extra = {}, failure = '') {
  let output;
  let calls = 0;
  const logs = [];
  const notices = [];
  const context = {
    $persistentStore: {
      read(key) { if (failure === 'read') throw new Error('secret read detail'); return store.get(key); },
      write(value, key) { if (failure === 'write') return false; store.set(key, value); return true; }
    },
    $notification: { post(...args) { notices.push(args); } },
    $done(value) { output = value; calls++; },
    console: { log(value) { logs.push(value); } },
    Uint8Array, ArrayBuffer, TextDecoder, TextEncoder,
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
    $argument: {script_debug:debug}
  }, failure);
}

test('logger plugin only supplies manual entry and local HTTP request; no overlapping ad response rules', () => {
  assert.equal(plugin.split('\n').filter(x => x.startsWith('http-response')).length, 0);
  const line = plugin.split('\n').find(x => x.startsWith('http-request'));
  const regex = new RegExp(line.split(' ')[1]);
  assert.ok(regex.test(base + '/download.log'));
  assert.ok(!regex.test('http://youtube-logs.invalid.evil/'));
  assert.ok(plugin.includes('generic script-path='));
  assert.ok(!logger.includes('$httpClient') && !logger.includes('$persistentStore.remove'));
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
  assert.equal(JSON.parse(store.get(sourceKey('YouTubePlaybackAds'))).entries.length, 1);
  request(store, '/pause', 'POST');
  play(store);
  const exportLog = request(store, '/download.log');
  assert.ok(exportLog.body.includes('Entries: 1'));
  assert.ok(exportLog.body.includes('[YouTubePlaybackAds 1.2.1] player changed'));
  assert.ok(!exportLog.body.includes('PRIVATE') && !exportLog.body.includes('SECRET'));
});
test('stream summaries collect in a separate buffer and appear in one file', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  play(store);
  const media = new Uint8Array([21, 3, 1, 2, 3]);
  const r = execute(stream, store, {
    $request:{url:'https://rr5.googlevideo.com/videoplayback?sig=PRIVATE'},
    $response:{status:200, headers:{'Content-Type':'application/vnd.yt-ump'}, body:media},
    $argument:{script_debug:false, ump_enabled:true, ump_mode:'inspect'}
  });
  assert.equal(Object.keys(r.output).length, 0);
  const exported = request(store, '/download.log').body;
  assert.ok(exported.includes('Entries: 2'));
  assert.ok(exported.includes('[YouTubeStreamAds 1.2.1] ump pass: mode=inspect'));
  assert.ok(exported.includes('parts=21:1'));
  assert.ok(!exported.includes('PRIVATE'));
});
test('disabled UMP produces no stream entries', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  execute(stream, store, {$request:{url:'https://rr5.googlevideo.com/videoplayback?x=1'}, $response:{}, $argument:{ump_enabled:false}});
  assert.equal(store.has(sourceKey('YouTubeStreamAds')), false);
});
test('log buffers retain the newest 300 entries and stay within 64 KiB', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const session = JSON.parse(store.get(configKey)).session;
  store.set(sourceKey('YouTubePlaybackAds'), JSON.stringify({session, entries:Array.from({length:300}, (_, n) => ({time:'2026-10-02T00:00:00.000Z',version:'1.2.1',endpoint:'player',message:'old-' + n}))}));
  play(store);
  const state = JSON.parse(store.get(sourceKey('YouTubePlaybackAds')));
  assert.equal(state.entries.length, 300);
  assert.equal(state.entries[0].message, 'old-1');
  assert.ok(state.entries.at(-1).message.startsWith('changed'));
  assert.ok(store.get(sourceKey('YouTubePlaybackAds')).length <= 65536);
});
test('byte budget also trims entries when count is below the maximum', () => {
  const store = new Map();
  request(store, '/start', 'POST');
  const session = JSON.parse(store.get(configKey)).session;
  const row = {time:'2026-10-02T00:00:00.000Z',version:'1.2.1',endpoint:'player',message:'a'.repeat(600)};
  const entries = Array(90).fill(row);
  let seed = JSON.stringify({session, entries});
  entries.push({...row, message:'b'.repeat(65530 - seed.length - JSON.stringify({...row,message:''}).length - 1)});
  seed = JSON.stringify({session, entries});
  assert.equal(seed.length, 65530);
  store.set(sourceKey('YouTubePlaybackAds'), seed);
  play(store);
  assert.ok(store.get(sourceKey('YouTubePlaybackAds')).length <= 65536);
  assert.ok(JSON.parse(store.get(sourceKey('YouTubePlaybackAds'))).entries.length <= entries.length, 'a new entry forces old entries to be evicted');
});
test('clear rotates session and preserves other scripts storage', () => {
  const store = new Map([['unrelated', 'keep']]);
  request(store, '/start', 'POST');
  play(store);
  const old = store.get(sourceKey('YouTubePlaybackAds'));
  assert.equal(request(store, '/clear', 'POST').status, 303);
  assert.equal(JSON.parse(store.get(configKey)).enabled, false);
  assert.equal(store.get('unrelated'), 'keep');
  // An in-flight writer from the previous session cannot resurrect old logs.
  store.set(sourceKey('YouTubePlaybackAds'), old);
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
      $argument:{script_debug:true,ump_enabled:true,ump_mode:'clean_prefetch'}
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
  const row = time => ({time,version:'1.2.1',endpoint:'player',message:'pass: removed=0'});
  store.set(sourceKey('YouTubePlaybackAds'), JSON.stringify({session,entries:[row('2026-10-02T02:00:00.000Z'),row('2026-10-02T01:00:00.000Z'), {...row('2026-10-02T01:00:00.000Z'),message:'bad\nline'}]}));
  store.set(sourceKey('YouTubeStreamAds'), JSON.stringify({session:'stale',entries:[row('2026-10-02T00:00:00.000Z')]}));
  const body = request(store, '/download.log').body;
  assert.ok(body.includes('Entries: 2'));
  assert.ok(body.indexOf('01:00:00') < body.indexOf('02:00:00'));
  assert.ok(!body.includes('bad\nline'));
});
