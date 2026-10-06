import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../src/YouTubePlayback.js', import.meta.url), 'utf8');
const context = { module: { exports: {} }, Uint8Array, ArrayBuffer };
vm.runInNewContext(source, context);
const { processUMP, readUMPInt, encodeUMPInt } = context.module.exports;
const bytes = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)));
// Fixture builder is independent of the implementation: literal UMP headers
// are used for the short metadata parts, with externally specified integers.
const shortPart = (type, payload) => {
  assert.ok(type < 128 && payload.length < 128);
  return bytes([type, payload.length], payload);
};
const protoMessage = (field, payload) => {
  assert.ok(field < 16 && payload.length < 128);
  return bytes([field * 8 + 2, payload.length], payload);
};
const cueInfo = (type, event) => protoMessage(1, protoMessage(1, [8, type, 16, event]));
const adPrefetch = cueInfo(1, 6);
const normalPrefetch = cueInfo(2, 6);
const adStart = cueInfo(1, 1);
const adStop = cueInfo(1, 3);
const mediaHeader = shortPart(20, [8, 1, 18, 2, 65, 66]);
// Includes bytes looking like an ad cue: they must stay opaque inside media.
const media = shortPart(21, [1, 69, 10, 10, 8, 10, 6, 8, 1, 16, 6, 255]);
const end = shortPart(22, [1]);
const seek = shortPart(45, [8, 100]);
const contextUpdate = shortPart(57, [8, 1, 16, 4, 26, 2, 10, 0]);
const encrypted = shortPart(12, [1, 69, 3, 255]);

for (const [value, encoded] of [
  [0, [0]], [127, [127]], [128, [128, 2]], [16383, [191, 255]],
  [16384, [192, 0, 2]], [2097151, [223, 255, 255]],
  [2097152, [224, 0, 0, 2]], [268435455, [239, 255, 255, 255]],
  [268435456, [240, 0, 0, 0, 16]], [4294967295, [240, 255, 255, 255, 255]]
]) test(`UMP integer reference vector ${value}`, () => {
  assert.deepEqual(Array.from(encodeUMPInt(value)), encoded);
  const cursor = { pos: 0 };
  assert.equal(readUMPInt(Uint8Array.from(encoded), cursor), value);
  assert.equal(cursor.pos, encoded.length);
});

test('inspect never changes the response and counts explicit ad cues', () => {
  const input = bytes(mediaHeader, shortPart(69, bytes(adPrefetch, normalPrefetch, adStart, adStop)), media, end);
  const result = processUMP(input, 'inspect');
  assert.equal(result.body, input);
  assert.equal(result.removed, 0);
  assert.equal(result.summary.adCues, 3);
  assert.equal(result.summary.adPrefetch, 1);
  assert.equal(result.summary.otherAdCues, 2);
});

test('cleanup removes only ad PREFETCH, preserving media and active cues exactly', () => {
  const unknown = shortPart(100, [255, 254]);
  const input = bytes(mediaHeader, shortPart(69, bytes(adPrefetch, normalPrefetch, adStart, adStop)),
    media, end, seek, contextUpdate, encrypted, unknown);
  const original = input.slice();
  const expected = bytes(mediaHeader, shortPart(69, bytes(normalPrefetch, adStart, adStop)),
    media, end, seek, contextUpdate, encrypted, unknown);
  const result = processUMP(input, 'clean_prefetch');
  assert.equal(result.removed, 1);
  assert.deepEqual(Array.from(result.body), Array.from(expected));
  assert.deepEqual(input, original);
});

test('preserves empty CuepointList envelope instead of emptying the response', () => {
  const result = processUMP(shortPart(69, adPrefetch), 'clean_prefetch');
  assert.deepEqual(Array.from(result.body), [69, 0]);
});

test('preserves unknown CuepointList fields and noncanonical untouched framing', () => {
  // Noncanonical two-byte encoding of type 20 and length 1.
  const originalMedia = bytes([0x94, 0x00, 0x81, 0x00, 255]);
  const unknown = bytes([0x12, 0x03, 1, 2, 3]);
  const result = processUMP(bytes(originalMedia, shortPart(69, bytes(adPrefetch, unknown))), 'clean_prefetch');
  assert.deepEqual(Array.from(result.body), Array.from(bytes(originalMedia, shortPart(69, unknown))));
});

