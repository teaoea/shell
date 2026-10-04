/*
 * YouTubeStreamAds 1.5.0 — UMP stream capture and ad PREFETCH cue cleanup experiment.
 * Handles googlevideo /videoplayback only; enabled together with development capture.
 * Does not remove ad media already transmitted or implement instant ad skip.
 * No imports, remote calls, redirects, or playback API processing.
 * Shared wire helpers are included here so Loon can run this file directly.
 */
(function () {
  "use strict";

  var VERSION = "1.5.0";
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var debug = args.script_debug === true || args.script_debug === "true";
  var endpoint = "unknown";
  var MAX_UMP_BYTES = 8 * 1024 * 1024;
  var MAX_UMP_PARTS = 10000;
  var MEDIA_API = /^https:\/\/[\w-]+\.googlevideo\.com\/videoplayback\?[^#]*$/i;

  var devMessages = [];
  var devException = null;
  function devFailure(error) {
    if (!devFlag(args.capture_raw)) return;
    try { devException = {name:String(error.name || "Error"), message:String(error.message || ""), stack:typeof error.stack === "string" ? error.stack : null, code:error.ytNoAdsCode || null}; } catch (_) {}
  }
  var devStarted = Date.now();

  function devFlag(value) { return value === true || value === "true"; }
  function devConfig() {
    if (!devFlag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read("ytads.logger.config.v1");
    var c = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null;
  }
  function devUTF8Size(text) {
    var size = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { size += 4; i++; }
      else size += 3;
    }
    return size;
  }
  function devBase64(bytes) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var parts = [], text = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      text += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < bytes.length ? alphabet[c & 63] : "=");
      if (text.length >= 32768) { parts.push(text); text = ""; }
    }
    parts.push(text);
    return parts.join("");
  }
  function devBody(body) {
    if (body === undefined || body === null) return {available:false, reason:"not-provided-by-runtime"};
    if (typeof body === "string") {
      var size = devUTF8Size(body);
      if (size > 8388608) throw new Error("capture-body-limit");
      return {available:true, encoding:"utf8-text", bytes:size, data:body};
    }
    var bytes;
    if (body instanceof Uint8Array) bytes = body;
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else if (ArrayBuffer.isView(body)) bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    else return {available:false, reason:"unsupported-runtime-body-type"};
    if (bytes.length > 8388608) throw new Error("capture-body-limit");
    return {available:true, encoding:"base64", bytes:bytes.length, data:devBase64(bytes)};
  }
  function devHalt(c, reason) {
    if (c) {
      c.enabled = false;
      c.haltReason = reason;
      c.haltedAt = new Date().toISOString();
      $persistentStore.write(JSON.stringify(c), "ytads.logger.config.v1");
    }
    if (typeof console !== "undefined") console.log("[YouTubeLogger] recording-stopped: " + reason);
  }
  function devAppend(entry, payload) {
    var written = [], c = null;
    try {
      c = devConfig();
      if (!c) return false;
      var raw = $persistentStore.read("ytads.logger.entries.v2");
      if (raw && devUTF8Size(raw) > 131072) throw new Error("log-index-invalid");
      var old = raw ? JSON.parse(raw) : null;
      var state = old && old.session === c.session && Array.isArray(old.entries) ? old : {session:c.session, entries:[], captureBytes:0};
      if (state.entries.length >= 600) { devHalt(c, "entry-limit"); return false; }
      var serialized = payload ? JSON.stringify(payload) : null;
      if (serialized && serialized.length > 33554432) { devHalt(c, "capture-event-limit"); return false; }
      var used = state.captureBytes || 0;
      var budget = [16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) * 1048576 : 33554432;
      var size = serialized ? devUTF8Size(serialized) : 0;
      if (used + size > budget) { devHalt(c, "capture-budget-limit"); return false; }
      var chunks = [];
      if (serialized) {
        for (var start = 0; start < serialized.length;) {
          var end = Math.min(start + 131072, serialized.length);
          if (end < serialized.length && serialized.charCodeAt(end - 1) >= 55296 && serialized.charCodeAt(end - 1) <= 56319 && serialized.charCodeAt(end) >= 56320 && serialized.charCodeAt(end) <= 57343) end--;
          chunks.push(serialized.slice(start, end));
          start = end;
        }
        if (chunks.length > 256) { devHalt(c, "capture-event-limit"); return false; }
        var prefix = "ytads.capture." + c.session + "." + payload.id + ".";
        entry.captureRef = {prefix:prefix, chunks:chunks.length, chars:serialized.length, storedBytes:size, checksum:devChecksum(serialized)};
      }
      var next = {session:c.session, entries:state.entries.concat([entry]), captureBytes:used + size};
      var index = JSON.stringify(next);
      if (devUTF8Size(index) > 131072) { devHalt(c, "log-index-limit"); return false; }
      if (serialized) {
        for (var i = 0; i < entry.captureRef.chunks; i++) {
          var key = entry.captureRef.prefix + i;
          if ($persistentStore.write(chunks[i], key) !== true) throw new Error("capture-write-failed");
          written.push(key);
        }
      }
      if ($persistentStore.write(index, "ytads.logger.entries.v2") !== true) throw new Error("log-index-write-failed");
      return true;
    } catch (_) {
      written.forEach(function (key) { try { $persistentStore.write(undefined, key); } catch (_) {} });
      try { devHalt(c, "storage-or-serialization-failed"); } catch (_) {}
      return false;
    }
  }
  function devChecksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  function devCorrelation(method, url) {
    // A grouping hint, never a claim of a unique request/response pairing.
    return devChecksum(method + " " + url);
  }
  function devCapture(source, phase, endpoint, version, output) {
    if (!devFlag(args.capture_raw)) return;
    var c = null;
    try {
      c = devConfig();
      if (!c || typeof $request === "undefined") return;
      var now = new Date().toISOString();
      var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
      var request = {url:$request.url, method:$request.method || "GET", headers:$request.headers || {}, h2_trailers:$request.h2_trailers || {}, body:devBody($request.body)};
      var payload = {schema:1, id:id, time:now, source:source, version:version, phase:phase, endpoint:endpoint,
        runtime:typeof $loon === "string" ? $loon : null,
        correlation:{urlMethodHash:devCorrelation(request.method, request.url), exactPairing:false},
        request:request,
        processing:{exception:devException, executionScript:phase === "request" ? "YouTubeLogger" : source, elapsedMs:Date.now() - devStarted, messages:devMessages.slice(),
          arguments:{development_capture:devFlag(args.capture_raw), ump_mode:args.ump_mode === "clean_prefetch" ? "clean_prefetch" : "inspect", log_level:args.log_level || "info"}}};
      if (phase === "response" && typeof $response !== "undefined") {
        payload.responseBefore = {status:$response.status, headers:$response.headers || {}, h2_trailers:$response.h2_trailers || {}, body:devBody($response.body)};
        var changed = output && Object.prototype.hasOwnProperty.call(output, "body");
        payload.responseAfter = {changed:!!changed, status:output && output.status !== undefined ? output.status : $response.status,
          headerOverrides:output && output.headers || null, transportHeadersRecomputedByLoon:true,
          body:changed ? devBody(output.body) : {reference:"responseBefore.body"}};
      }
      devAppend({source:source, version:version, endpoint:endpoint, level:"debug", time:now, phase:phase,
        message:"development capture: " + phase + (payload.responseAfter ? " changed=" + payload.responseAfter.changed : "")}, payload);
    } catch (error) {
      try { devHalt(c, error.message === "capture-body-limit" ? "capture-body-limit" : "capture-serialization-failed"); } catch (_) {}
    }
  }

  function saveLog(message) {
    devMessages.push(message);
    // Raw mode saves one complete response event, irrespective of log level.
    if (devFlag(args.capture_raw)) return;
    var ranks = {debug:0, info:1, warn:2, error:3};
    var level = message.indexOf("changed:") === 0 ? "info" :
      message === "pass: parse/schema check failed" ? "error" :
      /^(pass: (removed=|mode=|non-UMP))/.test(message) ? "debug" : "warn";
    var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubeStreamAds", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
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
    if (!devFlag(args.capture_raw)) return {};
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
    devFailure(error);
    // Do not log exception messages from JSON/UTF-8 parsers: they may contain
    // pieces of response data. Failed parsing leaves the complete body intact.
    log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));
  }
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && MEDIA_API.test($request.url || "")) devCapture("YouTubeStreamAds", "response", endpoint, VERSION, output);
  $done(output);
})();
