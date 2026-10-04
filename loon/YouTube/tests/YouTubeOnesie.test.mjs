import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const configSource = fs.readFileSync(new URL('YouTubeConfig.js', root), 'utf8');
const initSource = fs.readFileSync(new URL('YouTubeConfig.js', root), 'utf8');
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

function execute(source, {store=new Map(), request, response, argument={}, cryptoApi, utilsApi}={}) {
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
  if (cryptoApi) context.$crypto = cryptoApi;
  if (utilsApi) context.$utils = utilsApi;
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
function initPlayback(store, key, ua=youtubeUA, argument={}, body=makeInit(key), cryptoApi, utilsApi) {
  return execute(initSource, {store,request:{url:'https://rr5---sn-test.googlevideo.com/initplayback?ack=1&sig=PRIVATE',method:'POST',headers:{'User-Agent':ua,'Content-Length':'100','Content-Encoding':'br'},body},argument,cryptoApi,utilsApi});
}

const cryptoApi = {aes:{
  encrypt(data,{key,iv}) { const cipher=crypto.createCipheriv('aes-128-ctr',Buffer.from(key),Buffer.from(iv)); return {ciphertext:new Uint8Array(Buffer.concat([cipher.update(Buffer.from(data)),cipher.final()]))}; },
  decrypt(data,{key,iv}) { const decipher=crypto.createDecipheriv('aes-128-ctr',Buffer.from(key),Buffer.from(iv)); return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(data)),decipher.final()])); }
}};
const hmac = (key, ...parts) => new Uint8Array(crypto.createHmac('sha256',Buffer.from(key)).update(Buffer.concat(parts.map(part=>Buffer.from(part)))).digest());
const aesCtr = (key,iv,data) => cryptoApi.aes.encrypt(data,{key,iv}).ciphertext;
const readVarint = (bytes,cursor) => { let value=0,factor=1; for(let i=0;i<10;i++){const byte=bytes[cursor.pos++];value+=(byte&127)*factor;if(byte<128)return value;factor*=128;} throw new Error('invalid-varint'); };
const fields = bytes => {
  const cursor={pos:0},result=[];
  const skip=(no,wire)=>{if(wire===0)readVarint(bytes,cursor);else if(wire===2){const length=readVarint(bytes,cursor);cursor.pos+=length;}else if(wire===3){while(cursor.pos<bytes.length){const tag=readVarint(bytes,cursor),childNo=Math.floor(tag/8),childWire=tag&7;if(childWire===4){assert.equal(childNo,no);return;}skip(childNo,childWire);}}else throw new Error('unsupported-wire');};
  while(cursor.pos<bytes.length){const start=cursor.pos,tag=readVarint(bytes,cursor),no=Math.floor(tag/8),wire=tag&7;let dataStart=cursor.pos,dataEnd=cursor.pos,value;if(wire===0){value=readVarint(bytes,cursor);dataEnd=cursor.pos;}else if(wire===2){const length=readVarint(bytes,cursor);dataStart=cursor.pos;cursor.pos+=length;dataEnd=cursor.pos;}else if(wire===3){skip(no,wire);dataEnd=cursor.pos;}else throw new Error('unsupported-wire');result.push({no,wire,start,end:cursor.pos,dataStart,dataEnd,value});}return result;
};
const field = (bytes,no,wire=2) => { const item=fields(bytes).find(entry=>entry.no===no&&entry.wire===wire); return item && bytes.subarray(item.dataStart,item.dataEnd); };
const makeEncryptedInit = (clientKey,encryptKey,player,{tamper=false,preroll=true,unknownGroup=false,gzip=false,protobuf=false}={}) => {
  const iv=Uint8Array.from({length:16},(_,i)=>i+1);
  const group=unknownGroup?concat(varint(20*8+3),scalar(1,7),varint(20*8+4)):new Uint8Array(0);
  const encoded=protobuf?player:new TextEncoder().encode(JSON.stringify(player));
  const plain=concat(message(1,new TextEncoder().encode('https://youtubei.googleapis.com/youtubei/v1/player')),group,message(3,encoded));
  const encrypted=aesCtr(clientKey.subarray(0,16),iv,gzip?zlib.gzipSync(plain):plain);
  const mac=hmac(clientKey.subarray(16),encrypted,iv); if(tamper)mac[0]^=255;
  const envelope=concat(message(2,encrypted),message(5,encryptKey),message(6,iv),message(7,mac),scalar(13,preroll?1:0));
  return message(3,envelope);
};
const protobufPlayer = () => concat(
  message(1,concat(message(9,Uint8Array.from([8,1])),message(90,Uint8Array.from([1,2,3])))),
  message(4,message(1,concat(message(12,new TextEncoder().encode('vast')),message(25,new TextEncoder().encode('forced')),scalar(50,0),message(61,Uint8Array.from([4,5]))))),
  message(99,Uint8Array.from([7,8,9]))
);
const decryptPlayer = (body,clientKey,{gzip=false}={}) => {
  const envelope=field(body,3),encrypted=field(envelope,2),iv=field(envelope,6),mac=field(envelope,7);
  assert.deepEqual(mac,hmac(clientKey.subarray(16),encrypted,iv));
  const decrypted=cryptoApi.aes.decrypt(encrypted,{key:clientKey.subarray(0,16),iv});
  const plain=gzip?new Uint8Array(zlib.gunzipSync(decrypted)):decrypted;
  const playerBody=field(plain,3); let player;
  try { player=JSON.parse(new TextDecoder().decode(playerBody)); } catch (_) {}
  return {plain,playerBody,player,preroll:fields(envelope).find(entry=>entry.no===13)?.value};
};
const utilsApi={gzip:data=>new Uint8Array(zlib.gzipSync(data)),ungzip:data=>new Uint8Array(zlib.gunzipSync(data))};

