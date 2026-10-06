/** ChatGPT 网络诊断日志 1.0.0 | MIT | 本地元数据，不读取正文。 */
(function () {
  'use strict';
  var KEY = 'chatgpt.network.logger.v1';
  var LIMIT = 300;
  var LOCAL = 'http://chatgpt-logs.invalid';
  var qx = typeof $prefs !== 'undefined';
  var store = qx ? {
    read: function () { return $prefs.valueForKey(KEY); },
    write: function (v) { return $prefs.setValueForKey(v, KEY); }
  } : {
    read: function () { return $persistentStore.read(KEY); },
    write: function (v) { return $persistentStore.write(v, KEY); }
  };
  function save(s) {
    if (store.write(JSON.stringify(s)) !== true) throw Error('storage-write-failed');
  }
  function fresh() {
    return { version: 1, enabled: false, token: Date.now().toString(36) + Math.random().toString(36).slice(2), events: [], evicted: 0 };
  }
  function load() {
    var raw = store.read();
    if (!raw) return fresh();
    if (raw.length > 262144) throw Error('storage-too-large');
    var s = JSON.parse(raw);
    if (s.version !== 1 || typeof s.enabled !== 'boolean' || !Array.isArray(s.events) || s.events.length > LIMIT ||
      typeof s.token !== 'string' || !/^[a-z0-9]+$/.test(s.token) || typeof s.evicted !== 'number') throw Error('storage-invalid');
    return s;
  }
  function escape(v) {
    return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(headers[keys[i]]);
    return '';
  }
  function respond(status, type, body, extra) {
    var headers = {
      'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    };
    Object.keys(extra || {}).forEach(function (key) { headers[key] = extra[key]; });
    if (qx) return $done({ status: 'HTTP/1.1 ' + status + ' Response', headers: headers, body: body });
    return $done({ response: { status: status, headers: headers, body: body } });
  }
  function page(s) {
    var actions = [['start', '开启日志'], ['pause', '暂停日志'], ['clear', '清空并暂停']];
    var forms = actions.map(function (a) {
      return '<form method="post" action="/' + a[0] + '?token=' + s.token + '"><button>' + a[1] + '</button></form>';
    }).join('');
    var rows = s.events.slice().reverse().map(function (e) {
      return '<tr>' + [e.time, e.phase, e.host, e.endpoint, e.method, e.status || '—'].map(function (v) { return '<td>' + escape(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>ChatGPT 网络日志</title><style>body{font:16px system-ui;margin:24px;color:#17332c;background:#f4f8f6}main{max-width:960px;margin:auto}button,a{display:inline-block;padding:10px;margin:5px;color:#075e47}form{display:inline}table{border-collapse:collapse;font-size:13px}td,th{padding:8px;border-bottom:1px solid #ccd8d2;text-align:left}.scroll{overflow:auto}</style><main>' +
      '<h1>ChatGPT 网络日志</h1><p>状态：' + (s.enabled ? '记录中' : '已暂停') + ' · 已保存 ' + s.events.length + ' 条 · 已淘汰 ' + s.evicted + ' 条</p>' +
      '<p>最多保留最近 300 条。仅记录网络元数据，不保存聊天正文、账号凭据或完整 URL。</p>' + forms +
      '<a href="/export" download="chatgpt-network.log">导出日志</a><a href="/">刷新</a>' +
      '<p>网络选择：在代理软件中选择 ChatGPT 策略的 DIRECT（直连）或代理节点。实际出口请查看软件的连接记录。</p>' +
      '<p>HTTPS 日志需要解密成功；原生客户端可能拒绝解密。此页未显示失败的 TLS、DNS、纯 IP 或 WebSocket 帧，零条记录不代表没有连接。</p>' +
      '<div class="scroll"><table><thead><tr><th>时间 UTC</th><th>阶段</th><th>主机</th><th>接口类别</th><th>方法</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div></main></html>';
  }
  var req = typeof $request === 'undefined' ? null : $request;
  var local = false;
  try {
    if (!req) return $done({});
    var url = String(req.url || '');
    var lm = /^http:\/\/chatgpt-logs\.invalid(?::80)?(\/[^#]*)?$/i.exec(url);
    local = !!lm;
    if (local) {
      var route = lm[1] || '/';
      var path = route.split('?')[0];
      var method = String(req.method || 'GET').toUpperCase();
      var state = load();
      if (method === 'GET' && path === '/') { save(state); return respond(200, 'text/html', page(state)); }
      if (method === 'GET' && path === '/export') {
        var data = [{ format: 'chatgpt-network-log', version: 1, exported: new Date().toISOString(), count: state.events.length, evicted: state.evicted, enabled: state.enabled,
          coverage: 'HTTP metadata only; concurrent writes may lose events; no observed exit policy' }].concat(state.events);
        return respond(200, 'text/plain', data.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n', { 'Content-Disposition': 'attachment; filename="chatgpt-network.log"' });
      }
      if (!/^\/(start|pause|clear)$/.test(path)) return respond(404, 'text/plain', '页面不存在');
      if (method !== 'POST') return respond(405, 'text/plain', '请使用日志页按钮', { Allow: 'POST' });
      var origin = header(req.headers, 'origin');
      var referer = header(req.headers, 'referer');
      if ((origin && origin !== LOCAL && origin !== LOCAL + ':80') ||
        (referer && !/^http:\/\/chatgpt-logs\.invalid(?::80)?\//i.test(referer)) || route !== path + '?token=' + state.token) return respond(403, 'text/plain', '请刷新日志页后重试');
      if (path === '/clear') state = fresh();
      else state.enabled = path === '/start';
      save(state);
      return respond(303, 'text/plain', '已更新', { Location: '/' });
    }
    var match = /^https:\/\/((?:[a-z0-9-]+\.)*(?:chatgpt\.com|openai\.com|oaistatic\.com|oaiusercontent\.com|oaistatsig\.com|openaimerge\.com))(?::443)?(\/[^?#]*)?(?:[?#].*)?$/i.exec(url);
    if (!match) return $done({});
    var s = load();
    if (!s.enabled) return $done({});
    var response = typeof $response === 'undefined' ? null : $response;
    var status = response ? Number(response.statusCode || response.status) : 0;
    var methodName = String(req.method || '').toUpperCase();
    var endpoint = 'other';
    var p = match[2] || '/';
    if (/^\/(?:backend-api|api|v1)(?:\/|$)/.test(p)) endpoint = 'api';
    else if (/^\/(?:auth|oauth|authorize|login|signin|callback)(?:\/|$)/.test(p)) endpoint = 'auth';
    else if (/^\/(?:assets|static|_next)(?:\/|$)/.test(p)) endpoint = 'static';
    else if (p === '/') endpoint = 'root';
    var event = { time: new Date().toISOString(), phase: response ? 'response' : 'request', host: match[1].toLowerCase(), endpoint: endpoint,
      method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT)$/.test(methodName) ? methodName : 'OTHER',
      status: status >= 100 && status <= 599 && status % 1 === 0 ? status : null };
    // 公开持久化接口无原子追加；容量有界，但并发完整率仍需设备验证。
    s.events.push(event);
    if (s.events.length > LIMIT) { s.events.shift(); s.evicted++; }
    save(s);
    return $done({});
  } catch (_) {
    console.log('[ChatGPT] 日志存储不可用；业务请求继续放行。');
    if (local) return respond(503, 'text/plain', '日志存储不可用，请检查代理软件脚本日志。未覆盖原有数据。');
    return $done({});
  }
}());
