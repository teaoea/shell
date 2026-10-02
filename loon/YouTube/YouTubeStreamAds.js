/*
 * YouTubeStreamAds 1.3.0 — UMP stream ad PREFETCH cue cleanup experiment.
 * Handles googlevideo /videoplayback only; disabled by default in the plugin.
 * Does not remove ad media already transmitted or implement instant ad skip.
 * No imports, remote calls, redirects, or playback API processing.
 * Shared wire helpers are included here so Loon can run this file directly.
 */
(function () {
  "use strict";

  var VERSION = "1.3.0";
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var debug = args.script_debug !== false && args.script_debug !== "false";
  var endpoint = "unknown";
  var MAX_UMP_BYTES = 8 * 1024 * 1024;
  var MAX_UMP_PARTS = 10000;
  var MEDIA_API = /^https:\/\/[\w-]+\.googlevideo\.com\/videoplayback\?[^#]*$/i;

  // Optional shared local log collection controlled by the main plugin.
  // One bounded cache retains source/level tags; failures never alter playback.
  function saveLog(message) {
    try {
      if (args.log_enabled !== true && args.log_enabled !== "true") return;
      if (typeof $persistentStore === "undefined") return;
      var ranks = {debug:0, info:1, warn:2, error:3};
      var level = message.indexOf("changed:") === 0 ? "info" :
        message === "pass: parse/schema check failed" ? "error" :
        /^(pass: (removed=|mode=|non-UMP))/.test(message) ? "debug" : "warn";
      var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
      if (ranks[level] < ranks[minimum]) return;
      var rawConfig = $persistentStore.read("ytads.logger.config.v1");
      if (!rawConfig || rawConfig.length > 2048) return;
      var config = JSON.parse(rawConfig);
      if (!config || config.enabled !== true || typeof config.session !== "string" || !/^[a-z0-9-]{1,80}$/.test(config.session)) return;
      var key = "ytads.logger.entries.v2";
      var raw = $persistentStore.read(key);
      var state = raw && raw.length <= 131072 ? JSON.parse(raw) : null;
      var entries = state && state.session === config.session && Array.isArray(state.entries) ? state.entries.slice(-599) : [];
      entries.push({source:"YouTubeStreamAds", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message.slice(0, 600)});
      var serialized = JSON.stringify({session:config.session, entries:entries});
      while (serialized.length > 131072 && entries.length > 1) {
        entries.shift();
        serialized = JSON.stringify({session:config.session, entries:entries});
      }
      if ($persistentStore.write(serialized, key) !== true && debug && typeof console !== "undefined") console.log("[YouTubeStreamAds] local-log-write-failed");
    } catch (_) {
      // A broken log store must not prevent $done from committing ad cleanup.
      if (debug && typeof console !== "undefined") console.log("[YouTubeStreamAds] local-log-store-unavailable");
    }
  }

  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubeStreamAds " + VERSION + "] " + endpoint + " " + message);
    }
  }

  function fail(code) {
    var error = new Error(code);
    error.ytNoAdsCode = code;
    throw error;
  }

  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return String(headers[keys[i]]).toLowerCase();
    }
    return "";
  }

  function bytesOf(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return null;
  }

  // Only tags and lengths need numeric decoding. Unknown 64-bit values are
  // skipped as raw varints, avoiding JavaScript integer precision loss.
  function read32(bytes, cursor) {
    var value = 0;
    var scale = 1;
    for (var i = 0; i < 5; i++) {
      if (cursor.pos >= bytes.length) fail("truncated-varint");
      var b = bytes[cursor.pos++];
      if (i === 4 && b > 15) fail("uint32-overflow");
      value += (b & 127) * scale;
      if (!(b & 128)) return value;
      scale *= 128;
    }
    fail("invalid-varint");
  }

  function skip64(bytes, cursor) {
    for (var i = 0; i < 10; i++) {
      if (cursor.pos >= bytes.length) fail("truncated-varint");
      var b = bytes[cursor.pos++];
      if (i === 9 && b > 1) fail("uint64-overflow");
      if (!(b & 128)) return;
    }
    fail("invalid-varint");
  }

  function parse(bytes, budget) {
    var cursor = { pos: 0 };
    var records = [];
    while (cursor.pos < bytes.length) {
      if (++budget.fields > MAX_FIELDS) fail("field-limit");
      var start = cursor.pos;
      var tag = read32(bytes, cursor);
      var no = Math.floor(tag / 8);
      var wire = tag % 8;
      if (no < 1 || no > 536870911) fail("invalid-tag");
      var tagEnd = cursor.pos;
      var payloadStart = cursor.pos;
      if (wire === 0) skip64(bytes, cursor);
      else if (wire === 1) cursor.pos += 8;
      else if (wire === 2) {
        var length = read32(bytes, cursor);
        payloadStart = cursor.pos;
        if (length > bytes.length - cursor.pos) fail("truncated-field");
        cursor.pos += length;
      } else if (wire === 5) cursor.pos += 4;
      // Deprecated groups have no expected use here. Pass the entire original
      // response through rather than guessing at a different message layout.
      else fail("unsupported-wire-type");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({ no: no, wire: wire, start: start, tagEnd: tagEnd,
        payloadStart: payloadStart, end: cursor.pos });
    }
    return records;
  }

  function join(parts) {
    var length = 0;
    for (var i = 0; i < parts.length; i++) length += parts[i].length;
    var out = new Uint8Array(length);
    var pos = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], pos);
      pos += parts[j].length;
    }
    return out;
  }

  // UMP framing uses leading-prefix integers, NOT Protobuf varints. Payload
  // lengths delimit entire parts; media bytes are never scanned as protobuf.
  function readUMPInt(bytes, cursor) {
    if (cursor.pos >= bytes.length) fail("ump-truncated-integer");
    var first = bytes[cursor.pos++];
    var size = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
    var bits = 8 - size;
    var value = size === 5 ? 0 : first % Math.pow(2, bits);
    var scale = size === 5 ? 1 : Math.pow(2, bits);
    for (var i = 1; i < size; i++) {
      if (cursor.pos >= bytes.length) fail("ump-truncated-integer");
      value += bytes[cursor.pos++] * scale;
      scale *= 256;
    }
    return value;
  }

  function encodeUMPInt(value) {
    var size = value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5;
    var out = new Uint8Array(size);
    if (size === 5) out[0] = 240;
    else {
      var base = Math.pow(2, 8 - size);
      out[0] = (size === 1 ? 0 : 256 - Math.pow(2, 9 - size)) + value % base;
      value = Math.floor(value / base);
    }
    for (var i = 1; i < size; i++) {
      out[i] = value % 256;
      value = Math.floor(value / 256);
    }
    return out;
  }

  function scalar32(bytes, record) {
    if (record.wire !== 0) fail("cue-schema-mismatch");
    var cursor = { pos: record.payloadStart };
    var value = read32(bytes, cursor);
    if (cursor.pos !== record.end) fail("cue-scalar-mismatch");
    return value;
  }

  function inspectCueInfo(bytes, budget, summary) {
    var records = parse(bytes, budget);
    var cue = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].no !== 1) continue;
      if (records[i].wire !== 2) fail("cue-info-schema-mismatch");
      // Multiple singular messages have protobuf merge semantics. Do not
      // delete an ambiguous merged Cuepoint without a verified schema sample.
      if (cue) fail("duplicate-cuepoint");
      cue = records[i];
    }
    if (!cue) return false;
    var payload = bytes.subarray(cue.payloadStart, cue.end);
    var fields = parse(payload, budget);
    var type = 0;
    var event = 0;
    for (var j = 0; j < fields.length; j++) {
      if (fields[j].no === 1) type = scalar32(payload, fields[j]);
      if (fields[j].no === 2) event = scalar32(payload, fields[j]);
    }
    var prefetch = type === 1 && event === 6;
    if (type === 1) {
      summary.adCues++;
      if (prefetch) summary.adPrefetch++;
      else summary.otherAdCues++;
    }
    return prefetch;
  }

  function cleanCueList(bytes, budget, summary, modify) {
    var records = parse(bytes, budget);
    var parts = [];
    var removed = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var prefetch = false;
      if (r.no === 1) {
        if (r.wire !== 2) fail("cue-list-schema-mismatch");
        prefetch = inspectCueInfo(bytes.subarray(r.payloadStart, r.end), budget, summary);
      }
      if (modify && prefetch) removed++;
      else parts.push(bytes.subarray(r.start, r.end));
    }
    return { body: removed ? join(parts) : bytes, removed: removed };
  }

  function processUMP(bytes, mode) {
    if (!(bytes instanceof Uint8Array)) fail("ump-needs-binary");
    if (bytes.length > MAX_UMP_BYTES) fail("ump-size-limit");
    if (mode !== "inspect" && mode !== "clean_prefetch") fail("ump-unknown-mode");
    var cursor = { pos: 0 };
    var parts = [];
    var removed = 0;
    var count = 0;
    var budget = { fields: 0 };
    var summary = { partCounts: {}, adCues: 0, adPrefetch: 0, otherAdCues: 0 };
    while (cursor.pos < bytes.length) {
      if (++count > MAX_UMP_PARTS) fail("ump-part-limit");
      var start = cursor.pos;
      var type = readUMPInt(bytes, cursor);
      var typeEnd = cursor.pos;
      var length = readUMPInt(bytes, cursor);
      var payloadStart = cursor.pos;
      if (length > bytes.length - cursor.pos) fail("ump-truncated-part");
      cursor.pos += length;
      summary.partCounts[type] = (summary.partCounts[type] || 0) + 1;
      if (Object.keys(summary.partCounts).length > 128) fail("ump-type-limit");
      // Only CuepointList (69) is a cleanup target. Preserve all media,
      // headers/end markers, seek commands, contexts, and encrypted parts.
      if (type === 69) {
        var result = cleanCueList(bytes.subarray(payloadStart, cursor.pos), budget, summary, mode === "clean_prefetch");
        removed += result.removed;
        parts.push(result.removed ? join([bytes.subarray(start, typeEnd), encodeUMPInt(result.body.length), result.body]) : bytes.subarray(start, cursor.pos));
      } else parts.push(bytes.subarray(start, cursor.pos));
    }
    return { body: removed ? join(parts) : bytes, removed: removed, summary: summary };
  }

  function runUMP() {
    endpoint = "ump";
    if (args.ump_enabled !== true && args.ump_enabled !== "true") return {};
    var type = header($response.headers, "content-type").split(";")[0].trim();
    if (type !== "application/vnd.yt-ump") { log("pass: non-UMP"); return {}; }
    if (Number($response.status) !== 200) { log("pass: non-200"); return {}; }
    var bytes = bytesOf($response.body);
    if (!bytes) { log("pass: ump-needs-binary"); return {}; }
    var result = processUMP(bytes, args.ump_mode || "inspect");
    var summary = result.summary;
    var ids = Object.keys(summary.partCounts).sort(function (a, b) { return Number(a) - Number(b); });
    var partCounts = ids.slice(0, 24).map(function (id) { return id + ":" + summary.partCounts[id]; }).join(",");
    log((result.removed ? "changed" : "pass") + ": mode=" + (args.ump_mode || "inspect") +
      " removed_prefetch=" + result.removed + " ad_cues=" + summary.adCues +
      " ad_prefetch=" + summary.adPrefetch + " other_ad_cues=" + summary.otherAdCues +
      " bytes=" + bytes.length + " parts=" + partCounts + (ids.length > 24 ? ",..." : ""));
    return result.removed ? { body: result.body } : {};
  }

  function run() {
    if (typeof $request === "undefined" || typeof $response === "undefined" || !MEDIA_API.test($request.url || "")) return {};
    return runUMP();
  }

  // Offline tests use exactly the same code, without Node or third-party imports.
  if (typeof module !== "undefined" && module.exports && typeof $done === "undefined") {
    module.exports = { processUMP: processUMP, readUMPInt: readUMPInt, encodeUMPInt: encodeUMPInt };
    return;
  }

  var output = {};
  try { output = run(); }
  catch (error) {
    // Do not log exception messages from JSON/UTF-8 parsers: they may contain
    // pieces of response data. Failed parsing leaves the complete body intact.
    log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));
  }
  $done(output);
})();
