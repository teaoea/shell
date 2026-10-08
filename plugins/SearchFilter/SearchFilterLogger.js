// BEGIN GENERATED SEARCH LOG CORE
/* Privacy allowlist shared by the generated Loon scripts. */
function sfLogFresh() {
  return { schema: 1, active: true, token: Date.now().toString(36) + Math.random().toString(36).slice(2), evicted: 0, events: [] };
}
function sfLogClean(input) {
  if (!input || typeof input !== 'object') return null;
  var phases = ['request', 'response', 'subscription'];
  var reasons = ['captured', 'disabled', 'query-disabled', 'rewritten', 'unchanged', 'error', 'non-get', 'non-web', 'non-html', 'http-status', 'body-limit', 'body-fragment', 'already-injected', 'no-rules', 'rules-limit', 'invalid-input', 'csp-blocked', 'injected', 'subscription-invalid', 'download-failed', 'format-invalid', 'storage-failed', 'updated'];
  if (phases.indexOf(input.phase) < 0 || reasons.indexOf(input.reason) < 0) return null;
  var event = { time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time || '') ? input.time : new Date().toISOString(), version: '1.0.1', phase: input.phase, reason: input.reason };
  if (['google', 'bing', 'baidu'].indexOf(input.engine) >= 0) event.engine = input.engine;
  var hosts = ['google.com', 'www.google.com', 'google.com.hk', 'www.google.com.hk', 'google.com.tw', 'www.google.com.tw', 'google.co.jp', 'www.google.co.jp', 'google.co.uk', 'www.google.co.uk', 'bing.com', 'www.bing.com', 'cn.bing.com', 'baidu.com', 'www.baidu.com', 'm.baidu.com'];
  if (hosts.indexOf(input.host) >= 0) event.host = input.host;
  if (['/search', '/s'].indexOf(input.path) >= 0) event.path = input.path;
  if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) event.status = input.status;
  if (Number.isInteger(input.rules) && input.rules >= 0 && input.rules <= 200) event.rules = input.rules;
  return event;
}
function sfLogLoad() {
  var raw = $persistentStore.read('search-filter.logs.v1');
  if (!raw) return sfLogFresh();
  if (raw.length > 262144) throw new Error('invalid-log-store');
  var state = JSON.parse(raw);
  if (!state || state.schema !== 1 || typeof state.active !== 'boolean' || !/^[a-z0-9]{10,80}$/.test(state.token || '') || !Array.isArray(state.events) || state.events.length > 300 || !Number.isInteger(state.evicted) || state.evicted < 0) throw new Error('invalid-log-store');
  // Rebuild all entries through the allowlist when reading, not just writing.
  return { schema: 1, active: state.active, token: state.token, evicted: state.evicted, events: state.events.map(sfLogClean).filter(Boolean) };
}
function sfLogSave(state) {
  if ($persistentStore.write(JSON.stringify(state), 'search-filter.logs.v1') !== true) throw new Error('log-save-failed');
}
function sfLogRecord(args, input) {
  if (!args || !(args.log_enabled === true || args.log_enabled === 'true') || typeof $persistentStore === 'undefined') return;
  try {
    var state = sfLogLoad(), event = sfLogClean(input);
    if (!state.active || !event) return;
    state.events.push(event);
    if (state.events.length > 300) { state.events.shift(); state.evicted++; }
    sfLogSave(state);
  } catch (_) { /* Log/storage errors never change the search response. */ }
}
// END GENERATED SEARCH LOG CORE