test('fixes UMP length across the 127-byte boundary', () => {
  const opaque = bytes([0x12, 120], new Uint8Array(120).fill(42));
  const cueList = bytes(opaque, adPrefetch);
  assert.equal(cueList.length, 130);
  // 130 uses UMP [0x82,0x02], not protobuf [0x82,0x01].
  const input = bytes([69, 0x82, 0x02], cueList, media, end);
  const result = processUMP(input, 'clean_prefetch');
  assert.deepEqual(Array.from(result.body), Array.from(bytes([69, 122], opaque, media, end)));
});

test('does not clean other ad events or a response with no explicit cue list', () => {
  const input = bytes(mediaHeader, media, end, encrypted, seek, contextUpdate);
  assert.equal(processUMP(input, 'clean_prefetch').body, input);
  for (const event of [0, 1, 2, 3, 4, 5, 7]) {
    const fixture = shortPart(69, cueInfo(1, event));
    assert.equal(processUMP(fixture, 'clean_prefetch').body, fixture);
  }
});

for (const [label, input] of [
  ['truncated integer', [69, 128]],
  ['truncated payload', [69, 5, 10]],
  ['malformed cue protobuf', [69, 1, 255]],
  ['wrong list wire type', [69, 2, 8, 1]],
  ['wrong cue scalar type', shortPart(69, protoMessage(1, protoMessage(1, [10, 0, 16, 6])))],
  ['duplicate cuepoint messages', shortPart(69, protoMessage(1, bytes(protoMessage(1, [8, 1, 16, 6]), protoMessage(1, [8, 2]))))]
]) test(`UMP rejects ambiguous data: ${label}`, () => {
  assert.throws(() => processUMP(bytes(input), 'clean_prefetch'));
});

function runtime(body, mode = 'clean_prefetch', capture = true, type = 'application/vnd.yt-ump', url = 'https://rr5.googlevideo.com/videoplayback?ctier=L&sig=PRIVATE_SIG') {
  let output;
  let calls = 0;
  const logs = [];
  vm.runInNewContext(source, {
    Uint8Array, ArrayBuffer, TextDecoder, TextEncoder,
    $request: { url },
    $response: { status: 200, body, headers: { 'Content-Type': type } },
    $argument: { capture_raw: capture, ump_mode: mode, script_debug: true },
    $done(result) { output = result; calls++; }, console: { log(line) { logs.push(line); } }
  }, { timeout: 1000 });
  assert.equal(calls, 1);
  assert.ok(!logs.join('\n').includes('PRIVATE_SIG'));
  assert.ok(logs.every(line => line.startsWith('[YouTubePlayback 1.5.0]')));
  return { output, logs };
}

test('live adapter returns original whole response on later malformed part', () => {
  const input = bytes(shortPart(69, adPrefetch), [21, 10, 1]);
  assert.deepEqual(Object.keys(runtime(input).output), []);
});

test('live adapter has a real cleanup route, inspect default, and follows the development capture switch', () => {
  const input = bytes(shortPart(69, adPrefetch), media, end);
  assert.deepEqual(Array.from(runtime(input).output.body), Array.from(bytes([69, 0], media, end)));
  assert.deepEqual(Object.keys(runtime(input, 'inspect').output), []);
  assert.deepEqual(Object.keys(runtime(input, 'clean_prefetch', false).output), []);
  assert.deepEqual(Object.keys(runtime(input, 'clean_prefetch', true, 'video/mp4').output), []);
  assert.deepEqual(Object.keys(runtime('binary unavailable').output), []);
});

test('UMP resource limits pass the whole original response through', () => {
  assert.deepEqual(Object.keys(runtime(new Uint8Array(8 * 1024 * 1024 + 1)).output), []);
  assert.deepEqual(Object.keys(runtime(new Uint8Array(20002)).output), []);
});

test('merged playback dispatcher leaves unrelated hosts untouched', () => {
  assert.ok(source.includes('function cleanPlayer('));
  assert.ok(source.includes('function cleanJSON('));
  const input = shortPart(69, adPrefetch);
  for (const url of ['https://rr5.googlevideo.com.evil.test/videoplayback?ctier=L',
    'https://example.com/youtubei/v1/player']) {
    const result = runtime(input, 'clean_prefetch', true, 'application/vnd.yt-ump', url);
    assert.deepEqual(Object.keys(result.output), []);
    assert.equal(result.logs.length, 0);
  }
});
