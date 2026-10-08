// BEGIN GENERATED SEARCH LOG CORE
/* Privacy allowlist shared by the generated Loon scripts. */
function sfLogFresh() {
  return { schema: 1, active: true, switchOn: false, announced: false, token: Date.now().toString(36) + Math.random().toString(36).slice(2), evicted: 0, events: [] };
}
function sfLogClean(input) {
  if (!input || typeof input !== 'object') return null;
  var phases = ['request', 'response', 'subscription'];
  var reasons = ['captured', 'disabled', 'query-disabled', 'rewritten', 'unchanged', 'error', 'non-get', 'non-web', 'non-html', 'http-status', 'body-limit', 'body-fragment', 'already-injected', 'no-rules', 'rules-limit', 'invalid-input', 'csp-blocked', 'injected', 'static-removed', 'static-and-injected', 'subscription-invalid', 'download-failed', 'format-invalid', 'storage-failed', 'updated'];
  if (phases.indexOf(input.phase) < 0 || reasons.indexOf(input.reason) < 0) return null;
  var event = { time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time || '') ? input.time : new Date().toISOString(), version: ['1.0.1', '1.0.2', '1.0.3'].indexOf(input.version) >= 0 ? input.version : '1.0.4', phase: input.phase, reason: input.reason };
  if (['google', 'bing', 'baidu'].indexOf(input.engine) >= 0) event.engine = input.engine;
  var hosts = ['google.com', 'www.google.com', 'google.com.hk', 'www.google.com.hk', 'google.com.tw', 'www.google.com.tw', 'google.co.jp', 'www.google.co.jp', 'google.co.uk', 'www.google.co.uk', 'bing.com', 'www.bing.com', 'cn.bing.com', 'baidu.com', 'www.baidu.com', 'm.baidu.com'];
  if (hosts.indexOf(input.host) >= 0) event.host = input.host;
  if (['/search', '/s'].indexOf(input.path) >= 0) event.path = input.path;
  if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) event.status = input.status;
  if (Number.isInteger(input.rules) && input.rules >= 0 && input.rules <= 200) event.rules = input.rules;
  ['recognized', 'removed', 'unresolved'].forEach(function (key) { if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 10000) event[key] = input[key]; });
  return event;
}
function sfLogLoad() {
  var raw = $persistentStore.read('search-filter.logs.v1');
  if (!raw) return sfLogFresh();
  if (raw.length > 262144) throw new Error('invalid-log-store');
  var state = JSON.parse(raw);
  if (!state || state.schema !== 1 || typeof state.active !== 'boolean' || !/^[a-z0-9]{10,80}$/.test(state.token || '') || !Array.isArray(state.events) || state.events.length > 300 || !Number.isInteger(state.evicted) || state.evicted < 0) throw new Error('invalid-log-store');
  if ((state.switchOn !== undefined && typeof state.switchOn !== 'boolean') || (state.announced !== undefined && typeof state.announced !== 'boolean')) throw new Error('invalid-log-store');
  // Rebuild all entries through the allowlist when reading, not just writing.
  return { schema: 1, active: state.active, switchOn: state.switchOn === true, announced: state.announced === true, token: state.token, evicted: state.evicted, events: state.events.map(sfLogClean).filter(Boolean) };
}
function sfLogSave(state) {
  if ($persistentStore.write(JSON.stringify(state), 'search-filter.logs.v1') !== true) throw new Error('log-save-failed');
}
function sfLogSync(args) {
  var enabled = args && (args.log_enabled === true || args.log_enabled === 'true');
  var state = sfLogLoad();
  if (!enabled) {
    if (state.switchOn || state.announced) {
      state.switchOn = false; state.announced = false; sfLogSave(state);
    }
  } else if (!state.switchOn) {
    // Initial enable or an observed off -> on transition starts recording,
    // including migration of a paused log created by older plugin versions.
    state.switchOn = true; state.active = true; state.announced = false; sfLogSave(state);
  }
  return state;
}
function sfLogAnnounce(state) {
  if (!state.switchOn || !state.active || state.announced || typeof $notification === 'undefined') return;
  // Persist before posting to suppress repeat prompts in subsequent scripts.
  // Concurrent storage writes, like the event ring, are not an atomic lock.
  state.announced = true; sfLogSave(state);
  try {
    $notification.post('搜索屏蔽开发日志 v1.0.4', '已自动开始记录', '点击打开本地日志页。重新搜索后可刷新、导出脱敏记录。', { openUrl: 'http://search-filter-logs.invalid/' });
  } catch (_) { /* Notification permissions/errors never change filtering. */ }
}
function sfLogRecord(args, input) {
  if (typeof $persistentStore === 'undefined') return;
  try {
    var state = sfLogSync(args);
    if (!args || !(args.log_enabled === true || args.log_enabled === 'true')) return;
    var event = sfLogClean(input);
    if (!state.active || !event) return;
    state.events.push(event);
    if (state.events.length > 300) { state.events.shift(); state.evicted++; }
    sfLogSave(state);
    sfLogAnnounce(state);
  } catch (_) { /* Log/storage errors never change the search response. */ }
}
// END GENERATED SEARCH LOG CORE

