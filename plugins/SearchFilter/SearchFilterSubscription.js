// BEGIN GENERATED SEARCH ENGINES CORE
/* Explicit search entry and result adapters. No wildcard MitM hosts. */
var sfEngines = [
  {
    "id": "google",
    "label": "Google",
    "hosts": [
      "google.com",
      "www.google.com",
      "google.com.hk",
      "www.google.com.hk",
      "google.com.tw",
      "www.google.com.tw",
      "google.co.jp",
      "www.google.co.jp",
      "google.co.uk",
      "www.google.co.uk"
    ],
    "paths": [
      "/search"
    ],
    "query": [
      "q"
    ],
    "title": "h3, [role=\"heading\"][aria-level=\"3\"]",
    "card": ".g, .MjjYud, .tF2Cxc, .vt6azd, .Ww4FFb, [data-sokoban-container]",
    "root": "#search, #rso, #main",
    "citation": "cite, .ob9lvb",
    "targetAttrs": [],
    "queryExclusion": true
  },
  {
    "id": "bing",
    "label": "Bing",
    "hosts": [
      "bing.com",
      "www.bing.com",
      "cn.bing.com"
    ],
    "paths": [
      "/search"
    ],
    "query": [
      "q"
    ],
    "title": "h2",
    "card": "li.b_algo",
    "root": "#b_results",
    "citation": "cite",
    "targetAttrs": [],
    "queryExclusion": true
  },
  {
    "id": "baidu",
    "label": "百度",
    "hosts": [
      "baidu.com",
      "www.baidu.com",
      "m.baidu.com"
    ],
    "paths": [
      "/s"
    ],
    "query": [
      "wd",
      "word"
    ],
    "title": "h3",
    "card": ".result, .c-container",
    "root": "",
    "citation": "cite, .c-showurl, .c-showurl-color",
    "targetAttrs": [
      "data-landurl"
    ],
    "queryExclusion": true
  },
  {
    "id": "duckduckgo",
    "label": "DuckDuckGo",
    "hosts": [
      "duckduckgo.com",
      "www.duckduckgo.com",
      "safe.duckduckgo.com",
      "start.duckduckgo.com",
      "noai.duckduckgo.com",
      "html.duckduckgo.com"
    ],
    "paths": [
      "/",
      "/html",
      "/html/"
    ],
    "query": [
      "q"
    ],
    "title": "h2",
    "card": ".result.web-result, article[data-testid=\"result\"], article[data-testid=\"result-row\"], article",
    "root": "#links, [data-testid=\"web-vertical\"]",
    "citation": ".result__url",
    "targetAttrs": [],
    "queryExclusion": true
  },
  {
    "id": "yahoo",
    "label": "Yahoo",
    "hosts": [
      "search.yahoo.com",
      "uk.search.yahoo.com",
      "tw.search.yahoo.com",
      "hk.search.yahoo.com",
      "sg.search.yahoo.com",
      "search.yahoo.co.jp"
    ],
    "paths": [
      "/search"
    ],
    "query": [
      "p"
    ],
    "title": "h3",
    "card": ".algo-sr, .sw-Card.Algo",
    "root": "",
    "citation": "cite",
    "targetAttrs": [],
    "queryExclusion": true
  },
  {
    "id": "brave",
    "label": "Brave",
    "hosts": [
      "search.brave.com",
      "safe.search.brave.com"
    ],
    "paths": [
      "/search"
    ],
    "query": [
      "q"
    ],
    "title": ".search-snippet-title, a.title",
    "card": ".snippet[data-type=\"web\"]",
    "root": "#mixed-main",
    "citation": "cite",
    "targetAttrs": [],
    "queryExclusion": true
  },
  {
    "id": "yandex",
    "label": "Yandex",
    "hosts": [
      "yandex.com",
      "www.yandex.com",
      "yandex.ru",
      "www.yandex.ru",
      "ya.ru",
      "www.ya.ru"
    ],
    "paths": [
      "/search",
      "/search/",
      "/search/touch",
      "/search/touch/"
    ],
    "query": [
      "text"
    ],
    "title": "h2, h3.b-serp-item__title",
    "card": ".Organic, li.serp-item",
    "root": "",
    "citation": ".Organic-Path, .Path-Item, cite",
    "targetAttrs": [],
    "queryExclusion": false
  },
  {
    "id": "sogou",
    "label": "搜狗",
    "hosts": [
      "sogou.com",
      "www.sogou.com",
      "m.sogou.com"
    ],
    "paths": [
      "/web",
      "/web/searchList.jsp"
    ],
    "query": [
      "query",
      "keyword"
    ],
    "title": "h3.vr-title, h3.vr-tit",
    "card": ".vrwrap, .rb, .vrResult",
    "root": "#main, #mainBody",
    "citation": "cite, .citeurl, .fb, .cite, .citeLinkClass",
    "targetAttrs": [],
    "queryExclusion": false
  },
  {
    "id": "so",
    "label": "360 搜索",
    "hosts": [
      "so.com",
      "www.so.com",
      "m.so.com"
    ],
    "paths": [
      "/s"
    ],
    "query": [
      "q"
    ],
    "title": "h3.res-title",
    "card": "li.res-list, div.res-list",
    "root": "#main",
    "citation": "cite, .res-linkinfo, .res-site, .res-url",
    "targetAttrs": [
      "data-mdurl"
    ],
    "queryExclusion": false
  },
  {
    "id": "shenma",
    "label": "神马",
    "hosts": [
      "m.sm.cn",
      "sm.cn",
      "www.sm.cn"
    ],
    "paths": [
      "/s"
    ],
    "query": [
      "q"
    ],
    "title": ".qk-title-text",
    "card": ".sc[data-tpl=\"structure_template_normal\"]",
    "root": "#content",
    "citation": "cite",
    "targetAttrs": [],
    "queryExclusion": false
  },
  {
    "id": "ecosia",
    "label": "Ecosia",
    "hosts": [
      "www.ecosia.org",
      "ecosia.org"
    ],
    "paths": [
      "/search"
    ],
    "query": [
      "q"
    ],
    "title": "h2",
    "card": ".result",
    "root": "",
    "citation": ".result__url, cite",
    "targetAttrs": [],
    "queryExclusion": true
  },
  {
    "id": "startpage",
    "label": "Startpage",
    "hosts": [
      "www.startpage.com",
      "startpage.com"
    ],
    "paths": [
      "/sp/search",
      "/do/dsearch"
    ],
    "query": [
      "query"
    ],
    "title": "h2",
    "card": ".result",
    "root": ".w-gl, .w-bg",
    "citation": ".result-url, cite",
    "targetAttrs": [],
    "queryExclusion": true
  }
];
function sfEngine(id) { return sfEngines.filter(function (entry) { return entry.id === id; })[0] || null; }
function sfEngineEntry(host, path) {
  return sfEngines.filter(function (entry) { return entry.hosts.indexOf(host) >= 0 && entry.paths.indexOf(path) >= 0; })[0] || null;
}
function sfEngineQuery(entry, parameters) {
  var keys = entry.query.filter(function (key) { return Object.prototype.hasOwnProperty.call(parameters, key); });
  return keys.length === 1 && parameters[keys[0]].trim() ? keys[0] : '';
}
function sfEngineWeb(entry, parameters) {
  if (entry.id === 'google' && (parameters.tbm || (parameters.udm && parameters.udm !== '14'))) return false;
  if (entry.id === 'baidu' && parameters.tn && parameters.tn !== 'baidu' && parameters.tn !== 'baidulocal') return false;
  if (entry.id === 'duckduckgo' && ((parameters.ia && parameters.ia !== 'web') || (parameters.iar && parameters.iar !== 'web') || (parameters.iax && parameters.iax !== 'web'))) return false;
  if (entry.id === 'startpage' && parameters.cat && parameters.cat !== 'web') return false;
  if (entry.id === 'shenma' && parameters.uc_param_str && parameters.from === 'video') return false;
  return true;
}
function sfEngineSelection(settings) {
  var selected = {};
  sfEngines.forEach(function (entry) { selected[entry.id] = settings.engines[entry.id] === true; });
  return { engines: selected, query_exclusion: settings.query_exclusion, subscription_url: settings.subscription_url };
}
// END GENERATED SEARCH ENGINES CORE

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
  var event = { time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time || '') ? input.time : new Date().toISOString(), version: ['1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5'].indexOf(input.version) >= 0 ? input.version : '1.1.0', phase: input.phase, reason: input.reason };
  if (sfEngines.some(function (entry) { return entry.id === input.engine; })) event.engine = input.engine;
  var hosts = sfEngines.reduce(function (list, entry) { return list.concat(entry.hosts); }, []);
  if (hosts.indexOf(input.host) >= 0) event.host = input.host;
  if (sfEngines.some(function (entry) { return entry.paths.indexOf(input.path) >= 0; })) event.path = input.path;
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
    $notification.post('搜索屏蔽开发日志 v1.1.0', '已自动开始记录', '点击打开本地日志页。重新搜索后可刷新、导出脱敏记录。', { openUrl: 'http://search-filter-logs.invalid/' });
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

