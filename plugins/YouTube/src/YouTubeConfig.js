/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 文件：YouTubeConfig.js
 * 功能：维护 YouTube Onesie 配置；旧初始化请求改写保留供离线回归，当前主插件使用原生空视频响应。
 * 版本：2.2.1
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
  function body(v,request,inner){if(!v||v.reference||!v.available)return v;var out={available:false,reason:'privacy-structure-only',bytes:v.bytes,redacted:true};if(!inner&&/^(config|log_event|initplayback|ump)$/.test(payload.endpoint))return out;try{var b=v.encoding==='base64'?decode(v.data):null;if(b){try{var text=typeof TextDecoder==='function'&&(b[0]===123||b[0]===91)?new TextDecoder('utf-8',{fatal:true}).decode(b):null;out.structure=text?json(JSON.parse(text),0):proto(b,0);}catch(_){out.structure={bytes:b.length,omitted:true};}}else out.structure=json(JSON.parse(v.data),0);}catch(_){out.structure={omitted:true};}return out;}
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
  if (/\/youtubei\/v1\/(?:config|log_event)(?:\?[^#]*)?$/i.test(dispatcherUrl)) {










/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SOURCE = "YouTubeConfig";
  var STATE_KEY = "ytads.onesie.youtube.v1";
  var LOG_CONFIG = "ytads.logger.config.v1";
  var LOG_CACHE = "ytads.logger.entries.v2";
  var MAX_BODY = 2097152;
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  args.log_level=String(args.log_level||"info").toLowerCase();
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var debug = flag(args.script_debug);
  var API = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.)?youtube\.com)\/youtubei\/v1\/(config|log_event)(?:\?[^#]*)?$/i;

  /**
   * 功能：把 Loon 参数转换为严格布尔值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function flag(value) { return value === true || value === "true"; }
  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) { var error = new Error(code); error.ytNoAdsCode = code; throw error; }
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
   * 功能：按不区分大小写的方式读取 HTTP 请求头。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function header(headers, name) {
    var keys = Object.keys(headers || {}), lower = name.toLowerCase();
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === lower) return String(headers[keys[i]] || "");
    return "";
  }
  /**
   * 功能：执行 isYouTubeApp 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function isYouTubeApp() {
    var ua = header(typeof $request !== "undefined" ? $request.headers : {}, "user-agent");
    return /(?:^|\s)com\.google\.ios\.youtube\//i.test(ua) && !/youtubemusic/i.test(ua);
  }
  /**
   * 功能：读取 Protobuf 变长整数并推进游标。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function readVarint(bytes, cursor) {
    var value = 0, factor = 1, count = 0;
    while (cursor.pos < bytes.length && count++ < 10) {
      var current = bytes[cursor.pos++];
      value += (current & 127) * factor;
      if (!Number.isSafeInteger(value)) fail("unsafe-varint");
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
      var dataStart = cursor.pos, dataEnd = cursor.pos, value = null;
      if (wire === 0) { value = readVarint(bytes, cursor); dataEnd = cursor.pos; }
      else if (wire === 1) { cursor.pos += 8; dataEnd = cursor.pos; }
      else if (wire === 2) {
        var length = readVarint(bytes, cursor);
        if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - cursor.pos) fail("truncated-field");
        dataStart = cursor.pos; cursor.pos += length; dataEnd = cursor.pos;
      } else if (wire === 5) { cursor.pos += 4; dataEnd = cursor.pos; }
      else fail("unsupported-wire");
      if (cursor.pos > bytes.length) fail("truncated-field");
      records.push({no:no, wire:wire, start:start, end:cursor.pos, dataStart:dataStart, dataEnd:dataEnd, value:value});
    }
    return records;
  }
  /**
   * 功能：执行 only 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function only(records, no, wire) {
    var found = null;
    for (var i = 0; i < records.length; i++) if (records[i].no === no && records[i].wire === wire) {
      if (found) fail("duplicate-schema-field");
      found = records[i];
    }
    return found;
  }
  /**
   * 功能：执行 descend 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function descend(bytes, field, budget) {
    var record = only(parse(bytes, budget), field, 2);
    return record ? bytes.subarray(record.dataStart, record.dataEnd) : null;
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
   * 功能：执行 extractConfig 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function extractConfig(body) {
    var root = bytesOf(body);
    if (!root || !root.length || root.length > MAX_BODY) fail("unsupported-body");
    var budget = {fields:0}, current = root;
    var path = [1, 16, 7, 138536474, 146311580];
    for (var i = 0; i < path.length; i++) {
      current = descend(current, path[i], budget);
      if (!current) return null;
    }
    var fields = parse(current, budget);
    var client = only(fields, 1, 2), encrypt = only(fields, 2, 2);
    if (!client || !encrypt || client.dataEnd === client.dataStart || encrypt.dataEnd === encrypt.dataStart) fail("incomplete-onesie-config");
    var lifetime = only(fields, 3, 0), enabled = only(fields, 30, 0);
    var seconds = lifetime && lifetime.value > 0 && lifetime.value <= 604800 ? lifetime.value : 3600;
    var now = Date.now();
    return {schema:1, platform:"youtube", clientKey:base64(current.subarray(client.dataStart, client.dataEnd)),
      encryptKey:base64(current.subarray(encrypt.dataStart, encrypt.dataEnd)), capturedAt:now,
      expiresAt:now + seconds * 1000, lifetimeSeconds:seconds, useHotConfig:!!(enabled && enabled.value)};
  }
  /**
   * 功能：执行 readState 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function readState() {
    if (typeof $persistentStore === "undefined") return null;
    try {
      var raw = $persistentStore.read(STATE_KEY), state = raw && raw.length <= 8192 ? JSON.parse(raw) : null;
      if (!state || state.schema !== 1 || state.platform !== "youtube" || typeof state.clientKey !== "string" || typeof state.encryptKey !== "string") return null;
      if (!Number.isFinite(state.expiresAt) || state.expiresAt <= Date.now()) { $persistentStore.write(undefined, STATE_KEY); return null; }
      return state;
    } catch (_) { return null; }
  }
  /**
   * 功能：执行 writeState 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function writeState(state) {
    if (typeof $persistentStore === "undefined") return false;
    return $persistentStore.write(JSON.stringify(state), STATE_KEY) === true;
  }
  /**
   * 功能：执行 filteredHeaders 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function filteredHeaders(headers, removeHotHash) {
    var result = {}, changed = false;
    Object.keys(headers || {}).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) {
      var lower = key.toLowerCase();
      if (lower === "content-encoding" || (removeHotHash && lower === "x-youtube-hot-hash-data")) changed = true;
      else result[key] = headers[key];
    });
    return {headers:result, changed:changed};
  }

  /**
   * 功能：执行 utf8Size 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function utf8Size(text) { return unescape(encodeURIComponent(text)).length; }
  /**
   * 功能：执行 checksum 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function checksum(text) { var hash = 2166136261; for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8); }
  /**
   * 功能：执行 captureBody 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function captureBody(body) { if (body === undefined || body === null) return {available:false,reason:"not-provided-by-runtime"}; if (typeof body === "string") return {available:true,encoding:"utf8-text",bytes:utf8Size(body),data:body}; var bytes = bytesOf(body); return bytes ? {available:true,encoding:"base64",bytes:bytes.length,data:base64(bytes)} : {available:false,reason:"unsupported-runtime-body-type"}; }
  /**
   * 功能：执行 logConfig 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function logConfig() { if (!flag(args.log_enabled) || typeof $persistentStore === "undefined") return null; try { var raw = $persistentStore.read(LOG_CONFIG), c = raw && raw.length <= 2048 ? JSON.parse(raw) : null; return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null; } catch (_) { return null; } }
  /**
   * 功能：执行 append 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function append(entry, payload) {
    var c = logConfig(), written = []; if (!c) return false;
    try {
      if (!ytDiagnosticShouldRecord(entry,payload,args.log_level)) return true;
      ytDiagnosticPurgeLegacy();
      var raw = $persistentStore.read(LOG_CACHE), old = raw ? JSON.parse(raw) : null;
      var state = old && old.session === c.session && Array.isArray(old.entries) ? old : {session:c.session,entries:[],captureBytes:0};
      if (state.entries.length >= 600) return false;
      var serialized = payload ? JSON.stringify(ytDiagnosticSanitize(payload)) : null, size = serialized ? utf8Size(serialized) : 0;
      var budget = [16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) * 1048576 : 33554432;
      if ((state.captureBytes || 0) + size > budget || size > 33554432) return false;
      if (serialized) {
        var chunks = []; for (var start = 0; start < serialized.length; start += 131072) chunks.push(serialized.slice(start, start + 131072));
        if (chunks.length > 256) return false;
        var prefix = "ytads.capture." + c.session + "." + payload.id + ".";
        entry.captureRef = {prefix:prefix,chunks:chunks.length,chars:serialized.length,storedBytes:size,checksum:checksum(serialized)};
        for (var i = 0; i < chunks.length; i++) { var key = prefix + i; if ($persistentStore.write(chunks[i], key) !== true) fail("capture-write-failed"); written.push(key); }
      }
      var next = {session:c.session,entries:state.entries.concat([entry]),captureBytes:(state.captureBytes || 0) + size};
      var index = JSON.stringify(next); if (utf8Size(index) > 131072 || ytDiagnosticCommitEntry(next, budget) !== true) fail("index-write-failed");
      return true;
    } catch (_) { for (var j = 0; j < written.length; j++) try { $persistentStore.write(undefined, written[j]); } catch (_) {} return false; }
  }
  /**
   * 功能：记录当前配置或请求处理结果。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function record(message, level, endpoint, output) {
    var now = new Date().toISOString(), phase = typeof $response === "undefined" ? "request" : "response";
    if (flag(args.capture_raw) && typeof $request !== "undefined") {
      var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
      var payload = {schema:1,id:id,time:now,source:SOURCE,version:VERSION,phase:phase,endpoint:endpoint,
        runtime:typeof $loon === "string" ? $loon : null,correlation:{urlMethodHash:checksum(($request.method || "GET") + " " + $request.url),exactPairing:false},
        request:{url:$request.url,method:$request.method || "GET",headers:$request.headers || {},h2_trailers:$request.h2_trailers || {},body:captureBody($request.body)},
        processing:{exception:null,executionScript:SOURCE,elapsedMs:Date.now()-ytDiagnosticScriptStartedAt,messages:[message],arguments:{onesie_enabled:true,log_level:args.log_level || "info"}}};
      if (typeof $response !== "undefined") { payload.responseBefore = {status:$response.status,headers:$response.headers || {},h2_trailers:$response.h2_trailers || {},body:captureBody($response.body)}; payload.responseAfter = {changed:false,status:$response.status,headerOverrides:null,transportHeadersRecomputedByLoon:true,body:{reference:"responseBefore.body"}}; }
      append({source:SOURCE,version:VERSION,endpoint:endpoint,level:"debug",time:now,phase:phase,message:"development capture: " + phase + " changed=" + !!(output && Object.keys(output).length)}, payload);
    } else {
      var ranks = {debug:0,info:1,warn:2,error:3}, minimum = Object.prototype.hasOwnProperty.call(ranks,args.log_level) ? args.log_level : "info";
      if ((minimum === "info" || ranks[level] >= ranks[minimum])) append({source:SOURCE,version:VERSION,endpoint:endpoint,level:level,time:now,phase:phase,message:message}, null);
    }
    if (debug && typeof console !== "undefined") console.log("[" + SOURCE + " " + VERSION + "] " + endpoint + " " + message);
  }

  var output = {};
  var match = typeof $request !== "undefined" ? API.exec($request.url || "") : null;
  var endpoint = match ? match[1].toLowerCase() : "unknown";
  if (match && isYouTubeApp()) {
    try {
      if (typeof $response === "undefined" && endpoint === "log_event") {
        var state = readState(), filtered = filteredHeaders($request.headers, !state);
        if (filtered.changed) output = {headers:filtered.headers};
        record((state ? "active" : "refresh-requested") + ": transport_headers=" + (filtered.changed ? "updated" : "unchanged"), state ? "debug" : "info", endpoint, output);
      } else if (typeof $response !== "undefined" && Number($response.status || 200) >= 200 && Number($response.status || 200) < 300) {
        var config = extractConfig($response.body);
        if (config) {
          if (!writeState(config)) fail("config-store-failed");
          record("updated: lifetime_seconds=" + config.lifetimeSeconds + " hot_config=" + config.useHotConfig, "info", endpoint, output);
        } else record("pass: onesie config absent", "debug", endpoint, output);
      }
    } catch (error) { record("pass: " + (error && error.message || "parse-failed"), "warn", endpoint, output); output = {}; }
  }
  $done(output);
})();

  }
  else if (!dispatcherResponse && /\/initplayback(?:\?[^#]*)?$/i.test(dispatcherUrl)) {









/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";

  var VERSION = "1.13.1";
  var SOURCE = "YouTubeConfig";
  var STATE_KEY = "ytads.onesie.youtube.v1";
  var LOG_CONFIG = "ytads.logger.config.v1";
  var LOG_CACHE = "ytads.logger.entries.v2";
  var MAX_BODY = 2097152;
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  args.log_level=String(args.log_level||"info").toLowerCase();
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var enabled = args.onesie_enabled !== false && args.onesie_enabled !== "false";
  var refreshMismatch = args.onesie_refresh_on_mismatch !== false && args.onesie_refresh_on_mismatch !== "false";
  var directPreroll = !flag(args.onesie_local_crypto);
  var debug = flag(args.script_debug);
  var API = /^https:\/\/[a-z0-9-]+\.googlevideo\.com\/initplayback(?:\?[^#]*)?$/i;

  /**
   * 功能：把 Loon 参数转换为严格布尔值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function flag(value) { return value === true || value === "true"; }
  /**
   * 功能：抛出带稳定错误代码的处理异常。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function fail(code) { var error = new Error(code); error.ytNoAdsCode = code; throw error; }
  /**
   * 功能：把 Loon 运行时正文安全转换为 Uint8Array。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function bytesOf(value) { if (value instanceof Uint8Array) return value; if (value instanceof ArrayBuffer) return new Uint8Array(value); if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer,value.byteOffset,value.byteLength); return null; }
  /**
   * 功能：按不区分大小写的方式读取 HTTP 请求头。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function header(headers, name) { var keys = Object.keys(headers || {}), lower = name.toLowerCase(); for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === lower) return String(headers[keys[i]] || ""); return ""; }
  /**
   * 功能：执行 isYouTubeApp 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function isYouTubeApp() { var ua = header($request.headers,"user-agent"); return /(?:^|\s)com\.google\.ios\.youtube\//i.test(ua) && !/youtubemusic/i.test(ua); }
  /**
   * 功能：读取 Protobuf 变长整数并推进游标。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function readVarint(bytes,cursor) { var value=0,factor=1,count=0; while(cursor.pos<bytes.length&&count++<10){var current=bytes[cursor.pos++];value+=(current&127)*factor;if(!Number.isSafeInteger(value))fail("unsafe-varint");if(current<128)return value;factor*=128;}fail("invalid-varint"); }
  /**
   * 功能：执行 skipValue 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function skipValue(bytes,cursor,no,wire,budget){if(wire===0)readVarint(bytes,cursor);else if(wire===1)cursor.pos+=8;else if(wire===2){var length=readVarint(bytes,cursor);if(!Number.isSafeInteger(length)||length<0||length>bytes.length-cursor.pos)fail("truncated-field");cursor.pos+=length;}else if(wire===3){while(cursor.pos<bytes.length){if(++budget.fields>MAX_FIELDS)fail("field-limit");var tag=readVarint(bytes,cursor),childNo=Math.floor(tag/8),childWire=tag&7;if(!childNo)fail("invalid-tag");if(childWire===4){if(childNo!==no)fail("mismatched-end-group");return;}skipValue(bytes,cursor,childNo,childWire,budget);}fail("truncated-group");}else if(wire===4)fail("unexpected-end-group");else if(wire===5)cursor.pos+=4;else fail("unsupported-wire");if(cursor.pos>bytes.length)fail("truncated-field");}
  /**
   * 功能：解析 Protobuf 字段边界并保留原始字节位置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function parse(bytes,budget) { var cursor={pos:0},records=[]; while(cursor.pos<bytes.length){if(++budget.fields>MAX_FIELDS)fail("field-limit");var start=cursor.pos,tag=readVarint(bytes,cursor),no=Math.floor(tag/8),wire=tag&7;if(!no)fail("invalid-tag");var dataStart=cursor.pos,dataEnd=cursor.pos,value=null;if(wire===0){value=readVarint(bytes,cursor);dataEnd=cursor.pos;}else if(wire===1){cursor.pos+=8;dataEnd=cursor.pos;}else if(wire===2){var length=readVarint(bytes,cursor);if(!Number.isSafeInteger(length)||length<0||length>bytes.length-cursor.pos)fail("truncated-field");dataStart=cursor.pos;cursor.pos+=length;dataEnd=cursor.pos;}else if(wire===3){skipValue(bytes,cursor,no,wire,budget);dataEnd=cursor.pos;}else if(wire===5){cursor.pos+=4;dataEnd=cursor.pos;}else fail(wire===4?"unexpected-end-group":"unsupported-wire");if(cursor.pos>bytes.length)fail("truncated-field");records.push({no:no,wire:wire,start:start,end:cursor.pos,dataStart:dataStart,dataEnd:dataEnd,value:value});}return records; }
  /**
   * 功能：执行 only 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function only(records,no,wire){var found=null;for(var i=0;i<records.length;i++)if(records[i].no===no&&records[i].wire===wire){if(found)fail("duplicate-schema-field");found=records[i];}return found;}
  /**
   * 功能：执行 encryptedClientKey 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function encryptedClientKey(body){var root=bytesOf(body);if(!root||!root.length||root.length>MAX_BODY)fail("unsupported-body");var budget={fields:0},outer=only(parse(root,budget),3,2);if(!outer)return null;var inner=root.subarray(outer.dataStart,outer.dataEnd),key=only(parse(inner,budget),5,2);return key?inner.subarray(key.dataStart,key.dataEnd):null;}
  /**
   * 功能：只关闭 Onesie 外层信封的片头广告请求标志，保留密文、密钥、IV、HMAC 与未知字段。
   * 更新时间：2026-10-04T15:47:25+08:00
   * @param {Uint8Array|ArrayBuffer} body 已由 Loon 提供的二进制请求正文。
   * @returns {Object|null} 返回修改后的正文与方式；已关闭或未知结构返回空值。
   * @throws {Error} 重复字段、字段类型异常或截断时拒绝修改。
   */
  function disablePreroll(body) {
    var root = bytesOf(body);
    if (!root || !root.length || root.length > MAX_BODY) fail("unsupported-body");
    var budget = {fields:0}, roots = parse(root, budget);
    var outer = only(roots, 3, 2);
    if (!outer) return null;
    var count = 0, i;
    for (i = 0; i < roots.length; i++) if (roots[i].no === 3) count++;
    if (count !== 1) fail("duplicate-schema-field");
    var envelope = root.subarray(outer.dataStart, outer.dataEnd), fields = parse(envelope, budget);
    for (var n = 0; n < 4; n++) {
      var number = [2,5,6,7][n], total = 0;
      for (i = 0; i < fields.length; i++) if (fields[i].no === number) {
        total++;
        if (fields[i].wire !== 2) fail("invalid-envelope-field");
      }
      if (total > 1) fail("duplicate-schema-field");
    }
    var cipher = only(fields, 2, 2), key = only(fields, 5, 2), iv = only(fields, 6, 2), mac = only(fields, 7, 2);
    if (!cipher || !key || !iv || !mac || cipher.dataEnd === cipher.dataStart || key.dataEnd === key.dataStart || iv.dataEnd - iv.dataStart !== 16 || mac.dataEnd - mac.dataStart !== 32) return null;
    var flags = [];
    for (i = 0; i < fields.length; i++) if (fields[i].no === 13) flags.push(fields[i]);
    if (flags.length > 1) fail("duplicate-schema-field");
    var preroll = flags[0];
    if (preroll && (preroll.wire !== 0 || (preroll.value !== 0 && preroll.value !== 1))) fail("invalid-preroll-flag");
    if (preroll && preroll.value === 0) return null;
    if (preroll && preroll.dataEnd - preroll.dataStart === 1) {
      var result = new Uint8Array(root);
      result[outer.dataStart + preroll.dataStart] = 0;
      return {body:result, mode:"in_place"};
    }
    var parts = [];
    for (i = 0; i < fields.length; i++) parts.push(fields[i] === preroll ? scalar(13, 0) : raw(envelope, fields[i]));
    if (!preroll) parts.push(scalar(13, 0));
    var changed = message(3, concat(parts)), rootParts = [];
    for (i = 0; i < roots.length; i++) rootParts.push(roots[i] === outer ? changed : raw(root, roots[i]));
    return {body:concat(rootParts), mode:"envelope_only"};
  }
  /**
   * 功能：执行 base64 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function base64(bytes){var alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",result="";for(var i=0;i<bytes.length;i+=3){var a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;result+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|(c>>6)]:"=")+(i+2<bytes.length?alphabet[c&63]:"=");}return result;}
  /**
   * 功能：执行 unbase64 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function unbase64(text){var alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",clean=String(text||"").replace(/\s+/g,""),out=[];if(!clean||clean.length%4)fail("invalid-base64");for(var i=0;i<clean.length;i+=4){var a=alphabet.indexOf(clean[i]),b=alphabet.indexOf(clean[i+1]),c=clean[i+2]==="="?-1:alphabet.indexOf(clean[i+2]),d=clean[i+3]==="="?-1:alphabet.indexOf(clean[i+3]);if(a<0||b<0||(c<0&&clean[i+2]!=="=")||(d<0&&clean[i+3]!=="=")||(c<0&&d>=0)||(i+4<clean.length&&(c<0||d<0)))fail("invalid-base64");out.push((a<<2)|(b>>4));if(c>=0)out.push(((b&15)<<4)|(c>>2));if(d>=0)out.push(((c&3)<<6)|d);}return new Uint8Array(out);}
  /**
   * 功能：把整数编码为 Protobuf 变长整数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function varint(value){var result=[];do{var byte=value%128;value=Math.floor(value/128);result.push(byte+(value?128:0));}while(value);return new Uint8Array(result);}
  /**
   * 功能：合并多个二进制片段并保持顺序。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function concat(parts){var size=0,offset=0,i;for(i=0;i<parts.length;i++)size+=parts[i].length;var output=new Uint8Array(size);for(i=0;i<parts.length;i++){output.set(parts[i],offset);offset+=parts[i].length;}return output;}
  /**
   * 功能：编码长度限定的 Protobuf 消息字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function message(no,payload){return concat([varint(no*8+2),varint(payload.length),payload]);}
  /**
   * 功能：编码 Protobuf 标量字段。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function scalar(no,value){return concat([varint(no*8),varint(value)]);}
  /**
   * 功能：取得指定 Protobuf 字段的原始字节。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function raw(bytes,record){return bytes.subarray(record.start,record.end);}
  /**
   * 功能：执行 utf8Decode 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function utf8Decode(bytes){if(typeof TextDecoder!=="undefined")return new TextDecoder("utf-8",{fatal:true}).decode(bytes);var text="";for(var i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);return decodeURIComponent(escape(text));}
  /**
   * 功能：执行 utf8Encode 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function utf8Encode(text){if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text);var encoded=unescape(encodeURIComponent(text)),out=new Uint8Array(encoded.length);for(var i=0;i<encoded.length;i++)out[i]=encoded.charCodeAt(i);return out;}
  /**
   * 功能：执行 rotate 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function rotate(value,bits){return (value>>>bits)|(value<<(32-bits));}
  /**
   * 功能：执行 sha256 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function sha256(data){var constants=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];var length=data.length,total=Math.ceil((length+9)/64)*64,buffer=new Uint8Array(total),view=new DataView(buffer.buffer),bits=length*8;buffer.set(data);buffer[length]=128;view.setUint32(total-8,Math.floor(bits/4294967296));view.setUint32(total-4,bits>>>0);var hash=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],words=new Uint32Array(64);for(var offset=0;offset<total;offset+=64){for(var i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);for(i=16;i<64;i++){var s0=rotate(words[i-15],7)^rotate(words[i-15],18)^(words[i-15]>>>3),s1=rotate(words[i-2],17)^rotate(words[i-2],19)^(words[i-2]>>>10);words[i]=(words[i-16]+s0+words[i-7]+s1)>>>0;}var a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];for(i=0;i<64;i++){var upper=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),t1=(h+upper+choice+constants[i]+words[i])>>>0,lower=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),t2=(lower+majority)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}hash[0]=(hash[0]+a)>>>0;hash[1]=(hash[1]+b)>>>0;hash[2]=(hash[2]+c)>>>0;hash[3]=(hash[3]+d)>>>0;hash[4]=(hash[4]+e)>>>0;hash[5]=(hash[5]+f)>>>0;hash[6]=(hash[6]+g)>>>0;hash[7]=(hash[7]+h)>>>0;}var result=new Uint8Array(32),resultView=new DataView(result.buffer);for(i=0;i<8;i++)resultView.setUint32(i*4,hash[i]);return result;}
  /**
   * 功能：执行 hmac256 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function hmac256(key,data){if(key.length>64)key=sha256(key);var inner=new Uint8Array(64+data.length),outer=new Uint8Array(96);for(var i=0;i<64;i++){var value=i<key.length?key[i]:0;inner[i]=value^54;outer[i]=value^92;}inner.set(data,64);outer.set(sha256(inner),64);return sha256(outer);}
  /**
   * 功能：执行 equal 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function equal(a,b){if(!a||!b||a.length!==b.length)return false;var difference=0;for(var i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;}
  var AES_SBOX=new Uint8Array([99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22]);
  /**
   * 功能：执行 aesSchedule 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function aesSchedule(key){if(!key||key.length!==16)fail("invalid-aes-key");var expanded=new Uint8Array(176);expanded.set(key);var generated=16,rcon=1,temp=new Uint8Array(4);while(generated<176){for(var i=0;i<4;i++)temp[i]=expanded[generated-4+i];if(generated%16===0){var first=temp[0];temp[0]=AES_SBOX[temp[1]]^rcon;temp[1]=AES_SBOX[temp[2]];temp[2]=AES_SBOX[temp[3]];temp[3]=AES_SBOX[first];rcon=((rcon<<1)^((rcon&128)?27:0))&255;}for(i=0;i<4;i++){expanded[generated]=expanded[generated-16]^temp[i];generated++;}}return expanded;}
  /**
   * 功能：执行 aesBlock 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function aesBlock(input,roundKeys){var state=new Uint8Array(input),round,i,column,a0,a1,a2,a3,t;/**
 * 功能：执行 addKey 对应的内部处理步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function addKey(offset){for(i=0;i<16;i++)state[i]^=roundKeys[offset+i];}/**
 * 功能：执行 xtime 对应的内部处理步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function xtime(value){return ((value<<1)^((value&128)?27:0))&255;}addKey(0);for(round=1;round<=10;round++){for(i=0;i<16;i++)state[i]=AES_SBOX[state[i]];t=state[1];state[1]=state[5];state[5]=state[9];state[9]=state[13];state[13]=t;t=state[2];state[2]=state[10];state[10]=t;t=state[6];state[6]=state[14];state[14]=t;t=state[3];state[3]=state[15];state[15]=state[11];state[11]=state[7];state[7]=t;if(round<10)for(column=0;column<4;column++){i=column*4;a0=state[i];a1=state[i+1];a2=state[i+2];a3=state[i+3];t=a0^a1^a2^a3;state[i]=a0^t^xtime(a0^a1);state[i+1]=a1^t^xtime(a1^a2);state[i+2]=a2^t^xtime(a2^a3);state[i+3]=a3^t^xtime(a3^a0);}addKey(round*16);}return state;}
  /**
   * 功能：执行 incrementCounter 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function incrementCounter(counter){for(var i=15;i>=0;i--){counter[i]=(counter[i]+1)&255;if(counter[i]!==0)return;}}
  /**
   * 功能：执行 aesCtr 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function aesCtr(data,key,iv){if(!iv||iv.length!==16)fail("invalid-aes-iv");var roundKeys=aesSchedule(key),counter=new Uint8Array(iv),output=new Uint8Array(data.length);for(var offset=0;offset<data.length;offset+=16){var stream=aesBlock(counter,roundKeys),length=Math.min(16,data.length-offset);for(var i=0;i<length;i++)output[offset+i]=data[offset+i]^stream[i];incrementCounter(counter);}return output;}
  /**
   * 功能：执行 hexPrefix 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function hexPrefix(data){var result="";for(var i=0;i<Math.min(4,data.length);i++)result+=(data[i]<16?"0":"")+data[i].toString(16);return result||"empty";}
  /**
   * 功能：执行 decodePlain 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function decodePlain(data){if(data.length>=2&&data[0]===31&&data[1]===139){if(typeof $utils==="undefined"||typeof $utils.ungzip!=="function")fail("gzip-unavailable");var restored=bytesOf($utils.ungzip(data));if(!restored||!restored.length||restored.length>MAX_BODY)fail("invalid-gzip-plain");return{bytes:restored,encoding:"gzip"};}return{bytes:data,encoding:"identity"};}
  /**
   * 功能：执行 encodePlain 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function encodePlain(data,encoding){if(encoding!=="gzip")return data;if(typeof $utils==="undefined"||typeof $utils.gzip!=="function")fail("gzip-unavailable");var compressed=bytesOf($utils.gzip(data));if(!compressed||!compressed.length||compressed.length>MAX_BODY)fail("gzip-failed");return compressed;}
  /**
   * 功能：执行 stage 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function stage(prefix,fn){try{return fn();}catch(error){fail(prefix+(error&&error.ytNoAdsCode||"failed"));}}
  /**
   * 功能：验证播放器已知字段的类型与唯一性，遇到歧义时停止内层改写。
   * 更新时间：2026-10-05T11:54:46+08:00
   * @param {Array} records 已解析字段。
   * @param {number} no 字段编号。
   * @param {number} wire 预期类型。
   * @returns {Object|null} 唯一的合法字段或缺失状态。
   */
  function knownPlayerField(records,no,wire) {
    for(var i=0;i<records.length;i++)if(records[i].no===no&&records[i].wire!==wire)fail("player-schema-mismatch");
    return only(records,no,wire);
  }
  var lastInnerDiagnostics=null;
  var lastInnerBodies=null;
  /**
   * 功能：输出内层格式与已知路径的存在状态，不记录正文、令牌或密钥。
   * 更新时间：2026-10-05T11:54:46+08:00
   * @param {Object} counts 内层清理计数及原始结构状态。
   * @returns {string} 固定字段名称及有限状态组成的安全诊断摘要。
   */
  function innerDiagnosticSummary(counts) {
    if(!counts)return "";
    return " inner_format="+counts.format+" playback_present="+!!counts.playbackPresent+" content_present="+!!counts.contentPresent+" inline_before="+(counts.inlineBefore||"unobserved")+" region_selected="+(selectedRegion()||"original")+" region_applied="+(counts.regionApplied||0);
  }
  /**
   * 功能：清理播放器消息中的广告配置并保留未知字段。
   * 更新时间：2026-10-05T11:54:46+08:00
   */
  function cleanPlayer(value,counts) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var context = value.context;
    if (!context || typeof context !== "object" || Array.isArray(context)) return false;
    var changed = regionJson(context,counts);
    if (Object.prototype.hasOwnProperty.call(context,"adSignalsInfo")) {delete context.adSignalsInfo;counts.contextAdSignals++;changed=true;}
    counts.playbackPresent = Object.prototype.hasOwnProperty.call(value,"playbackContext");
    if (!counts.playbackPresent) {value.playbackContext={};changed=true;}
    var playback=value.playbackContext;
    if (!playback || typeof playback!=="object" || Array.isArray(playback)) fail("playback-schema-mismatch");
    counts.contentPresent=Object.prototype.hasOwnProperty.call(playback,"contentPlaybackContext");
    if (!counts.contentPresent) {playback.contentPlaybackContext={};changed=true;}
    var content=playback.contentPlaybackContext;
    if (!content || typeof content!=="object" || Array.isArray(content)) fail("content-schema-mismatch");
    var names=["adParams","forceAdParameters"];
    for(var i=0;i<names.length;i++) if(Object.prototype.hasOwnProperty.call(content,names[i])) {delete content[names[i]];counts.playbackAdParams++;changed=true;}
    counts.inlineBefore=content.isInlinePlaybackNoAd===true?"on":content.isInlinePlaybackNoAd===false?"off":Object.prototype.hasOwnProperty.call(content,"isInlinePlaybackNoAd")?"invalid":"absent";
    if(counts.inlineBefore==="invalid") fail("inline-schema-mismatch");
    if(content.isInlinePlaybackNoAd!==true) {content.isInlinePlaybackNoAd=true;counts.inlineNoAd++;changed=true;}
    return changed;
  }

  /**
   * 功能：校验手动选择的播放请求地区；默认和无效选项均不修改地区。
   * 更新时间：2026-10-05T13:06:10+08:00
   * @returns {string} 已确认的两字母地区代码，或空字符串。
   */
  function selectedRegion(){var region=String(args.playback_region||'original').toUpperCase();return ['CN','HK','TW','US','JP','KR','SG','GB','DE','RU'].indexOf(region)>=0?region:'';}
  /**
   * 功能：只修改已确认的 ClientInfo.gl 字段；拒绝重复或错误线型并保留其他字段。
   * 更新时间：2026-10-05T13:06:10+08:00
   * @param {Uint8Array} bytes 客户端信息字段。
   * @param {Object} budget 解析预算。
   * @param {Object} counts 处理计数。
   * @returns {Object} 修改后的字段及是否发生改变。
   */
  function regionClient(bytes,budget,counts){var region=selectedRegion();if(!region)return {body:bytes,changed:false};var fields=parse(bytes,budget),parts=[],seen=false,changed=false;for(var i=0;i<fields.length;i++){var r=fields[i];if(r.no===2){if(seen||r.wire!==2)fail('region-schema-mismatch');seen=true;var old=bytes.subarray(r.dataStart,r.dataEnd);if(old.length!==2||old[0]!==region.charCodeAt(0)||old[1]!==region.charCodeAt(1)){parts.push(message(2,new Uint8Array([region.charCodeAt(0),region.charCodeAt(1)])));changed=true;}else parts.push(raw(bytes,r));}else parts.push(raw(bytes,r));}if(!seen){parts.push(message(2,new Uint8Array([region.charCodeAt(0),region.charCodeAt(1)])));changed=true;}counts.regionApplied=(counts.regionApplied||0)+1;return {body:changed?concat(parts):bytes,changed:changed};}
  /**
   * 功能：定位 InnertubeContext.client，仅在手动选择地区时调用地区字段改写。
   * 更新时间：2026-10-05T13:06:10+08:00
   */
  function regionContext(bytes,budget,counts){if(!selectedRegion())return {body:bytes,changed:false};var fields=parse(bytes,budget),parts=[],seen=false,changed=false;for(var i=0;i<fields.length;i++){var r=fields[i];if(r.no===1){if(seen||r.wire!==2)fail('region-context-schema-mismatch');seen=true;var c=regionClient(bytes.subarray(r.dataStart,r.dataEnd),budget,counts);parts.push(c.changed?message(1,c.body):raw(bytes,r));changed=changed||c.changed;}else parts.push(raw(bytes,r));}return {body:changed?concat(parts):bytes,changed:changed};}
  /**
   * 功能：只在合法的 JSON 客户端对象上设置 gl，不创建未知上下文。
   * 更新时间：2026-10-05T13:06:10+08:00
   */
  function regionJson(context,counts){var region=selectedRegion();if(!region||!context||!context.client||typeof context.client!=='object'||Array.isArray(context.client))return false;counts.regionApplied=(counts.regionApplied||0)+1;if(context.client.gl===region)return false;context.client.gl=region;return true;}
  /**
   * 功能：执行 cleanProtoContext 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function cleanProtoContext(bytes,budget,counts){var region=regionContext(bytes,budget,counts);bytes=region.body;var records=parse(bytes,budget),parts=[],changed=region.changed;for(var i=0;i<records.length;i++){if(records[i].no===9&&records[i].wire===2){counts.contextAdSignals++;changed=true;}else parts.push(raw(bytes,records[i]));}return{body:changed?concat(parts):bytes,changed:changed};}
  /**
   * 功能：沿已确认的播放器字段路径清理广告参数，诊断原始状态并保留未知字段。
   * 更新时间：2026-10-05T11:54:46+08:00
   */
  function cleanProtoContent(bytes,budget,counts) {
    var records=parse(bytes,budget),parts=[],changed=false;
    var inline=knownPlayerField(records,50,0);
    counts.inlineBefore=inline?inline.value===1?"on":inline.value===0?"off":"invalid":"absent";
    if(counts.inlineBefore==="invalid")fail("inline-schema-mismatch");
    for(var i=0;i<records.length;i++) {
      var record=records[i];
      if((record.no===12||record.no===25)&&record.wire===2) {counts.playbackAdParams++;changed=true;}
      else if(record===inline&&inline.value!==1) {parts.push(scalar(50,1));counts.inlineNoAd++;changed=true;}
      else parts.push(raw(bytes,record));
    }
    if(!inline) {parts.push(scalar(50,1));counts.inlineNoAd++;changed=true;}
    return {body:changed?concat(parts):bytes,changed:changed};
  }

  /**
   * 功能：沿已确认的播放器字段路径清理广告参数，诊断原始状态并保留未知字段。
   * 更新时间：2026-10-05T11:54:46+08:00
   */
  function cleanProtoPlayback(bytes,budget,counts) {
    var records=parse(bytes,budget),parts=[],changed=false,content=knownPlayerField(records,1,2);
    counts.contentPresent=!!content;
    for(var i=0;i<records.length;i++) {
      var record=records[i];
      if(record===content) {var child=cleanProtoContent(bytes.subarray(record.dataStart,record.dataEnd),budget,counts);parts.push(child.changed?message(1,child.body):raw(bytes,record));changed=changed||child.changed;}
      else parts.push(raw(bytes,record));
    }
    if(!content) {parts.push(message(1,scalar(50,1)));counts.inlineBefore="absent";counts.inlineNoAd++;changed=true;}
    return {body:changed?concat(parts):bytes,changed:changed};
  }

  /**
   * 功能：沿已确认的播放器字段路径清理广告参数，诊断原始状态并保留未知字段。
   * 更新时间：2026-10-05T11:54:46+08:00
   */
  function cleanProtoPlayer(bytes,budget,counts) {
    var records=parse(bytes,budget),parts=[],changed=false;
    var context=knownPlayerField(records,1,2),playback=knownPlayerField(records,4,2);
    if(!context)return {body:bytes,changed:false};
    counts.playbackPresent=!!playback;
    for(var i=0;i<records.length;i++) {
      var record=records[i],child=null;
      if(record===context)child=cleanProtoContext(bytes.subarray(record.dataStart,record.dataEnd),budget,counts);
      else if(record===playback)child=cleanProtoPlayback(bytes.subarray(record.dataStart,record.dataEnd),budget,counts);
      if(child&&child.changed){parts.push(message(record.no,child.body));changed=true;}else parts.push(raw(bytes,record));
    }
    if(!playback){parts.push(message(4,message(1,scalar(50,1))));counts.contentPresent=false;counts.inlineBefore="absent";counts.inlineNoAd++;changed=true;}
    return {body:changed?concat(parts):bytes,changed:changed};
  }

  /**
   * 功能：沿已确认的播放器字段路径清理广告参数，诊断原始状态并保留未知字段。
   * 更新时间：2026-10-05T11:54:46+08:00
   */
  function cleanInnerBody(bytes,budget,counts) {
    var value=null,json=false;
    try {value=JSON.parse(utf8Decode(bytes));json=true;}catch(_) {}
    counts.format=json?"json":"protobuf";
    if(flag(args.capture_raw))lastInnerBodies={before:bytes,after:null};
    lastInnerDiagnostics=counts;
    if(json) {if(!cleanPlayer(value,counts))return null;return {body:utf8Encode(JSON.stringify(value)),format:"json"};}
    var result=cleanProtoPlayer(bytes,budget,counts);
    return result.changed?{body:result.body,format:"protobuf"}:null;
  }

  /**
   * 功能：执行 cleanEncryptedRequest 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function cleanEncryptedRequest(body,state){var root=bytesOf(body),budget={fields:0};if(!root||!root.length||root.length>MAX_BODY)fail("unsupported-body");var rootRecords=stage("outer-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return parse(root,budget);}),outer=only(rootRecords,3,2);if(!outer)return null;var envelope=root.subarray(outer.dataStart,outer.dataEnd),records=stage("envelope-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return parse(envelope,budget);}),cipherField=only(records,2,2),ivField=only(records,6,2),macField=only(records,7,2);if(!cipherField||!ivField||!macField)fail("incomplete-encrypted-request");var clientKey=unbase64(state.clientKey);if(clientKey.length!==32)fail("invalid-client-key");var cipher=envelope.subarray(cipherField.dataStart,cipherField.dataEnd),iv=envelope.subarray(ivField.dataStart,ivField.dataEnd),mac=envelope.subarray(macField.dataStart,macField.dataEnd);if(iv.length!==16||mac.length!==32)fail("invalid-crypto-params");if(!equal(hmac256(clientKey.subarray(16),concat([cipher,iv])),mac))fail("hmac-mismatch");var decrypted=stage("decrypt-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return aesCtr(cipher,clientKey.subarray(0,16),iv);}),decoded=stage("decompressed-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return decodePlain(decrypted);}),plain=decoded.bytes,innerRecords=stage("decrypted-"+decoded.encoding+"-"+hexPrefix(plain)+"-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return parse(plain,budget);}),bodyField=only(innerRecords,3,2);if(!bodyField)return null;var counts={contextAdSignals:0,playbackAdParams:0,inlineNoAd:0},cleanedBody=cleanInnerBody(plain.subarray(bodyField.dataStart,bodyField.dataEnd),budget,counts);if(lastInnerBodies)lastInnerBodies.after=cleanedBody?cleanedBody.body:lastInnerBodies.before;if(!cleanedBody)return null;var innerParts=[];for(var i=0;i<innerRecords.length;i++)innerParts.push(innerRecords[i]===bodyField?message(3,cleanedBody.body):raw(plain,innerRecords[i]));var cleanedPlain=concat(innerParts),encodedPlain=stage("compressed-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return encodePlain(cleanedPlain,decoded.encoding);}),cleanedCipher=stage("encrypt-",/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function(){return aesCtr(encodedPlain,clientKey.subarray(0,16),iv);});if(!cleanedCipher||cleanedCipher.length!==encodedPlain.length)fail("encrypt-failed");var cleanedMac=hmac256(clientKey.subarray(16),concat([cleanedCipher,iv])),envelopeParts=[];for(i=0;i<records.length;i++){var record=records[i];if(record===cipherField)envelopeParts.push(message(2,cleanedCipher));else if(record===macField)envelopeParts.push(message(7,cleanedMac));else if(record.no===13&&record.wire===0)envelopeParts.push(scalar(13,0));else envelopeParts.push(raw(envelope,record));}var cleanedEnvelope=concat(envelopeParts),rootParts=[];for(i=0;i<rootRecords.length;i++)rootParts.push(rootRecords[i]===outer?message(3,cleanedEnvelope):raw(root,rootRecords[i]));return{body:concat(rootParts),counts:counts,encoding:decoded.encoding,format:cleanedBody.format};}
  /**
   * 功能：执行 readState 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function readState(){if(typeof $persistentStore==="undefined")return null;try{var raw=$persistentStore.read(STATE_KEY),state=raw&&raw.length<=8192?JSON.parse(raw):null;if(!state||state.schema!==1||state.platform!=="youtube"||typeof state.clientKey!=="string"||typeof state.encryptKey!=="string")return null;if(!Number.isFinite(state.expiresAt)||state.expiresAt<=Date.now()){$persistentStore.write(undefined,STATE_KEY);return null;}return state;}catch(_){return null;}}
  /**
   * 功能：执行 clearState 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function clearState(){if(typeof $persistentStore!=="undefined")$persistentStore.write(undefined,STATE_KEY);}
  /**
   * 功能：执行 rewrittenHeaders 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function rewrittenHeaders(headers){var result={},keys=Object.keys(headers||{});for(var i=0;i<keys.length;i++){var lower=keys[i].toLowerCase();if(lower!=="content-encoding"&&lower!=="content-length")result[keys[i]]=headers[keys[i]];}return result;}
  /**
   * 功能：返回空的 initplayback 响应，促使 YouTube 回退到已清理的普通播放器链路。
   * 更新时间：2026-10-04T10:26:00+08:00
   */
  function classicPlaybackResponse(){return{response:{status:200,headers:{"Content-Type":"application/x-protobuf","Cache-Control":"no-store"},body:new Uint8Array(0)}};}
  /**
   * 功能：执行 utf8Size 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function utf8Size(text){return unescape(encodeURIComponent(text)).length;}
  /**
   * 功能：执行 checksum 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function checksum(text){var hash=2166136261;for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return "fnv1a32-utf16:"+("00000000"+(hash>>>0).toString(16)).slice(-8);}
  /**
   * 功能：执行 captureBody 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function captureBody(body){if(body===undefined||body===null)return{available:false,reason:"not-provided-by-runtime"};if(typeof body==="string")return{available:true,encoding:"utf8-text",bytes:utf8Size(body),data:body};var bytes=bytesOf(body);return bytes?{available:true,encoding:"base64",bytes:bytes.length,data:base64(bytes)}:{available:false,reason:"unsupported-runtime-body-type"};}
  /**
   * 功能：执行 logConfig 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function logConfig(){if(!flag(args.log_enabled)||typeof $persistentStore==="undefined")return null;try{var raw=$persistentStore.read(LOG_CONFIG),c=raw&&raw.length<=2048?JSON.parse(raw):null;return c&&c.enabled===true&&typeof c.session==="string"&&/^[a-z0-9-]{1,80}$/.test(c.session)?c:null;}catch(_){return null;}}
  /**
   * 功能：执行 append 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function append(entry,payload){var c=logConfig(),written=[];if(!c)return false;try{if (!ytDiagnosticShouldRecord(entry,payload,args.log_level)) return true;
      ytDiagnosticPurgeLegacy();var raw=$persistentStore.read(LOG_CACHE),old=raw?JSON.parse(raw):null,state=old&&old.session===c.session&&Array.isArray(old.entries)?old:{session:c.session,entries:[],captureBytes:0};if(state.entries.length>=600)return false;var serialized=payload?JSON.stringify(ytDiagnosticSanitize(payload)):null,size=serialized?utf8Size(serialized):0,budget=[16,32,64].indexOf(Number(args.capture_budget))>=0?Number(args.capture_budget)*1048576:33554432;if((state.captureBytes||0)+size>budget||size>33554432)return false;if(serialized){var chunks=[];for(var start=0;start<serialized.length;start+=131072)chunks.push(serialized.slice(start,start+131072));if(chunks.length>256)return false;var prefix="ytads.capture."+c.session+"."+payload.id+".";entry.captureRef={prefix:prefix,chunks:chunks.length,chars:serialized.length,storedBytes:size,checksum:checksum(serialized)};for(var i=0;i<chunks.length;i++){var key=prefix+i;if($persistentStore.write(chunks[i],key)!==true)fail("capture-write-failed");written.push(key);}}var next={session:c.session,entries:state.entries.concat([entry]),captureBytes:(state.captureBytes||0)+size},index=JSON.stringify(next);if(utf8Size(index)>131072||ytDiagnosticCommitEntry(next, budget)!==true)fail("index-write-failed");return true;}catch(_){for(var j=0;j<written.length;j++)try{$persistentStore.write(undefined,written[j]);}catch(_){}return false;}}
  /**
   * 功能：记录当前配置或请求处理结果。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function record(message,level,output){var now=new Date().toISOString(),changed=!!(output&&(output.response||output.body));if(flag(args.capture_raw)){var id=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,14),request={url:$request.url,method:$request.method||"GET",headers:$request.headers||{},h2_trailers:$request.h2_trailers||{},body:captureBody($request.body)};var payload={schema:1,id:id,time:now,source:SOURCE,version:VERSION,phase:"request",endpoint:"initplayback",requestInner:lastInnerBodies?{body:captureBody(lastInnerBodies.before)}:null,requestInnerAfter:lastInnerBodies&&lastInnerBodies.after?{body:captureBody(lastInnerBodies.after)}:null,runtime:typeof $loon==="string"?$loon:null,correlation:{urlMethodHash:checksum(request.method+" "+request.url),exactPairing:false},request:request,processing:{exception:null,executionScript:SOURCE,elapsedMs:Date.now()-ytDiagnosticScriptStartedAt,messages:[message],arguments:{onesie_enabled:enabled,onesie_refresh_on_mismatch:refreshMismatch,log_level:args.log_level||"info"}},responseAfter:output&&output.response?{synthetic:true,status:output.response.status,headers:output.response.headers,body:captureBody(output.response.body)}:null,requestAfter:output&&output.body?{changed:true,body:captureBody(output.body)}:null};append({source:SOURCE,version:VERSION,endpoint:"initplayback",level:level,time:now,phase:"request",message:"development capture: "+message+" changed="+changed},payload);}else{var ranks={debug:0,info:1,warn:2,error:3},minimum=Object.prototype.hasOwnProperty.call(ranks,args.log_level)?args.log_level:"info";if((minimum==="info"||ranks[level]>=ranks[minimum]))append({source:SOURCE,version:VERSION,endpoint:"initplayback",level:level,time:now,phase:"request",message:message},null);}if(debug&&typeof console!=="undefined")console.log("["+SOURCE+" "+VERSION+"] initplayback "+message);}

  var output = {};
  if (enabled && typeof $request !== "undefined" && typeof $response === "undefined" && API.test($request.url || "") && isYouTubeApp()) {
    try {
      if (directPreroll) {
        var direct = disablePreroll($request.body);
        if (direct) {
          output = {headers:rewrittenHeaders($request.headers), body:direct.body};
        }
        var innerStatus = "config_absent", innerCounts = "", innerChanged = false;
        try {
          var activeState = readState(), directBody = direct ? direct.body : $request.body;
          if (activeState) {
            var activeKey = encryptedClientKey(directBody);
            if (!activeKey || !activeKey.length) innerStatus = "envelope_unrecognized";
            else if (base64(activeKey) !== activeState.encryptKey) innerStatus = "key_mismatch";
            else {
              var innerCleaned = cleanEncryptedRequest(directBody, activeState);
              innerStatus = innerCleaned ? "authenticated_cleaned" : "authenticated_unchanged";
              if(!innerCleaned)innerCounts=innerDiagnosticSummary(lastInnerDiagnostics);
              if (innerCleaned) {
                output = {headers:rewrittenHeaders($request.headers), body:innerCleaned.body};
                innerChanged = true;
                innerCounts = innerDiagnosticSummary(innerCleaned.counts) + " context_ad_signals=" + innerCleaned.counts.contextAdSignals + " playback_ad_params=" + innerCleaned.counts.playbackAdParams + " inline_no_ad=" + innerCleaned.counts.inlineNoAd;
              }
            }
          }
        } catch (innerError) {
          // 内层验证或改写失败时保留已完成的外层标志改动，不阻断播放。
          var failureCode = innerError && innerError.ytNoAdsCode || "";
          innerStatus = /hmac/.test(failureCode) ? "authentication_failed" :
            /gzip/.test(failureCode) ? "compression_failed" :
            /client-key/.test(failureCode) ? "invalid_config_key" : "protocol_cleanup_failed";
        }
        record((direct || innerChanged ? "changed" : "pass") + ": preroll_mode=" + (direct ? direct.mode : "unchanged") + " inner=" + innerStatus + " crypto_unchanged=" + !innerChanged + " fallback=false" + innerCounts, direct || innerChanged ? "info" : "debug", output);
      } else {
        var state = readState(), key = encryptedClientKey($request.body);
        if (!key || !key.length) record("pass: encrypted client key absent", "debug", output);
        else if (!state) record("pass: active config absent", "info", output);
        else if (base64(key) === state.encryptKey) {
        var cleaned = cleanEncryptedRequest($request.body, state);
        if (cleaned) {
          output = {headers:rewrittenHeaders($request.headers),body:cleaned.body};
          record("changed: authenticated=true encoding=" + cleaned.encoding + " inner=" + cleaned.format + " context_ad_signals=" + cleaned.counts.contextAdSignals + " playback_ad_params=" + cleaned.counts.playbackAdParams + " inline_no_ad=" + cleaned.counts.inlineNoAd + innerDiagnosticSummary(cleaned.counts), "info", output);
        } else record("matched: local config active; inner player request unchanged", "debug", output);
        }
        else {
          clearState();
          if (refreshMismatch) output = classicPlaybackResponse();
          record("mismatch: config cleared refresh=" + refreshMismatch, "warn", output);
        }
      }
    } catch (error) { record("pass: " + (error && error.message || "parse-failed"), "warn", output); output = {}; }
  }
  $done(output);
})();

  }
  else { $done({}); }
})();
