import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runtimeSource} from '../tools/runtime-source.mjs';

const root = new URL('../', import.meta.url);

test('published phase pruning keeps offline sources and excludes unreachable protocol branches', () => {
  const playback = fs.readFileSync(new URL('src/YouTubePlayback.js', root),'utf8');
  const config = fs.readFileSync(new URL('src/YouTubeConfig.js', root),'utf8');
  assert.ok(playback.includes('module.exports = { processUMP:'));
  assert.ok(config.includes('function aesCtr'));
  for (const phase of ['request','response']) {
    const player = runtimeSource(playback,'YouTubePlayback',phase);
    const configuration = runtimeSource(config,'YouTubeConfig',phase);
    assert.ok(!player.includes('module.exports = { processUMP:'));
    assert.ok(!player.includes('function processUMP('));
    assert.ok(!configuration.includes('function aesCtr'));
    assert.ok(player.includes('player/get_watch') || player.includes('(?:player|get_watch)'));
    new vm.Script(player); new vm.Script(configuration);
  }
  assert.throws(()=>runtimeSource(config.replace('(?:config|log_event)','(?:new_api|log_event)'),'YouTubeConfig','request'),/已改变/);
});

test('the shared dispatcher resolves Stash page-controlled options only once per invocation', () => {
  const code = fs.readFileSync(new URL('dist/request.min.js',root),'utf8');
  let reads = 0, calls = 0;
  vm.runInNewContext(code, {
    $environment:{'stash-version':'test'}, $argument:'log_control=page',
    $request:{url:'https://www.youtube.com/api/timedtext?lang=ja&v=test'},
    $persistentStore:{read(){reads++;return null;},write(){throw Error('must not write');}},
    $done(){calls++;}, console:{log(){}}
  });
  assert.equal(calls,1);assert.equal(reads,1);
});

test('the two published bundles reproduce exactly from current sources and pinned build options', () => {
  const result = spawnSync(process.execPath, [new URL('tools/build.mjs', root).pathname, '--check'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readdirSync(new URL('dist/', root)).sort(), ['request.min.js', 'response.min.js']);
});

test('every plugin rule uses the bundle for its actual phase', () => {
  const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root), 'utf8');
  const lines = plugin.split('\n').filter(line => line.startsWith('http-request ') || line.startsWith('http-response ') || line.startsWith('response if ') || line.startsWith('request if ') && line.includes(' then script('));
  assert.equal(lines.length, 10);
  for (const line of lines) {
    const phase = line.startsWith('http-request ') || line.startsWith('request if ') ? 'request' : 'response';
    assert.ok(line.includes(`https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/dist/${phase}.min.js`));
  }
});

/**
 * 功能：执行原始模块或发布包，比较输出和副作用；固定时钟以避免非业务时间差。
 * 更新时间：2026-10-06
 * @param {string} code 待执行代码。
 * @param {Object} extra 请求、响应和参数样本。
 * @returns {Object} 可比较的输出与副作用。
 */
function execute(code, extra) {
  const store = new Map(), logs = [];
  let calls = 0, output;
  class Clock extends Date {constructor(...args) {super(...(args.length ? args : [1791230400000]));} static now() {return 1791230400000;}}
  vm.runInNewContext(code, {
    Date: Clock, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    $argument: {log_enabled: false},
    $persistentStore: {read(key) {return store.get(key);}, write(value, key) {if (value === undefined) store.delete(key); else store.set(key, value); return true;}},
    console: {log(value) {logs.push(value);}},
    $done(value) {calls++; output = value;}, ...extra
  }, {timeout: 1000});
  assert.equal(calls, 1);
  return JSON.parse(JSON.stringify({output, logs, store: [...store]}));
}

