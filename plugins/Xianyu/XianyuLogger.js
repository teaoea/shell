/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 更新时间：2026-10-06
 * 闲鱼开发日志 1.0.0，2026-10-06。
 * 在 Loon 本地保存匹配到的 HTTP 请求／响应和标记，分块存储、校验、单文件导出。
 * 不修改业务请求或响应；所有正文仅在用户开启日志时读取。
 */
(function () {
  "use strict";
  var VERSION = "1.0.0", KEY = "xianyu.logger.v1", BASE = "http://xianyu-logs.invalid";
  var MAX_EVENTS = 4096, CHUNK = 32768, MAX_INDEX = 1048576;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var req = typeof $request === "undefined" ? null : $request;
  var res = typeof $response === "undefined" ? null : $response;
  var flag = function (v) { return v === true || v === "true"; };
  var mainEnabled = flag(args.log_enabled);
  var budget = [16, 32, 64, 128].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) * 1048576 : 33554432;
  var bodyLimit = [256, 1024, 4096].indexOf(Number(args.body_limit_kb)) >= 0 ? Number(args.body_limit_kb) * 1024 : 1048576;
  var sensitive = /^(?:cookie|set-cookie|authorization|proxy-authorization|password|passwd|secret|sign|signature|wua|mini-wua|umidtoken|deviceid|user.?id|seller.?id|buyer.?id|uid|unb|phone|mobile|email|address|session.?id|sid|csrf|x-csrf-token|_m_h5_tk(?:_enc)?)$|(?:access|refresh|login|auth|csrf|xsrf)[_-]?token|^x-.*(?:token|sign|uid|device)|^token$/i;

  /** 生成会话、事件及本地控制标识，不使用账号信息。 */
  function id() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12); }
  function now() { return new Date().toISOString(); }
  function size(s) { return unescape(encodeURIComponent(s)).length; }
  function checksum(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
  function header(h, name) { var keys = Object.keys(h || {}); for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name.toLowerCase()) return String(h[keys[i]]); return ""; }
  /** 不以闲鱼域名、共享 CDN、Referer 或 API 名推断发起 App；缺少标识即跳过。 */
  function source(headers) {
    var ua = header(headers, "user-agent");
    var marker = /(?:^|\s)(?:AliApp\(Fish\/[0-9][\d.]*\)|(?:com\.taobao\.fleamarket|IdleFish|Goofish|闲鱼|%E9%97%B2%E9%B1%BC)\/[0-9][\d.]*)(?=\s|$)/i.exec(ua);
    return marker ? {method:"user-agent-marker", marker:marker[0].trim(), processVerified:false} : null;
  }
  function ip(s) {
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) return s.split(".").every(function (v) { return Number(v) <= 255; }) ? s : null;
    if (s.indexOf(":") < 0 || !/^[a-f0-9:.]+$/i.test(s)) return null;
    var v = s.replace(/(?:\d{1,3}\.){3}\d{1,3}$/, function (v4) { return ip(v4) ? "0:0" : "invalid"; });
    var groups = v.split(":"), count = groups.filter(Boolean).length;
    if (groups.some(function (g) { return g && !/^[a-f0-9]{1,4}$/i.test(g); })) return null;
    if (v.indexOf("::") >= 0) return v.indexOf("::") === v.lastIndexOf("::") && v.indexOf(":::") < 0 && count < 8 ? s.toLowerCase() : null;
    return count === 8 && groups.length === 8 ? s.toLowerCase() : null;
  }
  function endpoint(url) {
    var m = /^([a-z][a-z\d+.-]*):\/\/(?:[^/?#]*@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?/i.exec(url || "");
    if (!m) return {host:null, urlIP:null, addressSource:"request-url"};
    var host = m[2].replace(/^\[|\]$/g, "").toLowerCase();
    return {scheme:m[1].toLowerCase(), host:host, port:m[3] ? Number(m[3]) : m[1].toLowerCase() === "https" ? 443 : 80, urlIP:ip(host), addressSource:"request-url"};
  }
  function write(v, k) { if ($persistentStore.write(v, k) !== true) throw Error("storage-write-failed"); }
  function config() {
    var raw = $persistentStore.read(KEY);
    if (!raw) return null;
    if (raw.length > MAX_INDEX) throw Error("invalid-index");
    var c = JSON.parse(raw);
    if (!c || c.schema !== 1 || !/^[a-z0-9-]+$/.test(c.session) || !Array.isArray(c.entries) || c.entries.length > MAX_EVENTS || !Number.isFinite(c.bytes) || c.bytes < 0) throw Error("invalid-index");
    return c;
  }
  function fresh(active) { return {schema:1, session:id(), csrf:id()+id(), startedAt:now(), active:active, bytes:0, entries:[], haltReason:null}; }
  function save(c) { var s = JSON.stringify(c); if (s.length > MAX_INDEX) throw Error("index-limit"); write(s, KEY); }
  function ensure() { var c = config(); if (!c) { c = fresh(mainEnabled); save(c); } return c; }
  function halt(session, reason) {
    try { var c = config(); if (c && c.session === session) { c.active = false; c.haltReason = reason; c.stoppedAt = now(); save(c); } } catch (_) {}
    console.log("[XianyuLogger] recording-stopped: " + reason);
  }
  function prefix(session, eventId) { return KEY + "." + session + "." + eventId + "."; }

  /** 在写入前遮盖已知凭据；保留广告字段、普通数值和未识别结构供开发。 */
  function cleanURL(s) {
    return String(s || "").replace(/^(https?:\/\/)[^/@]+@/i, "$1[REDACTED]@").replace(/([?&])([^=&#]+)=([^&#]*)/g, function (_, sep, key, value) {
      var k; try { k = decodeURIComponent(key); } catch (_) { k = key; }
      return sep + key + "=" + (sensitive.test(k) ? "%5BREDACTED%5D" : value);
    }).replace(/#.*$/, "");
  }
  function cleanText(s) {
    return String(s).replace(/https?:\/\/[^\s"'<>]+/gi, cleanURL)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+\/=._-]+/gi, "$1 [REDACTED]")
      .replace(/([?&\s])([\w-]+)=([^&\s]*)/g, function (m, sep, k, v) { return sensitive.test(k) ? sep + k + "=[REDACTED]" : m; })
      .replace(/"([\w-]+)"\s*:\s*"(?:\\.|[^"\\])*"/g, function (m, k) { return sensitive.test(k) ? JSON.stringify(k) + ':"[REDACTED]"' : m; });
  }
  function cleanJSON(v, depth) {
    if (depth > 80) return {omitted:"depth-limit"};
    if (Array.isArray(v)) return v.map(function (x) { return cleanJSON(x, depth + 1); });
    if (v && typeof v === "object") {
      var out = Object.create(null);
      Object.keys(v).forEach(function (k) { out[k] = sensitive.test(k) ? "[REDACTED]" : cleanJSON(v[k], depth + 1); });
      return out;
    }
    return typeof v === "string" ? cleanText(v) : v;
  }
  function cleanHeaders(h) {
    var out = Object.create(null);
    Object.keys(h || {}).forEach(function (k) { out[k] = sensitive.test(k) ? "[REDACTED]" : cleanText(h[k]); });
    return out;
  }
  function form(s) {
    return s.split("&").map(function (part) {
      var i = part.indexOf("="), k = i < 0 ? part : part.slice(0, i), value = i < 0 ? "" : part.slice(i + 1), key;
      try { key = decodeURIComponent(k.replace(/\+/g, " ")); value = decodeURIComponent(value.replace(/\+/g, " ")); } catch (_) { return cleanText(part); }
      if (sensitive.test(key)) value = "[REDACTED]";
      else { try { value = JSON.stringify(cleanJSON(JSON.parse(value), 0)); } catch (_) { value = cleanText(value); } }
      return k + "=" + encodeURIComponent(value);
    }).join("&");
  }
  function bytes(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return null;
  }
  function utf8(b) {
    if (typeof TextDecoder === "function") { try { return new TextDecoder("utf-8", {fatal:true}).decode(b); } catch (_) { return null; } }
    var parts = []; for (var n = 0; n < b.length; n += 8192) parts.push(String.fromCharCode.apply(null, b.subarray(n, n + 8192)));
    try { return decodeURIComponent(escape(parts.join(""))); } catch (_) { return null; }
  }
  function base64(b) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", parts = [];
    for (var i = 0; i < b.length; i += 3) { var v = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0); parts.push(alphabet[(v >>> 18) & 63] + alphabet[(v >>> 12) & 63] + (i + 1 < b.length ? alphabet[(v >>> 6) & 63] : "=") + (i + 2 < b.length ? alphabet[v & 63] : "=")); }
    return parts.join("");
  }
  /** 记录正文或明确的缺失原因；超限不保存半份正文。 */
  function body(v, headers) {
    if (v === undefined || v === null) return {available:false, reason:"not-provided-by-runtime"};
    var b = typeof v === "string" ? null : bytes(v), length = typeof v === "string" ? size(v) : b ? b.length : null;
    if (length === null) return {available:false, reason:"unsupported-body-type"};
    if (length > bodyLimit) return {available:false, reason:"body-limit", bytes:length, limit:bodyLimit};
    var mime = header(headers, "content-type"), text = typeof v === "string" ? v : utf8(b);
    if (text !== null && !/[\x00-\x08\x0e-\x1f]/.test(text)) {
      try { return {available:true, encoding:"json", bytes:length, redacted:true, data:cleanJSON(JSON.parse(text), 0)}; } catch (_) {}
      var jsonp = /^[\w.$]+\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text);
      if (jsonp) { try { return {available:true, encoding:"jsonp-json", bytes:length, redacted:true, data:cleanJSON(JSON.parse(jsonp[1]), 0)}; } catch (_) {} }
      return {available:true, encoding:"utf8", bytes:length, redacted:true, data:/application\/x-www-form-urlencoded/i.test(mime) ? form(text) : cleanText(text)};
    }
    return flag(args.raw_binary) && b ? {available:true, encoding:"base64", bytes:length, redacted:false, data:base64(b)} : {available:false, bytes:length, reason:"binary-capture-disabled"};
  }

  /** 每个事件独立分块；提交前重新读索引，拒绝已暂停或已清空的旧会话。 */
  function append(c, event) {
    var written = [], p = prefix(c.session, event.id);
    try {
      var serialized = JSON.stringify(event), eventBytes = size(serialized);
      var latest = config();
      if (!latest || latest.session !== c.session || !latest.active) return false;
      if (latest.entries.length >= MAX_EVENTS || latest.bytes + eventBytes > budget) { halt(c.session, latest.entries.length >= MAX_EVENTS ? "event-limit" : "capacity-limit"); return false; }
      var chunks = [];
      for (var start = 0; start < serialized.length;) {
        var end = Math.min(start + CHUNK, serialized.length);
        if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized.charAt(end - 1))) end--;
        chunks.push(serialized.slice(start, end)); start = end;
      }
      for (var i = 0; i < chunks.length; i++) { write(chunks[i], p + i); written.push(p + i); }
      latest = config();
      if (!latest || latest.session !== c.session || !latest.active) throw Error("session-changed");
      if (latest.entries.length >= MAX_EVENTS || latest.bytes + eventBytes > budget) throw Error("capacity-limit");
      latest.entries.push({id:event.id, phase:event.phase, time:event.time, chunks:chunks.length, chars:serialized.length, bytes:eventBytes, checksum:checksum(serialized)});
      latest.bytes += eventBytes;
      save(latest); return true;
    } catch (e) {
      written.forEach(function (k) { try { write(undefined, k); } catch (_) {} });
      if (e.message !== "session-changed") halt(c.session, /limit/.test(e.message) ? e.message : "storage-error");
      return false;
    }
  }
  function readEvent(c, ref) {
    if (!ref || !/^[a-z0-9-]+$/.test(ref.id) || !Number.isInteger(ref.chunks) || ref.chunks < 1 || ref.chunks > 1024 || !Number.isInteger(ref.chars) || ref.chars < 1 || ref.chars > 33554432) throw Error("invalid-reference");
    var parts = [], p = prefix(c.session, ref.id);
    for (var i = 0; i < ref.chunks; i++) { var s = $persistentStore.read(p + i); if (typeof s !== "string" || s.length > CHUNK) throw Error("missing-chunk"); parts.push(s); }
    var text = parts.join("");
    if (text.length !== ref.chars || checksum(text) !== ref.checksum) throw Error("checksum-mismatch");
    var event = JSON.parse(text);
    if (event.id !== ref.id || event.session !== c.session) throw Error("metadata-mismatch");
    return text;
  }
  function record() {
    if (!mainEnabled || !/^https?:\/\//i.test(req.url)) return;
    var attribution = source(req.headers); if (!attribution) return;
    var c = ensure(); if (!c.active) return;
    var event = {schema:1, version:VERSION, id:id(), session:c.session, time:now(), phase:res ? "response" : "request", correlationKey:checksum(c.session + "|" + (req.method || "GET") + "|" + req.url), source:attribution, network:endpoint(req.url), request:{url:cleanURL(req.url), method:req.method || "GET", headers:cleanHeaders(req.headers), trailers:cleanHeaders(req.h2_trailers)}};
    if (!res) { event.request.body = body(req.body, req.headers); if (req.body === undefined && /^(?:image|video|audio)\/|^application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(header(req.headers, "content-type")) && !flag(args.media_body)) event.request.body.reason = "media-headers-only"; }
    else {
      // Response 阶段不假定请求正文仍可用，不虚构网络耗时。
      event.response = {status:res.status, headers:cleanHeaders(res.headers), trailers:cleanHeaders(res.h2_trailers), body:body(res.body, res.headers)};
      if (res.body === undefined && /^(?:image|video|audio)\/|^application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(header(res.headers, "content-type")) && !flag(args.media_body)) event.response.body.reason = "media-headers-only";
    }
    append(c, event);
  }
  function response(status, text, type, extra) { return {response:{status:status, headers:Object.assign({"Content-Type":type || "text/plain; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Access-Control-Allow-Origin":BASE}, extra || {}), body:text}}; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function exportScript(token) {
    // 浏览器逐条读取分块事件，生成一个 .log；元数据和事件使用 JSON Lines，便于离线分析。
    return '(' + (async function (csrf) {
      var status = document.getElementById("status"), button = document.getElementById("download");
      button.onclick = async function () {
        button.disabled = true;
        try {
          var paused = await fetch("/pause", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:"csrf=" + encodeURIComponent(csrf)});
          if (!paused.ok) throw Error("暂停失败，请刷新日志页");
          var r = await fetch("/manifest"); if (!r.ok) throw Error("读取索引失败");
          var data = await r.json(), parts = [JSON.stringify(data.meta) + "\n"], issues = [], urls = Object.create(null), hosts = Object.create(null), ips = Object.create(null);
          for (var i = 0; i < data.entries.length; i++) {
            status.textContent = "正在导出 " + (i + 1) + "/" + data.entries.length;
            var item = await fetch("/event/" + data.meta.session + "/" + data.entries[i].id);
            var text = await item.text();
            if (!item.ok) { issues.push({id:data.entries[i].id, reason:text}); continue; }
            var event = JSON.parse(text);
            if (event.session !== data.meta.session || event.id !== data.entries[i].id) throw Error("会话已变化，请刷新后重试");
            parts.push(text + "\n");
            if (event.request) urls[event.request.url] = true;
            if (event.network && event.network.host) hosts[event.network.host] = true;
            if (event.network && event.network.urlIP) ips[event.network.urlIP] = "url-literal";
          }
          parts.push(JSON.stringify({type:"network-inventory", urls:Object.keys(urls), hosts:Object.keys(hosts), ips:Object.keys(ips).map(function (address) { return {address:address, source:"request-url-literal"}; }), attribution:"user-agent-marker", processVerified:false, note:"仅汇总已采集请求；URL 为请求 URL，IP 仅取 URL 主机字面值。无 DNS 推导，不含未知来源连接或未命中脚本的纯 TCP／UDP。"}) + "\n");
          parts.push(JSON.stringify({type:"export-result", exported:data.entries.length - issues.length, issues:issues}) + "\n");
          var blob = new Blob(parts, {type:"text/plain;charset=utf-8"}), url = URL.createObjectURL(blob), a = document.getElementById("save");
          if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
          a.dataset.url = url; a.href = url; a.download = "xianyu-" + data.meta.session + ".log"; a.hidden = false; a.click();
          status.textContent = issues.length ? "导出完成，但有 " + issues.length + " 条损坏／缺失，请查看文件末尾。" : "已生成日志；记录已暂停，可点击保存或使用分享菜单。";
        } catch (e) { status.textContent = e.message; }
        button.disabled = false;
      };
    }).toString() + ')(' + JSON.stringify(token) + ');';
  }
  function page(c) {
    var actions = [["start","开始／继续记录"],["pause","暂停记录"],["mark-ad","标记广告出现"],["mark-content","标记正常页面"],["clear","清空并新建会话"]];
    var forms = actions.map(function (a) { return '<form method="post" action="/' + a[0] + '"><input type="hidden" name="csrf" value="' + esc(c.csrf) + '"><button>' + a[1] + '</button></form>'; }).join("");
    var html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>闲鱼开发日志</title><style>body{font:16px system-ui;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.6}form{display:inline-block;margin:5px}button,a{padding:10px}button{cursor:pointer}pre{white-space:pre-wrap}</style><h1>闲鱼开发日志</h1><p>插件日志开关：' + (mainEnabled ? "开启" : "关闭（仍可导出已有记录）") + '；记录状态：' + (c.active && mainEnabled ? "记录中" : "暂停") + '。</p><p>保留 ' + c.entries.length + ' 条，约 ' + (c.bytes/1048576).toFixed(2) + ' MB。会话：' + esc(c.session) + '</p><p>停止原因：' + esc(c.haltReason || "无") + '</p>' + forms + '<p>清空会删除当前会话，请先导出。新会话先暂停，点击开始后再打开闲鱼复现。</p><button id="download">暂停并下载全部日志</button><a id="save" hidden>保存日志文件</a><p id="status"></p><p>仅记录含闲鱼客户端标识的 HTTP 请求／响应；这是 Header 识别，无法做系统进程归属证明。正文可能包含聊天、订单和二进制个人数据。未知二进制不保证脱敏。未解密流量、QUIC 和 WebSocket 消息帧无法作为完整 HTTP 正文采集。</p><script>' + exportScript(c.csrf) + '</script></html>';
    return response(200, html, "text/html; charset=utf-8", {"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
  }
  function portal() {
    var match = /^http:\/\/xianyu-logs\.invalid(?::80)?(\/[^?#]*)?(?:\?[^#]*)?$/.exec(req.url);
    if (!match) return response(400, "Invalid local URL");
    var path = match[1] || "/", method = String(req.method || "GET").toUpperCase();
    var c = ensure();
    if (method === "POST") {
      var origin = header(req.headers, "origin"), raw = typeof req.body === "string" ? req.body : utf8(bytes(req.body) || new Uint8Array());
      var fields = {}; (raw || "").split("&").forEach(function (s) { var at = s.indexOf("="); if (at >= 0) { try { fields[s.slice(0, at)] = decodeURIComponent(s.slice(at + 1)); } catch (_) {} } });
      if (origin && origin !== BASE && origin !== BASE + ":80" || fields.csrf !== c.csrf) return response(403, "Local control token required");
      if (path === "/pause") { c.active = false; c.stoppedAt = now(); save(c); }
      else if (path === "/start") { if (!mainEnabled) return response(403, "请先在插件中开启日志工具"); if (c.haltReason) return response(409, "已因容量或存储问题停止，请先导出并清空"); c.active = true; save(c); }
      else if (path === "/clear") {
        c.active = false; save(c);
        c.entries.forEach(function (ref) { if (!/^[a-z0-9-]+$/.test(ref.id) || !Number.isInteger(ref.chunks) || ref.chunks < 1 || ref.chunks > 1024) throw Error("invalid-reference"); for (var n = 0; n < ref.chunks; n++) write(undefined, prefix(c.session, ref.id) + n); });
        save(fresh(false));
      } else if (path === "/mark-ad" || path === "/mark-content") {
        if (!mainEnabled || !c.active) return response(409, "请先开始记录");
        if (!append(c, {schema:1, version:VERSION, id:id(), session:c.session, time:now(), phase:"mark", label:path === "/mark-ad" ? "ad-visible" : "normal-content"})) return response(507, "标记未保存，检查容量或停止原因");
      } else return response(404, "Not found");
      return response(303, "", "text/plain", {Location:"/"});
    }
    if (method !== "GET") return response(405, "GET or POST required");
    if (path === "/") return page(c);
    if (path === "/manifest") {
      if (c.active) return response(409, "请先暂停记录");
      var meta = {type:"xianyu-diagnostic-log", format:1, version:VERSION, session:c.session, startedAt:c.startedAt, exportedAt:now(), events:c.entries.length, storedBytes:c.bytes, haltReason:c.haltReason, limits:{budgetBytes:budget, bodyLimitBytes:bodyLimit, maxEvents:MAX_EVENTS}, settings:{rawBinary:flag(args.raw_binary), mediaBody:flag(args.media_body)}, scope:"HTTP(S) with explicit Xianyu User-Agent marker", attribution:{method:"user-agent-marker", processVerified:false}, limitations:["仅包含命中脚本且经 Loon 可见的 HTTP 请求和响应；不保证所有 App 网络流量。", "其他脚本、未解密流量、QUIC、WebSocket 帧、网络失败未产生响应均可能导致缺失。", "正文超限及媒体省略原因记录在各事件内；不滚动删除已有事件。", "已知凭据脱敏；未知二进制及普通正文可能包含个人数据。", "相同方法和 URL 的重复请求可能共享 correlationKey，它不是严格的一一对应 ID。", "Loon 存储无原子追加接口，高并发存在索引竞争；未进行实机完整率验证。", "仅记录请求 URL 的 IP 字面值，不查询 DNS；无 HTTP 信息的纯 IP TCP／UDP 连接无法记录或证明 App 来源。", "User-Agent 标识不是系统进程归属信息；可被其他客户端复用或伪造。缺失标识时跳过，域名本身不作为归属依据。"]};
      return response(200, JSON.stringify({meta:meta, entries:c.entries}), "application/json; charset=utf-8");
    }
    var route = /^\/event\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path);
    if (route) {
      if (c.active || route[1] !== c.session) return response(409, "session-changed");
      var ref = c.entries.find(function (e) { return e.id === route[2]; });
      if (!ref) return response(404, "event-not-found");
      try { return response(200, readEvent(c, ref), "application/json; charset=utf-8"); } catch (e) { return response(422, e.message); }
    }
    return response(404, "Not found");
  }
  try {
    if (!req) {
      if (typeof $notification !== "undefined") $notification.post("闲鱼开发日志", "本地记录与导出", "开启插件日志工具后打开本地页面，复现广告再导出。", {openUrl:BASE + "/"});
      $done({title:"闲鱼开发日志", content:BASE + "/"});
    } else if (/^http:\/\/xianyu-logs\.invalid(?::80)?(?:\/|$)/.test(req.url)) $done(portal());
    else { record(); $done({}); }
  } catch (_) {
    console.log("[XianyuLogger] local-storage-or-capture-error");
    if (req && /^http:\/\/xianyu-logs\.invalid(?::80)?(?:\/|$)/.test(req.url)) $done(response(500, "本地日志读取或存储失败；已有记录保留，请检查日志容量"));
    else { try { var old = config(); if (old) halt(old.session, "capture-or-storage-error"); } catch (_) {} $done({}); }
  }
})();
