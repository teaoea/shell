/**
 * 功能：在模拟的 Quantumult X 运行时执行其发布包，核对接口转换、路由及与 Loon 发布包一致的清理结果。
 * 更新时间：2026-10-06
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const qxRoot = new URL('../../quantumultx/YouTube/', root);
const read = (name, base = root) => fs.readFileSync(new URL(name, base), 'utf8');
const qx = {request: read('dist/request.min.js', qxRoot), response: read('dist/response.min.js', qxRoot)};
const loon = {request: read('dist/request.min.js'), response: read('dist/response.min.js')};
const snippet = read('YouTubeNoAds.snippet', qxRoot);
const options = JSON.parse(read('options.json', qxRoot));
const api = 'https://youtubei.googleapis.com/youtubei/v1/';
const appAgent = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_0 like Mac OS X)';
const u8 = value => Uint8Array.from(value);
const concat = (...parts) => u8(parts.flatMap(part => Array.from(part)));
const text = value => new TextEncoder().encode(value);
function v(n) {const out = []; do {const b = n % 128; n = Math.floor(n / 128); out.push(b + (n ? 128 : 0));} while (n); return out;}
function msg(field, payload) {return concat(v(field * 8 + 2), v(payload.length), payload);}
function scalar(field, value) {return concat(v(field * 8), v(value));}
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const globals = {Uint8Array, ArrayBuffer, Object, JSON, console:{log() {}}};

/**
 * 功能：以 Quantumult X 的全局对象形式运行发布包；不提供 TextEncoder/TextDecoder，贴近其脚本环境。
 * 更新时间：2026-10-06
 * @param {string} phase 请求或响应阶段。
 * @param {Object} request Quantumult X 请求对象。
 * @param {Object} [response] Quantumult X 响应对象。
 * @param {string} [code] 待执行的发布包文本，默认取该阶段的已发布产物。
 * @returns {Object} 脚本交给 $done 的结果。
 */
function runQX(phase, request, response, code = qx[phase]) {
  let output, calls = 0;
  const store = new Map();
  const context = {...globals, $request:request,
    $prefs:{valueForKey:k => store.has(k) ? store.get(k) : null, setValueForKey(value, key) {store.set(key, value); return true;}, removeValueForKey(key) {store.delete(key); return true;}},
    $done(value) {output = value; calls++;}};
  if (response) context.$response = response;
  vm.runInNewContext(code, context, {timeout:2000});
  assert.equal(calls, 1);
  return output;
}

/**
 * 功能：用相同输入运行 Loon 发布包，作为清理结果的对照；参数取自 Quantumult X 的固定开关。
 * 更新时间：2026-10-06
 * @param {string} phase 请求或响应阶段。
 * @param {Object} request Loon 请求对象。
 * @param {Object} [response] Loon 响应对象。
 * @returns {Object} 脚本交给 $done 的结果。
 */
function runLoon(phase, request, response) {
  let output, calls = 0;
  const context = {...globals, TextEncoder, TextDecoder, $request:request, $argument:{log_enabled:false, ...options},
    $persistentStore:{read() {}, write() {return true;}}, $done(value) {output = value; calls++;}};
  if (response) context.$response = response;
  vm.runInNewContext(loon[phase], context, {timeout:2000});
  assert.equal(calls, 1);
  return output;
}
const bytesOf = value => Array.from(new Uint8Array(value));
// 脚本在独立上下文生成对象，比较前转成当前上下文的普通对象。
const plain = value => JSON.parse(JSON.stringify(value));