const api = 'https://youtubei.googleapis.com/youtubei/v1/';
for (const [phase, name, extra] of [
  ['request', 'YouTubePlayback', {$request: {url: api+'player', method: 'POST', headers: {'Content-Type':'application/json'}, body: '{"context":{"adSignalsInfo":{}},"playbackContext":{"contentPlaybackContext":{"adParams":"PRIVATE"}}}'}}],
  ['request', 'YouTubePlayback', {$request: {url: api+'player/ad_break', method:'POST'}}],
  ['request', 'YouTubeConfig', {$request: {url: api+'log_event', method:'POST', headers:{'User-Agent':'com.google.ios.youtube/21.39.4'}}}],
  ['request', 'YouTubeLogger', {$request: {url: api+'browse'}}],
  ['request', 'YouTubeLogger', {$request: {url:'http://youtube-logs.invalid/', method:'GET'}}],
  ['request', 'YouTubeLogger', {$request: {url:'https://rr5.googlevideo.com/initplayback?sig=PRIVATE', method:'POST'}}],
  ['response', 'YouTubeFeed', {$request:{url:api+'next'}, $response:{status:200, headers:{'Content-Type':'application/json'}, body:'{"contents":[{"adSlotRenderer":{}},{"videoRenderer":{"title":"normal"}}]}'}}],
  ['response', 'YouTubePlayback', {$request:{url:api+'player'}, $response:{status:200, headers:{'Content-Type':'application/json'}, body:'{"adPlacements":[{}],"videoDetails":{"videoId":"normal"}}'}}],
  ['response', 'YouTubeConfig', {$request:{url:api+'config', headers:{'User-Agent':'com.google.ios.youtube/21.39.4'}}, $response:{status:200, body:new Uint8Array()}}],
  ['response', 'YouTubeLogger', {$request:{url:'https://rr5.googlevideo.com/videoplayback?sig=PRIVATE'}, $response:{status:200, headers:{'Content-Type':'application/vnd.yt-ump'}}}]
]) test(`${phase} entry routes ${extra.$request.url.split('?')[0]} to ${name} without altering its result`, () => {
  const source = fs.readFileSync(new URL(`src/${name}.js`, root), 'utf8');
  const built = fs.readFileSync(new URL(`dist/${phase}.min.js`, root), 'utf8');
  assert.deepEqual(execute(built, extra), execute(source, extra));
});

for (const phase of ['request', 'response']) test(`${phase} entry rejects execution in the wrong phase without touching response bodies`, () => {
  const extra = {$request:{url:api+'player'}};
  if (phase === 'request') {
    extra.$response = {status:200};
    Object.defineProperty(extra.$response, 'body', {get() {throw Error('must not read body');}});
  }
  const built = fs.readFileSync(new URL(`dist/${phase}.min.js`, root), 'utf8');
  assert.deepEqual(execute(built, extra), {output:{}, logs:[], store:[]});
});

for (const phase of ['request', 'response']) test(`${phase} media sampling is fully off with logging disabled, regardless of saved mode`, () => {
  const built = fs.readFileSync(new URL(`dist/${phase}.min.js`, root), 'utf8');
  for (const endpoint of ['videoplayback', 'initplayback']) for (const enabled of [false, 'false', undefined]) {
    let calls = 0, output;
    const request = {url: `https://rr5.googlevideo.com/${endpoint}?sig=PRIVATE`, method:'POST'};
    const response = {status:200};
    for (const value of [request, response]) for (const field of ['body', 'headers']) Object.defineProperty(value, field, {get() {throw Error('disabled sampling must not read media');}});
    const argument = {log_enabled:enabled, capture_raw:true};
    Object.defineProperty(argument, 'media_capture_mode', {get() {throw Error('disabled sampling must not consult mode');}});
    class NoClock {constructor() {throw Error('logger must not initialize');} static now() {throw Error('logger must not initialize');}}
    const context = {
      Date:NoClock, $request:request, $argument:argument,
      $persistentStore:{read() {throw Error('must not read cache');}, write() {throw Error('must not write cache');}},
      $done(value) {calls++; output = value;}
    };
    if (phase === 'response') context.$response = response;
    vm.runInNewContext(built, context, {timeout:1000});
    assert.equal(calls, 1);assert.deepEqual(Object.keys(output), []);
  }
});
