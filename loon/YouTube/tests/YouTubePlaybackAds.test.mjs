import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../YouTubePlayback.js', import.meta.url), 'utf8');
const plugin = fs.readFileSync(new URL('../YouTubeNoAds.plugin', import.meta.url), 'utf8');
const prefix = 'https://youtubei.googleapis.com/youtubei/v1/';
const u8 = value => Uint8Array.from(value);
const concat = (...parts) => u8(parts.flatMap(part => Array.from(part)));
function v(n) {
  const result = [];
  while (n >= 128) { result.push((n % 128) + 128); n = Math.floor(n / 128); }
  return [...result, n];
}
function msg(field, payload) {
  return concat(v(field * 8 + 2), v(payload.length), payload);
}
function scalar(field, value) {
  return concat(v(field * 8), v(value));
}
// Unknown payload deliberately contains ad-looking tags; it must not be
// recursively interpreted without a known enclosing message schema.
const opaque = msg(99, [0x3a, 0x00, 0xa2, 0x04, 0x00, 0xff]);
const status = u8([0x12, 0x02, 0x08, 0x00]);
const backgroundRenderer = msg(11, msg(64657230, scalar(1, 1)));
const statusBackground = msg(2, concat([0x08, 0x00, 0x20, 0x01], backgroundRenderer));
const clean = concat(status, opaque);
const ad = concat([0x3a, 0x03, 0x08, 0x01, 0x10], [0xa2, 0x04, 0x00]);
const player = concat(status, ad, opaque, [0x3a, 0x00]);

function run(body, { endpoint = 'player', host = 'youtubei.googleapis.com',
  url = `https://${host}/youtubei/v1/${endpoint}`, type = 'application/x-protobuf',
  statusCode = 200, debug = true, response = true, background = false } = {}) {
  let output;
  let calls = 0;
  const logs = [];
  const original = typeof body === 'string' ? body : body && ArrayBuffer.isView(body) ? Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)) : null;
  const context = {
    $request: { url },
    $argument: { script_debug: debug, background_playback: background },
    $done(value) { calls++; output = value; },
    console: { log(value) { logs.push(value); } },
    Uint8Array, ArrayBuffer, TextDecoder, TextEncoder
  };
  if (response) context.$response = { body, status: statusCode, headers: { 'Content-Type': type } };
  vm.runInNewContext(source, context, { timeout: 1000 });
  assert.equal(calls, 1, 'every execution must finish exactly once');
  if (original && typeof original !== 'string') {
    assert.deepEqual(Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)), original, 'input buffer must not be mutated');
  }
  return { output, logs };
}
function passed(result) {
  assert.deepEqual(Object.keys(result.output), [], 'must return no changes');
}

test('plugin defaults media sampling to headers and buffers only explicitly selected full sampling', () => {
  const allEntries = plugin.split('\n').filter(line => /^http-response /.test(line));
  assert.equal(allEntries.length, 4);
  const entries = [
    allEntries.find(line => line.includes('tag=YouTube 播放响应与后台播放')),
    allEntries.find(line => line.includes('tag=YouTube 日志媒体响应记录'))
  ];
  assert.equal(entries.length, 2);
  assert.ok(entries[0].includes('script-path=https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubePlayback.js'));
  assert.ok(entries[0].includes('requires-body=true,binary-body-mode=true'));
  assert.ok(entries[0].includes('argument=[{log_enabled},{log_level},{capture_budget},{background_playback}]'));
  const regex = new RegExp(entries[0].split(' ')[1], 'i');
  for (const host of ['youtubei.googleapis.com', 'youtubei-att.googleapis.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube.com']) {
    assert.ok(regex.test(`https://${host}/youtubei/v1/player?key=redacted`));
    assert.ok(regex.test(`https://${host}/youtubei/v1/get_watch`));
  }
  for (const url of [prefix + 'browse', prefix + 'player/extra',
    'https://youtubei.googleapis.com.evil.test/youtubei/v1/player',
    'https://rr5.googlevideo.com/videoplayback?ctier=L&sabr=1&c=IOS']) assert.equal(regex.test(url), false);
  const active = plugin.split('\n').filter(line => !line.startsWith('#')).join('\n');
  assert.ok(active.split('[Mitm]')[1].includes('*.googlevideo.com'));
  assert.ok(active.includes('background_playback = switch,false,'));
  assert.ok(!active.includes('ump_enabled = switch,false,'));
  assert.ok(entries[1].includes('enable={log_enabled}'));
  assert.ok(entries[1].includes('YouTubeLogger.js,requires-body=false'));
  assert.ok(plugin.includes('media_capture_mode = select,"headers","full"'));
  const full=plugin.split('\n').find(line=>line.startsWith('response if '));
  assert.ok(full.includes('${log_enabled} == true') && full.includes('${media_capture_mode} == "full"'));
  assert.ok(full.includes('requires_body=true, binary_body_mode=true'));
  assert.ok(plugin.indexOf(full)<plugin.indexOf(entries[1]),'full sampling must precede header fallback');
  assert.ok(!plugin.includes('ump_mode ='));
  assert.ok(entries[1].includes('argument=[{log_enabled},{log_level},{capture_budget}]'));
  assert.ok(entries[1].includes('script-path=https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeLogger.js'));
  assert.ok(source.includes('function processUMP('));
  assert.ok(new RegExp(entries[1].split(' ')[1]).test('https://rr5.googlevideo.com/videoplayback?ctier=L&sabr=1'));
  assert.ok(active.includes('DOMAIN-SUFFIX,googlevideo.com'));
  assert.ok(!active.includes('reject(502)'));
  assert.ok(!active.includes('Maasea'));
  assert.ok(!source.includes('$httpClient'));
  assert.ok(source.includes('$persistentStore'), 'optional local logging uses Loon storage');
});