// BEGIN GENERATED SEARCH RULES CORE
/* Explicit line-based rules shared by request, response and subscription. */
function sfRuleValid(rule) {
  if (!rule || typeof rule.value !== 'string' || rule.value.length > 253) return false;
  var label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (rule.kind === 'key') return label.test(rule.value) && /[a-z]/.test(rule.value);
  if (rule.kind !== 'url') return false;
  var labels = rule.value.split('.');
  return labels.length >= 2 && labels.every(function (value) { return label.test(value); }) && /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[labels.length - 1]);
}
function sfRuleParseLine(line, subscription) {
  line = line.trim();
  var item = /^(domain-keyword|domian-keyword|domain-keywrod|domian-keywrod|domain-suffix): +([^\s]+)$/i.exec(line);
  var kind, value;
  if (item) { kind = item[1].toLowerCase() === 'domain-suffix' ? 'url' : 'key'; value = item[2]; }
  else if (subscription) {
    // Retain explicitly typed old subscription entries, without wildcards.
    item = /^\[(key|url): +([^\]\s]+)\s*\]$/i.exec(line);
    if (item) { kind = item[1].toLowerCase(); value = item[2]; }
  }
  if (!value) return null;
  var rule = { kind: kind, value: value.toLowerCase().replace(/\.$/, '') };
  return sfRuleValid(rule) ? rule : null;
}
function sfRuleParseList(raw, subscription) {
  var rules = [], invalid = false;
  raw.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach(function (line) {
    line = line.trim();
    if (!line || /^(?:#|\/\/)/.test(line)) return;
    var rule = sfRuleParseLine(line, subscription);
    if (!rule) { invalid = true; return; }
    if (!rules.some(function (current) { return current.kind === rule.kind && current.value === rule.value; })) rules.push(rule);
  });
  return { rules: rules, invalid: invalid };
}
function sfRuleLocalList(args) {
  if (typeof $persistentStore !== 'undefined') {
    try {
      var stored = $persistentStore.read('search-filter.blacklist.v1');
      if (stored && stored.length <= 65536) {
        var state = JSON.parse(stored);
        if (state && state.schema === 1 && state.override === true && Array.isArray(state.rules) && state.rules.length <= 100 && state.rules.every(sfRuleValid)) return { rules: state.rules.map(function (rule) { return { kind: rule.kind, value: rule.value }; }), invalid: false, limited: false, source: 'editor' };
      }
    } catch (_) { /* Invalid editor storage keeps the plugin parameter usable. */ }
  }
  var raw = String(args.blocked_domains || '');
  if (raw.length > 8192) return { rules: [], invalid: true, limited: true, source: 'plugin' };
  var result = sfRuleParseList(raw, false);
  result.limited = result.rules.length > 100; result.source = 'plugin';
  return result;
}
function sfSubscriptionURL(value) {
  return typeof value === 'string' && (!value || /^https:\/\/[a-z0-9.-]+(?::443)?(?:\/[^\s#]*)?$/i.test(value));
}
function sfSettingsValid(settings) {
  return settings && settings.engines && ['google', 'bing', 'baidu'].every(function (engine) { return typeof settings.engines[engine] === 'boolean'; }) && sfEngines.every(function (entry) { return settings.engines[entry.id] === undefined || typeof settings.engines[entry.id] === 'boolean'; }) && typeof settings.query_exclusion === 'boolean' && sfSubscriptionURL(settings.subscription_url);
}
function sfRuleSettings(args) {
  args = args || {};
  var on = function (value) { return value === true || value === 'true'; };
  var selected = {};
  sfEngines.forEach(function (entry) { selected[entry.id] = args[entry.id + '_enabled'] === undefined ? ['google', 'bing', 'baidu'].indexOf(entry.id) >= 0 : on(args[entry.id + '_enabled']); });
  var result = { engines: selected, query_exclusion: on(args.query_exclusion), subscription_url: String(args.subscription_url || '').trim() };
  if (typeof $persistentStore !== 'undefined') {
    try {
      var raw = $persistentStore.read('search-filter.blacklist.v1');
      if (raw && raw.length <= 65536) {
        var state = JSON.parse(raw), settings = state && state.settings;
        if (state && state.schema === 1 && sfSettingsValid(settings)) result = sfEngineSelection(settings);
      }
    } catch (_) { /* Keep fixed defaults if settings cannot be read. */ }
  }
  return result;
}
// END GENERATED SEARCH RULES CORE

// BEGIN GENERATED SEARCH SUBSCRIPTION CORE
/* Public text subscription; callback carries fixed outcome codes, never raw errors. */
function sfSubscriptionRefresh(source, complete) {
  if (!source || !sfSubscriptionURL(source)) return complete('subscription-invalid');
  try {
    $httpClient.get({ url: source, headers: { Accept: 'text/plain' }, timeout: 10000, 'auto-cookie': false, insecure: false }, function (error, response, body) {
      if (error || !response || Number(response.status || response.statusCode) !== 200 || typeof body !== 'string' || body.length > 256 * 1024) return complete('download-failed');
      var parsed = sfRuleParseList(body, true);
      if (parsed.invalid || parsed.rules.length > 100) return complete('format-invalid');
      try {
        var record = { source: source, rules: parsed.rules, updated_at: new Date().toISOString() };
        if ($persistentStore.write(JSON.stringify(record), 'search-filter.subscription.v1') !== true) return complete('storage-failed');
        return complete('updated', parsed.rules.length);
      } catch (_) { return complete('storage-failed'); }
    });
  } catch (_) { return complete('download-failed'); }
}
// END GENERATED SEARCH SUBSCRIPTION CORE

/* 搜索结果屏蔽订阅 v1.1.0. Downloads only when explicitly configured. */
(function () {
  'use strict';
  var args = typeof $argument === 'object' && $argument ? $argument : {};
  var messages = { 'subscription-invalid': '未填写有效的 HTTPS 订阅 URL；未更新缓存。', 'download-failed': '订阅下载失败或正文超限；保留上次有效名单。', 'format-invalid': '订阅格式无效或超过 100 条；保留上次有效名单。', 'storage-failed': '缓存保存失败；保留上次有效名单。' };
  sfSubscriptionRefresh(sfRuleSettings(args).subscription_url, function (reason, rules) {
    sfLogRecord(args, { phase: 'subscription', reason: reason, rules: rules });
    $done({ title: '搜索屏蔽订阅', content: reason === 'updated' ? '已更新 ' + rules + ' 条订阅规则。重新加载搜索页后生效。' : messages[reason] });
  });
}());
