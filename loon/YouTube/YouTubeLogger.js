/* YouTubeLogger 1.0.0 — local diagnostic collection control and .log export.
 * No network calls, filesystem assumptions, third-party code, or body capture.
 * Writers in PlaybackAds/StreamAds use the same bounded store schema.
 */
(function () {
  "use strict";
  var CONFIG = "ytads.logger.config.v1";
  var SOURCES = ["YouTubePlaybackAds", "YouTubeStreamAds"];
  var BASE = "http://youtube-logs.invalid/";
  var LIMIT = 300;

  function read(key) {
    var raw = $persistentStore.read(key);
    if (!raw) return null;
    if (typeof raw !== "string" || raw.length > 100000) throw new Error("invalid-store");
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
  function records(c) {
    var rows = [];
    if (!c) return rows;
    SOURCES.forEach(function (source) {
      var state = read("ytads.logger." + source + ".v1");
      if (!state || state.session !== c.session || !Array.isArray(state.entries)) return;
      state.entries.slice(-LIMIT).forEach(function (r) {
        // Read only the owned schema; never dump arbitrary store contents.
        if (!r || typeof r.time !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.time) ||
            typeof r.version !== "string" || !/^\d+\.\d+\.\d+$/.test(r.version) ||
            !/^(player|get_watch|ump|unknown)$/.test(r.endpoint) ||
            typeof r.message !== "string" || r.message.length > 600 || /[\r\n<>]/.test(r.message)) return;
        rows.push({ time:r.time, source:source, version:r.version, endpoint:r.endpoint, message:r.message });
      });
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
  function page(c, rows) {
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 日志</title>' +
      '<style>body{font:17px system-ui;margin:32px auto;padding:0 24px;max-width:620px;line-height:1.7}button,a{font:inherit}button{margin:6px 0;padding:8px 16px}a{display:block;margin:22px 0}</style>' +
      '<h1>YouTube 日志</h1><p>状态：' + (c && c.enabled === true ? '正在记录' : '已暂停') + '；保留 ' + rows.length + ' 条。</p>' +
      '<form method="post" action="/start"><button>开始记录（保留本次日志）</button></form>' +
      '<form method="post" action="/pause"><button>暂停记录</button></form>' +
      '<a href="/download.log">下载日志文件 .log</a>' +
      '<p>下载后在 Safari 保存或通过分享菜单存储到“文件”。每份脚本最多保留最近 300 条，超出自动覆盖。开始记录后播放一次有广告的视频，再下载。</p>' +
      '<p>只记录本插件的处理摘要，无法读取 Loon 的连接、证书或脚本超时日志。UMP 信息需要主插件开启 UMP 试验处理。</p>' +
      '<form method="post" action="/clear"><button>清空日志并暂停（不可恢复）</button></form></html>';
  }
  function run() {
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
    if (path === "/start" || path === "/pause" || path === "/clear") {
      if (method !== "POST") return response(405, "Use the buttons on the log page.", "text/plain; charset=utf-8", {Allow:"POST"});
      if (path === "/clear") {
        // Rotate session first so any old or in-flight entries are invisible.
        c = {enabled:false, session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        write(c, CONFIG);
        SOURCES.forEach(function (source) { write({session:c.session, entries:[]}, "ytads.logger." + source + ".v1"); });
      } else {
        if (!c) c = {session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        c.enabled = path === "/start";
        write(c, CONFIG);
      }
      return response(303, "", "text/plain; charset=utf-8", {Location:BASE});
    }
    if (method !== "GET") return response(405, "Method not allowed", "text/plain; charset=utf-8", {Allow:"GET"});
    if (path !== "/" && path !== "/download.log") return response(404, "Not found", "text/plain; charset=utf-8");
    var rows = records(c);
    if (path === "/") return response(200, page(c, rows));
    var now = new Date().toISOString();
    var filename = "YouTube-" + now.replace(/[:.]/g, "-") + ".log";
    var lines = ["YouTube diagnostic log", "Exported (UTC): " + now, "Recording: " + (c && c.enabled === true ? "on" : "paused"),
      "Entries: " + rows.length + " (max 300 per source; oldest entries overwritten)",
      "Only script summaries; no media bodies, request tokens or full URLs.", "Concurrent writes may lose entries; this is not a complete packet capture.", ""];
    if (!rows.length) lines.push("No entries. Start recording, update both ad scripts, reproduce, then export.");
    rows.forEach(function (r) { lines.push(r.time + " [" + r.source + " " + r.version + "] " + r.endpoint + " " + r.message); });
    return response(200, lines.join("\n") + "\n", "text/plain; charset=utf-8", {"Content-Disposition":'attachment; filename="' + filename + '"'});
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
