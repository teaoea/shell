/*
 * YouTubePlaybackAds 2.1.0 — playback API ad cleanup and optional background playback for Loon.
 * Handles player/get_watch JSON and known Protobuf responses only.
 * Standalone: no imports, remote calls, redirects, or UMP processing.
 * Browser-derived strategy: remove ad metadata before the player enters ad state.
 * Known reverse-engineered schema: Player fields 2/7/9/68; Tracking field 18;
 * PlayabilityStatus fields 4/11 and BackgroundSupportedRenderer extension 64657230;
 * get_watch path 1 -> 2.
 * Shared wire helpers are included here so Loon can run this file directly.
 */
(function () {
  "use strict";

  var VERSION = "2.1.0";
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var debug = args.script_debug !== false && args.script_debug !== "false";
  var backgroundPlayback = args.background_playback === true || args.background_playback === "true";
  var endpoint = "unknown";
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_JSON_NODES = 20000;
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(player|get_watch)(?:\?[^#]*)?$/i;

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
          arguments:{ump_enabled:devFlag(args.ump_enabled), ump_mode:args.ump_mode === "clean_prefetch" ? "clean_prefetch" : "inspect", background_playback:backgroundPlayback, log_level:args.log_level || "info"}}};
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
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubePlaybackAds", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubePlaybackAds " + VERSION + "] " + endpoint + " " + message);
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

  function enableNestedBoolean(bytes, extensionNo) {
    var records = parse(bytes, {fields:0});
    var extension = encodeField(extensionNo, 2, new Uint8Array([8, 1]));
    var parts = [], found = false, changed = false;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.no !== extensionNo) { parts.push(bytes.subarray(r.start, r.end)); continue; }
      if (r.wire !== 2) fail("background-schema-mismatch");
      found = true;
      var childBytes = bytes.subarray(r.payloadStart, r.end);
      var childRecords = parse(childBytes, {fields:0});
      var childParts = [], active = false;
      for (var j = 0; j < childRecords.length; j++) {
        var c = childRecords[j];
        if (c.no === 1) {
          if (c.wire !== 0) fail("background-schema-mismatch");
          if (varintIsTrue(childBytes, c)) active = true;
          continue;
        }
        childParts.push(childBytes.subarray(c.start, c.end));
      }
      childParts.push(new Uint8Array([8, 1]));
      var normalized = join(childParts);
      parts.push(encodeField(extensionNo, 2, normalized));
      if (!active || childRecords.filter(function (item) {return item.no === 1;}).length !== 1) changed = true;
    }
    if (!found) { parts.push(extension); changed = true; }
    return {body:changed ? join(parts) : bytes, changed:changed};
  }

  // Keep the older direct field 4 for compatibility and also write the current
  // nested field 11 capability used by recent iOS player responses.
  function enableBackground(bytes, records) {
    var matches = [];
    for (var i = 0; i < records.length; i++) {
      if (records[i].no !== 4) continue;
      if (records[i].wire !== 0) fail("background-schema-mismatch");
      matches.push(i);
    }
    var enabled = new Uint8Array([32, 1]);
    var directChanged = !(matches.length === 1 && varintIsTrue(bytes, records[matches[0]]));
    var parts = [];
    for (var j = 0; j < records.length; j++) {
      if (records[j].no === 4) {
        if (j === matches[0]) parts.push(enabled);
      } else {
        parts.push(bytes.subarray(records[j].start, records[j].end));
      }
    }
    if (!matches.length) parts.push(enabled);
    var directBody = directChanged ? join(parts) : bytes;
    var directRecords = parse(directBody, {fields:0});
    var nestedFound = false, nestedChanged = false, nestedParts = [];
    for (var k = 0; k < directRecords.length; k++) {
      var record = directRecords[k];
      if (record.no !== 11) {nestedParts.push(directBody.subarray(record.start, record.end)); continue;}
      if (record.wire !== 2) fail("background-schema-mismatch");
      nestedFound = true;
      var nested = enableNestedBoolean(directBody.subarray(record.payloadStart, record.end), 64657230);
      nestedChanged = nestedChanged || nested.changed;
      nestedParts.push(nested.changed ? encodeField(11, 2, nested.body) : directBody.subarray(record.start, record.end));
    }
    if (!nestedFound) {
      nestedParts.push(encodeField(11, 2, encodeField(64657230, 2, new Uint8Array([8, 1]))));
      nestedChanged = true;
    }
    return { body:directChanged || nestedChanged ? join(nestedParts) : bytes, background:directChanged || nestedChanged ? 1 : 0 };
  }

  function cleanTracking(bytes, budget) {
    var records = parse(bytes, budget), parts = [], removed = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.no === 18) {
        if (r.wire !== 2) fail("tracking-schema-mismatch");
        removed++;
      } else parts.push(bytes.subarray(r.start, r.end));
    }
    return {body:removed ? join(parts) : bytes, removed:removed};
  }

  function cleanPlayer(bytes, budget) {
    var records = parse(bytes, budget);
    var recognized = false;
    var statusChanges = [], trackingChanges = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.no === 2) {
        if (r.wire !== 2) fail("player-schema-mismatch");
        var status = parse(bytes.subarray(r.payloadStart, r.end), budget);
        for (var s = 0; s < status.length; s++) {
          if (status[s].no === 1 && status[s].wire !== 0) fail("status-schema-mismatch");
        }
        if (backgroundPlayback) statusChanges[i] = enableBackground(bytes.subarray(r.payloadStart, r.end), status);
        recognized = true;
      }
      if ((r.no === 7 || r.no === 68) && r.wire !== 2) fail("ad-schema-mismatch");
      if (r.no === 9) {
        if (r.wire !== 2) fail("tracking-schema-mismatch");
        trackingChanges[i] = cleanTracking(bytes.subarray(r.payloadStart, r.end), budget);
      }
    }
    if (!recognized) return { body: bytes, removed: 0, tracking: 0, background: 0 };
    var parts = [];
    var removed = 0;
    var tracking = 0;
    var background = 0;
    for (var j = 0; j < records.length; j++) {
      var field = records[j];
      if (field.no === 7 || field.no === 68) removed++;
      else if (trackingChanges[j] && trackingChanges[j].removed) {
        parts.push(replaceChild(bytes, field, trackingChanges[j].body));
        removed += trackingChanges[j].removed;
        tracking += trackingChanges[j].removed;
      }
      else if (statusChanges[j] && statusChanges[j].background) {
        parts.push(replaceChild(bytes, field, statusChanges[j].body));
        background += statusChanges[j].background;
      }
      else parts.push(bytes.subarray(field.start, field.end));
    }
    return { body: removed || background ? join(parts) : bytes, removed: removed, tracking: tracking, background: background };
  }

  // Rebuild only the enclosing length when a known child changes. Everything
  // else, including unknown fields, ordering and original varints, stays raw.
  function cleanWatch(bytes, budget, level) {
    var records = parse(bytes, budget);
    var target = level === 0 ? 1 : 2;
    var parts = [];
    var removed = 0;
    var tracking = 0;
    var background = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.no !== target) {
        parts.push(bytes.subarray(r.start, r.end));
        continue;
      }
      if (r.wire !== 2) fail("watch-schema-mismatch");
      var payload = bytes.subarray(r.payloadStart, r.end);
      var result = level === 0 ? cleanWatch(payload, budget, 1) : cleanPlayer(payload, budget);
      removed += result.removed;
      tracking += result.tracking || 0;
      background += result.background;
      parts.push(result.removed || result.background ? replaceChild(bytes, r, result.body) : bytes.subarray(r.start, r.end));
    }
    return { body: removed || background ? join(parts) : bytes, removed: removed, tracking: tracking, background: background };
  }

  function cleanJSON(text) {
    var root = JSON.parse(text);
    if (!root || typeof root !== "object") return { body: text, removed: 0, tracking: 0, background: 0 };
    var queue = [{ value: root, depth: 0, player: endpoint === "player", backgroundTarget: endpoint === "player" }];
    var count = 0;
    var removed = 0;
    var tracking = 0;
    var background = 0;
    function enqueue(value, depth, player, backgroundTarget) {
      if (count + queue.length >= MAX_JSON_NODES || depth > 64) fail("json-limit");
      queue.push({ value: value, depth: depth, player: player, backgroundTarget: backgroundTarget });
    }
    while (queue.length) {
      var item = queue.pop();
      var value = item.value;
      if (++count > MAX_JSON_NODES || item.depth > 64) fail("json-limit");
      if (Array.isArray(value)) {
        for (var a = 0; a < value.length; a++) {
          if (value[a] && typeof value[a] === "object") {
            enqueue(value[a], item.depth + 1, item.player, item.backgroundTarget);
          }
        }
        continue;
      }
      var isPlayer = item.player || Object.prototype.hasOwnProperty.call(value, "playabilityStatus") ||
        Object.prototype.hasOwnProperty.call(value, "streamingData");
      if (isPlayer) {
        var adKeys = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams", "adParams"];
        for (var k = 0; k < adKeys.length; k++) {
          if (Object.prototype.hasOwnProperty.call(value, adKeys[k])) {
            delete value[adKeys[k]];
            removed++;
          }
        }
        if (value.playbackTracking && typeof value.playbackTracking === "object" &&
            Object.prototype.hasOwnProperty.call(value.playbackTracking, "pageadViewthroughconversion")) {
          delete value.playbackTracking.pageadViewthroughconversion;
          removed++;
          tracking++;
        }
        if (value.playerConfig && typeof value.playerConfig === "object" && !Array.isArray(value.playerConfig)) {
          var configKeys = ["adPlacementConfig", "adSignalsConfig"];
          for (var c = 0; c < configKeys.length; c++) {
            if (Object.prototype.hasOwnProperty.call(value.playerConfig, configKeys[c])) {
              delete value.playerConfig[configKeys[c]];
              removed++;
            }
          }
        }
      }
      if (backgroundPlayback && item.backgroundTarget && value.playabilityStatus &&
          typeof value.playabilityStatus === "object" && !Array.isArray(value.playabilityStatus)) {
        var backgroundChanged = false;
        if (value.playabilityStatus.playableInBackground !== true) {
          value.playabilityStatus.playableInBackground = true;
          backgroundChanged = true;
        }
        var renderer = value.playabilityStatus.backgroundPlayerRender;
        if (!renderer || !renderer.backgroundAbility || renderer.backgroundAbility.active !== true) {
          value.playabilityStatus.backgroundPlayerRender = {backgroundAbility:{active:true}};
          backgroundChanged = true;
        }
        if (backgroundChanged) background++;
      }
      var keys = Object.keys(value);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var child = value[key];
        if (child && typeof child === "object") {
          var playerWrapper = key === "playerResponse" || key === "player";
          enqueue(child, item.depth + 1, playerWrapper, playerWrapper);
        }
      }
    }
    return { body: removed || background ? JSON.stringify(root) : text, removed: removed, tracking: tracking, background: background };
  }

  function run() {
    var match = API.exec(typeof $request !== "undefined" ? $request.url || "" : "");
    if (!match || typeof $response === "undefined") return {};
    endpoint = match[1].toLowerCase();
    var status = $response.status;
    if (status !== undefined && Number(status) !== 200) { log("pass: non-200"); return {}; }
    var type = header($response.headers, "content-type").split(";")[0].trim();
    if (type === "application/vnd.yt-ump") { log("pass: UMP unsupported"); return {}; }
    var body = $response.body;
    var bytes = bytesOf(body);
    if (typeof body !== "string" && !bytes) { log("pass: body unavailable"); return {}; }
    if ((bytes ? bytes.length : body.length) > MAX_BYTES) { log("pass: size-limit"); return {}; }
    if (!(bytes ? bytes.length : body.length)) { log("pass: empty"); return {}; }
    if (bytes && bytes[0] === 31 && bytes[1] === 139) { log("pass: compressed body"); return {}; }
    var json = /^(?:application\/(?:json|[\w.+-]+\+json)|text\/json)$/.test(type);
    var result;
    if (typeof body === "string" || json) {
      var text = body;
      if (bytes) {
        if (typeof TextDecoder !== "function") { log("pass: no UTF-8 decoder"); return {}; }
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      result = cleanJSON(text);
      if ((result.removed || result.background) && bytes) {
        if (typeof TextEncoder !== "function") { log("pass: no UTF-8 encoder"); return {}; }
        result.body = new TextEncoder().encode(result.body);
      }
    } else {
      if (type && !/^(?:application\/(?:x-protobuf|protobuf|vnd\.google\.protobuf|octet-stream))$/.test(type)) {
        log("pass: unsupported content type"); return {};
      }
      var budget = { fields: 0 };
      result = endpoint === "player" ? cleanPlayer(bytes, budget) : cleanWatch(bytes, budget, 0);
    }
    log((result.removed || result.background ? "changed" : "pass") + ": removed=" + result.removed +
      " tracking_removed=" + (result.tracking || 0) +
      " background_modified=" + result.background +
      " format=" + (typeof body === "string" || json ? "json" : "protobuf"));
    return result.removed || result.background ? { body: result.body } : {};
  }

  var output = {};
  try { output = run(); }
  catch (error) {
    devFailure(error);
    // Do not log exception messages from JSON/UTF-8 parsers: they may contain
    // pieces of response data. Failed parsing leaves the complete body intact.
    log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));
  }
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && API.test($request.url || "")) devCapture("YouTubePlaybackAds", "response", endpoint, VERSION, output);
  $done(output);
})();
