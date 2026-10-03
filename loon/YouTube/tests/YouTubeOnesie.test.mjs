import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const configSource = fs.readFileSync(new URL('YouTubeOnesieConfig.js', root), 'utf8');
const initSource = fs.readFileSync(new URL('YouTubeInitPlayback.js', root), 'utf8');
const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root), 'utf8');
const stateKey = 'ytads.onesie.youtube.v1';
const logConfigKey = 'ytads.logger.config.v1';
const logCacheKey = 'ytads.logger.entries.v2';
const youtubeUA = 'com.google.ios.youtube/21.39.4 (iPhone; iOS)';
const musicUA = 'com.google.ios.youtubemusic/9.1 (iPhone; iOS)';

const concat = (...parts) => {
  const flat = parts.flat();
  const result = new Uint8Array(flat.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of flat) { result.set(part, offset); offset += part.length; }
  return result;
};
const varint = value => {
  const out = [];
  do { const byte = value % 128; value = Math.floor(value / 128); out.push(byte + (value ? 128 : 0)); } while (value);
  return Uint8Array.from(out);
};
const message = (field, payload) => concat(varint(field * 8 + 2), varint(payload.length), payload);
const scalar = (field, value) => concat(varint(field * 8), varint(value));
const makeConfig = ({client=[1,2,3], encrypt=[9,8,7], lifetime=600, enabled=1}={}) => {
  const onesie = concat(message(1, Uint8Array.from(client)), message(2, Uint8Array.from(encrypt)), scalar(3, lifetime), scalar(30, enabled));
  return message(1, message(16, message(7, message(138536474, message(146311580, onesie)))));
};
const makeInit = key => message(3, concat(message(2, Uint8Array.from([4,5])), message(5, Uint8Array.from(key)), message(6, Uint8Array.from([6])), message(7, Uint8Array.from([7]))));

function execute(source, {store=new Map(), request, response, argument={}}={}) {
  let output, calls = 0;
  const logs = [];
  const context = {
    Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    $persistentStore:{read:key=>store.get(key),write(value,key){if(value===undefined)store.delete(key);else store.set(key,value);return true;}},
    $argument:{onesie_enabled:true,script_debug:false,log_enabled:true,log_level:'debug',capture_raw:false,capture_budget:'16',...argument},
    $request:request,
    $done(value){output=value;calls++;},
    console:{log(value){logs.push(value);}}
  };
  if (response !== undefined) context.$response = response;
  vm.runInNewContext(source, context, {timeout:1000});
  assert.equal(calls, 1);
  return {output,logs,store};
}
function configResponse(store, body=makeConfig(), ua=youtubeUA, argument={}) {
  return execute(configSource, {store,
    request:{url:'https://youtubei.googleapis.com/youtubei/v1/config?prettyPrint=false',method:'POST',headers:{'User-Agent':ua}},
    response:{status:200,headers:{'Content-Type':'application/x-protobuf'},body}, argument});
}
function logEvent(store, ua=youtubeUA, headers={}) {
  return execute(configSource, {store,request:{url:'https://youtubei.googleapis.com/youtubei/v1/log_event',method:'POST',headers:{'User-Agent':ua,...headers},body:Uint8Array.from([8,1])}});
}
function initPlayback(store, key, ua=youtubeUA, argument={}) {
  return execute(initSource, {store,request:{url:'https://rr5---sn-test.googlevideo.com/initplayback?ack=1&sig=PRIVATE',method:'POST',headers:{'User-Agent':ua},body:makeInit(key)},argument});
}

test('plugin routes the YouTube-only Onesie lifecycle to two function-specific scripts', () => {
  assert.ok(plugin.includes('onesie_enabled = switch,true'));
  const configLines = plugin.split('\n').filter(line => line.includes('YouTubeOnesieConfig.js'));
  const initLine = plugin.split('\n').find(line => line.includes('YouTubeInitPlayback.js'));
  assert.equal(configLines.length, 2);
  assert.ok(initLine && initLine.includes('enable={onesie_enabled}') && initLine.includes('requires-body=true'));
  assert.ok(configLines.every(line => !line.includes('music\\.')));
  assert.ok(!initLine.includes('workers.dev'));
});