for (const host of ['youtubei.googleapis.com', 'youtubei-att.googleapis.com']) {
  test(`${host}: player removes repeated ads, preserves exact non-ad bytes`, () => {
    const { output } = run(player, { host });
    assert.deepEqual(Array.from(output.body), Array.from(clean));
  });
  test(`${host}: get_watch preserves siblings and repeated content records`, () => {
    const sibling = msg(3, [0x3a, 0x00]);
    const input = concat(msg(1, concat(msg(2, player), sibling)), opaque, msg(1, msg(2, player)));
    const expected = concat(msg(1, concat(msg(2, clean), sibling)), opaque, msg(1, msg(2, clean)));
    assert.deepEqual(Array.from(run(input, { host, endpoint: 'get_watch' }).output.body), Array.from(expected));
  });
}

test('preserves all supported unknown wire types and 64-bit varints exactly', () => {
  const unknown = concat([0x50, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01],
    [0x59, 1, 2, 3, 4, 5, 6, 7, 8], [0x65, 9, 8, 7, 6], opaque,
    // A noncanonical but valid unknown tag/value varint is preserved raw.
    [0xf0, 0x00, 0x81, 0x00]);
  assert.deepEqual(Array.from(run(concat(status, unknown, ad)).output.body), Array.from(concat(status, unknown)));
});

test('repairs nested lengths across the 127-byte boundary', () => {
  const bigOpaque = msg(99, new Uint8Array(100).fill(42));
  const inputPlayer = concat(status, bigOpaque, msg(7, new Uint8Array(100).fill(1)));
  const expected = msg(1, msg(2, concat(status, bigOpaque)));
  const input = msg(1, msg(2, inputPlayer));
  assert.deepEqual(Array.from(run(input, { endpoint: 'get_watch' }).output.body), Array.from(expected));
});

test('preserves byte-view offsets and accepts ArrayBuffer input', () => {
  const padded = concat([99, 98], player, [97, 96]);
  const offsetView = new DataView(padded.buffer, 2, player.length);
  assert.deepEqual(Array.from(run(offsetView).output.body), Array.from(clean));
  assert.deepEqual(Array.from(run(player.buffer.slice(0)).output.body), Array.from(clean));
});

test('background switch adds the explicit Protobuf capability and keeps unknown bytes', () => {
  const result = run(clean, { background: true });
  assert.deepEqual(Array.from(result.output.body), Array.from(concat(statusBackground, opaque)));
  assert.ok(result.logs.some(line => line.includes('removed=0 background_modified=1')));
});

test('background switch enables false value, preserves true value, and collapses duplicates', () => {
  const falseStatus = msg(2, [0x08, 0x00, 0x20, 0x00]);
  assert.deepEqual(Array.from(run(concat(falseStatus, opaque), { background: true }).output.body),
    Array.from(concat(statusBackground, opaque)));
  passed(run(concat(statusBackground, opaque), { background: true }));
  const duplicate = msg(2, [0x08, 0x00, 0x20, 0x01, 0x2a, 0x01, 0x7f, 0x20, 0x00]);
  const expected = msg(2, concat([0x08, 0x00, 0x20, 0x01, 0x2a, 0x01, 0x7f], backgroundRenderer));
  assert.deepEqual(Array.from(run(concat(duplicate, opaque), { background: true }).output.body),
    Array.from(concat(expected, opaque)));
});

