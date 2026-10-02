/*
 * YouTubeShortsAds 1.0.0 — Shorts playback ad cleanup for Loon.
 * Removes only entries explicitly carrying reelWatchEndpoint.adClientParams.isAd.
 * Standalone: no imports, remote calls, redirects, DOM access, or media blocking.
 * Schema: response entries 2 -> command 1 -> endpoint 139608561 -> params 16 -> isAd 1.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var debug = args.script_debug !== false && args.script_debug !== "false";
  var removeShortsAds = args.remove_shorts_ads !== false && args.remove_shorts_ads !== "false";
  var endpoint = "unknown";
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_JSON_NODES = 20000;
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/reel\/reel_watch_sequence(?:\?[^#]*)?$/i;

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
          arguments:{remove_shorts_ads:removeShortsAds, log_level:args.log_level || "info"}}};
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
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubeShortsAds", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubeShortsAds " + VERSION + "] " + endpoint + " " + message);
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

  function encodeLength(value) {
    var out = [];
    do {
      var b = value % 128;
      value = Math.floor(value / 128);
      out.push(b + (value ? 128 : 0));
    } while (value);
    return new Uint8Array(out);
  }

  function encodeField(no, wire, payload) {
    return join([encodeLength(no * 8 + wire), wire === 2 ? encodeLength(payload.length) : new Uint8Array(0), payload]);
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

  function replaceChild(bytes, record, body) {
    return join([bytes.subarray(record.start, record.tagEnd),
      encodeLength(body.length), body]);
  }

  function varintIsTrue(bytes, record) {
    for (var i = record.tagEnd; i < record.end; i++) {
      if ((bytes[i] & 127) !== 0) return true;
    }
    return false;
  }

  function oneMessage(bytes, no, budget) {
    var records = parse(bytes, budget), matches = [];
    for (var i = 0; i < records.length; i++) if (records[i].no === no) matches.push(records[i]);
    if (matches.length !== 1 || matches[0].wire !== 2) return null;
    return bytes.subarray(matches[0].payloadStart, matches[0].end);
  }

  // Shorts response schema:
  // entries(2) -> command(1) -> reelWatchEndpoint(139608561)
  // -> adClientParams(16) -> isAd(1, bool).
  function protobufAdEntry(bytes, budget) {
    var command = oneMessage(bytes, 1, budget);
    if (!command) return false;
    var endpointMessage = oneMessage(command, 139608561, budget);
    if (!endpointMessage) return false;
    var params = oneMessage(endpointMessage, 16, budget);
    if (!params) return false;
    var records = parse(params, budget), found = false;
    for (var i = 0; i < records.length; i++) {
      if (records[i].no !== 1) continue;
      if (records[i].wire !== 0) fail("shorts-ad-schema-mismatch");
      if (varintIsTrue(params, records[i])) found = true;
    }
    return found;
  }

  function cleanProto(bytes, budget) {
    var records = parse(bytes, budget), parts = [], removed = 0, entries = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.no !== 2) {parts.push(bytes.subarray(r.start, r.end)); continue;}
      entries++;
      if (r.wire !== 2) fail("shorts-entry-schema-mismatch");
      if (protobufAdEntry(bytes.subarray(r.payloadStart, r.end), budget)) removed++;
      else parts.push(bytes.subarray(r.start, r.end));
    }
    return {body:removed ? join(parts) : bytes, removed:removed, entries:entries};
  }

  function object(value) {return !!value && typeof value === "object" && !Array.isArray(value);}
  function jsonAdEntry(entry) {
    var endpointValue = entry && entry.command && entry.command.reelWatchEndpoint;
    return object(endpointValue) && object(endpointValue.adClientParams) && endpointValue.adClientParams.isAd === true;
  }

  function cleanJSON(text) {
    var root = JSON.parse(text), queue = [root], nodes = 0, removed = 0, entries = 0;
    while (queue.length) {
      var value = queue.pop();
      if (!value || typeof value !== "object") continue;
      if (++nodes > MAX_JSON_NODES) fail("json-limit");
      if (Array.isArray(value)) {
        for (var a = 0; a < value.length; a++) queue.push(value[a]);
        continue;
      }
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], child = value[key];
        if (key === "entries" && Array.isArray(child)) {
          entries += child.length;
          value[key] = child.filter(function (entry) {
            if (jsonAdEntry(entry)) {removed++; return false;}
            return true;
          });
          child = value[key];
        }
        if (child && typeof child === "object") queue.push(child);
      }
    }
    return {body:removed ? JSON.stringify(root) : text, removed:removed, entries:entries};
  }

  function run() {
    var match = API.exec(typeof $request !== "undefined" ? $request.url || "" : "");
    if (!match || typeof $response === "undefined" || !removeShortsAds) return {};
    endpoint = "reel_watch_sequence";
    if ($response.status !== undefined && Number($response.status) !== 200) {log("pass: non-200"); return {};}
    var type = header($response.headers, "content-type").split(";")[0].trim();
    var body = $response.body, bytes = bytesOf(body);
    if (typeof body !== "string" && !bytes) {log("pass: body unavailable"); return {};}
    if ((bytes ? bytes.length : body.length) > MAX_BYTES) {log("pass: size-limit"); return {};}
    if (!(bytes ? bytes.length : body.length)) {log("pass: empty"); return {};}
    if (bytes && bytes[0] === 31 && bytes[1] === 139) {log("pass: compressed body"); return {};}
    var json = /^(?:application\/(?:json|[\w.+-]+\+json)|text\/json)$/.test(type), result;
    if (typeof body === "string" || json) {
      var text = body;
      if (bytes) {
        if (typeof TextDecoder !== "function") {log("pass: no UTF-8 decoder"); return {};}
        text = new TextDecoder("utf-8", {fatal:true}).decode(bytes);
      }
      result = cleanJSON(text);
      if (result.removed && bytes) {
        if (typeof TextEncoder !== "function") {log("pass: no UTF-8 encoder"); return {};}
        result.body = new TextEncoder().encode(result.body);
      }
    } else {
      if (!bytes || !/^(?:application\/(?:x-protobuf|protobuf|vnd\.google\.protobuf|octet-stream))$/.test(type)) {log("pass: unsupported content type"); return {};}
      result = cleanProto(bytes, {fields:0});
    }
    log((result.removed ? "changed" : "pass") + ": removed=" + result.removed + " entries=" + result.entries + " format=" + (typeof body === "string" || json ? "json" : "protobuf"));
    return result.removed ? {body:result.body} : {};
  }

  var output = {};
  try {output = run();}
  catch (error) {devFailure(error); log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));}
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && API.test($request.url || "")) devCapture("YouTubeShortsAds", "response", endpoint, VERSION, output);
  $done(output);
})();
