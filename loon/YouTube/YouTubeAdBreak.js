/*
 * YouTubeAdBreak 1.0.0 — suppress explicit player ad-break configuration.
 * Handles only /youtubei/v1/player/ad_break and returns a valid empty
 * Protobuf response. It never blocks googlevideo media requests.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SOURCE = "YouTubeAdBreak";
  var ENDPOINT = "ad_break";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/player\/ad_break(?:\?[^#]*)?$/i;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var enabled = args.block_ad_break !== false && args.block_ad_break !== "false";
  var debug = args.script_debug === true || args.script_debug === "true";

  function flag(value) { return value === true || value === "true"; }
  function utf8Size(text) {
    var size = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) {size += 4; i++;}
      else size += 3;
    }
    return size;
  }
  function checksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619);}
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  function base64(bytes) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") +
        (i + 2 < bytes.length ? alphabet[c & 63] : "=");
    }
    return out;
  }
  function captureBody(body) {
    if (body === undefined || body === null) return {available:false, reason:"not-provided-by-runtime"};
    if (typeof body === "string") return {available:true, encoding:"utf8-text", bytes:utf8Size(body), data:body};
    var bytes = body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) :
      ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
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
      var raw = $persistentStore.read(CACHE);
      if (raw && utf8Size(raw) > 131072) return false;
      var old = raw ? JSON.parse(raw) : null;
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
      for (var j = 0; j < written.length; j++) try {$persistentStore.write(undefined, written[j]);} catch (_) {}
      return false;
    }
  }
  function record(message) {
    var now = new Date().toISOString();
    if (flag(args.capture_raw) && typeof $request !== "undefined") {
      var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
      var request = {url:$request.url, method:$request.method || "GET", headers:$request.headers || {}, h2_trailers:$request.h2_trailers || {}, body:captureBody($request.body)};
      var payload = {schema:1, id:id, time:now, source:SOURCE, version:VERSION, phase:"request", endpoint:ENDPOINT,
        runtime:typeof $loon === "string" ? $loon : null,
        correlation:{urlMethodHash:checksum(request.method + " " + request.url), exactPairing:true}, request:request,
        processing:{executionScript:SOURCE, elapsedMs:0, messages:[message], arguments:{block_ad_break:enabled, log_level:args.log_level || "info"}},
        responseAfter:{changed:true, synthetic:true, status:200, headerOverrides:{"Content-Type":"application/x-protobuf", "Cache-Control":"no-store"}, transportHeadersRecomputedByLoon:true,
          body:{available:true, encoding:"base64", bytes:0, data:""}}};
      append({source:SOURCE, version:VERSION, endpoint:ENDPOINT, level:"debug", time:now, phase:"request", message:"development capture: blocked=true"}, payload);
    } else {
      append({source:SOURCE, version:VERSION, endpoint:ENDPOINT, level:"info", time:now, message:message}, null);
    }
    if (debug && typeof console !== "undefined") console.log("[" + SOURCE + " " + VERSION + "] " + ENDPOINT + " " + message);
  }

  var output = {};
  if (enabled && typeof $request !== "undefined" && typeof $response === "undefined" && API.test($request.url || "")) {
    record("blocked: empty-protobuf status=200");
    output = {response:{status:200, headers:{"Content-Type":"application/x-protobuf", "Cache-Control":"no-store"}, body:new Uint8Array(0)}};
  }
  $done(output);
})();