// BEGIN GENERATED SEARCH LOG UI
/* Local log page. All controls use same-origin fetch; values render as text. */
function sfLogPageClient(initial) {
  'use strict';
  var state = initial, busy = false;
  var byId = function (id) { return document.getElementById(id); };
  var reasons = { captured: '请求进入脚本', disabled: '过滤关闭', 'query-disabled': '未启用额外搜索排除', rewritten: '已追加精确域名条件', unchanged: '查询保持原样', error: '处理异常，已放行', 'non-get': '非 GET，已放行', 'non-web': '非普通网页搜索', 'non-html': '非 HTML 响应', 'http-status': '非 200 响应', 'body-limit': '正文超过限制', 'body-fragment': '响应不是完整页面', 'already-injected': '已有过滤脚本', 'no-rules': '没有可用规则', 'rules-limit': '规则超过限制', 'invalid-input': '参数无效', 'csp-blocked': 'CSP 不允许脚本注入', injected: '已注入脚本，动态隐藏尚未确认', 'static-removed': 'Loon 已移除初始结果', 'static-and-injected': 'Loon 已移除初始结果，并注入动态过滤', 'subscription-invalid': '订阅地址无效', 'download-failed': '订阅下载失败', 'format-invalid': '订阅格式或数量无效', 'storage-failed': '订阅保存失败', updated: '订阅已更新' };
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function message(text, error) {
    var node = byId('notice'); node.textContent = text; node.className = error ? 'notice error' : 'notice';
  }
  function render() {
    byId('status').textContent = !state.allowed ? '日志开关关闭' : state.active ? '正在记录' : '已暂停';
    byId('status').className = 'status ' + (state.allowed && state.active ? 'recording' : 'paused');
    byId('count').textContent = state.events.length;
    byId('evicted').textContent = state.evicted;
    byId('toggle').textContent = state.active && state.allowed ? '暂停记录' : '开始记录';
    byId('toggle').disabled = busy || !state.allowed;
    ['refresh', 'export', 'clear'].forEach(function (id) { byId(id).disabled = busy || (id === 'export' && !state.events.length); });
    byId('hint').textContent = !state.allowed ? '请先在 Loon 插件中开启「日志工具」，再点刷新。已有日志仍可查看、导出或清空。' : state.active ? '重新发起搜索后，点刷新查看最新记录。' : '记录已暂停。点开始记录，再重新发起搜索。';
    var list = byId('events');
    while (list.firstChild) list.removeChild(list.firstChild);
    byId('empty').hidden = state.events.length > 0;
    state.events.slice().reverse().forEach(function (event) {
      var card = element('article', 'event');
      var top = element('div', 'event-top');
      var phase = event.phase === 'request' ? '请求发出' : event.phase === 'response' ? '响应返回' : '订阅更新';
      top.appendChild(element('span', 'phase ' + event.phase, phase));
      top.appendChild(element('span', 'engine', event.engine ? { google: 'Google', bing: 'Bing', baidu: '百度' }[event.engine] : '名单订阅'));
      card.appendChild(top);
      card.appendChild(element('p', 'outcome', reasons[event.reason] || '处理结果未知'));
      var details = element('div', 'details');
      var entries = [];
      if (event.status !== undefined) entries.push('HTTP ' + event.status);
      if (event.rules !== undefined) entries.push('规则 ' + event.rules);
      if (event.recognized !== undefined) entries.push('初始识别 ' + event.recognized);
      if (event.removed !== undefined) entries.push('初始移除 ' + event.removed);
      if (event.unresolved !== undefined) entries.push('目标不明 ' + event.unresolved);
      entries.forEach(function (value) { details.appendChild(element('span', 'detail', value)); });
      card.appendChild(details);
      if (event.host) card.appendChild(element('p', 'endpoint', event.host + (event.path || '')));
      var footer = element('div', 'event-footer');
      var date = new Date(event.time);
      footer.appendChild(element('time', '', isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString()));
      footer.appendChild(element('span', '', 'v' + event.version));
      card.appendChild(footer); list.appendChild(card);
    });
  }
  async function readState(path, action) {
    if (busy) return;
    busy = true; render();
    try {
      var response = await fetch(path, action ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + state.token, credentials: 'same-origin', cache: 'no-store' } : { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { message(response.status === 409 ? '请先开启 Loon 插件的日志工具，再刷新。' : response.status === 403 ? '页面已过期，请点刷新后重试。' : '操作未完成，请稍后重试。', true); return; }
      state = await response.json();
      message(action === 'clear' ? '日志已清空，记录已暂停。' : action === 'pause' ? '记录已暂停。' : action === 'start' ? '已开始记录，请重新发起搜索。' : '已刷新最新日志。', false);
    } catch (_) { message('无法读取本地日志，请确认 Loon 和插件已启用后重试。', true); }
    finally { busy = false; render(); }
  }
  byId('toggle').addEventListener('click', function () { var action = state.active ? 'pause' : 'start'; readState('/' + action, action); });
  byId('refresh').addEventListener('click', function () { readState('/state'); });
  byId('clear').addEventListener('click', function () { readState('/clear', 'clear'); });
  byId('export').addEventListener('click', async function () {
    if (busy) return;
    busy = true; render();
    var url = '', anchor;
    try {
      var response = await fetch('/export', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('export-failed');
      var blob = await response.blob(); url = URL.createObjectURL(blob);
      anchor = element('a'); anchor.href = url; anchor.download = 'search-filter-development.log'; anchor.hidden = true;
      document.body.appendChild(anchor); anchor.click();
      message('已发起日志下载，可在浏览器的下载列表中查看。', false);
    } catch (_) { message('导出失败，请稍后重试。', true); }
    finally {
      if (anchor) anchor.remove();
      if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      busy = false; render();
    }
  });
  render();
}
function sfLogPageMarkup(view) {
  var data = JSON.stringify(view).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>搜索屏蔽开发日志 v' + view.version + '</title><style>' +
    ':root{--bg:#f4f6fa;--surface:#fff;--text:#182238;--muted:#617087;--line:#e2e7ef;--accent:#315ee7;--soft:#eef3ff;--danger:#b84248}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:920px;margin:auto;padding:32px 20px 50px}.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.eyebrow{margin:0;color:var(--muted);font-size:12px;letter-spacing:.08em}h1{font-size:26px;line-height:1.25;margin:5px 0 0}.version{font-size:12px;color:var(--muted);margin:10px 0 0}.status{white-space:nowrap;border-radius:30px;padding:6px 12px;font-size:12px;font-weight:600;margin-top:4px}.recording{color:#187c55;background:#e3f5eb}.paused{background:var(--line);color:var(--muted)}.panel{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:20px;margin-top:22px}.stats{display:flex;align-items:center;gap:32px}.stat strong{display:block;font-size:28px;line-height:1.3;font-variant-numeric:tabular-nums}.stat span{font-size:12px;color:var(--muted)}.local{margin-left:auto;color:var(--muted);font-size:12px;text-align:right}.actions{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:8px;margin-top:20px}button{font:inherit;font-size:14px;font-weight:600;line-height:1.4;min-height:44px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);padding:10px;cursor:pointer;touch-action:manipulation}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--danger)}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:3px solid #91aaff;outline-offset:2px}.hint{margin:14px 0 0;font-size:12px;color:var(--muted)}.notice{min-height:24px;margin:8px 2px 0;font-size:13px;color:#187c55}.notice.error{color:var(--danger)}.privacy{font-size:12px;color:var(--muted);margin:18px 2px}.privacy summary{cursor:pointer;font-weight:600;color:var(--text)}.privacy p{margin:8px 0}.list-heading{display:flex;justify-content:space-between;align-items:center;margin:24px 2px 12px}.list-heading h2{font-size:16px;margin:0}.list-heading span{color:var(--muted);font-size:12px}.events{display:grid;gap:12px}.event{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px}.event-top{display:flex;align-items:center;gap:10px}.phase{border-radius:7px;padding:2px 8px;background:var(--soft);color:var(--accent);font-size:12px;font-weight:600}.phase.request{background:#eff4f6;color:#4d6b7c}.phase.subscription{background:#f4edff;color:#7658a9}.engine{font-size:13px;font-weight:600}.outcome{font-weight:600;margin:10px 0 8px;line-height:1.5}.details{display:flex;flex-wrap:wrap;gap:6px}.detail{font-size:12px;background:var(--bg);color:var(--muted);padding:2px 7px;border-radius:6px}.endpoint{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);overflow-wrap:anywhere;margin:10px 0 0}.event-footer{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:11px;margin-top:12px}.empty{text-align:center;color:var(--muted);padding:36px 20px;background:var(--surface);border:1px dashed var(--line);border-radius:16px}.empty strong{display:block;color:var(--text);margin-bottom:6px}.empty p{margin:0;font-size:13px}[hidden]{display:none!important}noscript{display:block;color:var(--danger);margin-top:20px}@media(max-width:540px){main{padding:24px 16px 36px}h1{font-size:23px}.heading{gap:8px}.panel{padding:16px}.stats{gap:24px}.actions{grid-template-columns:1fr 1fr}.event{padding:15px}}@media(prefers-color-scheme:dark){:root{--bg:#101622;--surface:#1a2232;--text:#e6ecf6;--muted:#9cabc0;--line:#303b4d;--accent:#5e86ff;--soft:#26334f;--danger:#ff979c}.recording{background:#193c32;color:#8bd8b2}.phase.request{background:#293845;color:#adcadb}.phase.subscription{background:#352d47;color:#c9b4ef}.notice{color:#8bd8b2}}' +
    '</style></head><body><main><div class="heading"><div><p class="eyebrow">本地诊断 · 隐私日志</p><h1>搜索屏蔽开发日志</h1><p class="version">v' + view.version + ' · 时间按当前设备时区显示</p></div><span id="status" class="status paused">读取中</span></div>' +
    '<section class="panel" aria-label="日志操作"><div class="stats"><div class="stat"><strong id="count">0</strong><span>当前记录</span></div><div class="stat"><strong id="evicted">0</strong><span>已淘汰</span></div><div class="local">只保存在本机<br>最多 300 条</div></div><div class="actions"><button id="toggle" class="primary" type="button">开始记录</button><button id="refresh" type="button">刷新日志</button><button id="export" type="button">导出日志</button><button id="clear" class="danger" type="button">清空并暂停</button></div><p id="hint" class="hint"></p></section><p id="notice" class="notice" role="status" aria-live="polite"></p>' +
    '<details class="privacy"><summary>隐私与诊断范围</summary><p>只记录时间、版本、阶段、搜索引擎、固定搜索主机与入口、状态码、规则数量、初始结果识别／移除数量和固定处理结果。不会记录搜索词、完整 URL、结果域名与正文、黑名单、订阅地址、Cookie 或设备标识。日志不自动上传。</p><p>初始移除数是 Loon 从本次 HTML 中删除的条目数。脚本已注入不代表浏览器已隐藏动态结果；初始移除为 0 也不能证明没有黑名单结果。开启日志时，可在搜索页右下角查看页面执行与当前隐藏数，并下载单独的脱敏页面诊断。零条日志仅说明未采集到。并发存储可能丢失部分事件。</p><p>页面按设备时区显示时间，导出文件保留 UTC 时间。清空后会暂停记录，需手动开始。</p></details>' +
    '<div class="list-heading"><h2>最近记录</h2><span>最新在前</span></div><div id="empty" class="empty"><strong>暂无日志</strong><p>开启日志工具后自动记录；重新搜索后刷新查看。</p></div><section id="events" class="events" aria-label="日志列表"></section><noscript>请允许本地页面运行 JavaScript，以使用日志按钮。</noscript></main><script nonce="' + view.token + '">(' + sfLogPageClient.toString() + ')(' + data + ');</script></body></html>';
}
// END GENERATED SEARCH LOG UI

/* 搜索屏蔽开发日志 v1.0.4 — local, allowlisted metadata only. */
(function () {
  'use strict';
  var BASE = 'http://search-filter-logs.invalid', VERSION = '1.0.4';
  var args = typeof $argument === 'object' && $argument ? $argument : {};
  var allowed = args.log_enabled === true || args.log_enabled === 'true';
  var req = typeof $request === 'undefined' ? null : $request;
  if (!req) {
    try {
      var current = sfLogSync(args);
      if (allowed) { current.announced = true; sfLogSave(current); }
    } catch (_) {}
    if (typeof $notification !== 'undefined') $notification.post('搜索屏蔽开发日志 v' + VERSION, '本地查看与导出', '点击打开日志页面。先开启插件日志工具，再复现搜索结果。', { openUrl: BASE + '/' });
    return $done({ title: '搜索屏蔽开发日志 v' + VERSION, content: '在浏览器打开 ' + BASE + '/' });
  }
  var match = /^http:\/\/search-filter-logs\.invalid(?::80)?(\/[^?#]*)?(?:\?[^#]*)?$/i.exec(String(req.url || ''));
  if (!match) return $done({});
  function respond(status, type, body, extra) {
    var headers = { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; script-src 'nonce-" + (nonce || '') + "'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" };
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    $done({ response: { status: status, headers: headers, body: body } });
  }
  function json(status, value) { return respond(status, 'application/json', JSON.stringify(value)); }
  function header(name) { var keys = Object.keys(req.headers || {}); for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(req.headers[keys[i]]); return ''; }
  function view(state) { return { version: VERSION, allowed: allowed, active: state.active, token: state.token, evicted: state.evicted, events: state.events }; }
  var nonce = '';
  try {
    var state = sfLogSync(args), path = match[1] || '/', method = req.method || 'GET';
    nonce = state.token;
    if (method === 'GET' && path === '/export') {
      var meta = { format: 'search-filter-development-log', version: VERSION, count: state.events.length, evicted: state.evicted, coverage: 'Loon metadata and initial HTML removal counts only; injection does not prove browser filtering; concurrent storage writes may lose events' };
      return respond(200, 'text/plain', [meta].concat(state.events).map(function (event) { return JSON.stringify(event); }).join('\n') + '\n', { 'Content-Disposition': 'attachment; filename="search-filter-development.log"' });
    }
    if (method === 'GET' && (path === '/' || path === '/state')) {
      if (allowed) state.announced = true; // The log page is already open.
      sfLogSave(state);
      return path === '/state' ? json(200, view(state)) : respond(200, 'text/html', sfLogPageMarkup(view(state)));
    }
    if (!/^\/(start|pause|clear)$/.test(path)) return json(404, { error: 'not-found' });
    if (method !== 'POST') return respond(405, 'application/json', '{"error":"post-required"}', { Allow: 'POST' });
    var origin = header('origin'), referer = header('referer'), body = typeof req.body === 'string' ? req.body : '';
    if ((origin && origin !== BASE && origin !== BASE + ':80') || (referer && !/^http:\/\/search-filter-logs\.invalid(?::80)?\//i.test(referer)) || body !== 'token=' + state.token) return json(403, { error: 'refresh-required' });
    if (path === '/start' && !allowed) return json(409, { error: 'log-switch-off' });
    if (path === '/clear') { state = sfLogFresh(); state.active = false; state.switchOn = allowed; state.announced = allowed; }
    else state.active = path === '/start';
    if (allowed) state.announced = true;
    sfLogSave(state);
    return json(200, view(state));
  } catch (_) { json(500, { error: 'log-store-unavailable' }); }
}());
