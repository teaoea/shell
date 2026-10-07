/**
 * Bilibili 增强：Loon JSON 响应过滤与本地开发日志。
 * 作者：可莉唯一的狗、ChatGPT
 * 版本：1.5.0；更新时间：2026-10-07
 * 只处理已登记的 JSON 接口；异常、未知结构与未发生修改的响应原样放行。
 */
(function () {
  'use strict';
  const defaults = {
    remove_splash_ads: true, remove_feed_ads: true,
    hide_live: false, hide_game: false, hide_member_shop: false,
    hide_publish: false, hide_search_discovery: false,
    blocked_uids: '', blocked_keywords: '', log_enabled: false
  };
  const paths = {
    '/x/v2/splash/list': 'splash', '/x/v2/splash/show': 'splash',
    '/x/v2/feed/index': 'feed', '/x/v2/feed/index/story': 'feed',
    '/x/resource/show/tab': 'tab', '/x/resource/show/tab/v2': 'tab',
    '/x/v2/search/square': 'search_square', '/x/v2/search/trending/ranking': 'search_trending'
  };
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function options(raw) {
    let source = raw;
    const result = Object.assign({}, defaults);
    if (typeof source === 'string') {
      if (source.trim().startsWith('{')) source = JSON.parse(source);
      else {
        source = Object.create(null);
        for (const pair of raw.split('&')) {
          const equal = pair.indexOf('=');
          if (equal < 1) continue;
          const decode = text => decodeURIComponent(text.replace(/\+/g, ' '));
          source[decode(pair.slice(0, equal))] = decode(pair.slice(equal + 1));
        }
      }
    }
    if (object(source)) for (const key of Object.keys(defaults)) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (typeof defaults[key] === 'boolean') {
        if (source[key] === true || source[key] === 'true') result[key] = true;
        if (source[key] === false || source[key] === 'false') result[key] = false;
      } else if (typeof source[key] === 'string') result[key] = source[key];
    }
    return result;
  }
  function ad(item) {
    if (!object(item)) return false;
    if (item.is_ad === true || item.is_ad === 1 || item.is_ad === '1') return true;
    if (object(item.ad_info) && Object.keys(item.ad_info).length > 0) return true;
    return ['cm_v2', 'cm_double_v9'].includes(item.card_type) &&
      ['ad_web_s', 'ad_av', 'ad_web_gif', 'ad_player', 'ad_inline_3d', 'ad_inline_eggs', 'ad_inline_av'].includes(item.card_goto);
  }
  function memberShop(item) {
    // 只识别商品跳转／明确的会员购标签，不按视频标题或 UP 主名称过滤。
    if (item.card_goto === 'mall') return true;
    if (object(item.rcmd_reason_style) && item.rcmd_reason_style.text === '会员购') return true;
    if (object(item.desc_button) && item.desc_button.text === '会员购') return true;
    return typeof item.uri === 'string' &&
      /^(?:bilibili:\/\/mall(?:[/?#]|$)|https?:\/\/mall\.bilibili\.com(?::443)?(?:[/?#]|$))/i.test(item.uri);
  }
  function losslessJSON(raw) {
    // 先校验原文，避免占位替换将异常 JSON 意外修复为合法数据。
    let value = JSON.parse(raw);
    let prefix = '__bili_raw_number__';
    const normalized = JSON.stringify(value);
    for (let attempts = 0; raw.includes(prefix) || normalized.includes(prefix); attempts++) {
      if (attempts >= 16) throw new Error('number marker collision');
      prefix += '_';
    }
    const numbers = new Map();
    const strings = /"(?:[^"\\]|\\[\s\S])*"/g;
    const masked = raw.replace(/"(?:[^"\\]|\\[\s\S])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
      if (token[0] === '"') return token;
      const number = Number(token);
      if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number))) return token;
      const marker = JSON.stringify(prefix + numbers.size);
      numbers.set(marker, token);
      return marker;
    });
    if (numbers.size) value = JSON.parse(masked);
    return {
      value,
      text: number => numbers.get(JSON.stringify(number)) || String(number),
      stringify: data => {
        const serialized = JSON.stringify(data);
        return numbers.size ? serialized.replace(strings, token => numbers.get(token) || token) : serialized;
      }
    };
  }
  const LOG_KEY = 'bilibili.enhance.logs.v1';
  const NOTICE_KEY = 'bilibili.enhance.notice.v1';
  const LIMIT = 300;
  const rpcPaths = [
    '/bilibili.app.view.v1.View/View', '/bilibili.app.viewunite.v1.View/View',
    '/bilibili.app.dynamic.v2.Dynamic/DynAll', '/bilibili.app.show.v1.Popular/Index',
    '/bilibili.app.playurl.v1.PlayURL/PlayView', '/bilibili.app.playerunite.v1.Player/PlayViewUnite'
  ];
  const outcomes = ['modified', 'unchanged', 'http_error', 'unsupported_body', 'api_error', 'invalid_json', 'unsupported_schema', 'metadata_only'];
  const cardTypes = ['small_cover_v2', 'small_cover_v10', 'banner_v8', 'cm_v2', 'cm_double_v9'];
  const cardGotos = ['av', 'live', 'live_rcmd', 'game', 'mall', 'banner', 'ad_web_s', 'ad_av', 'ad_web_gif', 'ad_player', 'ad_inline_3d', 'ad_inline_eggs', 'ad_inline_av'];
  const fields = ['data', 'type', 'items', 'list', 'top_list', 'show', 'top', 'bottom', 'card_type', 'card_goto', 'is_ad', 'ad_info', 'banner_item', 'args', 'title'];
  function kind(value) {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : object(value) ? 'object' :
      ['string', 'number', 'boolean'].includes(typeof value) ? typeof value : 'other';
  }
  function schema(value) {
    const result = {};
    if (object(value)) for (const key of fields) if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = kind(value[key]);
    return result;
  }
  function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 2097152 ? value : 0; }
  // 重新投影存储中的每条记录，防止污染或旧数据在页面／导出中泄漏任意字符串。
  function safeEvent(event) {
    if (!object(event)) return null;
    const endpoints = Object.keys(paths).concat(rpcPaths, ['other_api']);
    if (!endpoints.includes(event.endpoint) || !outcomes.includes(event.outcome)) return null;
    const result = {
      time: typeof event.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.time) ? event.time : '',
      endpoint: event.endpoint, outcome: event.outcome,
      method: ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(event.method) ? event.method : 'OTHER',
      status: Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : null,
      before: count(event.before), after: count(event.after), removed: count(event.removed),
      body_length: count(event.body_length)
    };
    // 不保存接口 message、原始字段名、字段值、标题、UID 或广告对象内容。
    for (const name of ['data_schema', 'item_schema']) {
      result[name] = {};
      if (object(event[name])) for (const key of fields) {
        if (['null', 'array', 'object', 'string', 'number', 'boolean', 'other'].includes(event[name][key])) result[name][key] = event[name][key];
      }
    }
    result.cards = [];
    if (Array.isArray(event.cards)) for (const card of event.cards.slice(0, 20)) if (object(card)) result.cards.push({
      type: cardTypes.includes(card.type) ? card.type : 'other',
      goto: cardGotos.includes(card.goto) ? card.goto : 'other', count: count(card.count)
    });
    return result;
  }
  function readLogs() {
    const raw = $persistentStore.read(LOG_KEY);
    if (!raw) return { events: [], evicted: 0 };
    if (typeof raw !== 'string' || raw.length > 262144) throw new Error('storage');
    const value = JSON.parse(raw);
    if (!object(value) || !Array.isArray(value.events) || value.events.length > LIMIT) throw new Error('storage');
    return { events: value.events.map(safeEvent).filter(Boolean), evicted: count(value.evicted) };
  }
  function saveLogs(state) {
    let raw = JSON.stringify(state);
    while (raw.length > 262144 && state.events.length) {
      state.events.shift(); state.evicted++; raw = JSON.stringify(state);
    }
    if ($persistentStore.write(raw, LOG_KEY) !== true) throw new Error('storage');
  }
  function append(event) {
    try {
      const state = readLogs();
      state.events.push(safeEvent(event));
      while (state.events.length > LIMIT) { state.events.shift(); state.evicted++; }
      saveLogs(state);
    } catch (_) { /* 日志故障不得影响过滤，不输出异常内容。 */ }
  }
  function syncLogging(config) {
    if (config.log_enabled) return true;
    try {
      // 无需解析旧数据：关闭时也能清空损坏或旧版本留下的日志。
      const raw = $persistentStore.read(LOG_KEY);
      const empty = JSON.stringify({ events: [], evicted: 0 });
      if (raw && raw !== empty && $persistentStore.write(empty, LOG_KEY) !== true) return false;
      if ($persistentStore.read(NOTICE_KEY) === 'on') $persistentStore.write('off', NOTICE_KEY);
      return true;
    } catch (_) { return false; }
  }
  function notifyLogging(config, manual = false) {
    try {
      const previous = $persistentStore.read(NOTICE_KEY);
      if (!config.log_enabled && previous === 'on') $persistentStore.write('off', NOTICE_KEY);
      if (!manual && (!config.log_enabled || previous === 'on')) return;
      if (typeof $notification === 'undefined' || typeof $notification.post !== 'function') return;
      if (config.log_enabled && $persistentStore.write('on', NOTICE_KEY) !== true) return;
      $notification.post('Bilibili 开发日志', config.log_enabled ? '日志已开启' : '打开日志页',
        '点击此通知，在浏览器查看、导出或清空记录。', { openUrl: 'http://bilibili-logs.invalid/' });
    } catch (_) { /* 通知与存储异常不影响业务，不输出异常内容。 */ }
  }
  function renderPage(state, config, cleared = false) {
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const labels = { modified: '已过滤', unchanged: '无需修改', http_error: '响应异常', unsupported_body: '正文未处理', api_error: '接口异常', invalid_json: '解析后放行', unsupported_schema: '结构未识别', metadata_only: '仅元数据' };
    const removed = state.events.reduce((sum, entry) => sum + entry.removed, 0);
    const rows = state.events.slice(-20).reverse().map(entry => {
      const time = entry.time && Number.isFinite(Date.parse(entry.time)) ? new Date(Date.parse(entry.time) + 8 * 3600000).toISOString().slice(5, 19).replace('T', ' ') : '时间未知';
      return '<article class="record"><div class="record-head"><time>' + escape(time) + '</time><span class="result">' + labels[entry.outcome] + '</span></div><p class="endpoint">' + escape(entry.endpoint) + '</p><div class="record-meta"><span>HTTP ' + (entry.status || '—') + '</span><span>' + entry.before + ' → ' + entry.after + ' 项</span><span>移除 ' + entry.removed + ' 项</span></div></article>';
    }).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Bilibili 开发日志</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20256%20256%22%3E%3Crect%20width%3D%22256%22%20height%3D%22256%22%20rx%3D%2256%22%20fill%3D%22%23fb7299%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%23fff%22%20stroke-width%3D%2214%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M92%2044l22%2024m50-24l-22%2024%22%2F%3E%3Crect%20x%3D%2249%22%20y%3D%2275%22%20width%3D%22158%22%20height%3D%22121%22%20rx%3D%2224%22%2F%3E%3Cpath%20d%3D%22M91%20112v25m74-25v25m-48%2021h22M84%20198v12m88-12v12%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E"><style>
      :root{color-scheme:light dark;--bg:#f6f7fb;--panel:#fff;--text:#202532;--muted:#6d7485;--line:#e8ebf1;--accent:#d83c75;--soft:#fff0f5;--green:#138356;--danger:#bd3045}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:760px;margin:0 auto;padding:24px 18px 40px;padding-bottom:calc(40px + env(safe-area-inset-bottom))}.brand-icon{width:48px;height:48px;flex:none;border-radius:12px}.brand-icon svg{display:block;width:100%;height:100%}.heading{display:flex;align-items:center;gap:12px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 22px}h1{font-size:24px;letter-spacing:-.5px;margin:0}.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:2px;margin:0 0 5px}.status{font-size:12px;white-space:nowrap;border-radius:24px;padding:6px 12px;background:var(--line);color:var(--muted)}.status.on{background:#e5f5ed;color:var(--green)}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px}.stat,.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px}.stat{padding:16px 12px}.stat strong{display:block;font-size:27px;line-height:1.2}.stat span{display:block;margin-top:7px;color:var(--muted);font-size:12px}.panel{padding:18px;margin-top:16px}h2{font-size:17px;margin:0 0 12px}p{margin:8px 0;color:var(--muted)}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}a,button{-webkit-tap-highlight-color:transparent;display:block;width:100%;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);font:inherit;font-weight:600;text-decoration:none;text-align:center;padding:12px;min-height:48px;cursor:pointer}.primary{background:var(--accent);color:white;border-color:var(--accent)}form{grid-column:1/-1;margin:0}.clear{color:var(--danger);background:var(--soft);border-color:transparent}.note{font-size:13px;margin-top:14px}.success{padding:12px 16px;background:#e5f5ed;color:var(--green);border-radius:12px;margin-bottom:16px}.empty{text-align:center;padding:18px 10px}.empty strong{display:block;margin-bottom:8px}.record{border-top:1px solid var(--line);padding:14px 0}.record:last-child{padding-bottom:0}.record-head,.record-meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px}.result{color:var(--accent)}.endpoint{color:var(--text);font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;margin:9px 0}.record-meta{justify-content:flex-start;flex-wrap:wrap;gap:8px 16px}details{color:var(--muted);font-size:13px}summary{cursor:pointer;color:var(--text);font-weight:600}footer{font-size:12px;color:var(--muted);text-align:center;margin-top:22px}@media(prefers-color-scheme:dark){:root{--bg:#14151b;--panel:#20222c;--text:#f1f2f7;--muted:#a4aabd;--line:#343744;--soft:#352330;--accent:#fa79a7;--danger:#ff9ba9}.status.on,.success{background:#18372d;color:#8de0b8}.primary{color:#25141b}}@media(max-width:360px){main{padding:16px 12px}h1{font-size:21px}.stat{padding:14px 9px}}
      </style></head><body><main><header><div class="heading"><div class="brand-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#fb7299"/><g fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M92 44l22 24m50-24l-22 24"/><rect x="49" y="75" width="158" height="121" rx="24"/><path d="M91 112v25m74-25v25m-48 21h22M84 198v12m88-12v12"/></g></svg></div><div><p class="eyebrow">BILIBILI</p><h1>开发日志</h1></div></div><span class="status ${config.log_enabled ? 'on' : ''}">${config.log_enabled ? '● 记录中' : '已关闭'}</span></header>
      ${cleared ? '<div class="success" role="status">记录已清空。' + (config.log_enabled ? '日志仍在开启，新请求会继续记录。' : '日志保持关闭。') + '</div>' : ''}
      <section class="stats" aria-label="日志统计"><div class="stat"><strong>${state.events.length}</strong><span>已保存记录</span></div><div class="stat"><strong>${removed}</strong><span>已移除项目</span></div><div class="stat"><strong>${state.evicted}</strong><span>已淘汰记录</span></div></section>
      <section class="panel"><h2>记录管理</h2><div class="actions"><a class="primary" href="/export" download="bilibili-development.log">导出日志</a><a href="/">刷新记录</a><form method="post" action="/clear"><button class="clear" type="submit">清空记录</button></form></div><p class="note">${config.log_enabled ? '开启后自动记录。请先导出文件，再关闭日志；关闭后会自动清空记录。' : '日志已关闭，记录会自动清空。开启「开发日志」后刷新 B 站首页即可自动记录。'}</p></section>
      <section class="panel"><h2>最近记录 <small style="font-size:12px;color:var(--muted);font-weight:400">最多展示 20 条</small></h2>${rows || '<div class="empty"><strong>还没有记录</strong><p>' + (config.log_enabled ? '打开 Bilibili 并刷新首页，再回来刷新记录。' : '开启日志后，打开 Bilibili 并刷新首页。') + '</p></div>'}</section>
      <section class="panel"><details><summary>隐私与记录范围</summary><p>记录仅保存在本机，最多保留 300 条。只保存接口类别、处理结果、数量和白名单结构类型，不保存令牌、Cookie、查询参数、标题、UID 或原始正文。</p><p>仅记录可被 Loon 解密的 app.bilibili.com 响应；二进制接口只记元数据。并发请求可能丢失部分记录。</p></details></section><footer>时间显示为北京时间 · Bilibili 增强 1.5.0</footer></main></body></html>`;
  }
  function localPage(request, local, config) {
    function respond(status, type, body, extra = {}) {
      return $done({ response: { status, headers: Object.assign({
        'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      }, extra), body } });
    }
    try {
      if (!syncLogging(config)) throw new Error('storage');
      const path = (local[1] || '/').split('?')[0];
      const method = request.method || 'GET';
      if (path === '/clear') {
        if (method !== 'POST') return respond(405, 'text/plain', '请使用页面清空按钮', { Allow: 'POST' });
        const headers = request.headers || {};
        const originKey = Object.keys(headers).find(key => key.toLowerCase() === 'origin');
        const origin = originKey && headers[originKey];
        // Safari / 代理本地响应可能没有 Origin 或提供 null；不再依赖页面 nonce。
        if (origin && origin !== 'null' && !['http://bilibili-logs.invalid', 'http://bilibili-logs.invalid:80'].includes(origin)) return respond(403, 'text/plain', '请在本地日志页使用清空按钮');
        const state = { events: [], evicted: 0 };
        saveLogs(state);
        return respond(200, 'text/html', renderPage(state, config, true));
      }
      const state = readLogs();
      if (path === '/' && method === 'GET') {
        return respond(200, 'text/html', renderPage(state, config));
      }
      if (path === '/export' && method === 'GET') {
        const header = { format: 'bilibili-development-log', version: 1, exported: new Date().toISOString(), count: state.events.length, evicted: state.evicted };
        return respond(200, 'text/plain', [header, ...state.events].map(value => JSON.stringify(value)).join('\n') + '\n', { 'Content-Disposition': 'attachment; filename="bilibili-development.log"' });
      }
      return respond(404, 'text/plain', '页面不存在');
    } catch (_) { return respond(503, 'text/plain', '日志存储不可用；未覆盖已有记录。'); }
  }
  let event = null;
  let config;
  function finish(result, outcome) {
    if (event && config.log_enabled) { event.outcome = outcome; append(event); }
    return $done(result);
  }
  try {
    const request = typeof $request === 'object' && $request;
    const response = typeof $response === 'object' && $response;
    config = options(typeof $argument === 'undefined' ? null : $argument);
    if (!request) {
      syncLogging(config);
      const manual = typeof $script === 'object' && $script && $script.name === 'Bilibili 打开日志页';
      notifyLogging(config, manual);
      return $done({});
    }
    const local = /^http:\/\/bilibili-logs\.invalid(?::80)?(\/[^#]*)?$/.exec(String(request.url || ''));
    if (local) return localPage(request, local, config);
    if (!response) return $done({});
    // 不依赖代理脚本环境是否提供 URL 类。
    const match = /^https:\/\/app\.bilibili\.com(?::443)?(\/[^?#]*)(?:\?[^#]*)?$/.exec(String(request.url || ''));
    const route = match && paths[match[1]];
    const status = Number(response.statusCode || response.status || 200);
    if (!match) return $done({});
    syncLogging(config);
    notifyLogging(config);
    if (config.log_enabled) event = {
      time: new Date().toISOString(), endpoint: (route || rpcPaths.includes(match[1])) ? match[1] : 'other_api',
      method: request.method || 'GET', status, body_length: route && typeof response.body === 'string' ? response.body.length : 0
    };
    if (!route || (request.method && request.method !== 'GET')) return finish({}, 'metadata_only');
    if (!Number.isFinite(status) || status < 200 || status >= 300) return finish({}, 'http_error');
    if (typeof response.body !== 'string' || response.body.length > 2097152) return finish({}, 'unsupported_body');
    const json = losslessJSON(response.body);
    const body = json.value;
    if (!object(body) || body.code !== 0) return finish({}, 'api_error');
    if (!(route === 'search_square' ? Array.isArray(body.data) : object(body.data))) return finish({}, 'unsupported_schema');
    const data = body.data;
    const contentCount = () => Array.isArray(body.data) ? body.data.length :
      ['items', 'list', 'show', 'top', 'bottom'].concat(route === 'search_trending' ? ['top_list'] : [])
        .reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
    if (event) {
      event.data_schema = Array.isArray(data) ? schema(body) : schema(data);
      event.before = contentCount();
      const items = Array.isArray(data.items) ? data.items : [];
      event.item_schema = {};
      event.cards = [];
      for (const item of items.slice(0, 200)) if (object(item)) {
        Object.assign(event.item_schema, schema(item));
        const type = cardTypes.includes(item.card_type) ? item.card_type : 'other';
        const goto = cardGotos.includes(item.card_goto) ? item.card_goto : 'other';
        const found = event.cards.find(card => card.type === type && card.goto === goto);
        if (found) found.count++;
        else if (event.cards.length < 20) event.cards.push({ type, goto, count: 1 });
      }
    }
    let changed = false;
    function filter(parent, key, keep) {
      if (!Array.isArray(parent[key])) return;
      const previous = parent[key];
      const next = previous.filter(keep);
      if (next.length !== previous.length) { parent[key] = next; changed = true; }
    }
    if (config.hide_search_discovery) {
      if (route === 'search_square') {
        // 公开 App 响应的模块类型：trending 为热搜，recommend 为搜索发现。
        // 保留 history 和所有未知模块，不按标题猜测类型。
        filter(body, 'data', module => !object(module) || !['trending', 'recommend'].includes(module.type));
      } else if (route === 'search_trending') {
        for (const key of ['list', 'top_list']) filter(data, key, () => false);
      }
    }
    if (route === 'splash' && config.remove_splash_ads) {
      // 仅清理开屏投放列表，保留启动配置和其他未知字段。
      for (const key of ['list', 'show']) if (Array.isArray(data[key]) && data[key].length) {
        data[key] = []; changed = true;
      }
    }
    if (route === 'feed') {
      const uids = new Set(config.blocked_uids.split(/[\s,，;；]+/).filter(uid => /^\d+$/.test(uid)));
      // 关键词使用字面包含匹配，以换行或逗号分隔；不执行用户输入的正则表达式。
      const keywords = config.blocked_keywords.split(/[\n,，]+/).map(word => word.trim().toLowerCase()).filter(Boolean);
      filter(data, 'items', item => {
        if (!object(item)) return true;
        if (config.remove_feed_ads && ad(item)) return false;
        if (config.hide_live && ['live', 'live_rcmd'].includes(item.card_goto)) return false;
        if (config.hide_game && item.card_goto === 'game') return false;
        if (config.hide_member_shop && memberShop(item)) return false;
        const uid = object(item.args) ? item.args.up_id : undefined;
        if (uid !== undefined && uids.has(json.text(uid))) return false;
        if (typeof item.title === 'string' && keywords.some(word => item.title.toLowerCase().includes(word))) return false;
        if (config.remove_feed_ads && item.card_type === 'banner_v8' && item.card_goto === 'banner' && Array.isArray(item.banner_item)) {
          filter(item, 'banner_item', banner => !object(banner) || banner.type !== 'ad');
          if (item.banner_item.length === 0) return false;
        }
        return true;
      });
    }
    if (route === 'tab') {
      for (const key of ['top', 'bottom']) {
        const before = data[key];
        filter(data, key, item => {
          if (!object(item)) return true;
          if (config.hide_game && item.name === '游戏中心') return false;
          if (config.hide_member_shop && (item.name === '会员购' || item.tab_id === '会员购Bottom')) return false;
          return !(config.hide_publish && item.name === '发布');
        });
        if (data[key] !== before) data[key].forEach((item, index) => {
          if (object(item) && typeof item.pos === 'number') item.pos = index + 1;
        });
      }
    }
    if (event) {
      event.after = contentCount();
      event.removed = event.before - event.after;
    }
    return finish(changed ? { body: json.stringify(body) } : {}, changed ? 'modified' : 'unchanged');
  } catch (_) {
    // 不输出请求 URL、Cookie、账号数据或响应正文。
    return finish({}, 'invalid_json');
  }
})();
