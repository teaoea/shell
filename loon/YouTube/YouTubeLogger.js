/* YouTubeLogger 1.9.0 — shared diagnostic cache and one complete full-chain .log export.
 * No network calls, filesystem assumptions, third-party code, or automatic uploads.
 * Enabled manually in the main plugin; no separate Logger plugin.
 */
(function () {
  "use strict";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var SOURCES = ["YouTubePlayerRequest", "YouTubePlaybackAds", "YouTubeStreamAds", "YouTubeFeedAds", "YouTubeShortsAds", "YouTubeAdBreak", "YouTubeOnesieConfig", "YouTubeInitPlayback", "YouTubeLogger"];
  var BASE = "http://youtube-logs.invalid/";
  var VERSION = "1.9.0";
  var LIMIT = 600;
  var API_CAPTURE = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(player|get_watch|browse|next|search|reel\/reel_watch_sequence|log_event|config)(?:\?[^#]*)?$/i;
  var MEDIA_CAPTURE = /^https:\/\/[\w-]+\.googlevideo\.com\/(videoplayback|initplayback)(?:\?[^#]*)?$/i;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var ranks = {debug:0, info:1, warn:2, error:3};
  var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";

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
          arguments:{development_capture:devFlag(args.capture_raw), ump_mode:args.ump_mode === "clean_prefetch" ? "clean_prefetch" : "inspect", background_playback:devFlag(args.background_playback), log_level:args.log_level || "info"}}};
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

  function read(key) {
    var raw = $persistentStore.read(key);
    if (!raw) return null;
    if (typeof raw !== "string" || raw.length > 131072) throw new Error("invalid-store");
    return JSON.parse(raw);
  }
  function config() {
    var c = read(CONFIG);
    if (!c || typeof c.session !== "string" || !/^[a-z0-9-]{1,80}$/.test(c.session)) return null;
    return c;
  }
  function write(value, key) {
    if ($persistentStore.write(JSON.stringify(value), key) !== true) throw new Error("write-failed");
  }
  function shared(c) {
    var state = read(CACHE);
    if (state) return state;
    // Preserve this session's old per-source logs once during an upgrade.
    var entries = [];
    SOURCES.forEach(function (source) {
      var old = read("ytads.logger." + source + ".v1");
      if (!old || old.session !== c.session || !Array.isArray(old.entries)) return;
      old.entries.slice(-300).forEach(function (r) {
        if (!r || typeof r.message !== "string") return;
        var level = r.message.indexOf("changed:") === 0 ? "info" :
          r.message === "pass: parse/schema check failed" ? "error" :
          /^(pass: (removed=|mode=|non-UMP))/.test(r.message) ? "debug" : "warn";
        entries.push({source:source, level:level, time:r.time, version:r.version, endpoint:r.endpoint, message:r.message});
      });
    });
    entries.sort(function (a,b) { return String(a.time).localeCompare(String(b.time)); });
    var serialized = JSON.stringify({session:c.session, entries:entries.slice(-LIMIT), captureBytes:0});
    if (devUTF8Size(serialized) > 131072) {
      devHalt(c, "legacy-migration-limit");
      // Keep old evidence readable/exportable without deleting any record.
      return {session:c.session, entries:entries, captureBytes:0, migrationDeferred:true};
    }
    if ($persistentStore.write(serialized, CACHE) !== true) throw new Error("write-failed");
    SOURCES.forEach(function (source) { $persistentStore.write(undefined, "ytads.logger." + source + ".v1"); });
    return JSON.parse(serialized);
  }
  function records(c) {
    var rows = [];
    if (!c) return rows;
    var state = shared(c);
    if (!state || state.session !== c.session || !Array.isArray(state.entries)) return rows;
    state.entries.slice(-LIMIT).forEach(function (r) {
        // Read only the owned schema; never dump arbitrary store contents.
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
    rows.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    return rows;
  }
  function response(status, body, type, extra) {
    var headers = {"Content-Type":type || "text/html; charset=utf-8", "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    return {response:{status:status, headers:headers, body:body}};
  }
  function developmentExport(c, rows) {
    var issues = [];
    var events = rows.map(function (row) {
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
      recording:!!(c && c.enabled), stoppedReason:c && c.haltReason || null,
      settings:{rawCapture:devFlag(args.capture_raw), summaryMinimumLevel:minimum, budgetMB:[16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) : 32},
      completeness:{allReferencedSamplesReadable:issues.length === 0, stoppedDueToLimitOrError:!!(c && c.haltReason), issues:issues,
        limitations:["Only matched player/get_watch/browse/next/search/reel_watch_sequence/log_event/config/initplayback/player/ad_break and enabled UMP response scripts; not all YouTube traffic.",
          "Media response capture is enabled together with development capture; inspect mode is recommended.",
          "Runtime bodies may already be decoded; these are not TLS/HTTP wire bytes.",
          "Missing runtime bodies are marked unavailable; before/after transport headers are not reconstructed.",
          "URL/method hashes are grouping hints, not guaranteed request/response pairs.",
          "Loon storage has no atomic append here; concurrent writers may lose index entries.",
          "Script timeouts, TLS failures and requests bypassing MitM are not observed."]}, events:events};
  }
  function exportPage() {
    // Read small owned chunks, then assemble one complete text log in the browser.
    // The manifest and chunks are local transport details, not separate log files.
    var script = '(' + browserExport.toString() + ')();';
    return response(200, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 导出</title><p id="status">正在读取本地记录，请保持 Loon 开启…</p><a id="save" hidden>保存日志文件</a><p>文件生成后点击保存；Safari 也可通过分享菜单存储到“文件”。</p><script>' + script + '</script></html>', "text/html; charset=utf-8", {"Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
  }
  async function browserExport() {
    var status = document.getElementById("status"), save = document.getElementById("save");
    try {
      async function get(path) {
        var r = await fetch(path, {cache:"no-store"});
        if (!r.ok) throw new Error("本地读取失败（" + r.status + "），请暂停记录后重新导出。");
        return await r.json();
      }
      function checksum(text) {
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619);}
        return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
      }
      function value(v) { if (v === null) return "null"; if (v === undefined) return "unavailable"; return typeof v === "string" ? v.replace(/\r/g,"\\r").replace(/\n/g,"\\n") : String(v); }
      function structure(label, v, lines, depth) {
        var indent = new Array(depth + 1).join("  ");
        if (v === null || v === undefined || typeof v !== "object") { lines.push(indent + label + ": " + value(v)); return; }
        if (Array.isArray(v)) { lines.push(indent + label + ": array(" + v.length + ")"); for (var i=0;i<v.length;i++) structure("["+i+"]",v[i],lines,depth+1); return; }
        var keys=Object.keys(v).sort(); lines.push(indent+label+": object("+keys.length+")");
        for(var k=0;k<keys.length;k++) structure(keys[k],v[keys[k]],lines,depth+1);
      }
      function body(label,v,lines) {
        lines.push(label+":");
        if(v&&v.reference){lines.push("  Reference: "+value(v.reference));return;}
        if(!v||v.available!==true){lines.push("  Available: false");lines.push("  Reason: "+value(v&&v.reason));return;}
        lines.push("  Available: true");lines.push("  Encoding: "+value(v.encoding));lines.push("  Bytes: "+value(v.bytes));
        if(Object.prototype.hasOwnProperty.call(v,"data")){var encoding=v.encoding==="base64"?"BASE64":"UTF-8 TEXT";lines.push("  ----- BEGIN "+encoding+" -----");lines.push(String(v.data));lines.push("  ----- END "+encoding+" -----");}
      }
      function exchange(label,v,lines){
        lines.push(label+":");if(!v){lines.push("  unavailable");return;}
        var names=["url","method","status","synthetic","changed","transportHeadersRecomputedByLoon"];
        for(var i=0;i<names.length;i++)if(Object.prototype.hasOwnProperty.call(v,names[i]))lines.push("  "+names[i]+": "+value(v[names[i]]));
        if(Object.prototype.hasOwnProperty.call(v,"headers"))structure("headers",v.headers,lines,1);
        if(Object.prototype.hasOwnProperty.call(v,"h2_trailers"))structure("h2_trailers",v.h2_trailers,lines,1);
        if(Object.prototype.hasOwnProperty.call(v,"body"))body("  body",v.body,lines);
      }
      function eventText(index,row,capture,captureError){
        var lines=["","================================================================================","EVENT "+(index+1),"================================================================================","Time: "+row.time,"Level: "+String(row.level).toUpperCase(),"Source: "+row.source,"Version: "+row.version,"Endpoint: "+row.endpoint,"Phase: "+value(row.phase),"Summary: "+row.message];
        if(captureError)lines.push("Capture-Error: "+captureError);if(!capture){lines.push("Capture: unavailable");return lines.join("\n")+"\n";}
        lines.push("Runtime: "+value(capture.runtime));structure("Correlation",capture.correlation,lines,0);structure("Processing",capture.processing,lines,0);
        exchange("Request-Before",capture.request,lines);exchange("Request-After",capture.requestAfter,lines);exchange("Response-Before",capture.responseBefore,lines);exchange("Response-After",capture.responseAfter,lines);
        return lines.join("\n")+"\n";
      }
      var manifest = await get("/export-manifest.json");
      var rows = manifest.rows, data = manifest.data, parts = [], issues = [];
      parts.push(["YouTube full diagnostic log","Format-Version: 1","Exported-UTC: "+data.exportedAt,"Session: "+value(data.session),"Recording: "+(data.recording?"on":"paused"),"Stopped-Reason: "+value(data.stoppedReason),"Entries: "+rows.length,"Raw-Capture-Enabled: "+value(data.settings.rawCapture),"Summary-Minimum-Level: "+value(data.settings.summaryMinimumLevel),"Capture-Budget-MB: "+value(data.settings.budgetMB),"Scope: browse, refresh/config, player, initplayback, ad-break, Shorts and UMP media events matched by the plugin","Binary-Body-Encoding: Base64","Sensitive-Data: full URLs, headers and bodies may contain account credentials, cookies, tokens and signatures","Completeness: best-effort Loon script capture; see LIMITATIONS at end",""].join("\n"));
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
      save.href = URL.createObjectURL(blob);
      save.download = "YouTube-" + data.exportedAt.replace(/[:.]/g, "-") + ".log";
      save.hidden = false;
      status.textContent = "已合成一个完整 .log 文件（" + rows.length + " 条记录）。点击下方保存日志文件。";
    } catch (error) {
      status.textContent = error.message || "导出失败，请检查 Loon 是否运行。";
      save.hidden = true;
    }
  }
  function exportRows(c) { return records(c); }
  function page(c, rows) {
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 日志</title>' +
      '<style>body{font:17px system-ui;margin:32px auto;padding:0 24px;max-width:620px;line-height:1.7}button,a{font:inherit}button{margin:6px 0;padding:8px 16px}a{display:block;margin:22px 0}</style>' +
      '<h1>YouTube 日志</h1><p>状态：' + (c && c.enabled === true ? '正在记录' : '已暂停') + '；保留 ' + rows.length + ' 条。保存级别：' + minimum + ' 及以上。</p>' +
      '<form method="post" action="/start"><button>开始记录（保留本次日志）</button></form>' +
      '<form method="post" action="/pause"><button>暂停记录</button></form>' +
      '<form method="post" action="/mark-ad"><button>标记：正在播放广告</button></form>' +
      '<form method="post" action="/mark-content"><button>标记：正在播放正片</button></form>' +
      '<a href="/export">导出完整日志文件 .log（浏览、刷新、播放全链路）</a>' +
      '<p>开发抓包：' + (devFlag(args.capture_raw) ? '已开启，保存原始数据' : '未开启，只保存摘要') + '。' +
      (c && c.haltReason ? '记录已因容量或存储问题停止；请先导出，再清空重试。' : '') + '</p>' +
      '<p>下载后在 Safari 保存或通过分享菜单存储到“文件”。共用缓存最多 600 条或 128 KiB 索引，原始样本另按主插件所选容量保存。达到上限停止记录，保留旧记录。</p>' +
      '<p>开发抓包在主插件手动开启，请先选择容量和 UMP 模式，再开始记录。它会同时读取 UMP 响应；唯一的 .log 文件保存完整 URL、请求头、文本正文和 Base64 二进制，可能包含账号凭据与签名；文件留在本机，不会自动上传。</p>' +
      '<p>在主插件选择日志保存级别：debug 为全部排查摘要；info 为修改结果及异常；warn 为警告及错误；error 为未预期错误。调整级别只影响新记录。</p>' +
      '<p>开发抓包记录不受摘要级别过滤。日志无法读取 Loon 的连接、证书或脚本超时记录。抓包可能增加播放等待，复现后应关闭。</p>' +
      '<form method="post" action="/clear"><button>清空日志并暂停（不可恢复）</button></form></html>';
  }
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
        var source = apiName === "reel/reel_watch_sequence" ? "YouTubeShortsAds" : /^(browse|next|search)$/i.test(apiName) ? "YouTubeFeedAds" :
          /^(log_event|config|initplayback)$/i.test(apiName) ? "YouTubeLogger" : api ? "YouTubePlaybackAds" : "YouTubeStreamAds";
        var endpoint = apiName === "reel/reel_watch_sequence" ? "reel_watch_sequence" : apiName === "videoplayback" ? "ump" : apiName;
        devCapture(source, typeof $response !== "undefined" ? "response" : "request", endpoint, VERSION, {});
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
        // Rotate session first so any old or in-flight entries are invisible.
        c = {enabled:false, session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        write(c, CONFIG);
        var previous = null;
        try { previous = read(CACHE); } catch (_) {}
        if (previous && Array.isArray(previous.entries)) previous.entries.slice(0, LIMIT).forEach(function (r) {
          var ref = r && r.captureRef;
          if (!ref || typeof ref.prefix !== "string" || !/^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(ref.prefix) || !Number.isInteger(ref.chunks) || ref.chunks < 1 || ref.chunks > 256) return;
          for (var i = 0; i < ref.chunks; i++) $persistentStore.write(undefined, ref.prefix + i);
        });
        write({session:c.session, entries:[], captureBytes:0}, CACHE);
        SOURCES.forEach(function (source) { $persistentStore.write(undefined, "ytads.logger." + source + ".v1"); });
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
    if (path === "/") return response(200, page(c, rows));
    // Keep old bookmarks working while exposing one canonical export interface.
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