test('background switch modifies get_watch and repairs enclosing lengths', () => {
  const bigOpaque = msg(99, new Uint8Array(110).fill(42));
  const input = msg(1, msg(2, concat(status, bigOpaque)));
  const expected = msg(1, msg(2, concat(statusBackground, bigOpaque)));
  assert.deepEqual(Array.from(run(input, { endpoint: 'get_watch', background: true }).output.body), Array.from(expected));
});

test('background switch rejects a mismatched capability wire type without partial ad cleanup', () => {
  const invalidStatus = msg(2, [0x08, 0x00, 0x22, 0x00]);
  passed(run(concat(invalidStatus, ad), { background: true }));
});

test('JSON strips only player ad metadata, preserves playback/configuration', () => {
  const payload = {
    playabilityStatus: { status: 'OK' }, adPlacements: [{}], adSlots: [{}], playerAds: [{}],
    adBreakHeartbeatParams: 'drop', adParams: 'drop',
    playerConfig: {adPlacementConfig:{enabled:true},adSignalsConfig:{token:'drop'},keep:'value'},
    streamingData: { serverAbrStreamingUrl: 'https://rr5.googlevideo.com/videoplayback?ctier=L&sig=secret' },
    captions: { language: 'zh' }, unrelated: { adSlots: ['keep'], value: 3 },
    playbackTracking: { videostatsPlaybackUrl: { baseUrl: 'https://s.youtube.com/example' } }
  };
  const result = run(JSON.stringify(payload), { type: 'application/json' });
  const output = JSON.parse(result.output.body);
  const expected = structuredClone(payload);
  delete expected.adPlacements; delete expected.adSlots; delete expected.playerAds;
  delete expected.adBreakHeartbeatParams; delete expected.adParams;
  delete expected.playerConfig.adPlacementConfig; delete expected.playerConfig.adSignalsConfig;
  assert.deepEqual(output, expected);
});

test('removes pagead view-through tracking while preserving other tracking URLs', () => {
  const tracking = msg(9, concat(msg(1, [1]), msg(18, [2]), msg(5, [3])));
  const input = concat(status, tracking, opaque);
  const expected = concat(status, msg(9, concat(msg(1, [1]), msg(5, [3]))), opaque);
  assert.deepEqual(Array.from(run(input).output.body), Array.from(expected));
  const payload = {playabilityStatus:{status:'OK'},playbackTracking:{pageadViewthroughconversion:{baseUrl:'drop'},qoeUrl:{baseUrl:'keep'}}};
  assert.deepEqual(JSON.parse(run(JSON.stringify(payload),{type:'application/json'}).output.body),
    {playabilityStatus:{status:'OK'},playbackTracking:{qoeUrl:{baseUrl:'keep'}}});
  assert.ok(run(input).logs.some(line => line.includes('tracking_removed=1')));
});

test('JSON get_watch supports arrays and named player wrappers, including UTF-8 bytes', () => {
  const payload = [{ playerResponse: { adPlacements: [1], videoDetails: { title: '测试影片' } } },
    { content: { player: { adSlots: [2], streamingData: { value: 'keep' } } } },
    { unrelated: { adSlots: [3] } }];
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const result = run(encoded, { type: 'application/json; charset=utf-8', endpoint: 'get_watch' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result.output.body)), [
    { playerResponse: { videoDetails: { title: '测试影片' } } },
    { content: { player: { streamingData: { value: 'keep' } } } },
    { unrelated: { adSlots: [3] } }
  ]);
});

test('JSON background switch changes only recognized player objects', () => {
  const payload = {
    playerResponse: { playabilityStatus: { status: 'OK', playableInBackground: false }, videoDetails: { title: 'keep' } },
    unrelated: { playabilityStatus: { status: 'OK', playableInBackground: false } }
  };
  const result = run(JSON.stringify(payload), { endpoint: 'get_watch', type: 'application/json', background: true });
  const output = JSON.parse(result.output.body);
  assert.equal(output.playerResponse.playabilityStatus.playableInBackground, true);
  assert.equal(output.unrelated.playabilityStatus.playableInBackground, false);
});