test('config response stores complete YouTube keys with a bounded lifetime and leaves response untouched', () => {
  const store = new Map([[logConfigKey,JSON.stringify({enabled:true,session:'test-session'})]]);
  const before = Date.now();
  const result = configResponse(store);
  assert.deepEqual(Object.keys(result.output), []);
  const state = JSON.parse(store.get(stateKey));
  assert.equal(state.platform, 'youtube');
  assert.equal(state.clientKey, Buffer.from([1,2,3]).toString('base64'));
  assert.equal(state.encryptKey, Buffer.from([9,8,7]).toString('base64'));
  assert.equal(state.lifetimeSeconds, 600);
  assert.equal(state.useHotConfig, true);
  assert.ok(state.expiresAt >= before + 600000 && state.expiresAt <= Date.now() + 600000);
  const entries = JSON.parse(store.get(logCacheKey)).entries;
  assert.equal(entries[0].source, 'YouTubeOnesieConfig');
  assert.ok(!JSON.stringify(entries).includes(state.clientKey));
  assert.ok(!JSON.stringify(entries).includes(state.encryptKey));
});

test('log_event requests refresh full config only when the YouTube cache is absent or expired', () => {
  const empty = new Map();
  const refresh = logEvent(empty,youtubeUA,{'Content-Encoding':'br','X-YouTube-Hot-Hash-Data':'stale','X-Keep':'yes'}).output;
  assert.equal(refresh.headers['Content-Encoding'], undefined);
  assert.equal(refresh.headers['X-YouTube-Hot-Hash-Data'], undefined);
  assert.equal(refresh.headers['X-Keep'], 'yes');

  const active = new Map(); configResponse(active);
  const reused = logEvent(active,youtubeUA,{'content-encoding':'br','x-youtube-hot-hash-data':'current'}).output;
  assert.equal(reused.headers['content-encoding'], undefined);
  assert.equal(reused.headers['x-youtube-hot-hash-data'], 'current');

  const stale = JSON.parse(active.get(stateKey)); stale.expiresAt = Date.now() - 1; active.set(stateKey,JSON.stringify(stale));
  const expired = logEvent(active,youtubeUA,{'X-YouTube-Hot-Hash-Data':'old'}).output;
  assert.equal(expired.headers['X-YouTube-Hot-Hash-Data'], undefined);
  assert.equal(active.has(stateKey), false);
});

test('matching initplayback key passes through; mismatch clears state and triggers one local fallback', () => {
  const matching = new Map(); configResponse(matching);
  assert.deepEqual(Object.keys(initPlayback(matching,[9,8,7]).output), []);
  assert.equal(matching.has(stateKey), true);

  const stale = new Map(); configResponse(stale);
  const result = initPlayback(stale,[3,3,3]);
  assert.equal(result.output.response.status, 200);
  assert.equal(result.output.response.headers['Content-Type'], 'application/x-protobuf');
  assert.equal(result.output.response.body.length, 0);
  assert.equal(stale.has(stateKey), false);
});

test('fallback can be disabled, and absent config never blocks playback', () => {
  const stale = new Map(); configResponse(stale);
  const result = initPlayback(stale,[3,3,3],youtubeUA,{onesie_refresh_on_mismatch:false});
  assert.deepEqual(Object.keys(result.output), []);
  assert.equal(stale.has(stateKey), false);
  assert.deepEqual(Object.keys(initPlayback(new Map(),[9,8,7]).output), []);
});

test('YouTube Music, unknown clients, malformed messages and disabled execution pass through', () => {
  const musicStore = new Map();
  assert.deepEqual(Object.keys(configResponse(musicStore,makeConfig(),musicUA).output), []);
  assert.equal(musicStore.has(stateKey), false);
  const existing = new Map(); configResponse(existing);
  assert.deepEqual(Object.keys(initPlayback(existing,[1],musicUA).output), []);
  assert.equal(existing.has(stateKey), true);

  const malformed = execute(configSource,{store:new Map(),request:{url:'https://youtubei.googleapis.com/youtubei/v1/config',headers:{'User-Agent':youtubeUA}},response:{status:200,headers:{},body:Uint8Array.from([10,5,1])}});
  assert.deepEqual(Object.keys(malformed.output), []);
  const disabled = initPlayback(existing,[1],youtubeUA,{onesie_enabled:false});
  assert.deepEqual(Object.keys(disabled.output), []);
});

test('raw development events use the shared cache while summaries never expose key values', () => {
  const store = new Map([[logConfigKey,JSON.stringify({enabled:true,session:'raw-session'})]]);
  configResponse(store,makeConfig(),youtubeUA,{capture_raw:true});
  initPlayback(store,[9,8,7],youtubeUA,{capture_raw:true});
  const entries = JSON.parse(store.get(logCacheKey)).entries;
  assert.deepEqual(entries.map(entry => entry.source), ['YouTubeOnesieConfig','YouTubeInitPlayback']);
  assert.ok(entries.every(entry => entry.captureRef));
  assert.ok(entries.every(entry => !entry.message.includes('CQgH')));
});
