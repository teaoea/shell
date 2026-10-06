/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 文件：YouTubeFeed.js
 * 功能：清理首页与推荐信息流广告，并按开关隐藏首页 Shorts 推荐区。
 * 版本：2.6.0
 * 更新时间：2026-10-05
 * 运行环境：Loon JavaScript
 */
/**
 * 功能：记录当前 JS 和 Loon 提供的脚本起点；不读取请求内容，也不把该时间当作网络请求开始时间。
 * 更新时间：2026-10-05
 */
var ytDiagnosticScriptStartedAt = Date.now();
var ytDiagnosticRuntimeStartedAt = null;
try {
  var ytDiagnosticRuntimeDate = typeof $script !== "undefined" && $script ? $script.startTime : null;
  var ytDiagnosticRuntimeValue = ytDiagnosticRuntimeDate && typeof ytDiagnosticRuntimeDate.getTime === "function" ? ytDiagnosticRuntimeDate.getTime() : null;
  if (typeof ytDiagnosticRuntimeValue === "number" && Number.isFinite(ytDiagnosticRuntimeValue) && ytDiagnosticRuntimeValue >= 0 && ytDiagnosticRuntimeValue <= ytDiagnosticScriptStartedAt) ytDiagnosticRuntimeStartedAt = ytDiagnosticRuntimeValue;
} catch (_) {}
/**
 * 功能：在最终索引提交前记录实际脚本用时，覆盖处理、脱敏和样本写入；不包含最后索引写入及后续渲染。
 * 更新时间：2026-10-05
 * @param {Object} entry 待提交事件，不包含原始凭据或正文。
 * @returns {void} 只补充有效计时；缺少运行时起点时不生成占位值。
 */
function ytDiagnosticStampTiming(entry) {
  var now = Date.now(), timing = entry.timing && typeof entry.timing === "object" && !Array.isArray(entry.timing) ? entry.timing : {};
  var jsElapsed = now - ytDiagnosticScriptStartedAt;
  if (Number.isFinite(jsElapsed) && jsElapsed >= 0 && jsElapsed <= 600000) timing.jsBeforeIndexCommitMs = jsElapsed;
  if (ytDiagnosticRuntimeStartedAt !== null) {
    var runtimeElapsed = now - ytDiagnosticRuntimeStartedAt;
    if (Number.isFinite(runtimeElapsed) && runtimeElapsed >= 0 && runtimeElapsed <= 600000) timing.runtimeBeforeIndexCommitMs = runtimeElapsed;
  }
  if (Object.keys(timing).length) entry.timing = timing;
}
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
 * 功能：样本写完后刷新索引、补充提交前计时并追加事件，减少并发覆盖，拒绝暂停或旧会话写入。
 * 更新时间：2026-10-05
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
  ytDiagnosticStampTiming(entry);
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
   * 功能：将可用 API 正文及已认证的内层播放器请求转换为脱敏字段树；配置密钥和媒体正文不保存。
   * 更新时间：2026-10-05T12:09:41+08:00
   */
  function body(v,request,inner){if(!v||v.reference||!v.available)return v;var out={available:false,reason:'privacy-structure-only',bytes:v.bytes,redacted:true};if(!inner&&/^(config|log_event|initplayback|ump)$/.test(payload.endpoint))return out;try{var b=v.memoryBytes instanceof Uint8Array?v.memoryBytes:v.encoding==='base64'?decode(v.data):null;if(b){try{var text=typeof TextDecoder==='function'&&(b[0]===123||b[0]===91)?new TextDecoder('utf-8',{fatal:true}).decode(b):null;out.structure=text?json(JSON.parse(text),0):proto(b,0);}catch(_){out.structure={bytes:b.length,omitted:true};}}else out.structure=json(JSON.parse(v.data),0);}catch(_){out.structure={omitted:true};}return out;}
  ['request','requestAfter','requestInner','requestInnerAfter','responseBefore','responseAfter'].forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(key){var v=payload[key];if(!v)return;var out={};['status','method','synthetic','changed','transportHeadersRecomputedByLoon'].forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){if(v[k]!==undefined)out[k]=v[k];});if(v.url)out.url=url(v.url);if(v.headers)out.headers=headers(v.headers);if(v.headerOverrides)out.headerOverrides=headers(v.headerOverrides);out.body=body(v.body,key==='request'||key==='requestAfter',key==='requestInner'||key==='requestInnerAfter');payload[key]=out;});
  if(payload.processing&&payload.processing.exception)payload.processing.exception={code:'processing-failed'};
  payload.privacy='structure-only-v1';return payload;
}