test('snippet binds each rule to the matching script type and published bundle', () => {
  const rules = snippet.split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith('hostname'));
  assert.equal(rules.length, 3);
  const [request, response, init] = rules.map(line => {const [pattern, url, type, path] = line.split(' '); assert.equal(url, 'url'); return {regex:new RegExp(pattern), type, path};});
  const base = 'https://raw.githubusercontent.com/falconchen/shell/main/quantumultx/YouTube/dist/';
  assert.deepEqual([request.type, request.path], ['script-request-body', base + 'request.min.js']);
  assert.deepEqual([response.type, response.path], ['script-response-body', base + 'response.min.js']);
  assert.deepEqual([init.type, init.path], ['script-request-header', base + 'request.min.js']);
  for (const name of ['player', 'get_watch', 'player/ad_break']) assert.ok(request.regex.test(api + name + '?prettyPrint=false'));
  for (const name of ['browse', 'next', 'search', 'player', 'get_watch', 'reel/reel_watch_sequence']) assert.ok(response.regex.test('https://www.youtube.com/youtubei/v1/' + name));
  assert.ok(!request.regex.test(api + 'browse') && !response.regex.test(api + 'player/ad_break') && !response.regex.test(api + 'log_event'));
  assert.ok(init.regex.test('https://rr5---sn-abc.googlevideo.com/initplayback?id=1'));
  for (const rule of [request, response, init]) assert.ok(!rule.regex.test('https://rr5---sn-abc.googlevideo.com/videoplayback?ctier=L'));
  const hosts = snippet.split('\n').find(line => line.startsWith('hostname = ')).slice(11).split(', ');
  assert.deepEqual(hosts, ['youtubei.googleapis.com', 'youtubei-att.googleapis.com', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', '*.googlevideo.com']);
});

test('bundles exclude the logging and Onesie modules and carry the fixed options', () => {
  for (const code of Object.values(qx)) {
    assert.ok(!code.includes('youtube-logs.invalid') && !code.includes('ytads.onesie.youtube.v1'));
    assert.ok(code.includes(Object.entries(options).map(([key, value]) => key + ':' + JSON.stringify(value)).join(',')));
  }
});

test('protobuf player request is cleaned exactly like the Loon bundle and returned as bodyBytes', () => {
  const context = concat(msg(1, u8([1, 2, 3])), msg(9, msg(1, u8([4, 5]))), msg(10, u8([6])));
  const content = concat(scalar(4, 0), msg(12, text('output=xml_vast2')), msg(25, u8([9])), msg(31, u8([7])), scalar(44, 1));
  const input = concat(msg(1, context), msg(2, text('video-id')), msg(4, concat(msg(1, content), msg(8, u8([8])))), scalar(5, 1));
  const headers = {'Content-Type':'application/x-protobuf', 'Content-Encoding':'gzip', 'Content-Length':'99', 'X-Test':'kept'};
  for (const name of ['player', 'get_watch']) {
    const body = name === 'player' ? input : concat(msg(1, msg(9, u8([1]))), msg(2, input));
    const expected = runLoon('request', {url:api + name, method:'POST', headers, body});
    const output = runQX('request', {url:api + name, method:'POST', headers, body:'ignored', bodyBytes:buffer(body)});
    assert.ok(expected.body.length && expected.body.length < body.length);
    assert.ok(output.bodyBytes instanceof ArrayBuffer && !('body' in output));
    assert.deepEqual(bytesOf(output.bodyBytes), Array.from(expected.body));
    assert.deepEqual(plain(output.headers), plain(expected.headers));
    assert.equal(output.headers['X-Test'], 'kept');
    assert.ok(!Object.keys(output.headers).some(key => /^content-(?:encoding|length)$/i.test(key)));
  }
});

test('JSON player request uses the string body without a UTF-8 decoder', () => {
  const body = JSON.stringify({context:{adSignalsInfo:{params:[1]}, client:{hl:'zh'}}, playbackContext:{contentPlaybackContext:{adParams:'x', vis:0}}, videoId:'v'});
  const headers = {'content-type':'application/json'};
  const expected = runLoon('request', {url:api + 'player', method:'POST', headers, body});
  const output = runQX('request', {url:api + 'player', method:'POST', headers, body, bodyBytes:buffer(text(body))});
  assert.equal(typeof expected.body, 'string');
  assert.ok(!expected.body.includes('adSignalsInfo') && !expected.body.includes('adParams'));
  assert.deepEqual(plain(output), plain({headers:expected.headers, body:expected.body}));
});

test('ad_break request is answered directly with an empty 200 protobuf response', () => {
  const output = runQX('request', {url:api + 'player/ad_break', method:'POST', headers:{}, bodyBytes:buffer(u8([10, 0]))});
  assert.deepEqual(plain(output), {status:'HTTP/1.1 200 OK', headers:{'Content-Type':'application/x-protobuf', 'Cache-Control':'no-store'}, body:''});
});

test('initplayback returns a trackless MP4 only for the YouTube app POST', () => {
  const url = 'https://rr5---sn-abc.googlevideo.com/initplayback?id=PRIVATE';
  const output = runQX('request', {url, method:'POST', headers:{'user-agent':appAgent}});
  assert.equal(output.status, 'HTTP/1.1 200 OK');
  assert.equal(output.headers['Content-Type'], 'video/mp4');
  const data = new Uint8Array(output.bodyBytes), view = new DataView(output.bodyBytes), name = offset => String.fromCharCode(...data.subarray(offset, offset + 4));
  assert.deepEqual([view.getUint32(0), name(4), view.getUint32(28), name(32), view.getUint32(36), name(40)], [28, 'ftyp', 116, 'moov', 108, 'mvhd']);
  assert.equal(data.length, 144);
  assert.equal(view.getUint32(56), 1000);
  for (const request of [
    {url, method:'GET', headers:{'User-Agent':appAgent}},
    {url, method:'POST', headers:{'User-Agent':'com.google.ios.youtubemusic/8.1'}},
    {url, method:'POST', headers:{'User-Agent':'Mozilla/5.0 (iPhone)'}},
    {url:url.replace('initplayback', 'videoplayback'), method:'POST', headers:{'User-Agent':appAgent}}
  ]) assert.deepEqual(plain(runQX('request', request)), {});
});

test('JSON responses are cleaned like the Loon bundle and stay strings', () => {
  const headers = {'Content-Type':'application/json; charset=UTF-8'};
  const player = JSON.stringify({playabilityStatus:{status:'OK'}, adPlacements:[{}], adSlots:[{}], playerAds:[{}], streamingData:{formats:[{itag:18}]}, videoDetails:{title:'中文标题'}});
  const expected = runLoon('response', {url:api + 'player', method:'POST', headers:{}}, {status:200, headers, body:player});
  const output = runQX('response', {url:api + 'player', method:'POST', headers:{}}, {statusCode:200, headers, body:player, bodyBytes:buffer(text(player))});
  assert.ok(!expected.body.includes('adPlacements') && expected.body.includes('中文标题'));
  assert.deepEqual(plain(output), {body:expected.body});
});

test('protobuf player response removes ad fields like the Loon bundle', () => {
  const headers = {'Content-Type':'application/x-protobuf'};
  const body = concat(msg(2, scalar(1, 0)), msg(7, u8([1, 2])), msg(4, u8([3])), msg(68, u8([4])), msg(11, u8([5])));
  const expected = runLoon('response', {url:api + 'player', method:'POST', headers:{}}, {status:200, headers, body});
  const output = runQX('response', {url:api + 'player', method:'POST', headers:{}}, {statusCode:200, headers, body:'ignored', bodyBytes:buffer(body)});
  assert.ok(expected.body.length && expected.body.length < body.length);
  assert.deepEqual(Object.keys(output), ['bodyBytes']);
  assert.deepEqual(bytesOf(output.bodyBytes), Array.from(expected.body));
});

test('feed and Shorts responses reach their modules and match the Loon bundle', () => {
  const headers = {'Content-Type':'application/json'};
  const browse = JSON.stringify({contents:{singleColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{content:{sectionListRenderer:{contents:[
    {itemSectionRenderer:{contents:[{promotedVideoRenderer:{videoId:'ad'}}]}}, {itemSectionRenderer:{contents:[{videoWithContextRenderer:{videoId:'keep'}}]}}]}}}}]}}});
  const reel = JSON.stringify({entries:[{command:{reelWatchEndpoint:{videoId:'ad', adClientParams:{isAd:true}}}}, {command:{reelWatchEndpoint:{videoId:'keep'}}}]});
  for (const [name, body] of [['browse', browse], ['next', browse], ['search', browse], ['reel/reel_watch_sequence', reel]]) {
    const expected = runLoon('response', {url:api + name, method:'POST', headers:{}}, {status:200, headers, body});
    const output = runQX('response', {url:api + name, method:'POST', headers:{}}, {statusCode:200, headers, body});
    assert.deepEqual(plain(output), plain(expected), name);
  }
  const changed = runQX('response', {url:api + 'reel/reel_watch_sequence', method:'POST', headers:{}}, {statusCode:200, headers, body:reel});
  assert.ok(changed.body.includes('keep') && !changed.body.includes('adClientParams'));
});