test('JSON background switch defaults off and requires direct plus nested capabilities', () => {
  const disabled = JSON.stringify({ playabilityStatus: { status: 'OK', playableInBackground: false } });
  passed(run(disabled, { type: 'application/json' }));
  const enabled = JSON.stringify({ playabilityStatus: { status: 'OK', playableInBackground: true } });
  const changed = JSON.parse(run(enabled, { type: 'application/json', background: true }).output.body);
  assert.equal(changed.playabilityStatus.backgroundPlayerRender.backgroundAbility.active, true);
  passed(run(JSON.stringify(changed), { type: 'application/json', background: true }));
});

for (const [label, body, options] of [
  ['no ads', clean, {}],
  ['unknown player schema', concat(ad, opaque), {}],
  ['wrong ad wire type', concat(status, [0x38, 0x01]), {}],
  ['wrong status wire type', concat([0x10, 0x01], ad), {}],
  ['invalid playability schema', concat(msg(2, [0x0a, 0x00]), ad), {}],
  ['invalid field tag', concat(player, [0x00]), {}],
  ['truncated field after ads', concat(player, [0x22, 0x04, 0x01]), {}],
  ['truncated fixed32', concat(player, [0x65, 0x01]), {}],
  ['deprecated group', concat(player, [0x53, 0x08, 0x01, 0x54]), {}],
  ['oversized uint32', concat(player, [0x80, 0x80, 0x80, 0x80, 0x10]), {}],
  ['oversized uint64', concat(player, [0x50, ...new Array(9).fill(0xff), 0x02]), {}],
  ['malformed nested watch message', concat(msg(1, msg(2, player)), msg(1, [0x12, 0x04, 0x01])), { endpoint: 'get_watch' }],
  ['wrong watch root wire type', concat([0x08, 0x01], msg(1, msg(2, player))), { endpoint: 'get_watch' }],
  ['non-200', player, { statusCode: 403 }],
  ['UMP API response', player, { type: 'application/vnd.yt-ump' }],
  ['media URL', player, { url: 'https://rr5.googlevideo.com/videoplayback?ctier=L&sabr=1&c=IOS' }],
  ['unrelated host', player, { url: 'https://evil.test/youtubei/v1/player' }],
  ['HTML', player, { type: 'text/html' }],
  ['gzip bytes', u8([31, 139, 8, 0]), {}],
  ['invalid JSON', '{"adPlacements":[', { type: 'application/json' }],
  ['invalid UTF-8 JSON', u8([0xff, 0xfe]), { type: 'application/json' }],
  ['unchanged JSON formatting', ' { "value" : 123 } ', { type: 'application/json' }],
  ['no body', undefined, {}],
  ['empty body', u8([]), {}],
  ['request phase', player, { response: false }],
  ['oversized response', new Uint8Array(2 * 1024 * 1024 + 1), {}],
]) test(`pass-through: ${label}`, () => passed(run(body, options)));

test('resource limits discard all candidate changes', () => {
  const manyFields = concat(status, ad, new Uint8Array(60002).fill(8).map((n, i) => i % 2 ? 0 : n));
  passed(run(manyFields));
  let deep = { adSlots: [] };
  for (let i = 0; i < 66; i++) deep = { nested: deep };
  passed(run(JSON.stringify({ adPlacements: [1], deep }), { type: 'application/json' }));
  passed(run(JSON.stringify({ adPlacements: [1], largeArray: Array.from({ length: 20001 }, () => ({})) }), { type: 'application/json' }));
});

test('logs contain counts only, and debug switch suppresses them', () => {
  const url = prefix + 'player?key=PRIVATE_KEY&sig=PRIVATE_SIGNATURE';
  const result = run(player, { url });
  assert.ok(result.logs.some(line => line.includes('removed=3')));
  assert.ok(result.logs.some(line => line.includes('background_modified=0')));
  assert.ok(result.logs.every(line => line.startsWith('[YouTubePlayback 2.2.0]')));
  assert.ok(!result.logs.join('\n').includes('PRIVATE'));
  const invalid = run('{"PRIVATE_BODY":', { type: 'application/json' });
  assert.ok(!invalid.logs.join('\n').includes('PRIVATE_BODY'));
  assert.equal(run(player, { debug: false }).logs.length, 0);
});

test('player response diagnostics list only bounded field numbers and wire types',()=>{
 const result=run(clean);
 assert.ok(result.logs.some(line=>line.includes('player_fields=2/2,99/2')));
 assert.equal(result.output.body,undefined);
});
