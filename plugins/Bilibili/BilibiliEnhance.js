/**
 * Bilibili 增强：Loon JSON 响应过滤与本地开发日志。
 * 作者：可莉唯一的狗、ChatGPT
 * 版本：1.1.0；更新时间：2026-10-07
 * 只处理已登记的 JSON 接口；异常、未知结构与未发生修改的响应原样放行。
 */
(function () {
  'use strict';
  const defaults = {
    remove_splash_ads: true, remove_feed_ads: true,
    hide_live: false, hide_game: false, hide_member_shop: false,
    hide_publish: false, blocked_uids: '', blocked_keywords: '', log_enabled: false
  };
  const paths = {
    '/x/v2/splash/list': 'splash', '/x/v2/splash/show': 'splash',
    '/x/v2/feed/index': 'feed', '/x/v2/feed/index/story': 'feed',
    '/x/resource/show/tab': 'tab', '/x/resource/show/tab/v2': 'tab'
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
  const LOG_KEY = 'bilibili.enhance.logs.v1';
  const LIMIT = 300;
  const rpcPaths = [
    '/bilibili.app.view.v1.View/View', '/bilibili.app.viewunite.v1.View/View',
    '/bilibili.app.dynamic.v2.Dynamic/DynAll', '/bilibili.app.show.v1.Popular/Index',
    '/bilibili.app.playurl.v1.PlayURL/PlayView', '/bilibili.app.playerunite.v1.Player/PlayViewUnite'
  ];
  const outcomes = ['modified', 'unchanged', 'http_error', 'unsupported_body', 'api_error', 'invalid_json', 'unsupported_schema', 'metadata_only'];
  const cardTypes = ['small_cover_v2', 'small_cover_v10', 'banner_v8', 'cm_v2', 'cm_double_v9'];
  const cardGotos = ['av', 'live', 'live_rcmd', 'game', 'banner', 'ad_web_s', 'ad_av', 'ad_web_gif', 'ad_player', 'ad_inline_3d', 'ad_inline_eggs', 'ad_inline_av'];
  const fields = ['items', 'list', 'show', 'top', 'bottom', 'card_type', 'card_goto', 'is_ad', 'ad_info', 'banner_item', 'args', 'title'];
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
    return { events: value.events.map(safeEvent).filter(Boolean), evicted: count(value.evicted),
      nonce: typeof value.nonce === 'string' && /^[a-z0-9]{10,80}$/.test(value.nonce) ? value.nonce : undefined };
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
  function localPage(request, local, config) {
    function respond(status, type, body, extra = {}) {
      return $done({ response: { status, headers: Object.assign({
        'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      }, extra), body } });
    }
    try {
      const state = readLogs();
      const path = (local[1] || '/').split('?')[0];
      const method = request.method || 'GET';
      if (path === '/' && method === 'GET') {
        if (!state.nonce) { state.nonce = Date.now().toString(36) + Math.random().toString(36).slice(2); saveLogs(state); }
        // 页面只包含固定文字和数字；事件在导出时仅按 safeEvent 白名单投影。
        return respond(200, 'text/html', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bilibili 开发日志</title><style>body{font:16px system-ui;max-width:760px;margin:32px auto;padding:16px}a,button{padding:12px;display:inline-block}</style><h1>Bilibili 开发日志</h1><p>日志开关：' + (config.log_enabled ? '开启' : '关闭') + '；已保存 ' + state.events.length + ' 条，已淘汰 ' + state.evicted + ' 条。</p><p>在 Loon 插件参数中开启或关闭日志。最多保留最近 300 条。仅保存接口类别、处理结果、数量和白名单结构类型；不保存令牌、Cookie、请求参数、标题、UID 或原始正文。</p><a href="/export" download="bilibili-development.log">导出日志</a><a href="/">刷新</a><form method="post" action="/clear?nonce=' + state.nonce + '"><button>清空已存日志</button></form><p>仅覆盖 app.bilibili.com 的可解密 HTTP 响应；二进制接口仅记元数据，不解码正文。并发写入可能丢失记录。</p></html>');
      }
      if (path === '/export' && method === 'GET') {
        const header = { format: 'bilibili-development-log', version: 1, exported: new Date().toISOString(), count: state.events.length, evicted: state.evicted };
        return respond(200, 'text/plain', [header, ...state.events].map(value => JSON.stringify(value)).join('\n') + '\n', { 'Content-Disposition': 'attachment; filename="bilibili-development.log"' });
      }
      if (path === '/clear') {
        if (method !== 'POST') return respond(405, 'text/plain', '请使用页面按钮', { Allow: 'POST' });
        const headers = request.headers || {};
        const originKey = Object.keys(headers).find(key => key.toLowerCase() === 'origin');
        const origin = originKey && headers[originKey];
        if (!state.nonce || local[1] !== '/clear?nonce=' + state.nonce || (origin && !['http://bilibili-logs.invalid', 'http://bilibili-logs.invalid:80'].includes(origin))) return respond(403, 'text/plain', '请刷新日志页后重试');
        saveLogs({ events: [], evicted: 0 });
        return respond(303, 'text/plain', '已清空', { Location: '/' });
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
    if (!request) return $done({});
    const local = /^http:\/\/bilibili-logs\.invalid(?::80)?(\/[^#]*)?$/.exec(String(request.url || ''));
    if (local) return localPage(request, local, config);
    if (!response) return $done({});
    // 不依赖代理脚本环境是否提供 URL 类。
    const match = /^https:\/\/app\.bilibili\.com(?::443)?(\/[^?#]*)(?:\?[^#]*)?$/.exec(String(request.url || ''));
    const route = match && paths[match[1]];
    const status = Number(response.statusCode || response.status || 200);
    if (!match) return $done({});
    if (config.log_enabled) event = {
      time: new Date().toISOString(), endpoint: (route || rpcPaths.includes(match[1])) ? match[1] : 'other_api',
      method: request.method || 'GET', status, body_length: route && typeof response.body === 'string' ? response.body.length : 0
    };
    if (!route || (request.method && request.method !== 'GET')) return finish({}, 'metadata_only');
    if (!Number.isFinite(status) || status < 200 || status >= 300) return finish({}, 'http_error');
    if (typeof response.body !== 'string' || response.body.length > 2097152) return finish({}, 'unsupported_body');
    const body = JSON.parse(response.body, (_, value) => {
      // 避免重写时把超出 JS 整数精度的 ID 序列化为另一数值。
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('unsafe integer');
      return value;
    });
    if (!object(body) || body.code !== 0) return finish({}, 'api_error');
    if (!object(body.data)) return finish({}, 'unsupported_schema');
    const data = body.data;
    if (event) {
      event.data_schema = schema(data);
      event.before = ['items', 'list', 'show', 'top', 'bottom'].reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
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
        const uid = object(item.args) ? item.args.up_id : undefined;
        if (uid !== undefined && uids.has(String(uid))) return false;
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
      event.after = ['items', 'list', 'show', 'top', 'bottom'].reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
      event.removed = event.before - event.after;
    }
    return finish(changed ? { body: JSON.stringify(body) } : {}, changed ? 'modified' : 'unchanged');
  } catch (_) {
    // 不输出请求 URL、Cookie、账号数据或响应正文。
    return finish({}, 'invalid_json');
  }
})();
