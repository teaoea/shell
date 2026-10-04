/**
 * 文件：YouTubePlayback.js
 * 功能：统一处理播放器请求、播放器响应、片头与中插配置、Shorts 播放广告、UMP 预取提示和后台播放。
 * 版本：3.0.0
 * 更新时间：2026-10-04T08:54:22+08:00
 * 运行环境：Loon JavaScript
 */
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";
  var dispatcherUrl = typeof $request !== "undefined" ? String($request.url || "") : "";
  var dispatcherResponse = typeof $response !== "undefined";
  if (typeof module !== "undefined" && module.exports && typeof $done === "undefined") {







/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
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
  /**
   * 功能：保存运行异常的结构化信息，供完整日志导出。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFailure(error) {
    if (!devFlag(args.capture_raw)) return;
    try { devException = {name:String(error.name || "Error"), message:String(error.message || ""), stack:typeof error.stack === "string" ? error.stack : null, code:error.ytNoAdsCode || null}; } catch (_) {}
  }
  var devStarted = Date.now();

  /**
   * 功能：判断开发日志参数是否明确开启。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFlag(value) { return value === true || value === "true"; }
  /**
   * 功能：读取并校验当前日志记录会话配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devConfig() {
    if (!devFlag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read("ytads.logger.config.v1");
    var c = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null;
  }
  /**
   * 功能：计算字符串序列化为 UTF-8 后的字节数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把二进制数据编码为 Base64 文本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把运行时正文转换为可导出的文本或二进制结构。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：在日志容量或存储异常时暂停继续写入。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devHalt(c, reason) {
    if (c) {
      c.enabled = false;
      c.haltReason = reason;
      c.haltedAt = new Date().toISOString();
      $persistentStore.write(JSON.stringify(c), "ytads.logger.config.v1");
    }
    if (typeof console !== "undefined") console.log("[YouTubeLogger] recording-stopped: " + reason);
  }
  /**
   * 功能：把摘要与原始样本追加到统一日志缓存。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
      written.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { try { $persistentStore.write(undefined, key); } catch (_) {} });
      try { devHalt(c, "storage-or-serialization-failed"); } catch (_) {}
      return false;
    }
  }
  /**
   * 功能：计算日志分块的一致性校验值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devChecksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：生成请求与响应之间的本地关联标识。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devCorrelation(method, url) {

    return devChecksum(method + " " + url);
  }
  /**
   * 功能：记录请求或响应处理前后的完整开发样本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：把符合级别要求的处理摘要保存到统一日志。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function saveLog(message) {
    devMessages.push(message);

    if (devFlag(args.capture_raw)) return;
    var ranks = {debug:0, info:1, warn:2, error:3};
    var level = message.indexOf("changed:") === 0 ? "info" :
      message === "pass: parse/schema check failed" ? "error" :
      /^(pass: (removed=|mode=|non-UMP))/.test(message) ? "debug" : "warn";
    var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubePlayback", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  /**
   * 功能：写入脱敏处理摘要，并按需输出调试信息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubePlayback " + VERSION + "] " + endpoint + " " + message);
    }
  }

  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) {
    var error = new Error(code);
    error.ytNoAdsCode = code;
    throw error;
  }

  /**
   * 功能：按不区分大小写的方式读取 HTTP 请求头。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return String(headers[keys[i]]).toLowerCase();
    }
    return "";
  }

  /**
   * 功能：把 Loon 运行时正文安全转换为 Uint8Array。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function bytesOf(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return null;
  }



  /**
   * 功能：读取受限的 32 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：跳过并校验 64 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function skip64(bytes, cursor) {
    for (var i = 0; i < 10; i++) {
      if (cursor.pos >= bytes.length) fail("truncated-varint");
      var b = bytes[cursor.pos++];
      if (i === 9 && b > 1) fail("uint64-overflow");
      if (!(b & 128)) return;
    }
    fail("invalid-varint");
  }

  /**
   * 功能：解析 Protobuf 字段边界并保留原始字节位置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


      else fail("unsupported-wire-type");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({ no: no, wire: wire, start: start, tagEnd: tagEnd,
        payloadStart: payloadStart, end: cursor.pos });
    }
    return records;
  }

  /**
   * 功能：合并多个二进制片段并保持顺序。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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



  /**
   * 功能：执行 readUMPInt 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 encodeUMPInt 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 scalar32 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function scalar32(bytes, record) {
    if (record.wire !== 0) fail("cue-schema-mismatch");
    var cursor = { pos: record.payloadStart };
    var value = read32(bytes, cursor);
    if (cursor.pos !== record.end) fail("cue-scalar-mismatch");
    return value;
  }

  /**
   * 功能：执行 inspectCueInfo 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function inspectCueInfo(bytes, budget, summary) {
    var records = parse(bytes, budget);
    var cue = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].no !== 1) continue;
      if (records[i].wire !== 2) fail("cue-info-schema-mismatch");


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

  /**
   * 功能：执行 cleanCueList 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：解析 UMP 分片并按所选模式清理广告预取提示。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


      if (type === 69) {
        var result = cleanCueList(bytes.subarray(payloadStart, cursor.pos), budget, summary, mode === "clean_prefetch");
        removed += result.removed;
        parts.push(result.removed ? join([bytes.subarray(start, typeEnd), encodeUMPInt(result.body.length), result.body]) : bytes.subarray(start, cursor.pos));
      } else parts.push(bytes.subarray(start, cursor.pos));
    }
    return { body: removed ? join(parts) : bytes, removed: removed, summary: summary };
  }

  /**
   * 功能：执行 runUMP 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
    var ids = Object.keys(summary.partCounts).sort(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (a, b) { return Number(a) - Number(b); });
    var partCounts = ids.slice(0, 24).map(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (id) { return id + ":" + summary.partCounts[id]; }).join(",");
    log((result.removed ? "changed" : "pass") + ": mode=" + (args.ump_mode || "inspect") +
      " removed_prefetch=" + result.removed + " ad_cues=" + summary.adCues +
      " ad_prefetch=" + summary.adPrefetch + " other_ad_cues=" + summary.otherAdCues +
      " bytes=" + bytes.length + " parts=" + partCounts + (ids.length > 24 ? ",..." : ""));
    return result.removed ? { body: result.body } : {};
  }

  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function run() {
    if (typeof $request === "undefined" || typeof $response === "undefined" || !MEDIA_API.test($request.url || "")) return {};
    return runUMP();
  }


  if (typeof module !== "undefined" && module.exports && typeof $done === "undefined") {
    module.exports = { processUMP: processUMP, readUMPInt: readUMPInt, encodeUMPInt: encodeUMPInt };
    return;
  }

  var output = {};
  try { output = run(); }
  catch (error) {
    devFailure(error);


    log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));
  }
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && MEDIA_API.test($request.url || "")) devCapture("YouTubePlayback", "response", endpoint, VERSION, output);
  $done(output);
})();

    return;
  }
  if (!dispatcherResponse && /\/youtubei\/v1\/player\/ad_break(?:\?[^#]*)?$/i.test(dispatcherUrl)) {





/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SOURCE = "YouTubePlayback";
  var ENDPOINT = "ad_break";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/player\/ad_break(?:\?[^#]*)?$/i;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var enabled = args.block_ad_break !== false && args.block_ad_break !== "false";
  var debug = args.script_debug === true || args.script_debug === "true";

  /**
   * 功能：把 Loon 参数转换为严格布尔值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function flag(value) { return value === true || value === "true"; }
  /**
   * 功能：执行 utf8Size 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 checksum 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function checksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619);}
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：执行 base64 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 captureBody 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function captureBody(body) {
    if (body === undefined || body === null) return {available:false, reason:"not-provided-by-runtime"};
    if (typeof body === "string") return {available:true, encoding:"utf8-text", bytes:utf8Size(body), data:body};
    var bytes = body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) :
      ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
    return bytes ? {available:true, encoding:"base64", bytes:bytes.length, data:base64(bytes)} :
      {available:false, reason:"unsupported-runtime-body-type"};
  }
  /**
   * 功能：执行 loggerConfig 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function loggerConfig() {
    if (!flag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read(CONFIG), value = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return value && value.enabled === true && typeof value.session === "string" && /^[a-z0-9-]{1,80}$/.test(value.session) ? value : null;
  }
  /**
   * 功能：执行 append 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：记录当前配置或请求处理结果。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  }
  else if (!dispatcherResponse && /\/youtubei\/v1\/(?:player|get_watch)(?:\?[^#]*)?$/i.test(dispatcherUrl)) {









/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SOURCE = "YouTubePlayback";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var MAX_BODY = 2097152;
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var enabled = args.suppress_player_ads !== false && args.suppress_player_ads !== "false";
  var debug = args.script_debug === true || args.script_debug === "true";

  /**
   * 功能：把 Loon 参数转换为严格布尔值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function flag(value) { return value === true || value === "true"; }
  /**
   * 功能：执行 endpoint 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function endpoint(url) {
    var match = /\/youtubei\/v1\/(player|get_watch)(?:\?[^#]*)?$/i.exec(url || "");
    return match ? match[1].toLowerCase() : null;
  }
  /**
   * 功能：把 Loon 运行时正文安全转换为 Uint8Array。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
  }
  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) { throw new Error(code); }
  /**
   * 功能：读取 Protobuf 变长整数并推进游标。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：解析 Protobuf 字段边界并保留原始字节位置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把整数编码为 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function varint(value) {
    var result = [];
    do { var byte = value % 128; value = Math.floor(value / 128); result.push(byte + (value ? 128 : 0)); } while (value);
    return new Uint8Array(result);
  }
  /**
   * 功能：合并多个二进制片段并保持顺序。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function concat(parts) {
    var size = 0, i, offset = 0;
    for (i = 0; i < parts.length; i++) size += parts[i].length;
    var output = new Uint8Array(size);
    for (i = 0; i < parts.length; i++) { output.set(parts[i], offset); offset += parts[i].length; }
    return output;
  }
  /**
   * 功能：编码长度限定的 Protobuf 消息字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function message(no, payload) { return concat([varint(no * 8 + 2), varint(payload.length), payload]); }
  /**
   * 功能：编码 Protobuf 标量字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function scalar(no, value) { return concat([varint(no * 8), varint(value)]); }
  /**
   * 功能：取得指定 Protobuf 字段的原始字节。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function raw(bytes, record) { return bytes.subarray(record.start, record.end); }

  /**
   * 功能：清理播放器上下文中的广告协商字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：清理内容播放上下文里的广告参数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：重建已修改的播放上下文消息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：清理播放器消息中的广告配置并保留未知字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 cleanGetWatch 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 cleanJson 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function cleanJson(value, kind, counts) {
    /**
     * 功能：执行 context 对应的内部处理步骤。
     * 更新时间：2026-10-04T08:54:22+08:00
     */
    function context(target) {
      if (target && typeof target === "object" && Object.prototype.hasOwnProperty.call(target, "adSignalsInfo")) {
        delete target.adSignalsInfo; counts.contextAdSignals++;
      }
    }
    /**
     * 功能：执行 player 对应的内部处理步骤。
     * 更新时间：2026-10-04T08:54:22+08:00
     */
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
  /**
   * 功能：执行 utf8Size 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 checksum 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function checksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：执行 base64 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 captureBody 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function captureBody(body) {
    if (body === undefined || body === null) return {available:false, reason:"not-provided-by-runtime"};
    if (typeof body === "string") return {available:true, encoding:"utf8-text", bytes:utf8Size(body), data:body};
    var bytes = bytesOf(body);
    return bytes ? {available:true, encoding:"base64", bytes:bytes.length, data:base64(bytes)} :
      {available:false, reason:"unsupported-runtime-body-type"};
  }
  /**
   * 功能：执行 loggerConfig 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function loggerConfig() {
    if (!flag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read(CONFIG), value = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return value && value.enabled === true && typeof value.session === "string" && /^[a-z0-9-]{1,80}$/.test(value.session) ? value : null;
  }
  /**
   * 功能：执行 append 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 save 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function save(message, level, kind) {
    try {
      if (flag(args.capture_raw) || !flag(args.log_enabled) || typeof $persistentStore === "undefined") return;
      var ranks = {debug:0, info:1, warn:2, error:3};
      var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
      if (!Object.prototype.hasOwnProperty.call(ranks, level) || ranks[level] < ranks[minimum]) return;
      append({source:SOURCE, version:VERSION, endpoint:kind, level:level, time:new Date().toISOString(), phase:"request", message:message}, null);
    } catch (_) {}
  }
  /**
   * 功能：执行 captureDevelopment 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：写入脱敏处理摘要，并按需输出调试信息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function log(message, level, kind) {
    save(message, level, kind);
    if (debug && typeof console !== "undefined") console.log("[" + SOURCE + " " + VERSION + "] " + kind + " " + message);
  }
  /**
   * 功能：执行 outputHeaders 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function outputHeaders(headers) {
    var result = {}, source = headers || {};
    Object.keys(source).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) {
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

  }
  else if (dispatcherResponse && /\/youtubei\/v1\/(?:player|get_watch)(?:\?[^#]*)?$/i.test(dispatcherUrl)) {










/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";

  var VERSION = "2.1.0";
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var debug = args.script_debug === true || args.script_debug === "true";
  var backgroundPlayback = args.background_playback === true || args.background_playback === "true";
  var endpoint = "unknown";
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_JSON_NODES = 20000;
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(player|get_watch)(?:\?[^#]*)?$/i;

  var devMessages = [];
  var devException = null;
  /**
   * 功能：保存运行异常的结构化信息，供完整日志导出。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFailure(error) {
    if (!devFlag(args.capture_raw)) return;
    try { devException = {name:String(error.name || "Error"), message:String(error.message || ""), stack:typeof error.stack === "string" ? error.stack : null, code:error.ytNoAdsCode || null}; } catch (_) {}
  }
  var devStarted = Date.now();

  /**
   * 功能：判断开发日志参数是否明确开启。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFlag(value) { return value === true || value === "true"; }
  /**
   * 功能：读取并校验当前日志记录会话配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devConfig() {
    if (!devFlag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read("ytads.logger.config.v1");
    var c = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null;
  }
  /**
   * 功能：计算字符串序列化为 UTF-8 后的字节数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把二进制数据编码为 Base64 文本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把运行时正文转换为可导出的文本或二进制结构。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：在日志容量或存储异常时暂停继续写入。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devHalt(c, reason) {
    if (c) {
      c.enabled = false;
      c.haltReason = reason;
      c.haltedAt = new Date().toISOString();
      $persistentStore.write(JSON.stringify(c), "ytads.logger.config.v1");
    }
    if (typeof console !== "undefined") console.log("[YouTubeLogger] recording-stopped: " + reason);
  }
  /**
   * 功能：把摘要与原始样本追加到统一日志缓存。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
      written.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { try { $persistentStore.write(undefined, key); } catch (_) {} });
      try { devHalt(c, "storage-or-serialization-failed"); } catch (_) {}
      return false;
    }
  }
  /**
   * 功能：计算日志分块的一致性校验值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devChecksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：生成请求与响应之间的本地关联标识。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devCorrelation(method, url) {

    return devChecksum(method + " " + url);
  }
  /**
   * 功能：记录请求或响应处理前后的完整开发样本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
          arguments:{background_playback:backgroundPlayback, log_level:args.log_level || "info"}}};
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

  /**
   * 功能：把符合级别要求的处理摘要保存到统一日志。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function saveLog(message) {
    devMessages.push(message);

    if (devFlag(args.capture_raw)) return;
    var ranks = {debug:0, info:1, warn:2, error:3};
    var level = message.indexOf("changed:") === 0 ? "info" :
      message === "pass: parse/schema check failed" ? "error" :
      /^(pass: (removed=|mode=|non-UMP))/.test(message) ? "debug" : "warn";
    var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubePlayback", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  /**
   * 功能：写入脱敏处理摘要，并按需输出调试信息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubePlayback " + VERSION + "] " + endpoint + " " + message);
    }
  }

  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) {
    var error = new Error(code);
    error.ytNoAdsCode = code;
    throw error;
  }

  /**
   * 功能：按不区分大小写的方式读取 HTTP 请求头。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return String(headers[keys[i]]).toLowerCase();
    }
    return "";
  }

  /**
   * 功能：把 Loon 运行时正文安全转换为 Uint8Array。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function bytesOf(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return null;
  }



  /**
   * 功能：读取受限的 32 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：跳过并校验 64 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function skip64(bytes, cursor) {
    for (var i = 0; i < 10; i++) {
      if (cursor.pos >= bytes.length) fail("truncated-varint");
      var b = bytes[cursor.pos++];
      if (i === 9 && b > 1) fail("uint64-overflow");
      if (!(b & 128)) return;
    }
    fail("invalid-varint");
  }

  /**
   * 功能：解析 Protobuf 字段边界并保留原始字节位置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


      else fail("unsupported-wire-type");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({ no: no, wire: wire, start: start, tagEnd: tagEnd,
        payloadStart: payloadStart, end: cursor.pos });
    }
    return records;
  }

  /**
   * 功能：编码 Protobuf 长度或整数值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function encodeLength(value) {
    var out = [];
    do {
      var b = value % 128;
      value = Math.floor(value / 128);
      out.push(b + (value ? 128 : 0));
    } while (value);
    return new Uint8Array(out);
  }

  /**
   * 功能：按照字段号和 wire type 重新编码 Protobuf 字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function encodeField(no, wire, payload) {
    return join([encodeLength(no * 8 + wire), wire === 2 ? encodeLength(payload.length) : new Uint8Array(0), payload]);
  }

  /**
   * 功能：合并多个二进制片段并保持顺序。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 replaceChild 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function replaceChild(bytes, record, body) {
    return join([bytes.subarray(record.start, record.tagEnd),
      encodeLength(body.length), body]);
  }

  /**
   * 功能：执行 varintIsTrue 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function varintIsTrue(bytes, record) {
    for (var i = record.tagEnd; i < record.end; i++) {
      if ((bytes[i] & 127) !== 0) return true;
    }
    return false;
  }

  /**
   * 功能：执行 enableNestedBoolean 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
      if (!active || childRecords.filter(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (item) {return item.no === 1;}).length !== 1) changed = true;
    }
    if (!found) { parts.push(extension); changed = true; }
    return {body:changed ? join(parts) : bytes, changed:changed};
  }



  /**
   * 功能：执行 enableBackground 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：移除已确认的 pagead 播放追踪字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：清理播放器消息中的广告配置并保留未知字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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



  /**
   * 功能：沿 get_watch 已知消息路径清理播放器数据。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：清理已确认 JSON 结构中的广告字段或条目。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function cleanJSON(text) {
    var root = JSON.parse(text);
    if (!root || typeof root !== "object") return { body: text, removed: 0, tracking: 0, background: 0 };
    var queue = [{ value: root, depth: 0, player: endpoint === "player", backgroundTarget: endpoint === "player" }];
    var count = 0;
    var removed = 0;
    var tracking = 0;
    var background = 0;
    /**
     * 功能：执行 enqueue 对应的内部处理步骤。
     * 更新时间：2026-10-04T08:54:22+08:00
     */
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

  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


    log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));
  }
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && API.test($request.url || "")) devCapture("YouTubePlayback", "response", endpoint, VERSION, output);
  $done(output);
})();

  }
  else if (dispatcherResponse && /\/youtubei\/v1\/reel\/reel_watch_sequence(?:\?[^#]*)?$/i.test(dispatcherUrl)) {






/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var debug = args.script_debug === true || args.script_debug === "true";
  var removeShortsAds = args.remove_shorts_ads !== false && args.remove_shorts_ads !== "false";
  var endpoint = "unknown";
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_JSON_NODES = 20000;
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/reel\/reel_watch_sequence(?:\?[^#]*)?$/i;

  var devMessages = [];
  var devException = null;
  /**
   * 功能：保存运行异常的结构化信息，供完整日志导出。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFailure(error) {
    if (!devFlag(args.capture_raw)) return;
    try { devException = {name:String(error.name || "Error"), message:String(error.message || ""), stack:typeof error.stack === "string" ? error.stack : null, code:error.ytNoAdsCode || null}; } catch (_) {}
  }
  var devStarted = Date.now();

  /**
   * 功能：判断开发日志参数是否明确开启。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFlag(value) { return value === true || value === "true"; }
  /**
   * 功能：读取并校验当前日志记录会话配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devConfig() {
    if (!devFlag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read("ytads.logger.config.v1");
    var c = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null;
  }
  /**
   * 功能：计算字符串序列化为 UTF-8 后的字节数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把二进制数据编码为 Base64 文本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把运行时正文转换为可导出的文本或二进制结构。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：在日志容量或存储异常时暂停继续写入。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devHalt(c, reason) {
    if (c) {
      c.enabled = false;
      c.haltReason = reason;
      c.haltedAt = new Date().toISOString();
      $persistentStore.write(JSON.stringify(c), "ytads.logger.config.v1");
    }
    if (typeof console !== "undefined") console.log("[YouTubeLogger] recording-stopped: " + reason);
  }
  /**
   * 功能：把摘要与原始样本追加到统一日志缓存。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
      written.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { try { $persistentStore.write(undefined, key); } catch (_) {} });
      try { devHalt(c, "storage-or-serialization-failed"); } catch (_) {}
      return false;
    }
  }
  /**
   * 功能：计算日志分块的一致性校验值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devChecksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：生成请求与响应之间的本地关联标识。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devCorrelation(method, url) {

    return devChecksum(method + " " + url);
  }
  /**
   * 功能：记录请求或响应处理前后的完整开发样本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：把符合级别要求的处理摘要保存到统一日志。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function saveLog(message) {
    devMessages.push(message);

    if (devFlag(args.capture_raw)) return;
    var ranks = {debug:0, info:1, warn:2, error:3};
    var level = message.indexOf("changed:") === 0 ? "info" :
      message === "pass: parse/schema check failed" ? "error" :
      /^(pass: (removed=|mode=|non-UMP))/.test(message) ? "debug" : "warn";
    var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubePlayback", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  /**
   * 功能：写入脱敏处理摘要，并按需输出调试信息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubePlayback " + VERSION + "] " + endpoint + " " + message);
    }
  }

  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) {
    var error = new Error(code);
    error.ytNoAdsCode = code;
    throw error;
  }

  /**
   * 功能：按不区分大小写的方式读取 HTTP 请求头。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return String(headers[keys[i]]).toLowerCase();
    }
    return "";
  }

  /**
   * 功能：把 Loon 运行时正文安全转换为 Uint8Array。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function bytesOf(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return null;
  }



  /**
   * 功能：读取受限的 32 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：跳过并校验 64 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function skip64(bytes, cursor) {
    for (var i = 0; i < 10; i++) {
      if (cursor.pos >= bytes.length) fail("truncated-varint");
      var b = bytes[cursor.pos++];
      if (i === 9 && b > 1) fail("uint64-overflow");
      if (!(b & 128)) return;
    }
    fail("invalid-varint");
  }

  /**
   * 功能：解析 Protobuf 字段边界并保留原始字节位置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


      else fail("unsupported-wire-type");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({ no: no, wire: wire, start: start, tagEnd: tagEnd,
        payloadStart: payloadStart, end: cursor.pos });
    }
    return records;
  }

  /**
   * 功能：编码 Protobuf 长度或整数值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function encodeLength(value) {
    var out = [];
    do {
      var b = value % 128;
      value = Math.floor(value / 128);
      out.push(b + (value ? 128 : 0));
    } while (value);
    return new Uint8Array(out);
  }

  /**
   * 功能：按照字段号和 wire type 重新编码 Protobuf 字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function encodeField(no, wire, payload) {
    return join([encodeLength(no * 8 + wire), wire === 2 ? encodeLength(payload.length) : new Uint8Array(0), payload]);
  }

  /**
   * 功能：合并多个二进制片段并保持顺序。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 replaceChild 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function replaceChild(bytes, record, body) {
    return join([bytes.subarray(record.start, record.tagEnd),
      encodeLength(body.length), body]);
  }

  /**
   * 功能：执行 varintIsTrue 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function varintIsTrue(bytes, record) {
    for (var i = record.tagEnd; i < record.end; i++) {
      if ((bytes[i] & 127) !== 0) return true;
    }
    return false;
  }

  /**
   * 功能：执行 oneMessage 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function oneMessage(bytes, no, budget) {
    var records = parse(bytes, budget), matches = [];
    for (var i = 0; i < records.length; i++) if (records[i].no === no) matches.push(records[i]);
    if (matches.length !== 1 || matches[0].wire !== 2) return null;
    return bytes.subarray(matches[0].payloadStart, matches[0].end);
  }




  /**
   * 功能：执行 protobufAdEntry 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：清理已确认 Protobuf 结构中的广告字段或条目。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 object 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function object(value) {return !!value && typeof value === "object" && !Array.isArray(value);}
  /**
   * 功能：执行 jsonAdEntry 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function jsonAdEntry(entry) {
    var endpointValue = entry && entry.command && entry.command.reelWatchEndpoint;
    return object(endpointValue) && object(endpointValue.adClientParams) && endpointValue.adClientParams.isAd === true;
  }

  /**
   * 功能：清理已确认 JSON 结构中的广告字段或条目。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
          value[key] = child.filter(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (entry) {
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

  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && API.test($request.url || "")) devCapture("YouTubePlayback", "response", endpoint, VERSION, output);
  $done(output);
})();

  }
  else if (dispatcherResponse && /\/videoplayback\?[^#]*$/i.test(dispatcherUrl)) {







/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
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
  /**
   * 功能：保存运行异常的结构化信息，供完整日志导出。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFailure(error) {
    if (!devFlag(args.capture_raw)) return;
    try { devException = {name:String(error.name || "Error"), message:String(error.message || ""), stack:typeof error.stack === "string" ? error.stack : null, code:error.ytNoAdsCode || null}; } catch (_) {}
  }
  var devStarted = Date.now();

  /**
   * 功能：判断开发日志参数是否明确开启。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFlag(value) { return value === true || value === "true"; }
  /**
   * 功能：读取并校验当前日志记录会话配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devConfig() {
    if (!devFlag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read("ytads.logger.config.v1");
    var c = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null;
  }
  /**
   * 功能：计算字符串序列化为 UTF-8 后的字节数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把二进制数据编码为 Base64 文本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：把运行时正文转换为可导出的文本或二进制结构。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：在日志容量或存储异常时暂停继续写入。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devHalt(c, reason) {
    if (c) {
      c.enabled = false;
      c.haltReason = reason;
      c.haltedAt = new Date().toISOString();
      $persistentStore.write(JSON.stringify(c), "ytads.logger.config.v1");
    }
    if (typeof console !== "undefined") console.log("[YouTubeLogger] recording-stopped: " + reason);
  }
  /**
   * 功能：把摘要与原始样本追加到统一日志缓存。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
      written.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { try { $persistentStore.write(undefined, key); } catch (_) {} });
      try { devHalt(c, "storage-or-serialization-failed"); } catch (_) {}
      return false;
    }
  }
  /**
   * 功能：计算日志分块的一致性校验值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devChecksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：生成请求与响应之间的本地关联标识。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devCorrelation(method, url) {

    return devChecksum(method + " " + url);
  }
  /**
   * 功能：记录请求或响应处理前后的完整开发样本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：把符合级别要求的处理摘要保存到统一日志。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function saveLog(message) {
    devMessages.push(message);

    if (devFlag(args.capture_raw)) return;
    var ranks = {debug:0, info:1, warn:2, error:3};
    var level = message.indexOf("changed:") === 0 ? "info" :
      message === "pass: parse/schema check failed" ? "error" :
      /^(pass: (removed=|mode=|non-UMP))/.test(message) ? "debug" : "warn";
    var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";
    if (ranks[level] >= ranks[minimum]) devAppend({source:"YouTubePlayback", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  /**
   * 功能：写入脱敏处理摘要，并按需输出调试信息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubePlayback " + VERSION + "] " + endpoint + " " + message);
    }
  }

  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) {
    var error = new Error(code);
    error.ytNoAdsCode = code;
    throw error;
  }

  /**
   * 功能：按不区分大小写的方式读取 HTTP 请求头。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return String(headers[keys[i]]).toLowerCase();
    }
    return "";
  }

  /**
   * 功能：把 Loon 运行时正文安全转换为 Uint8Array。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function bytesOf(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return null;
  }



  /**
   * 功能：读取受限的 32 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：跳过并校验 64 位 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function skip64(bytes, cursor) {
    for (var i = 0; i < 10; i++) {
      if (cursor.pos >= bytes.length) fail("truncated-varint");
      var b = bytes[cursor.pos++];
      if (i === 9 && b > 1) fail("uint64-overflow");
      if (!(b & 128)) return;
    }
    fail("invalid-varint");
  }

  /**
   * 功能：解析 Protobuf 字段边界并保留原始字节位置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


      else fail("unsupported-wire-type");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({ no: no, wire: wire, start: start, tagEnd: tagEnd,
        payloadStart: payloadStart, end: cursor.pos });
    }
    return records;
  }

  /**
   * 功能：合并多个二进制片段并保持顺序。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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



  /**
   * 功能：执行 readUMPInt 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 encodeUMPInt 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：执行 scalar32 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function scalar32(bytes, record) {
    if (record.wire !== 0) fail("cue-schema-mismatch");
    var cursor = { pos: record.payloadStart };
    var value = read32(bytes, cursor);
    if (cursor.pos !== record.end) fail("cue-scalar-mismatch");
    return value;
  }

  /**
   * 功能：执行 inspectCueInfo 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function inspectCueInfo(bytes, budget, summary) {
    var records = parse(bytes, budget);
    var cue = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].no !== 1) continue;
      if (records[i].wire !== 2) fail("cue-info-schema-mismatch");


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

  /**
   * 功能：执行 cleanCueList 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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

  /**
   * 功能：解析 UMP 分片并按所选模式清理广告预取提示。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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


      if (type === 69) {
        var result = cleanCueList(bytes.subarray(payloadStart, cursor.pos), budget, summary, mode === "clean_prefetch");
        removed += result.removed;
        parts.push(result.removed ? join([bytes.subarray(start, typeEnd), encodeUMPInt(result.body.length), result.body]) : bytes.subarray(start, cursor.pos));
      } else parts.push(bytes.subarray(start, cursor.pos));
    }
    return { body: removed ? join(parts) : bytes, removed: removed, summary: summary };
  }

  /**
   * 功能：执行 runUMP 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
    var ids = Object.keys(summary.partCounts).sort(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (a, b) { return Number(a) - Number(b); });
    var partCounts = ids.slice(0, 24).map(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (id) { return id + ":" + summary.partCounts[id]; }).join(",");
    log((result.removed ? "changed" : "pass") + ": mode=" + (args.ump_mode || "inspect") +
      " removed_prefetch=" + result.removed + " ad_cues=" + summary.adCues +
      " ad_prefetch=" + summary.adPrefetch + " other_ad_cues=" + summary.otherAdCues +
      " bytes=" + bytes.length + " parts=" + partCounts + (ids.length > 24 ? ",..." : ""));
    return result.removed ? { body: result.body } : {};
  }

  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function run() {
    if (typeof $request === "undefined" || typeof $response === "undefined" || !MEDIA_API.test($request.url || "")) return {};
    return runUMP();
  }


  if (typeof module !== "undefined" && module.exports && typeof $done === "undefined") {
    module.exports = { processUMP: processUMP, readUMPInt: readUMPInt, encodeUMPInt: encodeUMPInt };
    return;
  }

  var output = {};
  try { output = run(); }
  catch (error) {
    devFailure(error);


    log("pass: " + (error.ytNoAdsCode || "parse/schema check failed"));
  }
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && MEDIA_API.test($request.url || "")) devCapture("YouTubePlayback", "response", endpoint, VERSION, output);
  $done(output);
})();

  }
  else { $done({}); }
})();