test('fixed background playback option changes the player response only when built as enabled', () => {
  const headers = {'Content-Type':'application/json'}, request = {url:api + 'player', method:'POST', headers:{}};
  const body = JSON.stringify({playabilityStatus:{status:'OK', playableInBackground:false}, videoDetails:{videoId:'v'}});
  const enabled = qx.response.replace('background_playback:false', 'background_playback:true');
  assert.notEqual(enabled, qx.response);
  assert.deepEqual(plain(runQX('response', request, {statusCode:200, headers, body})), options.background_playback ? plain(runQX('response', request, {statusCode:200, headers, body}, enabled)) : {});
  assert.equal(JSON.parse(runQX('response', request, {statusCode:200, headers, body}, enabled).body).playabilityStatus.playableInBackground, true);
});

test('unmatched URLs, non-200 responses, empty bodies and wrong phases pass through untouched', () => {
  const headers = {'Content-Type':'application/x-protobuf'};
  assert.deepEqual(plain(runQX('request', {url:api + 'browse', method:'POST', headers, bodyBytes:buffer(u8([10, 0]))})), {});
  assert.deepEqual(plain(runQX('response', {url:api + 'log_event', method:'POST', headers:{}}, {statusCode:200, headers, bodyBytes:buffer(u8([10, 0]))})), {});
  assert.deepEqual(plain(runQX('response', {url:api + 'player', method:'POST', headers:{}}, {statusCode:403, headers, bodyBytes:buffer(msg(7, u8([1])))})), {});
  assert.deepEqual(plain(runQX('response', {url:api + 'player', method:'POST', headers:{}}, {statusCode:200, headers, bodyBytes:new ArrayBuffer(0)})), {});
  assert.deepEqual(plain(runQX('request', {url:api + 'player', method:'POST', headers, bodyBytes:buffer(u8([31, 139, 8, 0, 1, 2]))})), {});
  const guarded = {statusCode:200, headers};
  Object.defineProperty(guarded, 'bodyBytes', {get() {throw Error('must not read body');}});
  assert.deepEqual(plain(runQX('request', {url:api + 'player', method:'POST', headers}, guarded)), {});
  assert.deepEqual(plain(runQX('response', {url:api + 'player', method:'POST', headers})), {});
});
