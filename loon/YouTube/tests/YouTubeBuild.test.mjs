import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);

test('the two published bundles reproduce exactly from current sources and pinned build options', () => {
  const result = spawnSync(process.execPath, [new URL('tools/build.mjs', root).pathname, '--check'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readdirSync(new URL('dist/', root)).sort(), ['request.min.js', 'response.min.js']);
});

test('every plugin rule uses the bundle for its actual phase', () => {
  const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root), 'utf8');
  const lines = plugin.split('\n').filter(line => line.startsWith('http-request ') || line.startsWith('http-response ') || line.startsWith('response if '));
  assert.equal(lines.length, 8);
  for (const line of lines) {
    const phase = line.startsWith('http-request ') ? 'request' : 'response';
    assert.ok(line.includes(`https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/dist/${phase}.min.js`));
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
