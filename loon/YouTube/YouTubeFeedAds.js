/*
 * YouTubeFeedAds 2.0.0 — sponsored feed cards and optional home Shorts hiding.
 * browse/next/search JSON; narrowly mapped browse/next Protobuf list envelopes.
 * Protocol mapping reference: davidzeng0/innertube (2025-02-18 schema).
 * Browser-derived strategy: remove complete promoted list entries before render.
 * Known EML ads require a template/model pair and a structural ad command;
 * optional adaptive mode recognizes pagead only inside a confirmed card entry.
 * Sample-derived mapping: YouTube iOS 21.39.4, 2026-10-02. Unknown EML stays raw.
 */
(function () {
  "use strict";
  var VERSION = "2.0.0";
  var MAX_FIELDS = 30000;
  var MAX_BYTES = 4 * 1024 * 1024;
  var MAX_JSON_NODES = 20000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var debug = args.script_debug === true || args.script_debug === "true";
  var hideHomeShorts = args.hide_home_shorts === true || args.hide_home_shorts === "true";
  var adaptiveFeedAds = args.adaptive_feed_ads !== false && args.adaptive_feed_ads !== "false";
  var endpoint = "unknown";
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(browse|next|search)(?:\?[^#]*)?$/i;
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
          arguments:{hide_home_shorts:hideHomeShorts, adaptive_feed_ads:adaptiveFeedAds, ump_enabled:devFlag(args.ump_enabled), ump_mode:args.ump_mode === "clean_prefetch" ? "clean_prefetch" : "inspect", log_level:args.log_level || "info"}}};
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
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubeFeedAds", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubeFeedAds " + VERSION + "] " + endpoint + " " + message);
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


  // Schema-directed edges only. Never try parsing arbitrary length-delimited
  // strings/bytes as messages or delete an item because its text says "ad".
  var EDGES = {
    browse: {9:"browseUnion", 10:"continuationUnion"},
    next: {7:"nextUnion", 8:"continuationUnion"},
    browseUnion: {49399797:"sectionList", 58173949:"browseColumns", 153515154:"opaqueElement"},
    browseColumns: {1:"tabUnion"},
    tabUnion: {58174010:"tab"}, tab: {4:"sectionUnion"},
    nextUnion: {51779735:"nextColumn"},
    nextColumn: {1:"sectionUnion", 8:"sectionUnion"},
    sectionUnion: {49399797:"sectionList"},
    continuationUnion: {49399797:"sectionList", 51779776:"secondaryList"},
    sectionList: {1:"sectionItem"}, secondaryList: {1:"secondaryItem"},
    sectionItem: {50195462:"itemSection"}, secondaryItem: {50195462:"itemSection"},
    itemSection: {1:"contentItem"}, contentItem: {153515154:"cardElement"}
  };
  var ADS = {sectionItem:{424701016:true,55514441:true}, secondaryItem:{424701016:true,73920376:true}, contentItem:{424701016:true,73920376:true}};
  // Observed layout/model pairs are not a general "ad" substring heuristic.
  // Command path ends in an explicit skip_ad_on_block map key in each sample.
  var EML_ADS = {
    "video_display_button_group_layout": {model:491441836, command:[19,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "full_width_portrait_image_layout": {model:478840678, command:[27,7,10,4,169495254,138681778,2,138681066,3,449330433]},
    "full_width_square_image_layout": {model:461080918, command:[55,7,10,4,169495254,138681778,2,138681066,3,449330433]},
    "full_width_square_image_carousel_layout": {model:33562350, command:[5,5,10,4,169495254,138681778,2,138681066,3,449330433]},
    "carousel_footered_layout": {model:505359416, command:[31,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "video_display_full_buttoned_layout": {model:454362329, command:[32,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "video_display_carousel_button_group_layout": {model:33561652, command:[14,8,10,4,169495254,138681778,2,138681066,3,449330433]}
  };
  function child(bytes, no, budget) {
    var records = parse(bytes, budget), targets = records.filter(function (r) {return r.no === no;});
    if (!targets.length) return null;
    if (targets.length !== 1 || targets[0].wire !== 2) fail("eml-single-message-mismatch");
    return bytes.subarray(targets[0].payloadStart, targets[0].end);
  }
  function ascii(bytes) {
    if (!bytes || bytes.length > 160) return "";
    var text = "";
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] < 32 || bytes[i] > 126) return "";
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }
  function containsASCII(bytes, marker) {
    if (!bytes || bytes.length < marker.length) return false;
    var needle = [];
    for (var i = 0; i < marker.length; i++) needle.push(marker.charCodeAt(i));
    for (var p = 0; p <= bytes.length - needle.length; p++) {
      var ok = true;
      for (var n = 0; n < needle.length; n++) {
        if (bytes[p + n] !== needle[n]) {ok = false; break;}
      }
      if (ok) return true;
    }
    return false;
  }
  function hasAdCommand(bytes, route, depth, budget) {
    var records = parse(bytes, budget);
    if (depth === route.length) {
      var marked = false;
      records.forEach(function (r) {
        if (r.no !== 8) return;
        if (r.wire !== 2) fail("eml-command-schema-mismatch");
        var entry = bytes.subarray(r.payloadStart, r.end);
        var key = child(entry, 1, budget), value = child(entry, 2, budget);
        if (key && ascii(key) === "skip_ad_on_block" && value !== null) marked = true;
      });
      return marked;
    }
    var found = false;
    records.forEach(function (r) {
      if (r.no !== route[depth]) return;
      if (r.wire !== 2) fail("eml-command-schema-mismatch");
      // Check every matched child, including later malformed siblings.
      if (hasAdCommand(bytes.subarray(r.payloadStart, r.end), route, depth + 1, budget)) found = true;
    });
    return found;
  }
  function classifyElement(bytes, budget) {
    var element = child(bytes, 172660663, budget);
    if (!element || parse(bytes, budget).some(function (r) {return r.no >= 1000000 && r.no !== 172660663;})) return {ad:false, divider:false};
    if (parse(element, budget).some(function (r) {return r.no === 3;})) return {ad:false, divider:false};
    var type = child(element, 1, budget);
    if (!type) return {ad:false, divider:false};
    var component = child(type, 168777401, budget);
    if (!component) return {ad:false, divider:false};
    var templateType = child(component, 3, budget);
    if (!templateType) return {ad:false, divider:false};
    var template = child(templateType, 172035250, budget);
    if (!template) return {ad:false, divider:false};
    var id = ascii(child(template, 1, budget));
    var match = /^([a-z_]+)\.eml-fe\|[0-9a-f]{16}$/.exec(id);
    if (!match) return {ad:false, divider:false};
    var name = match[1], mapping = EML_ADS[name];
    if (!mapping && name !== "cell_divider") return {ad:false, divider:false};
    var model = child(component, 5, budget);
    if (!model) return {ad:false, divider:false};
    var modelFields = parse(model, budget);
    // Unknown/mixed type or model variants cannot establish an ad identity.
    if (parse(type, budget).length !== 1 || parse(templateType, budget).length !== 1 || modelFields.length !== 1) return {ad:false, divider:false};
    var expected = mapping ? mapping.model : 347043917, field = modelFields[0];
    if (field.no !== expected) return {ad:false, divider:false};
    if (field.wire !== 2) fail("eml-model-schema-mismatch");
    if (!mapping) return {ad:false, divider:true};
    return {ad:hasAdCommand(model.subarray(field.payloadStart, field.end), mapping.command, 0, budget), divider:false};
  }
  // Homepage identity is local to each Tab/list. Other browse pages are not home.
  // Continuation tokens: sample-derived wrapper 80226972 -> browse_id (2).
  function continuationBrowseId(token, budget) {
    if (typeof token !== "string" || token.length > 16384) return "";
    try {
      token = decodeURIComponent(token).replace(/-/g, "+").replace(/_/g, "/");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(token) || token.length % 4 === 1) return "";
      var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var parts = [], value = 0, bits = 0;
      for (var i = 0; i < token.length && token[i] !== "="; i++) {
        value = (value << 6) | alphabet.indexOf(token[i]); bits += 6;
        if (bits >= 8) {bits -= 8; parts.push((value >>> bits) & 255);}
      }
      var wrapper = child(new Uint8Array(parts), 80226972, budget);
      return wrapper ? ascii(child(wrapper, 2, budget)) : "";
    } catch (error) {
      if (error.ytNoAdsCode === "field-limit") throw error;
      return "";
    }
  }
  function protoHomeContinuation(bytes, records, budget) {
    var ids = [];
    records.forEach(function (r) {
      if (r.no !== 2 || r.wire !== 2) return;
      var continuation = bytes.subarray(r.payloadStart, r.end);
      [52047593, 60487319].forEach(function (no) {
        var data = child(continuation, no, budget);
        if (data) {
          var token = child(data, 1, budget);
          if (token) ids.push(continuationBrowseId(asciiToken(token), budget));
        }
      });
    });
    return ids.length > 0 && ids.every(function (id) {return id === "FEwhat_to_watch";});
  }
  function asciiToken(bytes) {
    if (!bytes || bytes.length > 16384) return "";
    var text = "";
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] < 32 || bytes[i] > 126) return "";
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }
  function shortsCell(bytes, budget) {
    var records = parse(bytes, budget);
    if (records.some(function (r) {return r.no >= 1000000 && r.no !== 153515154;})) return false;
    var renderer = child(bytes, 153515154, budget);
    if (!renderer || parse(renderer, budget).some(function (r) {return r.no >= 1000000 && r.no !== 172660663;})) return false;
    var element = child(renderer, 172660663, budget);
    if (!element || parse(element, budget).some(function (r) {return r.no === 3;})) return false;
    var type = child(element, 1, budget);
    if (!type || parse(type, budget).length !== 1) return false;
    var component = child(type, 168777401, budget);
    if (!component) return false;
    var templateType = child(component, 3, budget), model = child(component, 5, budget);
    if (!templateType || !model || parse(templateType, budget).length !== 1) return false;
    var template = child(templateType, 172035250, budget);
    if (!template || !/^shorts_video_cell\.eml-fe\|[0-9a-f]{16}$/.test(ascii(child(template, 1, budget)))) return false;
    var fields = parse(model, budget);
    return fields.length === 1 && fields[0].no === 519005951 && fields[0].wire === 2;
  }
  function shortsShelf(bytes, budget) {
    // Observed iOS Shelf -> content (5) -> HorizontalList (51431404) -> items (1).
    var content = child(bytes, 5, budget);
    if (!content || parse(content, budget).length !== 1) return false;
    var list = child(content, 51431404, budget);
    if (!list) return false;
    var records = parse(list, budget), count = 0, valid = true;
    records.forEach(function (r) {
      if (r.no !== 1) return;
      count++;
      if (r.wire !== 2 || !shortsCell(list.subarray(r.payloadStart, r.end), budget)) valid = false;
    });
    return count > 0 && valid;
  }
  function cleanProto(bytes, kind, budget, depth, homeContext) {
    if (depth > 32) fail("protobuf-depth-limit");
    var records = parse(bytes, budget), edges = EDGES[kind] || {}, adFields = ADS[kind] || {};
    var parts = [], removed = 0, adaptive = 0, shorts = 0, opaque = 0, eml = 0, dividers = 0, adSeen = false, drop = false;
    if (hideHomeShorts && endpoint === "browse") {
      if (kind === "tab") homeContext = ascii(child(bytes, 11, budget)) === "FEwhat_to_watch";
      if (kind === "sectionList" && !homeContext) homeContext = protoHomeContinuation(bytes, records, budget);
    }
    var listCount = 0, keptListCount = 0, pendingAd = false, divider = false;
    records.forEach(function (r) {
      if (adFields[r.no]) { if (r.wire !== 2) fail("feed-ad-schema-mismatch"); adSeen = true; }
    });
    if (adSeen && records.some(function (r) {return r.no >= 1000000 && !adFields[r.no];})) fail("feed-mixed-renderer");
    records.forEach(function (r) {
      if (adFields[r.no]) { removed++; drop = true; return; }
      if (hideHomeShorts && endpoint === "browse" && homeContext && kind === "sectionItem" && r.no === 51845067) {
        if (r.wire !== 2) fail("shorts-shelf-schema-mismatch");
        if (shortsShelf(bytes.subarray(r.payloadStart, r.end), budget) && !records.some(function (other) {return other.no >= 1000000 && other.no !== 51845067;})) {
          shorts++; drop = true; return;
        }
      }
      var next = edges[r.no];
      if (!next) { parts.push(bytes.subarray(r.start, r.end)); return; }
      if (r.wire !== 2) fail("feed-envelope-schema-mismatch");
      if (next === "opaqueElement") { opaque++; parts.push(bytes.subarray(r.start, r.end)); return; }
      var result;
      if (next === "cardElement") {
        var cardBytes = bytes.subarray(r.payloadStart, r.end);
        var identity = classifyElement(cardBytes, budget);
        if (!identity.ad && adaptiveFeedAds && cardBytes.length >= 1000 && containsASCII(cardBytes, "pagead")) {
          identity.ad = true;
          adaptive++;
        }
        if (identity.ad && records.some(function (other) {return other.no >= 1000000 && other.no !== 153515154;})) fail("feed-mixed-renderer");
        if (identity.ad) {removed++; eml++; drop = true; return;}
        opaque++;
        divider = identity.divider && records.length === 1;
        parts.push(bytes.subarray(r.start, r.end));
        return;
      }
      result = cleanProto(bytes.subarray(r.payloadStart, r.end), next, budget, depth + 1, homeContext);
      removed += result.removed; adaptive += result.adaptive || 0; shorts += result.shorts; opaque += result.opaque; eml += result.eml; dividers += result.dividers;
      if ((kind === "sectionList" || kind === "secondaryList" || kind === "itemSection") && r.no === 1) {
        listCount++;
        if (result.drop) {pendingAd = result.removed > 0; return;}
        // Remove one verified divider immediately following a deleted ad card.
        if (kind !== "itemSection" && pendingAd && result.divider) {dividers++; pendingAd = false; return;}
        pendingAd = false; keptListCount++;
        if (kind === "itemSection") divider = listCount === 1 && result.divider;
      }
      if (kind === "sectionItem" || kind === "secondaryItem") {
        if (result.drop) {
          if (records.some(function (other) {return other.no >= 1000000 && other.no !== 50195462;})) fail("feed-mixed-renderer");
          drop = true;
        }
        divider = result.divider && records.length === 1;
      }
      parts.push(result.removed || result.shorts || result.dividers ? replaceChild(bytes, r, result.body) : bytes.subarray(r.start, r.end));
    });
    if (kind === "itemSection") {
      var safeMetadata = records.every(function (r) {return r.no === 1 || r.no === 4 || r.no === 8;});
      drop = removed > 0 && listCount > 0 && keptListCount === 0 && safeMetadata;
      divider = divider && listCount === 1 && safeMetadata;
    }
    return {body:removed || shorts || dividers ? join(parts) : bytes, removed:removed, adaptive:adaptive, shorts:shorts, opaque:opaque, eml:eml, dividers:dividers, drop:drop, divider:divider};
  }

  var AD_KEYS = ["adSlotRenderer", "adPlacementRenderer", "inFeedAdLayoutRenderer",
    "displayAdRenderer", "promotedVideoRenderer", "promotedSparklesWebRenderer",
    "promotedSparklesTextSearchRenderer", "compactPromotedItemRenderer",
    "compactPromotedVideoRenderer", "gridPromotedVideoRenderer", "searchPyvRenderer",
    "carouselAdRenderer", "companionAdRenderer"];
  function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function adCard(value, depth) {
    if (!object(value) || depth > 8) return false;
    var keys = Object.keys(value), marked = false;
    keys.forEach(function (key) { if (AD_KEYS.indexOf(key) >= 0 && object(value[key])) marked = true; });
    if (marked) {
      // Retain malformed unions containing both an ad and a normal renderer.
      if (keys.some(function (key) { return /(?:Renderer|ViewModel)$/.test(key) && AD_KEYS.indexOf(key) < 0; })) fail("feed-mixed-renderer");
      return true;
    }
    // A known card wrapper with an explicitly identified ad as its content.
    if (object(value.richItemRenderer) && adCard(value.richItemRenderer.content, depth + 1)) {
      if (keys.some(function (key) {return key !== "richItemRenderer" && /(?:Renderer|ViewModel)$/.test(key);})) fail("feed-mixed-renderer");
      return true;
    }
    return false;
  }
  function jsonHome(value) {
    if (!object(value)) return false;
    if (value.targetId === "browse-feedFEwhat_to_watch") return true;
    var ids = [], browse = value.endpoint && value.endpoint.browseEndpoint;
    if (typeof value.tabIdentifier === "string") ids.push(value.tabIdentifier);
    if (browse && typeof browse.browseId === "string") ids.push(browse.browseId);
    if (Array.isArray(value.continuations)) value.continuations.forEach(function (entry) {
      if (!object(entry)) return;
      ["nextContinuationData", "reloadContinuationData"].forEach(function (key) {
        if (object(entry[key])) ids.push(continuationBrowseId(entry[key].continuation, {fields:0}));
      });
    });
    return ids.length > 0 && ids.every(function (id) {return id === "FEwhat_to_watch";});
  }
  function requestHome() {
    if (!hideHomeShorts || endpoint !== "browse") return false;
    try {
      var body = $request.body, bytes = bytesOf(body), budget = {fields:0};
      if (typeof body === "string") {
        if (body.length > MAX_BYTES) return false;
        var request = JSON.parse(body);
        return request.browseId === "FEwhat_to_watch" || (!request.browseId && continuationBrowseId(request.continuation, budget) === "FEwhat_to_watch");
      }
      if (!bytes || bytes.length > MAX_BYTES) return false;
      var id = child(bytes, 2, budget);
      if (id) return ascii(id) === "FEwhat_to_watch";
      return continuationBrowseId(asciiToken(child(bytes, 7, budget)), budget) === "FEwhat_to_watch";
    } catch (_) {return false;}
  }
  function jsonShortsCard(value, depth) {
    if (!object(value) || depth > 8) return false;
    var keys = Object.keys(value), rendererKeys = keys.filter(function (key) {return /(?:Renderer|ViewModel)$/.test(key);});
    if (rendererKeys.length !== 1) return false;
    var key = rendererKeys[0], card = value[key];
    if (!object(card)) return false;
    if (key === "richSectionRenderer") return jsonShortsCard(card.content, depth + 1);
    if (key === "itemSectionRenderer") {
      return Object.keys(card).every(function (k) {return ["contents", "trackingParams", "sectionIdentifier", "targetId"].indexOf(k) >= 0;}) &&
        Array.isArray(card.contents) && card.contents.length > 0 && card.contents.every(function (item) {return jsonShortsCard(item, depth + 1);});
    }
    function shortsItem(item, level) {
      if (!object(item) || level > 8) return false;
      var names = Object.keys(item).filter(function (k) {return /(?:Renderer|ViewModel)$/.test(k);});
      if (names.length !== 1) return false;
      if (names[0] === "richItemRenderer" && object(item.richItemRenderer)) return shortsItem(item.richItemRenderer.content, level + 1);
      return (names[0] === "reelItemRenderer" || names[0] === "shortsLockupViewModel") && object(item[names[0]]);
    }
    var items;
    if (key === "reelShelfRenderer") items = card.items;
    else if (key === "richShelfRenderer" && card.icon && card.icon.iconType === "YOUTUBE_SHORTS_BRAND_24") items = card.contents;
    else if (key === "shelfRenderer" && card.content && object(card.content.horizontalListRenderer) && Object.keys(card.content).length === 1) items = card.content.horizontalListRenderer.items;
    return Array.isArray(items) && items.length > 0 && items.every(function (item) {return shortsItem(item, 0);});
  }
  function cleanJSON(text) {
    var root = JSON.parse(text), nodes = 0, removed = 0, shorts = 0, opaque = 0;
    var enabled = hideHomeShorts && endpoint === "browse";
    function walk(value, depth, homeContext) {
      if (!value || typeof value !== "object") return;
      if (++nodes > MAX_JSON_NODES || depth > 64) fail("json-limit");
      if (Array.isArray(value)) { value.forEach(function (v) {walk(v, depth + 1, homeContext);}); return; }
      if (enabled && jsonHome(value)) homeContext = true;
      Object.keys(value).forEach(function (key) {
        var child = value[key];
        if (key === "elementRenderer") opaque++;
        // Only actual list fields get item removal; renderer-looking metadata
        // elsewhere and titles stay untouched. Shorts require a home identity.
        if ((key === "contents" || key === "continuationItems" || key === "results" || key === "items") && Array.isArray(child)) {
          value[key] = child.filter(function (entry) {
            if (adCard(entry, 0)) { removed++; return false; }
            if (enabled && homeContext && jsonShortsCard(entry, 0)) {shorts++; return false;}
            return true;
          });
          child = value[key];
        }
        walk(child, depth + 1, key === "tabRenderer" ? enabled && jsonHome(child) : homeContext);
      });
    }
    walk(root, 0, requestHome());
    return {body:removed || shorts ? JSON.stringify(root) : text, removed:removed, shorts:shorts, opaque:opaque};
  }
  function run() {
    var match = API.exec(typeof $request !== "undefined" ? $request.url || "" : "");
    if (!match || typeof $response === "undefined") return {};
    endpoint = match[1].toLowerCase();
    if ($response.status !== undefined && Number($response.status) !== 200) {log("pass: non-200"); return {};}
    var type = header($response.headers, "content-type").split(";")[0].trim();
    var body = $response.body, bytes = bytesOf(body);
    if (typeof body !== "string" && !bytes) {log("pass: body unavailable"); return {};}
    if ((bytes ? bytes.length : devUTF8Size(body)) > MAX_BYTES) {log("pass: size-limit"); return {};}
    if (!(bytes ? bytes.length : body.length)) {log("pass: empty"); return {};}
    if (bytes && bytes[0] === 31 && bytes[1] === 139) {log("pass: compressed body"); return {};}
    var json = /^(?:application\/(?:json|[\w.+-]+\+json)|text\/json)$/.test(type), result;
    if (json || (!type && typeof body === "string")) {
      var text = body;
      if (bytes) {
        if (typeof TextDecoder !== "function") {log("pass: no UTF-8 decoder"); return {};}
        text = new TextDecoder("utf-8", {fatal:true}).decode(bytes);
      }
      result = cleanJSON(text);
      if ((result.removed || result.shorts) && bytes) {
        if (typeof TextEncoder !== "function") {log("pass: no UTF-8 encoder"); return {};}
        result.body = new TextEncoder().encode(result.body);
      }
    } else {
      if (!bytes || !/^(?:application\/(?:x-protobuf|protobuf|vnd\.google\.protobuf|octet-stream))$/.test(type)) {log("pass: unsupported content type"); return {};}
      if (endpoint === "search") {log("pass: search protobuf schema unsupported"); return {};}
      result = cleanProto(bytes, endpoint, {fields:0}, 0, requestHome());
    }
    log((result.removed || result.shorts ? "changed" : "pass") + ": removed=" + result.removed + " adaptive_removed=" + (result.adaptive || 0) + " format=" + (json || typeof body === "string" ? "json" : "protobuf") + " opaque_elements=" + result.opaque + " removed_eml=" + (result.eml || 0) + " removed_dividers=" + (result.dividers || 0) + " hidden_shorts=" + (result.shorts || 0));
    return result.removed || result.shorts ? {body:result.body} : {};
  }
  var output = {};
  try { output = run(); }
  catch (error) {devFailure(error); log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));}
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && API.test($request.url || "")) devCapture("YouTubeFeedAds", "response", endpoint, VERSION, output);
  $done(output);
})();
