/**
 * 文件：YouTubeLogger.js
 * 功能：管理本地日志会话、完整链路记录、分块校验和单文件导出。
 * 版本：2.6.0
 * 更新时间：2026-10-04T08:54:22+08:00
 * 运行环境：Loon JavaScript
 */
/**
 * 功能：按保存级别筛选新事件；info 保存完整脱敏链路，error 只保留错误并避免写入正常样本。
 * 更新时间：2026-10-05T11:54:46+08:00
 * @param {Object} entry 事件摘要。
 * @param {Object|null} payload 待脱敏的结构诊断。
 * @param {string} level 主插件选择的级别。
 * @returns {boolean} 是否保存当前事件。
 */
function ytDiagnosticShouldRecord(entry,payload,level) {
  var processing=payload&&payload.processing;
  var isError=entry.level==="error" || !!(payload&&payload.responseBefore&&Number(payload.responseBefore.status)>=400&&Number(payload.responseBefore.status)<=599) || !!(processing&&processing.exception) || /inner=(?:authentication_failed|compression_failed|invalid_config_key|protocol_cleanup_failed)/.test(entry.message);
  if(isError)entry.level="error";
  if(level==="error")return isError;
  if(level==="warn")return isError||entry.level==="warn";
  if(level!=="debug"&&entry.level==="debug")entry.level="info";
  return true;
}
/**
 * 功能：样本写完后重新读取最新索引追加事件，减少长时间处理导致的并发覆盖，并拒绝暂停或旧会话写入。
 * 更新时间：2026-10-05T09:16:03+08:00
 * @param {Object} pending 本次待提交的索引，其末项为新事件。
 * @param {number} budget 日志字节容量上限。
 * @returns {boolean} 索引提交成功；失败时抛出固定错误供调用方清理样本。
 */
function ytDiagnosticCommitEntry(pending, budget) {
  var configKey = "ytads.logger.config.v1", key = "ytads.logger.entries.v2";
  var current = JSON.parse($persistentStore.read(configKey) || "null");
  if (!current || !current.enabled || current.session !== pending.session) throw Error("log-session-inactive");
  var raw = $persistentStore.read(key);
  if (raw && raw.length > 131072) throw Error("log-index-invalid");
  var old = raw ? JSON.parse(raw) : null;
  var state = old && old.session === pending.session && Array.isArray(old.entries) ? old : {session:pending.session, entries:[], captureBytes:0};
  var entry = pending.entries[pending.entries.length - 1];
  var size = entry.captureRef ? entry.captureRef.storedBytes : 0;
  var used = Number(state.captureBytes || 0);
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(size) || size < 0) throw Error("log-index-invalid");
  var reason = state.entries.length >= 600 ? "entry-limit" : used + size > budget ? "capture-budget-limit" : null;
  var next = JSON.stringify({session:pending.session, entries:state.entries.concat([entry]), captureBytes:used + size});
  if (!reason && unescape(encodeURIComponent(next)).length > 131072) reason = "log-index-limit";
  if (reason) {
    current.enabled = false; current.haltReason = reason; current.haltedAt = new Date().toISOString();
    if ($persistentStore.write(JSON.stringify(current), configKey) !== true) throw Error("log-stop-write-failed");
    throw Error(reason);
  }
  if ($persistentStore.write(next, key) !== true) throw Error("log-index-write-failed");
  return true;
}
/**
 * 功能：首次使用脱敏版日志时清除旧缓存中未脱敏的正文块，保留无身份信息的事件摘要。
 * 更新时间：2026-10-04T14:45:25+08:00
 * @returns {void} 删除失败时抛出异常，阻止本次日志写入。
 */
function ytDiagnosticPurgeLegacy() {
  if (typeof $persistentStore === 'undefined') return;
  var key='ytads.logger.privacy.v1';
  if ($persistentStore.read(key)==='structure-only-v1') return;
  var raw=$persistentStore.read('ytads.logger.entries.v2'),state=raw?JSON.parse(raw):null;
  if(state&&Array.isArray(state.entries)) {
    for(var n=0;n<state.entries.length;n++) {
      var entry=state.entries[n],ref=entry&&entry.captureRef;
      if(!ref)continue;
      if(typeof ref.prefix!=='string'||!/^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(ref.prefix)||!Number.isInteger(ref.chunks)||ref.chunks<1||ref.chunks>256)throw Error('privacy-invalid-reference');
      for(var i=0;i<ref.chunks;i++)if($persistentStore.write(undefined,ref.prefix+i)!==true)throw Error('privacy-delete-failed');
      delete entry.captureRef;entry.message='legacy capture removed for privacy';
    }
    state.captureBytes=0;
    if($persistentStore.write(JSON.stringify(state),'ytads.logger.entries.v2')!==true)throw Error('privacy-index-failed');
  }
  if($persistentStore.write('structure-only-v1',key)!==true)throw Error('privacy-marker-failed');
}
/**
 * 功能：在日志落盘前移除身份信息，只保留协议字段、长度和广告结构标记；未知正文不保存原文。
 * 更新时间：2026-10-04T14:45:25+08:00
 * @param {Object} payload 原始诊断事件。
 * @returns {Object} 可安全持久化的结构诊断事件。
 */