/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";
  var dispatcherUrl = typeof $request !== "undefined" ? String($request.url || "") : "";
  var dispatcherResponse = typeof $response !== "undefined";
  if (dispatcherResponse && /\/youtubei\/v1\/(?:browse|next|search)(?:\?[^#]*)?$/i.test(dispatcherUrl)) {









/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";
  var VERSION = "2.6.0";
  var MAX_FIELDS = 30000;
  var MAX_BYTES = 4 * 1024 * 1024;
  var MAX_JSON_NODES = 20000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  args.log_level=String(args.log_level||"info").toLowerCase();
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var debug = args.script_debug === true || args.script_debug === "true";
  var hideHomeShorts = args.hide_home_shorts === true || args.hide_home_shorts === "true";
  var adaptiveFeedAds = args.adaptive_feed_ads !== false && args.adaptive_feed_ads !== "false";
  var endpoint = "unknown";
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(browse|next|search)(?:\?[^#]*)?$/i;
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
   * 功能：生成临时正文描述；二进制直接引用原视图，避免 Base64 往返，持久化前必须脱敏。
   * 更新时间：2026-10-05
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
    // 原始视图只留在当前调用的临时内存；写入前转换为脱敏字段树。
    return {available:true, bytes:bytes.length, memoryBytes:bytes};
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
   * 功能：追加脱敏样本并记录采样准备与样本写入耗时；不将临时字节视图写入持久缓存。
   * 更新时间：2026-10-05
   */
  function devAppend(entry, payload) {
    var appendStarted = Date.now();
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
      var prepareFinished = Date.now();
      if (serialized) {
        for (var i = 0; i < entry.captureRef.chunks; i++) {
          var key = entry.captureRef.prefix + i;
          if ($persistentStore.write(chunks[i], key) !== true) throw new Error("capture-write-failed");
          written.push(key);
        }
      }
      // 计时写在事件索引中，不重写样本；明确不包含最后的索引提交和网络等待。
      var writeFinished = Date.now();
      entry.timing = {capturePrepareMs:prepareFinished - appendStarted, sampleWriteMs:writeFinished - prepareFinished, scriptBeforeIndexCommitMs:writeFinished - devStarted};
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
          arguments:{hide_home_shorts:hideHomeShorts, adaptive_feed_ads:adaptiveFeedAds, log_level:args.log_level || "info"}}};
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
    if ((minimum === "info" || ranks[level] >= ranks[minimum])) devAppend({source:"YouTubeFeed", level:level, time:new Date().toISOString(), version:VERSION, endpoint:endpoint, message:message}, null);
  }

  /**
   * 功能：写入脱敏处理摘要，并按需输出调试信息。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function log(message) {
    saveLog(message);
    if (debug && typeof console !== "undefined") {
      console.log("[YouTubeFeed " + VERSION + "] " + endpoint + " " + message);
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
    sectionList: {1:"sectionItem", 32:"deferredUpdate"},
    deferredUpdate: {1:"deferredItems"}, deferredItems: {1:"itemSection"}, secondaryList: {1:"secondaryItem"},
    sectionItem: {50195462:"itemSection"}, secondaryItem: {50195462:"itemSection"},
    itemSection: {1:"contentItem"}, contentItem: {153515154:"cardElement"}
  };
  var ADS = {sectionItem:{424701016:true,55514441:true}, secondaryItem:{424701016:true,73920376:true}, contentItem:{424701016:true,73920376:true}};


  var EML_ADS = {
    "video_display_button_group_layout": {model:491441836, command:[19,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "full_width_portrait_image_layout": {model:478840678, command:[27,7,10,4,169495254,138681778,2,138681066,3,449330433]},
    "full_width_square_image_layout": {model:461080918, command:[55,7,10,4,169495254,138681778,2,138681066,3,449330433]},
    "full_width_square_image_carousel_layout": {model:33562350, command:[5,5,10,4,169495254,138681778,2,138681066,3,449330433]},
    "carousel_footered_layout": {model:505359416, command:[31,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "video_display_full_buttoned_layout": {model:454362329, command:[32,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "video_display_carousel_button_group_layout": {model:33561652, command:[14,8,10,4,169495254,138681778,2,138681066,3,449330433]},
    "banner_text_icon_buttoned_layout": {model:378585263, command:[5,3,4,169495254,138681778,2,138681066,3,449330433]},
    "fullscreen_engagement_companion": {model:252081505, command:[13,1,169495254,138681778,2,138681066,3,449330433]},
    "engagement_header": {model:403122092, command:[5,2,4,169495254,138681778,2,138681066,3,449330433]}
  };
  /**
   * 功能：执行 child 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function child(bytes, no, budget) {
    var records = parse(bytes, budget), targets = records.filter(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no === no;});
    if (!targets.length) return null;
    if (targets.length !== 1 || targets[0].wire !== 2) fail("eml-single-message-mismatch");
    return bytes.subarray(targets[0].payloadStart, targets[0].end);
  }
  /**
   * 功能：执行 ascii 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function ascii(bytes) {
    if (!bytes || bytes.length > 160) return "";
    var text = "";
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] < 32 || bytes[i] > 126) return "";
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }
  /**
   * 功能：执行 containsASCII 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 hasAdCommand 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function hasAdCommand(bytes, route, depth, budget) {
    var records = parse(bytes, budget);
    if (depth === route.length) {
      var marked = false;
      records.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
        if (r.no !== 8) return;
        if (r.wire !== 2) fail("eml-command-schema-mismatch");
        var entry = bytes.subarray(r.payloadStart, r.end);
        var key = child(entry, 1, budget), value = child(entry, 2, budget);
        if (key && ascii(key) === "skip_ad_on_block" && value !== null) marked = true;
      });
      return marked;
    }
    var found = false;
    records.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
      if (r.no !== route[depth]) return;
      if (r.wire !== 2) fail("eml-command-schema-mismatch");

      if (hasAdCommand(bytes.subarray(r.payloadStart, r.end), route, depth + 1, budget)) found = true;
    });
    return found;
  }
  /**
   * 功能：执行 classifyElement 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function classifyElement(bytes, budget) {
    var element = child(bytes, 172660663, budget);
    if (!element || parse(bytes, budget).some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no >= 1000000 && r.no !== 172660663;})) return {ad:false, divider:false};
    if (parse(element, budget).some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no === 3;})) return {ad:false, divider:false};
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

    if (parse(type, budget).length !== 1 || parse(templateType, budget).length !== 1 || modelFields.length !== 1) return {ad:false, divider:false};
    var expected = mapping ? mapping.model : 347043917, field = modelFields[0];
    if (field.no !== expected) return {ad:false, divider:false};
    if (field.wire !== 2) fail("eml-model-schema-mismatch");
    if (!mapping) return {ad:false, divider:true};
    return {ad:hasAdCommand(model.subarray(field.payloadStart, field.end), mapping.command, 0, budget), divider:false};
  }




  /**
   * 功能：执行 watchNextAdAction 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function watchNextAdAction(bytes, budget) {
    var action = child(bytes, 361588638, budget);
    if (!action) return false;
    var container = child(action, 2, budget);
    if (!container) return false;
    var renderer = child(container, 153515154, budget);
    if (!renderer) return false;
    return classifyElement(renderer, budget).ad;
  }
  /**
   * 功能：沿实机确认的播放页伴随面板路径检查广告模板、模型和跳过广告命令。
   * 更新时间：2026-10-04T16:25:46+08:00
   * @param {Uint8Array} bytes 面板消息正文。
   * @param {number[]} route 已确认的消息字段路径。
   * @param {Object} budget 当前响应共享的解析资源预算。
   * @returns {boolean} 仅完整匹配广告组件结构时返回真。
   */
  function watchNextAdCompanion(bytes, route, budget) {
    var container = bytes;
    for (var i = 0; i < route.length; i++) {
      container = child(container, route[i], budget);
      if (!container) return false;
    }
    var renderer = child(container, 153515154, budget);
    return !!renderer && classifyElement(renderer, budget).ad;
  }

  /**
   * 功能：识别 next 响应中带 Google pagead 点击地址的播放页赞助覆盖层。
   * 更新时间：2026-10-04T10:18:00+08:00
   */
  function watchNextAdOverlay(bytes, budget) {
    var records = parse(bytes, budget);
    if (records.length !== 1 || records[0].no !== 62960614 || records[0].wire !== 2) return false;
    var overlay = bytes.subarray(records[0].payloadStart, records[0].end);
    return containsASCII(overlay, "googleadservices.com/pagead/") ||
      containsASCII(overlay, "youtube.com/pagead/") ||
      containsASCII(overlay, "yt-ads-web-view-id");
  }


  /**
   * 功能：执行 continuationBrowseId 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 protoHomeContinuation 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function protoHomeContinuation(bytes, records, budget) {
    var ids = [];
    records.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
      if (r.no !== 2 || r.wire !== 2) return;
      var continuation = bytes.subarray(r.payloadStart, r.end);
      [52047593, 60487319].forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (no) {
        var data = child(continuation, no, budget);
        if (data) {
          var token = child(data, 1, budget);
          if (token) ids.push(continuationBrowseId(asciiToken(token), budget));
        }
      });
    });
    return ids.length > 0 && ids.every(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (id) {return id === "FEwhat_to_watch";});
  }
  /**
   * 功能：执行 asciiToken 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function asciiToken(bytes) {
    if (!bytes || bytes.length > 16384) return "";
    var text = "";
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] < 32 || bytes[i] > 126) return "";
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }
  /**
   * 功能：执行 shortsCell 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function shortsCell(bytes, budget) {
    var records = parse(bytes, budget);
    if (records.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no >= 1000000 && r.no !== 153515154;})) return false;
    var renderer = child(bytes, 153515154, budget);
    if (!renderer || parse(renderer, budget).some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no >= 1000000 && r.no !== 172660663;})) return false;
    var element = child(renderer, 172660663, budget);
    if (!element || parse(element, budget).some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no === 3;})) return false;
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
  /**
   * 功能：执行 shortsShelf 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function shortsShelf(bytes, budget) {

    var content = child(bytes, 5, budget);
    if (!content || parse(content, budget).length !== 1) return false;
    var list = child(content, 51431404, budget);
    if (!list) return false;
    var records = parse(list, budget), count = 0, valid = true;
    records.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
      if (r.no !== 1) return;
      count++;
      if (r.wire !== 2 || !shortsCell(list.subarray(r.payloadStart, r.end), budget)) valid = false;
    });
    return count > 0 && valid;
  }
  /**
   * 功能：清理已确认 Protobuf 结构中的广告字段或条目。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function cleanProto(bytes, kind, budget, depth, homeContext) {
    if (depth > 32) fail("protobuf-depth-limit");
    var records = parse(bytes, budget), edges = EDGES[kind] || {}, adFields = ADS[kind] || {};
    var parts = [], removed = 0, adaptive = 0, shorts = 0, opaque = 0, eml = 0, dividers = 0, adSeen = false, drop = false;
    if (hideHomeShorts && endpoint === "browse") {
      if (kind === "tab") homeContext = ascii(child(bytes, 11, budget)) === "FEwhat_to_watch";
      if (kind === "sectionList" && !homeContext) homeContext = protoHomeContinuation(bytes, records, budget);
    }
    var listCount = 0, keptListCount = 0, pendingAd = false, divider = false;
    records.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
      if (adFields[r.no]) { if (r.wire !== 2) fail("feed-ad-schema-mismatch"); adSeen = true; }
    });
    if (adSeen && records.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no >= 1000000 && !adFields[r.no];})) fail("feed-mixed-renderer");
    records.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
      if (adFields[r.no]) { removed++; drop = true; return; }
      if (kind === "next" && r.no === 15 && r.wire === 2 && watchNextAdAction(bytes.subarray(r.payloadStart, r.end), budget)) {
        removed++; eml++; return;
      }
      if (kind === "next" && r.no === 14 && r.wire === 2 && watchNextAdOverlay(bytes.subarray(r.payloadStart, r.end), budget)) {
        removed++; eml++; return;
      }
      if (kind === "next" && r.wire === 2 &&
          ((r.no === 37 && watchNextAdCompanion(bytes.subarray(r.payloadStart, r.end), [253885845,1], budget)) ||
           (r.no === 42 && watchNextAdCompanion(bytes.subarray(r.payloadStart, r.end), [357104971,2,361256913,1,138681066,2,194605894,1], budget)))) {
        removed++; eml++; return;
      }
      if (hideHomeShorts && endpoint === "browse" && homeContext && kind === "sectionItem" && r.no === 51845067) {
        if (r.wire !== 2) fail("shorts-shelf-schema-mismatch");
        if (shortsShelf(bytes.subarray(r.payloadStart, r.end), budget) && !records.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (other) {return other.no >= 1000000 && other.no !== 51845067;})) {
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
        if (identity.ad && records.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (other) {return other.no >= 1000000 && other.no !== 153515154;})) fail("feed-mixed-renderer");
        if (identity.ad) {removed++; eml++; drop = true; return;}
        opaque++;
        divider = identity.divider && records.length === 1;
        parts.push(bytes.subarray(r.start, r.end));
        return;
      }
      result = cleanProto(bytes.subarray(r.payloadStart, r.end), next, budget, depth + 1, homeContext);
      removed += result.removed; adaptive += result.adaptive || 0; shorts += result.shorts; opaque += result.opaque; eml += result.eml; dividers += result.dividers;
      if ((kind === "sectionList" || kind === "secondaryList" || kind === "itemSection" || kind === "deferredItems") && r.no === 1) {
        listCount++;
        if (result.drop) {pendingAd = result.removed > 0; return;}

        if (kind !== "itemSection" && pendingAd && result.divider) {dividers++; pendingAd = false; return;}
        pendingAd = false; keptListCount++;
        if (kind === "itemSection") divider = listCount === 1 && result.divider;
      }
      if (kind === "sectionItem" || kind === "secondaryItem") {
        if (result.drop) {
          if (records.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (other) {return other.no >= 1000000 && other.no !== 50195462;})) fail("feed-mixed-renderer");
          drop = true;
        }
        divider = result.divider && records.length === 1;
      }
      parts.push(result.removed || result.shorts || result.dividers ? replaceChild(bytes, r, result.body) : bytes.subarray(r.start, r.end));
    });
    if (kind === "itemSection") {
      var safeMetadata = records.every(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {return r.no === 1 || r.no === 4 || r.no === 8;});
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
  /**
   * 功能：执行 object 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  /**
   * 功能：执行 adCard 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function adCard(value, depth) {
    if (!object(value) || depth > 8) return false;
    var keys = Object.keys(value), marked = false;
    keys.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { if (AD_KEYS.indexOf(key) >= 0 && object(value[key])) marked = true; });
    if (marked) {

      if (keys.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { return /(?:Renderer|ViewModel)$/.test(key) && AD_KEYS.indexOf(key) < 0; })) fail("feed-mixed-renderer");
      return true;
    }

    if (object(value.richItemRenderer) && adCard(value.richItemRenderer.content, depth + 1)) {
      if (keys.some(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) {return key !== "richItemRenderer" && /(?:Renderer|ViewModel)$/.test(key);})) fail("feed-mixed-renderer");
      return true;
    }
    return false;
  }
  /**
   * 功能：执行 jsonHome 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function jsonHome(value) {
    if (!object(value)) return false;
    if (value.targetId === "browse-feedFEwhat_to_watch") return true;
    var ids = [], browse = value.endpoint && value.endpoint.browseEndpoint;
    if (typeof value.tabIdentifier === "string") ids.push(value.tabIdentifier);
    if (browse && typeof browse.browseId === "string") ids.push(browse.browseId);
    if (Array.isArray(value.continuations)) value.continuations.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (entry) {
      if (!object(entry)) return;
      ["nextContinuationData", "reloadContinuationData"].forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) {
        if (object(entry[key])) ids.push(continuationBrowseId(entry[key].continuation, {fields:0}));
      });
    });
    return ids.length > 0 && ids.every(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (id) {return id === "FEwhat_to_watch";});
  }
  /**
   * 功能：执行 requestHome 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  /**
   * 功能：执行 jsonShortsCard 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function jsonShortsCard(value, depth) {
    if (!object(value) || depth > 8) return false;
    var keys = Object.keys(value), rendererKeys = keys.filter(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) {return /(?:Renderer|ViewModel)$/.test(key);});
    if (rendererKeys.length !== 1) return false;
    var key = rendererKeys[0], card = value[key];
    if (!object(card)) return false;
    if (key === "richSectionRenderer") return jsonShortsCard(card.content, depth + 1);
    if (key === "itemSectionRenderer") {
      return Object.keys(card).every(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (k) {return ["contents", "trackingParams", "sectionIdentifier", "targetId"].indexOf(k) >= 0;}) &&
        Array.isArray(card.contents) && card.contents.length > 0 && card.contents.every(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (item) {return jsonShortsCard(item, depth + 1);});
    }
    /**
     * 功能：执行 shortsItem 对应的内部处理步骤。
     * 更新时间：2026-10-04T08:54:22+08:00
     */
    function shortsItem(item, level) {
      if (!object(item) || level > 8) return false;
      var names = Object.keys(item).filter(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (k) {return /(?:Renderer|ViewModel)$/.test(k);});
      if (names.length !== 1) return false;
      if (names[0] === "richItemRenderer" && object(item.richItemRenderer)) return shortsItem(item.richItemRenderer.content, level + 1);
      return (names[0] === "reelItemRenderer" || names[0] === "shortsLockupViewModel") && object(item[names[0]]);
    }
    var items;
    if (key === "reelShelfRenderer") items = card.items;
    else if (key === "richShelfRenderer" && card.icon && card.icon.iconType === "YOUTUBE_SHORTS_BRAND_24") items = card.contents;
    else if (key === "shelfRenderer" && card.content && object(card.content.horizontalListRenderer) && Object.keys(card.content).length === 1) items = card.content.horizontalListRenderer.items;
    return Array.isArray(items) && items.length > 0 && items.every(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (item) {return shortsItem(item, 0);});
  }
  /**
   * 功能：清理已确认 JSON 结构中的广告字段或条目。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function cleanJSON(text) {
    var root = JSON.parse(text), nodes = 0, removed = 0, shorts = 0, opaque = 0;
    var enabled = hideHomeShorts && endpoint === "browse";
    /**
     * 功能：执行 walk 对应的内部处理步骤。
     * 更新时间：2026-10-04T08:54:22+08:00
     */
    function walk(value, depth, homeContext) {
      if (!value || typeof value !== "object") return;
      if (++nodes > MAX_JSON_NODES || depth > 64) fail("json-limit");
      if (Array.isArray(value)) { value.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (v) {walk(v, depth + 1, homeContext);}); return; }
      if (enabled && jsonHome(value)) homeContext = true;
      Object.keys(value).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) {
        var child = value[key];
        if (key === "elementRenderer") opaque++;


        if ((key === "contents" || key === "continuationItems" || key === "results" || key === "items") && Array.isArray(child)) {
          value[key] = child.filter(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (entry) {
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
  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
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
  if (typeof $request !== "undefined" && typeof $response !== "undefined" && API.test($request.url || "")) devCapture("YouTubeFeed", "response", endpoint, VERSION, output);
  $done(output);
})();

  }
  else { $done({}); }
})();