test('plugin routes the YouTube-only Onesie lifecycle through the merged configuration file', () => {
  assert.ok(!plugin.includes('onesie_enabled = switch'));
  const configLines = plugin.split('\n').filter(line => line.includes('YouTubeConfig.js'));
  const initLine = plugin.split('\n').find(line => line.includes('tag=YouTube initplayback 广告协商清理'));
  assert.equal(configLines.length, 3);
  assert.ok(initLine && !initLine.includes('enable=') && initLine.includes('requires-body=true'));
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
  assert.equal(entries[0].source, 'YouTubeConfig');
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

test('matching initplayback request is authenticated, cleaned, re-encrypted and signed locally without a runtime crypto API', () => {
  const clientKey=Uint8Array.from({length:32},(_,i)=>i+1),encryptKey=Uint8Array.from([9,8,7]);
  const store=new Map();configResponse(store,makeConfig({client:[...clientKey],encrypt:[...encryptKey]}));
  const player={context:{adSignalsInfo:{params:[1]}},playbackContext:{contentPlaybackContext:{adParams:'vast',forceAdParameters:'forced'}}};
  const body=makeEncryptedInit(clientKey,encryptKey,player);
  const result=initPlayback(store,[...encryptKey],youtubeUA,{},body);
  assert.ok(result.output.body instanceof Uint8Array);
  assert.equal(result.output.headers['Content-Length'],undefined);
  assert.equal(result.output.headers['Content-Encoding'],undefined);
  assert.equal(result.output.headers['User-Agent'],youtubeUA);
  const cleaned=decryptPlayer(result.output.body,clientKey);
  assert.equal(cleaned.player.context.adSignalsInfo,undefined);
  assert.equal(cleaned.player.playbackContext.contentPlaybackContext.adParams,undefined);
  assert.equal(cleaned.player.playbackContext.contentPlaybackContext.forceAdParameters,undefined);
  assert.equal(cleaned.player.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,true);
  assert.equal(cleaned.preroll,0);
});

test('gzip-compressed inner request is decompressed, cleaned and recompressed before signing', () => {
  const clientKey=Uint8Array.from({length:32},(_,i)=>i+1),encryptKey=Uint8Array.from([9,8,7]);
  const store=new Map();configResponse(store,makeConfig({client:[...clientKey],encrypt:[...encryptKey]}));
  const player={context:{adSignalsInfo:{params:[1]}},playbackContext:{contentPlaybackContext:{adParams:'vast'}}};
  const body=makeEncryptedInit(clientKey,encryptKey,player,{gzip:true});
  const result=initPlayback(store,[...encryptKey],youtubeUA,{},body,undefined,utilsApi);
  const cleaned=decryptPlayer(result.output.body,clientKey,{gzip:true});
  assert.equal(cleaned.player.context.adSignalsInfo,undefined);
  assert.equal(cleaned.player.playbackContext.contentPlaybackContext.adParams,undefined);
  assert.equal(cleaned.player.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd,true);
  assert.equal(cleaned.preroll,0);
});

test('binary protobuf player body in iOS initplayback is cleaned without changing unknown fields', () => {
  const clientKey=Uint8Array.from({length:32},(_,i)=>i+1),encryptKey=Uint8Array.from([9,8,7]);
  const store=new Map([[logConfigKey,JSON.stringify({enabled:true,session:'protobuf-session'})]]);configResponse(store,makeConfig({client:[...clientKey],encrypt:[...encryptKey]}));
  const body=makeEncryptedInit(clientKey,encryptKey,protobufPlayer(),{protobuf:true,gzip:true});
  const result=initPlayback(store,[...encryptKey],youtubeUA,{capture_raw:true},body,undefined,utilsApi);
  assert.ok(result.output.body instanceof Uint8Array);
  const decrypted=decryptPlayer(result.output.body,clientKey,{gzip:true});
  const player=field(decrypted.plain,3),context=field(player,1),playback=field(player,4),content=field(playback,1);
  assert.equal(fields(context).some(entry=>entry.no===9),false);
  assert.ok(field(context,90));
  assert.equal(fields(content).some(entry=>entry.no===12||entry.no===25),false);
  assert.equal(fields(content).find(entry=>entry.no===50)?.value,1);
  assert.ok(field(content,61));
  assert.ok(field(player,99));
  assert.equal(decrypted.preroll,0);
  const entries=JSON.parse(store.get(logCacheKey)).entries;
  assert.match(entries.at(-1).message,/inner=protobuf/);
});

test('initplayback crypto authentication failure passes through without changing the request', () => {
  const clientKey=Uint8Array.from({length:32},(_,i)=>i+1),encryptKey=Uint8Array.from([9,8,7]);
  const store=new Map();configResponse(store,makeConfig({client:[...clientKey],encrypt:[...encryptKey]}));
  const body=makeEncryptedInit(clientKey,encryptKey,{context:{adSignalsInfo:{}}},{tamper:true});
  const result=initPlayback(store,[...encryptKey],youtubeUA,{},body,cryptoApi);
  assert.deepEqual(Object.keys(result.output),[]);
  assert.equal(store.has(stateKey),true);
});

test('unknown protobuf groups in the decrypted request are preserved byte-for-byte', () => {
  const clientKey=Uint8Array.from({length:32},(_,i)=>i+1),encryptKey=Uint8Array.from([9,8,7]);
  const store=new Map();configResponse(store,makeConfig({client:[...clientKey],encrypt:[...encryptKey]}));
  const group=concat(varint(20*8+3),scalar(1,7),varint(20*8+4));
  const body=makeEncryptedInit(clientKey,encryptKey,{context:{adSignalsInfo:{value:'remove'}}},{unknownGroup:true});
  const result=initPlayback(store,[...encryptKey],youtubeUA,{},body,cryptoApi);
  const plain=decryptPlayer(result.output.body,clientKey).plain;
  assert.notEqual(Buffer.from(plain).indexOf(Buffer.from(group)),-1);
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
  assert.deepEqual(entries.map(entry => entry.source), ['YouTubeConfig','YouTubeConfig']);
  assert.match(entries[1].message, /development capture: pass: invalid-client-key changed=false/);
  assert.ok(entries.every(entry => entry.captureRef));
  assert.ok(entries.every(entry => !entry.message.includes('CQgH')));
});