function ytDiagnosticSanitize(payload) {
  if (!payload) return payload;
  var markers = /(?:[a-z_]+\.eml-fe\|[0-9a-f]{16}|skip_ad_on_block|googleadservices\.com\/pagead\/|youtube\.com\/pagead\/|yt-ads-web-view-id|FEwhat_to_watch|FEsubscriptions|FEshorts)/g;
  /**
   * 功能：只提取用于广告分类的固定标记，模板哈希归零。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function labels(text) { return (String(text).match(markers) || []).map(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function (s) { return s.replace(/\|[0-9a-f]{16}$/, '|0000000000000000'); }); }
  /**
   * 功能：移除 URL 的全部查询参数和片段，阻止签名、令牌、IP 及账号标识写入。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function url(text) { var m=/^(https?:\/\/[^/?#]+)(\/[^?#]*)?/.exec(String(text||''));return m?m[1]+(m[2]||'/'):'[removed]'; }
  /**
   * 功能：仅保留 MIME、压缩方式和长度等无身份信息的传输头。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function headers(value) { var out={};Object.keys(value||{}).forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){var text=String(value[k]);if(/^(content-type|content-length|content-encoding|accept-encoding)$/i.test(k)&&/^[a-z0-9\s/.,;+_=\-]{0,160}$/i.test(text)||/^transfer-encoding$/i.test(k)&&/^(?:chunked|gzip|deflate|br|identity)(?:,\s*(?:chunked|gzip|deflate|br|identity))*$/i.test(text)||/^accept-ranges$/i.test(k)&&/^(?:bytes|none)$/i.test(text)||/^content-range$/i.test(k)&&/^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/.test(text))out[k]=text;});return out; }
  /**
   * 功能：读取 Base64 到临时内存；原始字节不会写入日志。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function decode(text) { var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[],v=0,bits=0;for(var i=0;i<text.length&&text[i]!=='=';i++){var n=alphabet.indexOf(text[i]);if(n<0)throw Error('base64');v=(v<<6)|n;bits+=6;if(bits>=8){bits-=8;out.push((v>>>bits)&255);}}return new Uint8Array(out); }
  var fields=0;
  /**
   * 功能：导出 Protobuf 字段树；仅保存字段号、线型、长度、布尔值和固定广告标记。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function proto(b,depth) {
    if(depth>32||fields>30000)return {bytes:b.length,omitted:true};
    var i=0,out=[];
    /**
     * 功能：读取结构分析使用的变长整数，限制最大编码长度。
     * 更新时间：2026-10-04T14:45:25+08:00
     */
    function integer(){var n=0,f=1;for(var c=0;c<10&&i<b.length;c++){var x=b[i++];n+=(x&127)*f;if(x<128)return n;f*=128;}throw Error('varint');}
    while(i<b.length){if(++fields>30000)throw Error('limit');var tag=integer(),no=Math.floor(tag/8),wire=tag%8;if(!no)throw Error('tag');var item={field:no,wire:wire};
      if(wire===0){var n=integer();item.value=n===0||n===1?n:'[removed]';}
      else if(wire===1||wire===5){var size=wire===1?8:4;i+=size;item.bytes=size;}
      else if(wire===2){var len=integer();if(!Number.isSafeInteger(len)||len<0||len>b.length-i)throw Error('length');var child=b.subarray(i,i+len);i+=len;item.bytes=len;try{item.fields=proto(child,depth+1);}catch(_){var text='';for(var j=0;j<child.length;j++)text+=child[j]>=32&&child[j]<127?String.fromCharCode(child[j]):' ';item.markers=labels(text);}}
      else throw Error('wire');if(i>b.length)throw Error('truncated');out.push(item);
    }return out;
  }
  /**
   * 功能：导出 JSON 结构，清除字符串内容及非布尔数值，并过滤身份键名。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function json(value,depth){if(depth>32)return '[omitted]';if(typeof value==='string')return {chars:value.length,markers:labels(value)};if(typeof value==='number')return value===0||value===1?value:'[removed]';if(Array.isArray(value))return value.map(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(v){return json(v,depth+1);});if(value&&typeof value==='object'){var out={};Object.keys(value).forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){if(!/token|cookie|auth|visitor|account|signature|clientkey|encryptkey|trackingparams|clicktracking/i.test(k)&&/^[a-zA-Z_][a-zA-Z0-9_]{0,80}$/.test(k))out[k]=json(value[k],depth+1);});return out;}return value;}
  /**
   * 功能：替换正文为不可重放的脱敏结构诊断；请求、配置及媒体正文不保存。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function body(v,request){if(!v||v.reference||!v.available)return v;var out={available:false,reason:'privacy-structure-only',bytes:v.bytes,redacted:true};if(/^(config|log_event|initplayback|ump)$/.test(payload.endpoint))return out;try{var b=v.encoding==='base64'?decode(v.data):null;if(b){try{var text=typeof TextDecoder==='function'&&(b[0]===123||b[0]===91)?new TextDecoder('utf-8',{fatal:true}).decode(b):null;out.structure=text?json(JSON.parse(text),0):proto(b,0);}catch(_){out.structure={bytes:b.length,omitted:true};}}else out.structure=json(JSON.parse(v.data),0);}catch(_){out.structure={omitted:true};}return out;}
  ['request','requestAfter','responseBefore','responseAfter'].forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(key){var v=payload[key];if(!v)return;var out={};['status','method','synthetic','changed','transportHeadersRecomputedByLoon'].forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){if(v[k]!==undefined)out[k]=v[k];});if(v.url)out.url=url(v.url);if(v.headers)out.headers=headers(v.headers);if(v.headerOverrides)out.headerOverrides=headers(v.headerOverrides);out.body=body(v.body,key==='request'||key==='requestAfter');payload[key]=out;});
  if(payload.processing&&payload.processing.exception)payload.processing.exception={code:'processing-failed'};
  payload.privacy='structure-only-v1';return payload;
}






/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var ACTIVE_SOURCES = ["YouTubeFeed", "YouTubePlayback", "YouTubeConfig", "YouTubeLogger"];
  var LEGACY_SOURCES = ["YouTubePlayerRequest", "YouTubePlaybackAds", "YouTubeStreamAds", "YouTubeFeedAds", "YouTubeShortsAds", "YouTubeAdBreak", "YouTubeOnesieConfig", "YouTubeInitPlayback"];
  var SOURCES = ACTIVE_SOURCES.concat(LEGACY_SOURCES);
  var BASE = "http://youtube-logs.invalid/";
  var VERSION = "2.6.0";
  var LIMIT = 600;
  var API_CAPTURE = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(player|get_watch|browse|next|search|reel\/reel_watch_sequence|log_event|config)(?:\?[^#]*)?$/i;
  var MEDIA_CAPTURE = /^https:\/\/[\w-]+\.googlevideo\.com\/(videoplayback|initplayback)(?:\?[^#]*)?$/i;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  args.log_level=String(args.log_level||"info").toLowerCase();
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var ranks = {debug:0, info:1, warn:2, error:3};
  var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";

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
      var latest = JSON.parse($persistentStore.read("ytads.logger.config.v1") || "null");
      if (!latest || !latest.enabled || latest.session !== c.session) return;
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
      if (!ytDiagnosticShouldRecord(entry,payload,args.log_level)) return true;
      ytDiagnosticPurgeLegacy();
      var raw = $persistentStore.read("ytads.logger.entries.v2");
      if (raw && devUTF8Size(raw) > 131072) throw new Error("log-index-invalid");
      var old = raw ? JSON.parse(raw) : null;
      var state = old && old.session === c.session && Array.isArray(old.entries) ? old : {session:c.session, entries:[], captureBytes:0};
      if (state.entries.length >= 600) { devHalt(c, "entry-limit"); return false; }
      var serialized = payload ? JSON.stringify(ytDiagnosticSanitize(payload)) : null;
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
      if (ytDiagnosticCommitEntry(next, budget) !== true) throw new Error("log-index-write-failed");
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
   * 功能：记录脱敏诊断样本；仅响应头模式不读取请求或媒体正文。
   * 更新时间：2026-10-04T15:35:00+08:00
   */
  function devCapture(source, phase, endpoint, version, output, headersOnly) {
    if (!devFlag(args.capture_raw)) return;
    var c = null;
    try {
      c = devConfig();
      if (!c || typeof $request === "undefined") return;
      var now = new Date().toISOString();
      var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
      var request = {url:$request.url, method:$request.method || "GET", headers:$request.headers || {}, h2_trailers:$request.h2_trailers || {}, body:headersOnly ? {available:false,reason:"headers-only-not-buffered"} : devBody($request.body)};
      var payload = {schema:1, id:id, time:now, source:source, version:version, phase:phase, endpoint:endpoint,
        runtime:typeof $loon === "string" ? $loon : null,
        correlation:{urlMethodHash:devCorrelation(request.method, request.url), exactPairing:false},
        request:request,
        processing:{exception:devException, executionScript:phase === "request" ? "YouTubeLogger" : source, bodyBuffering:!headersOnly, elapsedMs:Date.now() - devStarted, messages:devMessages.slice(),
          arguments:{development_capture:devFlag(args.capture_raw), background_playback:devFlag(args.background_playback), log_level:args.log_level || "info"}}};
      if (phase === "response" && typeof $response !== "undefined") {
        payload.responseBefore = {status:$response.status, headers:$response.headers || {}, h2_trailers:$response.h2_trailers || {}, body:headersOnly ? {available:false,reason:"headers-only-not-buffered"} : devBody($response.body)};
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
   * 功能：从 Loon 持久化存储安全读取数据。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function read(key) {
    var raw = $persistentStore.read(key);
    if (!raw) return null;
    if (typeof raw !== "string" || raw.length > 131072) throw new Error("invalid-store");
    return JSON.parse(raw);
  }
  /**
   * 功能：读取当前日志工具配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function config() {
    var c = read(CONFIG);
    if (!c || typeof c.session !== "string" || !/^[a-z0-9-]{1,80}$/.test(c.session)) return null;
    return c;
  }
  /**
   * 功能：向 Loon 持久化存储安全写入数据。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function write(value, key) {
    if ($persistentStore.write(JSON.stringify(value), key) !== true) throw new Error("write-failed");
  }
  /**
   * 功能：执行 shared 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function shared(c) {
    ytDiagnosticPurgeLegacy();
    var state = read(CACHE);
    if (state) return state;

    var entries = [];
    SOURCES.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (source) {
      var old = read("ytads.logger." + source + ".v1");
      if (!old || old.session !== c.session || !Array.isArray(old.entries)) return;
      old.entries.slice(-300).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
        if (!r || typeof r.message !== "string") return;
        var level = r.message.indexOf("changed:") === 0 ? "info" :
          r.message === "pass: parse/schema check failed" ? "error" :
          /^(pass: (removed=|mode=|non-UMP))/.test(r.message) ? "debug" : "warn";
        entries.push({source:source, level:level, time:r.time, version:r.version, endpoint:r.endpoint, message:r.message});
      });
    });
    entries.sort(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (a,b) { return String(a.time).localeCompare(String(b.time)); });
    var serialized = JSON.stringify({session:c.session, entries:entries.slice(-LIMIT), captureBytes:0});
    if (devUTF8Size(serialized) > 131072) {
      devHalt(c, "legacy-migration-limit");

      return {session:c.session, entries:entries, captureBytes:0, migrationDeferred:true};
    }
    if ($persistentStore.write(serialized, CACHE) !== true) throw new Error("write-failed");
    SOURCES.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (source) { $persistentStore.write(undefined, "ytads.logger." + source + ".v1"); });
    return JSON.parse(serialized);
  }
  /**
   * 功能：执行 records 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function records(c) {
    var rows = [];
    if (!c) return rows;
    var state = shared(c);
    if (!state || state.session !== c.session || !Array.isArray(state.entries)) return rows;
    state.entries.slice(-LIMIT).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {

        if (!r || SOURCES.indexOf(r.source) === -1 || !Object.prototype.hasOwnProperty.call(ranks, r.level) || typeof r.time !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.time) ||
            typeof r.version !== "string" || !/^\d+\.\d+\.\d+$/.test(r.version) ||
            !/^(player|get_watch|browse|next|search|reel_watch_sequence|log_event|config|initplayback|ad_break|ump|unknown)$/.test(r.endpoint) ||
            typeof r.message !== "string" || r.message.length > 600 || /[\r\n<>]/.test(r.message)) return;
        var row = { time:r.time, source:r.source, level:r.level, version:r.version, endpoint:r.endpoint, message:r.message };
        if (r.captureRef && typeof r.captureRef.prefix === "string" &&
            /^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(r.captureRef.prefix) &&
            r.captureRef.prefix.indexOf("ytads.capture." + c.session + ".") === 0 &&
            Number.isInteger(r.captureRef.chunks) && r.captureRef.chunks > 0 && r.captureRef.chunks <= 256 &&
            Number.isInteger(r.captureRef.chars) && r.captureRef.chars > 0 && r.captureRef.chars <= 33554432) {
          row.captureRef = r.captureRef;
          row.phase = r.phase;
        } else if (r.captureRef) row.captureError = "invalid-capture-reference";
        rows.push(row);
    });
    rows.sort(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    return rows;
  }
  /**
   * 功能：构造日志页面使用的本地 HTTP 响应。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function response(status, body, type, extra) {
    var headers = {"Content-Type":type || "text/html; charset=utf-8", "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
    Object.keys(extra || {}).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { headers[key] = extra[key]; });
    return {response:{status:status, headers:headers, body:body}};
  }
  /**
   * 功能：执行 developmentExport 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function developmentExport(c, rows) {
    var issues = [];
    var events = rows.map(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (row) {
      var event = {summary:row, capture:null};
      if (!row.captureRef) {
        if (row.captureError) { event.captureError = row.captureError; issues.push({time:row.time, source:row.source, reason:row.captureError}); }
        return event;
      }
      try {
        var parts = [];
        for (var i = 0; i < row.captureRef.chunks; i++) {
          var part = $persistentStore.read(row.captureRef.prefix + i);
          if (typeof part !== "string" || part.length > 131072) throw new Error("missing-or-invalid-chunk");
          parts.push(part);
        }
        var text = parts.join("");
        if (text.length !== row.captureRef.chars) throw new Error("capture-length-mismatch");
        if (devChecksum(text) !== row.captureRef.checksum) throw new Error("capture-checksum-mismatch");
        var capture = JSON.parse(text);
        if (capture.schema !== 1 || capture.source !== row.source || capture.time !== row.time || capture.phase !== row.phase) throw new Error("capture-metadata-mismatch");
        event.capture = capture;
      } catch (_) {
        event.captureError = "capture-unavailable-or-corrupt";
        issues.push({time:row.time, source:row.source, reason:event.captureError});
      }
      return event;
    });
    return {schema:1, exportedAt:new Date().toISOString(), session:c && c.session || null,
      recording:!!(c && c.enabled), stoppedReason:c && c.haltReason || null, coverage:coverage(rows),
      settings:{rawCapture:devFlag(args.capture_raw), summaryMinimumLevel:minimum, budgetMB:[16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) : 32},
      completeness:{allReferencedSamplesReadable:issues.length === 0, stoppedDueToLimitOrError:!!(c && c.haltReason), issues:issues,
        limitations:["Only matched player/get_watch/browse/next/search/reel_watch_sequence/log_event/config/initplayback/player/ad_break and enabled UMP response scripts; not all YouTube traffic.",
          "Media logging records headers only and does not buffer media bodies.",
          "Runtime bodies may already be decoded; these are not TLS/HTTP wire bytes.",
          "Missing runtime bodies are marked unavailable; before/after transport headers are not reconstructed.",
          "URL/method hashes are grouping hints, not guaranteed request/response pairs.",
          "Index is refreshed after sample writes; Loon has no atomic append, so simultaneous final commits may still lose entries.",
          "Script timeouts, TLS failures and requests bypassing MitM are not observed."]}, events:events};
  }
  /**
   * 功能：执行 exportPage 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function exportPage() {


    var script = '(' + browserExport.toString() + ')();';
    return response(200, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 导出</title><p id="status">正在读取本地记录，请保持 Loon 开启…</p><a id="save" hidden>保存日志文件</a><p>文件生成后点击保存；Safari 也可通过分享菜单存储到“文件”。</p><script>' + script + '</script></html>', "text/html; charset=utf-8", {"Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
  }
  /**
   * 功能：在日志页面中读取分块并生成单个完整日志文件。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  async function browserExport(event) {
    var status = document.getElementById("status"), save = document.getElementById("save"), download = document.getElementById("download");
    if(download&&download.disabled)return;
    if(download)download.disabled=true;
    try {
      if(event) {
        if(event.preventDefault)event.preventDefault();
        var pause=await fetch("/pause",{method:"POST",cache:"no-store"});
        if(!pause.ok)throw new Error("暂停失败，请检查 Loon 是否运行。");
      }
      status.textContent="正在生成日志文件，请保持 Loon 开启…";
      /**
       * 功能：执行 get 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      async function get(path) {
        var r = await fetch(path, {cache:"no-store"});
        if (!r.ok) throw new Error("本地读取失败（" + r.status + "），请暂停记录后重新导出。");
        return await r.json();
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
       * 功能：执行 value 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function value(v) { if (v === null) return "null"; if (v === undefined) return "unavailable"; return typeof v === "string" ? v.replace(/\r/g,"\\r").replace(/\n/g,"\\n") : String(v); }
      /**
       * 功能：执行 structure 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function structure(label, v, lines, depth) {
        var indent = new Array(depth + 1).join("  ");
        if (v === null || v === undefined || typeof v !== "object") { lines.push(indent + label + ": " + value(v)); return; }
        if (Array.isArray(v)) { lines.push(indent + label + ": array(" + v.length + ")"); for (var i=0;i<v.length;i++) structure("["+i+"]",v[i],lines,depth+1); return; }
        var keys=Object.keys(v).sort(); lines.push(indent+label+": object("+keys.length+")");
        for(var k=0;k<keys.length;k++) structure(keys[k],v[keys[k]],lines,depth+1);
      }
      /**
       * 功能：执行 body 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function body(label,v,lines) {
        lines.push(label+":");
        if(v&&v.reference){lines.push("  Reference: "+value(v.reference));return;}
        if(!v||v.available!==true){lines.push("  Available: false");lines.push("  Reason: "+value(v&&v.reason));if(v&&v.bytes!==undefined)lines.push("  Bytes: "+value(v.bytes));if(v&&v.structure)structure("Structure",v.structure,lines,1);return;}
        lines.push("  Available: true");lines.push("  Encoding: "+value(v.encoding));lines.push("  Bytes: "+value(v.bytes));
        if(Object.prototype.hasOwnProperty.call(v,"data")){var encoding=v.encoding==="base64"?"BASE64":"UTF-8 TEXT";lines.push("  ----- BEGIN "+encoding+" -----");lines.push(String(v.data));lines.push("  ----- END "+encoding+" -----");}
      }
      /**
       * 功能：执行 exchange 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function exchange(label,v,lines){
        lines.push(label+":");if(!v){lines.push("  unavailable");return;}
        var names=["url","method","status","synthetic","changed","transportHeadersRecomputedByLoon"];
        for(var i=0;i<names.length;i++)if(Object.prototype.hasOwnProperty.call(v,names[i]))lines.push("  "+names[i]+": "+value(v[names[i]]));
        if(Object.prototype.hasOwnProperty.call(v,"headers"))structure("headers",v.headers,lines,1);
        if(Object.prototype.hasOwnProperty.call(v,"h2_trailers"))structure("h2_trailers",v.h2_trailers,lines,1);
        if(Object.prototype.hasOwnProperty.call(v,"body"))body("  body",v.body,lines);
      }
      /**
       * 功能：执行 eventText 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function eventText(index,row,capture,captureError){
        var lines=["","================================================================================","EVENT "+(index+1),"================================================================================","Time: "+row.time,"Level: "+String(row.level).toUpperCase(),"Source: "+row.source,"Version: "+row.version,"Endpoint: "+row.endpoint,"Phase: "+value(row.phase),"Summary: "+row.message];
        if(captureError)lines.push("Capture-Error: "+captureError);if(!capture){lines.push("Capture: unavailable");return lines.join("\n")+"\n";}
        lines.push("Runtime: "+value(capture.runtime));structure("Correlation",capture.correlation,lines,0);structure("Processing",capture.processing,lines,0);
        exchange("Request-Before",capture.request,lines);exchange("Request-After",capture.requestAfter,lines);exchange("Response-Before",capture.responseBefore,lines);exchange("Response-After",capture.responseAfter,lines);
        return lines.join("\n")+"\n";
      }
      var manifest = await get("/export-manifest.json");
      var rows = manifest.rows, data = manifest.data, parts = [], issues = [];
      parts.push(["YouTube full diagnostic log","Format-Version: 2","Exported-UTC: "+data.exportedAt,"Session: "+value(data.session),"Recording: "+(data.recording?"on":"paused"),"Stopped-Reason: "+value(data.stoppedReason),"Entries: "+rows.length,"Recorded-Endpoints: "+data.coverage.summary,"Playback-Initialization-Observed: "+data.coverage.hasPlaybackInitialization,"Initialization-Versions: "+data.coverage.initializationVersions.join(","),"Structure-Capture-Enabled: "+value(data.settings.rawCapture),"Summary-Minimum-Level: "+value(data.settings.summaryMinimumLevel),"Capture-Budget-MB: "+value(data.settings.budgetMB),"Scope: browse, refresh/config, player, initplayback, ad-break, Shorts and UMP media events matched by the plugin","Body-Storage: redacted protocol structure only","Privacy: credentials, query values, request/config/media bodies and unknown values are removed before storage","Completeness: best-effort Loon script capture; see LIMITATIONS at end",""].join("\n"));
      for (var n = 0; n < rows.length; n++) {
        var row = rows[n], capture = null, captureError = row.captureError || null;
        status.textContent = "正在读取记录 " + (n + 1) + " / " + rows.length;
        if (row.captureRef) {
          var ref = row.captureRef, chunks = [];
          for (var k = 0; k < ref.chunks; k++) {
            var piece = await get("/export-chunk/" + manifest.session + "/" + n + "/" + k);
            if (typeof piece.chunk !== "string") throw new Error("本地样本块无效，请重新导出。");
            chunks.push(piece.chunk);
          }
          var text = chunks.join("");
          if (text.length !== ref.chars || checksum(text) !== ref.checksum) throw new Error("样本校验失败，请保留已有记录并检查存储。");
          capture = JSON.parse(text);
          if (capture.schema !== 1 || capture.source !== row.source || capture.time !== row.time || capture.phase !== row.phase) throw new Error("样本元数据不匹配，请重新导出。");
        } else if (captureError) issues.push(row.time+" "+row.source+" "+captureError);
        parts.push(eventText(n,row,capture,captureError));
      }
      parts.push("\n================================================================================\nLIMITATIONS\n================================================================================\n");
      for(var q=0;q<data.completeness.limitations.length;q++)parts.push((q+1)+". "+data.completeness.limitations[q]+"\n");
      parts.push("All-Referenced-Samples-Readable: "+(issues.length===0)+"\n");for(q=0;q<issues.length;q++)parts.push("Issue: "+issues[q]+"\n");
      var blob = new Blob(parts, {type:"text/plain;charset=utf-8"});
      if(save.href&&save.href.indexOf("blob:")===0)URL.revokeObjectURL(save.href);
      save.href = URL.createObjectURL(blob);
      save.download = "YouTube-" + data.exportedAt.replace(/[:.]/g, "-") + ".log";
      save.hidden = false;
      status.textContent = "已生成日志文件（" + rows.length + " 条记录），正在下载；若 Safari 未弹出下载提示，可点击保存日志文件。";
      save.click();
    } catch (error) {
      status.textContent = error.message || "导出失败，请检查 Loon 是否运行。";
      save.hidden = true;
    } finally {
      if(download)download.disabled=false;
    }
  }
  /**
   * 功能：执行 exportRows 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function exportRows(c) { return records(c); }
  /**
   * 功能：统计日志实际记录到的接口与初始化版本，避免把声明范围误认为完整链路。
   * 更新时间：2026-10-04T16:55:00+08:00
   * @param {Object[]} rows 当前会话的事件摘要。
   * @returns {Object} 接口计数、初始化观察状态和安全的版本列表。
   */
  function coverage(rows) {
    var names = ['browse','next','search','config','log_event','initplayback','player','get_watch','ad_break','reel_watch_sequence','ump'];
    var counts = {}, versions = [], parts = [], initialized = false;
    for (var i = 0; i < names.length; i++) counts[names[i]] = 0;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!Object.prototype.hasOwnProperty.call(counts, row.endpoint)) continue;
      counts[row.endpoint]++;
      if (/^(initplayback|player|get_watch)$/.test(row.endpoint)) {
        initialized = true;
        if (row.endpoint === "initplayback" && row.phase === "response" && row.source === "YouTubeLogger") continue;
        if (/^\d+\.\d+\.\d+$/.test(row.version) && versions.indexOf(row.version) < 0) versions.push(row.version);
      }
    }
    for (i = 0; i < names.length; i++) parts.push(names[i] + '=' + counts[names[i]]);
    return {counts:counts, summary:parts.join(' / '), hasPlaybackInitialization:initialized, initializationVersions:versions};
  }
  /**
   * 功能：生成本地日志管理页面。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function page(c, rows) {
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 日志</title>' +
      '<style>body{font:17px system-ui;margin:32px auto;padding:0 24px;max-width:620px;line-height:1.7}button,a{font:inherit}button{margin:6px 0;padding:8px 16px}a{display:block;margin:22px 0}[hidden]{display:none!important}</style>' +
      '<h1>YouTube 日志</h1><p>状态：' + (c && c.enabled === true ? '正在记录' : '已暂停') + '；保留 ' + rows.length + ' 条。保存级别：' + minimum + '。</p>' +
      '<form method="post" action="/start"><button>开始记录（保留本次日志）</button></form>' +
      '<form method="post" action="/pause"><button>暂停记录</button></form>' +
      '<form method="post" action="/mark-ad"><button>标记：正在播放广告</button></form>' +
      '<form method="post" action="/mark-content"><button>标记：正在播放正片</button></form>' +
      '<button id="download" type="button">下载日志</button><p id="status" role="status"></p><a id="save" hidden>保存日志文件</a>' +
      '<p>开发抓包：' + (devFlag(args.capture_raw) ? '已开启，保存脱敏结构' : '未开启，只保存摘要') + '。' +
      (c && c.haltReason ? '记录已因容量或存储问题停止；请先导出，再清空重试。' : '') + '</p>' +
      '<p>下载后在 Safari 保存或通过分享菜单存储到“文件”。共用缓存最多 600 条或 128 KiB 索引，脱敏记录另按主插件所选容量保存。达到上限停止记录，保留旧记录。</p>' +
      '<p>日志工具在主插件手动开启，请先选择容量，再开始记录。媒体事件仅记录响应头，不等待媒体正文；唯一的 .log 文件保存去除查询参数的接口地址、安全传输头、协议字段树、广告标记和处理结果；令牌、Cookie、账号标识、密钥与媒体正文在写入前移除。</p>' +
      '<p>在主插件选择日志保存级别：info 保存完整脱敏记录，包含浏览、刷新、播放及处理结果；error 只保存错误；debug 保存完整记录并保留调试级别；warn 只保存警告和错误。调整级别只影响新记录，旧记录仍保留。</p>' +
      '<p>下载日志会自动暂停记录，在当前页面生成一个 .log 并触发下载。完整记录指脚本实际捕获的脱敏数据，不保证覆盖所有网络请求；媒体正文不保存。日志无法读取 Loon 的连接、证书或脚本超时记录。</p>' +
      '<form method="post" action="/clear"><button>清空日志并暂停（不可恢复）</button></form><script>document.getElementById("download").onclick=' + browserExport.toString() + ';</script></html>';
  }
  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function run() {
    if (args.log_enabled !== true && args.log_enabled !== "true") {
      if (typeof $request !== "undefined") {
        if (/^http:\/\/youtube-logs\.invalid(?::80)?(?:\/|$)/.test($request.url || "")) return response(403, "请先在主插件手动开启日志工具。", "text/plain; charset=utf-8");
        return {};
      }
      return {title:"YouTube 日志", content:"请先在主插件手动开启日志工具。"};
    }
    if (typeof $request !== "undefined") {
      var api = API_CAPTURE.exec($request.url || "");
      var media = MEDIA_CAPTURE.exec($request.url || "");
      if (api || media) {
        var apiName = api ? api[1].toLowerCase() : media[1].toLowerCase();
        var source = /^(browse|next|search)$/i.test(apiName) ? "YouTubeFeed" :
          /^(log_event|config|initplayback)$/i.test(apiName) ? "YouTubeConfig" : api || apiName === "videoplayback" ? "YouTubePlayback" : "YouTubeLogger";
        var endpoint = apiName === "reel/reel_watch_sequence" ? "reel_watch_sequence" : apiName === "videoplayback" ? "ump" : apiName;
        if (media) devMessages.push((apiName === "initplayback" ? "initialization_response" : "media") + ": headers_only=true body_buffering=false");
        if(media&&apiName === "initplayback"&&typeof $response !== "undefined")source="YouTubeLogger";
        devCapture(source, typeof $response !== "undefined" ? "response" : "request", endpoint, VERSION, {}, !!media || typeof $response === "undefined");
        return {};
      }
    }
    if (typeof $request === "undefined") {
      if (typeof $notification !== "undefined") $notification.post("YouTube 日志", "点击打开日志页面", "开始记录、暂停或下载 .log 文件", {openUrl:BASE});
      return {title:"YouTube 日志", content:"在浏览器打开 " + BASE + "，点击开始记录，复现后下载日志。"};
    }
    var match = /^http:\/\/youtube-logs\.invalid(?::80)?(\/[^?#]*)?(?:\?[^#]*)?$/.exec($request.url || "");
    if (!match) return {};
    var path = match[1] || "/";
    var method = String($request.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") return response(405, "Method not allowed", "text/plain; charset=utf-8", {Allow:"GET, POST"});
    var origin = $request.headers && ($request.headers.Origin || $request.headers.origin);
    if (method === "POST" && origin && origin !== "http://youtube-logs.invalid" && origin !== "http://youtube-logs.invalid:80") return response(403, "Foreign origin rejected", "text/plain; charset=utf-8");
    var c = path === "/clear" ? null : config();
    if (path === "/start" || path === "/pause" || path === "/clear" || path === "/mark-ad" || path === "/mark-content") {
      if (method !== "POST") return response(405, "Use the buttons on the log page.", "text/plain; charset=utf-8", {Allow:"POST"});
      if (path === "/mark-ad" || path === "/mark-content") {
        if (!c || c.enabled !== true) return response(409, "请先开始记录，再标记播放状态。", "text/plain; charset=utf-8");
        if (!devAppend({source:"YouTubeLogger", version:VERSION, endpoint:"unknown", time:new Date().toISOString(), level:"info", message:"user mark: " + (path === "/mark-ad" ? "ad-playing" : "content-playing")}, null)) return response(507, "标记未保存，请先导出记录并检查停止原因。", "text/plain; charset=utf-8");
        return response(303, "", "text/plain; charset=utf-8", {Location:BASE});
      }
      if (path === "/clear") {

        c = {enabled:false, session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        write(c, CONFIG);
        var previous = null;
        try { previous = read(CACHE); } catch (_) {}
        if (previous && Array.isArray(previous.entries)) previous.entries.slice(0, LIMIT).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
          var ref = r && r.captureRef;
          if (!ref || typeof ref.prefix !== "string" || !/^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(ref.prefix) || !Number.isInteger(ref.chunks) || ref.chunks < 1 || ref.chunks > 256) return;
          for (var i = 0; i < ref.chunks; i++) $persistentStore.write(undefined, ref.prefix + i);
        });
        write({session:c.session, entries:[], captureBytes:0}, CACHE);
        SOURCES.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (source) { $persistentStore.write(undefined, "ytads.logger." + source + ".v1"); });
      } else {
        if (!c) c = {session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        c.enabled = path === "/start";
        if (c.enabled) { delete c.haltReason; delete c.haltedAt; }
        shared(c);
        write(c, CONFIG);
      }
      return response(303, "", "text/plain; charset=utf-8", {Location:BASE});
    }
    if (method !== "GET") return response(405, "Method not allowed", "text/plain; charset=utf-8", {Allow:"GET"});
    if (path === "/export") return exportPage();
    if (path === "/export-manifest.json") {
      if (c && c.enabled) return response(409, "请先在日志页面暂停记录，然后导出。", "text/plain; charset=utf-8");
      var manifestRows = exportRows(c);
      var manifestData = developmentExport(c, []);
      manifestData.coverage = coverage(manifestRows);
      return response(200, JSON.stringify({session:c && c.session || "none", rows:manifestRows, data:manifestData}), "application/json; charset=utf-8");
    }
    var chunkPath = /^\/export-chunk\/([a-z0-9-]{1,80})\/(\d{1,3})\/(\d{1,3})$/.exec(path);
    if (chunkPath) {
      if (!c || c.enabled || c.session !== chunkPath[1]) return response(409, "记录状态已变化，请暂停后重新导出。", "text/plain; charset=utf-8");
      var rowNumber = Number(chunkPath[2]), chunkNumber = Number(chunkPath[3]);
      var chunkRows = exportRows(c);
      var ref = chunkRows[rowNumber] && chunkRows[rowNumber].captureRef;
      if (!ref || chunkNumber >= ref.chunks) return response(404, "Sample not found", "text/plain; charset=utf-8");
      var chunk = $persistentStore.read(ref.prefix + chunkNumber);
      if (typeof chunk !== "string" || chunk.length > 131072) return response(503, "样本块丢失或损坏，未生成截断文件。", "text/plain; charset=utf-8");
      return response(200, JSON.stringify({chunk:chunk}), "application/json; charset=utf-8");
    }
    if (path !== "/" && path !== "/download.log") return response(404, "Not found", "text/plain; charset=utf-8");
    var rows = records(c);
    if (path === "/") return response(200, page(c, rows), "text/html; charset=utf-8", {"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});

    return response(303, "", "text/plain; charset=utf-8", {Location:BASE + "export"});
  }
  var output;
  try { output = run(); }
  catch (_) {
    if (typeof $request !== "undefined" && /^http:\/\/youtube-logs\.invalid(?::80)?(?:\/|$)/.test($request.url || "")) {
      output = response(503, "日志存储不可用，请检查脚本是否更新，或在 Loon 日志中查看存储错误。", "text/plain; charset=utf-8");
    } else output = {title:"YouTube 日志", content:"日志入口无法打开，请检查脚本。"};
  }
  $done(output);
})();
