/*
 * YouTubeNoAds 1.0.0 — standalone Loon response script.
 * No imports, remote calls, storage, redirects, or media request blocking.
 * Wire-format reader written here from the Protocol Buffers encoding spec.
 * Reverse-engineered schema: Player fields 7/68; get_watch path 1 -> 2.
 * These field numbers are not a public YouTube compatibility guarantee.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_FIELDS = 30000;
  var MAX_JSON_NODES = 20000;
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(player|get_watch)(?:\?[^#]*)?$/i;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var debug = args.script_debug !== false && args.script_debug !== "false";
  var endpoint = "unknown";

  function log(message) {
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubeNoAds " + VERSION + "] " + endpoint + " " + message);
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

  function cleanPlayer(bytes, budget) {
    var records = parse(bytes, budget);
    var recognized = false;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.no === 2) {
        if (r.wire !== 2) fail("player-schema-mismatch");
        var status = parse(bytes.subarray(r.payloadStart, r.end), budget);
        for (var s = 0; s < status.length; s++) {
          if (status[s].no === 1 && status[s].wire !== 0) fail("status-schema-mismatch");
        }
        recognized = true;
      }
      if ((r.no === 7 || r.no === 68) && r.wire !== 2) fail("ad-schema-mismatch");
    }
    if (!recognized) return { body: bytes, removed: 0 };
    var parts = [];
    var removed = 0;
    for (var j = 0; j < records.length; j++) {
      var field = records[j];
      if (field.no === 7 || field.no === 68) removed++;
      else parts.push(bytes.subarray(field.start, field.end));
    }
    return { body: removed ? join(parts) : bytes, removed: removed };
  }

  // Rebuild only the enclosing length when a known child changes. Everything
  // else, including unknown fields, ordering and original varints, stays raw.
  function cleanWatch(bytes, budget, level) {
    var records = parse(bytes, budget);
    var target = level === 0 ? 1 : 2;
    var parts = [];
    var removed = 0;
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
      parts.push(result.removed ? replaceChild(bytes, r, result.body) : bytes.subarray(r.start, r.end));
    }
    return { body: removed ? join(parts) : bytes, removed: removed };
  }

  function cleanJSON(text) {
    var root = JSON.parse(text);
    if (!root || typeof root !== "object") return { body: text, removed: 0 };
    var queue = [{ value: root, depth: 0, player: endpoint === "player" }];
    var count = 0;
    var removed = 0;
    function enqueue(value, depth, player) {
      if (count + queue.length >= MAX_JSON_NODES || depth > 64) fail("json-limit");
      queue.push({ value: value, depth: depth, player: player });
    }
    while (queue.length) {
      var item = queue.pop();
      var value = item.value;
      if (++count > MAX_JSON_NODES || item.depth > 64) fail("json-limit");
      if (Array.isArray(value)) {
        for (var a = 0; a < value.length; a++) {
          if (value[a] && typeof value[a] === "object") {
            enqueue(value[a], item.depth + 1, item.player);
          }
        }
        continue;
      }
      var isPlayer = item.player || Object.prototype.hasOwnProperty.call(value, "playabilityStatus") ||
        Object.prototype.hasOwnProperty.call(value, "streamingData");
      if (isPlayer) {
        var adKeys = ["adPlacements", "adSlots", "playerAds"];
        for (var k = 0; k < adKeys.length; k++) {
          if (Object.prototype.hasOwnProperty.call(value, adKeys[k])) {
            delete value[adKeys[k]];
            removed++;
          }
        }
      }
      var keys = Object.keys(value);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var child = value[key];
        if (child && typeof child === "object") {
          enqueue(child, item.depth + 1, key === "playerResponse" || key === "player");
        }
      }
    }
    return { body: removed ? JSON.stringify(root) : text, removed: removed };
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
      if (result.removed && bytes) {
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
    log((result.removed ? "changed" : "pass") + ": removed=" + result.removed +
      " format=" + (typeof body === "string" || json ? "json" : "protobuf"));
    return result.removed ? { body: result.body } : {};
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
