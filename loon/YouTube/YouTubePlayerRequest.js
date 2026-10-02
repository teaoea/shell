/*
 * YouTubePlayerRequest 1.0.0 — remove ad negotiation from player requests.
 *
 * The iOS protobuf request carries ad targeting in
 * PlayerRequest.context.ad_signals_info (1 -> 9) and VAST parameters in
 * playback_context.content_playback_context (4 -> 1 -> 12).  Strip those
 * exact fields and enable the documented inline no-ad flag (4 -> 1 -> 50).
 * Unknown fields and their original bytes remain untouched.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SOURCE = "YouTubePlayerRequest";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var MAX_BODY = 2097152;
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var enabled = args.suppress_player_ads !== false && args.suppress_player_ads !== "false";
  var debug = args.script_debug === true || args.script_debug === "true";

  function flag(value) { return value === true || value === "true"; }
  function endpoint(url) {
    var match = /\/youtubei\/v1\/(player|get_watch)(?:\?[^#]*)?$/i.exec(url || "");
    return match ? match[1].toLowerCase() : null;
  }
  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
  }
  function fail(code) { throw new Error(code); }
  function readVarint(bytes, cursor) {
    var value = 0, factor = 1, count = 0;
    while (cursor.pos < bytes.length && count++ < 10) {
      var current = bytes[cursor.pos++];
      if (factor <= 9007199254740991) value += (current & 127) * factor;
      if (current < 128) return value;
      factor *= 128;
    }
    fail("invalid-varint");
  }
  function parse(bytes, budget) {
    var cursor = {pos:0}, records = [];
    while (cursor.pos < bytes.length) {
      if (++budget.fields > MAX_FIELDS) fail("field-limit");
      var start = cursor.pos, tag = readVarint(bytes, cursor), no = Math.floor(tag / 8), wire = tag & 7;
      if (!no) fail("invalid-tag");
      var dataStart = cursor.pos, dataEnd = cursor.pos;
      if (wire === 0) { readVarint(bytes, cursor); dataEnd = cursor.pos; }
      else if (wire === 1) { cursor.pos += 8; dataEnd = cursor.pos; }
      else if (wire === 2) {
        var length = readVarint(bytes, cursor);
        if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - cursor.pos) fail("truncated-field");
        dataStart = cursor.pos; cursor.pos += length; dataEnd = cursor.pos;
      } else if (wire === 5) { cursor.pos += 4; dataEnd = cursor.pos; }
      else fail("unsupported-wire");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({no:no, wire:wire, start:start, end:cursor.pos, dataStart:dataStart, dataEnd:dataEnd});
    }
    return records;
  }
  function varint(value) {
    var result = [];
    do { var byte = value % 128; value = Math.floor(value / 128); result.push(byte + (value ? 128 : 0)); } while (value);
    return new Uint8Array(result);
  }
  function concat(parts) {
    var size = 0, i, offset = 0;
    for (i = 0; i < parts.length; i++) size += parts[i].length;
    var output = new Uint8Array(size);
    for (i = 0; i < parts.length; i++) { output.set(parts[i], offset); offset += parts[i].length; }
    return output;
  }
  function message(no, payload) { return concat([varint(no * 8 + 2), varint(payload.length), payload]); }
  function scalar(no, value) { return concat([varint(no * 8), varint(value)]); }
  function raw(bytes, record) { return bytes.subarray(record.start, record.end); }

  function cleanContext(bytes, budget, counts) {
    var records = parse(bytes, budget), parts = [], changed = false;
    for (var i = 0; i < records.length; i++) {
      if (records[i].no === 9 && records[i].wire === 2) {
        counts.contextAdSignals++;
        changed = true;
      } else parts.push(raw(bytes, records[i]));
    }
    return {body:changed ? concat(parts) : bytes, changed:changed};
  }
  function cleanContentPlayback(bytes, budget, counts) {
    var records = parse(bytes, budget), parts = [], changed = false, noAdWritten = false;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if ((record.no === 12 && record.wire === 2) || (record.no === 25 && record.wire === 2)) {
        counts.playbackAdParams++;
        changed = true;
      } else if (record.no === 50 && record.wire === 0) {
        if (!noAdWritten) parts.push(scalar(50, 1));
        noAdWritten = true;
        counts.inlineNoAd++;
        changed = true;
      } else parts.push(raw(bytes, record));
    }
    if (!noAdWritten) {
      parts.push(scalar(50, 1));
      counts.inlineNoAd++;
      changed = true;
    }
    return {body:changed ? concat(parts) : bytes, changed:changed};
  }
  function cleanPlaybackContext(bytes, budget, counts) {
    var records = parse(bytes, budget), parts = [], changed = false;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.no === 1 && record.wire === 2) {
        var child = cleanContentPlayback(bytes.subarray(record.dataStart, record.dataEnd), budget, counts);
        if (child.changed) { parts.push(message(1, child.body)); changed = true; }
        else parts.push(raw(bytes, record));
      } else parts.push(raw(bytes, record));
    }
    return {body:changed ? concat(parts) : bytes, changed:changed};
  }
  function cleanPlayer(bytes, budget, counts) {
    var records = parse(bytes, budget), parts = [], changed = false;
    for (var i = 0; i < records.length; i++) {
      var record = records[i], child = null;
      if (record.no === 1 && record.wire === 2) child = cleanContext(bytes.subarray(record.dataStart, record.dataEnd), budget, counts);
      else if (record.no === 4 && record.wire === 2) child = cleanPlaybackContext(bytes.subarray(record.dataStart, record.dataEnd), budget, counts);
      if (child && child.changed) { parts.push(message(record.no, child.body)); changed = true; }
      else parts.push(raw(bytes, record));
    }
    return {body:changed ? concat(parts) : bytes, changed:changed};
  }
  function cleanGetWatch(bytes, budget, counts) {
    var records = parse(bytes, budget), parts = [], changed = false;
    for (var i = 0; i < records.length; i++) {
      var record = records[i], child = null;
      if (record.no === 1 && record.wire === 2) child = cleanContext(bytes.subarray(record.dataStart, record.dataEnd), budget, counts);
      else if (record.no === 2 && record.wire === 2) child = cleanPlayer(bytes.subarray(record.dataStart, record.dataEnd), budget, counts);
      if (child && child.changed) { parts.push(message(record.no, child.body)); changed = true; }
      else parts.push(raw(bytes, record));
    }
    return {body:changed ? concat(parts) : bytes, changed:changed};
  }
  function cleanJson(value, kind, counts) {
    function context(target) {
      if (target && typeof target === "object" && Object.prototype.hasOwnProperty.call(target, "adSignalsInfo")) {
        delete target.adSignalsInfo; counts.contextAdSignals++;
      }
    }
    function player(target) {
      if (!target || typeof target !== "object") return;
      context(target.context);
      var content = target.playbackContext && target.playbackContext.contentPlaybackContext;
      if (content && typeof content === "object") {
        for (var i = 0; i < 2; i++) {
          var key = i ? "forceAdParameters" : "adParams";
          if (Object.prototype.hasOwnProperty.call(content, key)) { delete content[key]; counts.playbackAdParams++; }
        }
        if (content.isInlinePlaybackNoAd !== true) { content.isInlinePlaybackNoAd = true; counts.inlineNoAd++; }
      }
    }
    if (kind === "get_watch") { context(value.context); player(value.playerRequest); }
    else player(value);
  }
  function utf8Size(text) {
    var size = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 128) size++; else if (code < 2048) size += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { size += 4; i++; }
      else size += 3;
    }
    return size;
  }
  function checksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  function base64(bytes) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", result = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") +
        (i + 2 < bytes.length ? alphabet[c & 63] : "=");
    }
    return result;
  }
  function captureBody(body) {
    if (body === undefined || body === null) return {available:false, reason:"not-provided-by-runtime"};
    if (typeof body === "string") return {available:true, encoding:"utf8-text", bytes:utf8Size(body), data:body};
    var bytes = bytesOf(body);
    return bytes ? {available:true, encoding:"base64", bytes:bytes.length, data:base64(bytes)} :
      {available:false, reason:"unsupported-runtime-body-type"};
  }
  function loggerConfig() {
    if (!flag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read(CONFIG), value = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return value && value.enabled === true && typeof value.session === "string" && /^[a-z0-9-]{1,80}$/.test(value.session) ? value : null;
  }
  function append(entry, payload) {
    var written = [];
    try {
      var config = loggerConfig();
      if (!config) return false;
      var rawState = $persistentStore.read(CACHE);
      if (rawState && utf8Size(rawState) > 131072) return false;
      var old = rawState ? JSON.parse(rawState) : null;
      var state = old && old.session === config.session && Array.isArray(old.entries) ? old : {session:config.session, entries:[], captureBytes:0};
      if (state.entries.length >= 600) return false;
      var serialized = payload ? JSON.stringify(payload) : null;
      var size = serialized ? utf8Size(serialized) : 0;
      var budget = [16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) * 1048576 : 33554432;
      if (size > 33554432 || (state.captureBytes || 0) + size > budget) return false;
      if (serialized) {
        var chunks = [];
        for (var start = 0; start < serialized.length;) {
          var end = Math.min(start + 131072, serialized.length);
          if (end < serialized.length && serialized.charCodeAt(end - 1) >= 55296 && serialized.charCodeAt(end - 1) <= 56319 && serialized.charCodeAt(end) >= 56320 && serialized.charCodeAt(end) <= 57343) end--;
          chunks.push(serialized.slice(start, end)); start = end;
        }
        if (chunks.length > 256) return false;
        var prefix = "ytads.capture." + config.session + "." + payload.id + ".";
        entry.captureRef = {prefix:prefix, chunks:chunks.length, chars:serialized.length, storedBytes:size, checksum:checksum(serialized)};
        for (var i = 0; i < chunks.length; i++) {
          var key = prefix + i;
          if ($persistentStore.write(chunks[i], key) !== true) throw new Error("capture-write-failed");
          written.push(key);
        }
      }
      var next = {session:config.session, entries:state.entries.concat([entry]), captureBytes:(state.captureBytes || 0) + size};
      var index = JSON.stringify(next);
      if (utf8Size(index) > 131072 || $persistentStore.write(index, CACHE) !== true) throw new Error("index-write-failed");
      return true;
    } catch (_) {
      for (var j = 0; j < written.length; j++) try { $persistentStore.write(undefined, written[j]); } catch (_) {}
      return false;
    }
  }
  function save(message, level, kind) {
    try {
      if (flag(args.capture_raw) || !flag(args.log_enabled) || typeof $persistentStore === "undefined") return;
      var ranks = {debug:0, info:1, warn:2, error:3};
      var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
      if (!Object.prototype.hasOwnProperty.call(ranks, level) || ranks[level] < ranks[minimum]) return;
      append({source:SOURCE, version:VERSION, endpoint:kind, level:level, time:new Date().toISOString(), phase:"request", message:message}, null);
    } catch (_) {}
  }
  function captureDevelopment(message, kind, output) {
    if (!flag(args.capture_raw) || typeof $request === "undefined") return;
    try {
      var now = new Date().toISOString();
      var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
      var request = {url:$request.url, method:$request.method || "GET", headers:$request.headers || {}, h2_trailers:$request.h2_trailers || {}, body:captureBody($request.body)};
      var changed = output && Object.prototype.hasOwnProperty.call(output, "body");
      var payload = {schema:1, id:id, time:now, source:SOURCE, version:VERSION, phase:"request", endpoint:kind,
        runtime:typeof $loon === "string" ? $loon : null,
        correlation:{urlMethodHash:checksum(request.method + " " + request.url), exactPairing:true},
        request:request,
        processing:{exception:null, executionScript:SOURCE, elapsedMs:0, messages:[message],
          arguments:{suppress_player_ads:enabled, log_level:args.log_level || "info"}},
        requestAfter:{changed:!!changed, headerOverrides:changed ? output.headers || null : null,
          transportHeadersRecomputedByLoon:true, body:changed ? captureBody(output.body) : {reference:"request.body"}}};
      append({source:SOURCE, version:VERSION, endpoint:kind, level:"debug", time:now, phase:"request", message:"development capture: changed=" + !!changed}, payload);
    } catch (_) {}
  }
  function log(message, level, kind) {
    save(message, level, kind);
    if (debug && typeof console !== "undefined") console.log("[" + SOURCE + " " + VERSION + "] " + kind + " " + message);
  }
  function outputHeaders(headers) {
    var result = {}, source = headers || {};
    Object.keys(source).forEach(function (key) {
      var lower = key.toLowerCase();
      if (lower !== "content-encoding" && lower !== "content-length") result[key] = source[key];
    });
    return result;
  }

  var output = {};
  var kind = typeof $request !== "undefined" ? endpoint($request.url) : null;
  if (enabled && kind && typeof $response === "undefined" && $request.body !== undefined && $request.body !== null) {
    try {
      var counts = {contextAdSignals:0, playbackAdParams:0, inlineNoAd:0};
      var contentType = String(($request.headers && ($request.headers["Content-Type"] || $request.headers["content-type"])) || "").toLowerCase();
      if (typeof $request.body === "string" && (contentType.indexOf("json") >= 0 || /^\s*[\[{]/.test($request.body))) {
        var value = JSON.parse($request.body), before = JSON.stringify(value);
        cleanJson(value, kind, counts);
        var jsonBody = JSON.stringify(value);
        if (jsonBody !== before) output = {headers:outputHeaders($request.headers), body:jsonBody};
      } else {
        var input = bytesOf($request.body);
        if (!input || !input.length || input.length > MAX_BODY) fail("unsupported-body");
        var result = kind === "get_watch" ? cleanGetWatch(input, {fields:0}, counts) : cleanPlayer(input, {fields:0}, counts);
        if (result.changed) output = {headers:outputHeaders($request.headers), body:result.body};
      }
      var changed = Object.prototype.hasOwnProperty.call(output, "body");
      var messageText = (changed ? "changed" : "pass") + ": context_ad_signals=" + counts.contextAdSignals +
        " playback_ad_params=" + counts.playbackAdParams + " inline_no_ad=" + counts.inlineNoAd;
      log(messageText, changed ? "info" : "debug", kind);
      captureDevelopment(messageText, kind, output);
    } catch (error) {
      log("pass: " + (error && error.message || "parse-failed"), "warn", kind);
      output = {};
    }
  }
  $done(output);
})();