/* 搜索屏蔽开发日志 v1.0.1 — local, allowlisted metadata only. */
(function () {
  'use strict';
  var BASE = 'http://search-filter-logs.invalid', VERSION = '1.0.1';
  var args = typeof $argument === 'object' && $argument ? $argument : {};
  var allowed = args.log_enabled === true || args.log_enabled === 'true';
  var req = typeof $request === 'undefined' ? null : $request;
  if (!req) {
    if (typeof $notification !== 'undefined') $notification.post('搜索屏蔽开发日志 v' + VERSION, '本地查看与导出', '点击打开日志页面。先开启插件日志工具，再复现搜索结果。', { openUrl: BASE + '/' });
    return $done({ title: '搜索屏蔽开发日志 v' + VERSION, content: '在浏览器打开 ' + BASE + '/' });
  }
  var match = /^http:\/\/search-filter-logs\.invalid(?::80)?(\/[^?#]*)?(?:\?[^#]*)?$/i.exec(String(req.url || ''));
  if (!match) return $done({});
  function respond(status, type, body, extra) {
    var headers = { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    $done({ response: { status: status, headers: headers, body: body } });
  }
  function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function header(name) { var keys = Object.keys(req.headers || {}); for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(req.headers[keys[i]]); return ''; }
  var reasons = { captured: '请求进入脚本', disabled: '过滤关闭', 'query-disabled': '未启用额外查询条件', rewritten: '已追加精确域名条件', unchanged: '查询保持原样', error: '处理异常，放行', 'non-get': '非 GET，放行', 'non-web': '非普通网页搜索，放行', 'non-html': '非 HTML，放行', 'http-status': '非 200，放行', 'body-limit': '正文超限，放行', 'body-fragment': '响应不是完整页面', 'already-injected': '已有过滤脚本', 'no-rules': '没有可用规则', 'rules-limit': '名单超限，放行', 'invalid-input': '参数无效，放行', 'csp-blocked': 'CSP 不允许脚本注入', injected: '已注入过滤脚本；未证明条目已隐藏', 'subscription-invalid': '订阅 URL 无效', 'download-failed': '订阅下载失败', 'format-invalid': '订阅格式或数量无效', 'storage-failed': '订阅保存失败', updated: '订阅已更新' };
  try {
    var state = sfLogLoad(), path = match[1] || '/', method = req.method || 'GET';
    if (method === 'GET' && path === '/export') {
      var meta = { format: 'search-filter-development-log', version: VERSION, count: state.events.length, evicted: state.evicted, coverage: 'Loon request/response/subscription metadata only; injection does not prove browser filtering; concurrent storage writes may lose events' };
      return respond(200, 'text/plain', [meta].concat(state.events).map(function (event) { return JSON.stringify(event); }).join('\n') + '\n', { 'Content-Disposition': 'attachment; filename="search-filter-development.log"' });
    }
    if (method === 'GET' && path === '/') {
      sfLogSave(state);
      var rows = state.events.slice().reverse().map(function (event) {
        var phase = event.phase === 'request' ? '请求发出' : event.phase === 'response' ? '响应返回' : '订阅更新';
        return '<tr>' + [event.time, phase, event.engine || '—', event.host || '—', event.path || '—', event.status || '—', event.rules === undefined ? '—' : event.rules, reasons[event.reason] || event.reason].map(function (value) { return '<td>' + escape(value) + '</td>'; }).join('') + '</tr>';
      }).join('');
      var forms = [['start', '开始记录'], ['pause', '暂停记录'], ['clear', '清空并暂停']].map(function (action) { return '<form method="post" action="/' + action[0] + '"><input type="hidden" name="token" value="' + state.token + '"><button>' + action[1] + '</button></form>'; }).join('');
      return respond(200, 'text/html', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>搜索屏蔽开发日志 v' + VERSION + '</title><style>body{font:16px/1.6 system-ui;margin:20px;background:#f4f7fa;color:#172b40}main{max-width:1100px;margin:auto}form{display:inline}button,a{display:inline-block;margin:5px;padding:9px}table{border-collapse:collapse;font-size:13px}td,th{padding:8px;border-bottom:1px solid #ccd4df;text-align:left}.scroll{overflow:auto}</style></head><body><main><h1>搜索屏蔽开发日志 v' + VERSION + '</h1><p>状态：' + (!allowed ? '插件日志开关关闭' : state.active ? '记录中' : '已暂停') + ' · ' + state.events.length + ' 条 · 淘汰 ' + state.evicted + ' 条</p><p>最多保存最近 300 条，只保存在本机。不会记录搜索词、完整 URL、结果标题正文、请求响应头、黑名单、订阅地址或设备标识。</p>' + forms + '<a href="/export" download="search-filter-development.log">导出日志</a><a href="/">刷新</a><p>“已注入过滤脚本”只代表 Loon 已修改页面，不证明浏览器已隐藏结果。零条日志只代表未采集到；请检查插件脚本、MitM、QUIC 或流量是否绕过 Loon。</p><div class="scroll"><table><thead><tr><th>时间 UTC</th><th>阶段</th><th>引擎</th><th>固定主机</th><th>入口</th><th>状态</th><th>规则数</th><th>处理结果</th></tr></thead><tbody>' + rows + '</tbody></table></div></main></body></html>');
    }
    if (!/^\/(start|pause|clear)$/.test(path)) return respond(404, 'text/plain', '页面不存在');
    if (method !== 'POST') return respond(405, 'text/plain', '请使用日志页面按钮', { Allow: 'POST' });
    var origin = header('origin'), referer = header('referer'), body = typeof req.body === 'string' ? req.body : '';
    if ((origin && origin !== BASE && origin !== BASE + ':80') || (referer && !/^http:\/\/search-filter-logs\.invalid(?::80)?\//i.test(referer)) || body !== 'token=' + state.token) return respond(403, 'text/plain', '请刷新本地日志页后重试');
    if (path === '/start' && !allowed) return respond(409, 'text/plain', '请先开启插件的日志工具');
    if (path === '/clear') { state = sfLogFresh(); state.active = false; }
    else state.active = path === '/start';
    sfLogSave(state);
    return respond(303, 'text/plain', '已更新', { Location: '/' });
  } catch (_) { respond(500, 'text/plain', '日志存储不可用；搜索过滤不受影响。'); }
}());
