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
  var event = { time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time || '') ? input.time : new Date().toISOString(), version: ['1.0.1', '1.0.2', '1.0.3', '1.0.4'].indexOf(input.version) >= 0 ? input.version : '1.0.5', phase: input.phase, reason: input.reason };
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
    $notification.post('搜索屏蔽开发日志 v1.0.5', '已自动开始记录', '点击打开本地日志页。重新搜索后可刷新、导出脱敏记录。', { openUrl: 'http://search-filter-logs.invalid/' });
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
  return settings && settings.engines && ['google', 'bing', 'baidu'].every(function (engine) { return typeof settings.engines[engine] === 'boolean'; }) && typeof settings.query_exclusion === 'boolean' && sfSubscriptionURL(settings.subscription_url);
}
function sfRuleSettings(args) {
  args = args || {};
  var on = function (value) { return value === true || value === 'true'; };
  var result = { engines: { google: args.google_enabled === undefined ? true : on(args.google_enabled), bing: args.bing_enabled === undefined ? true : on(args.bing_enabled), baidu: args.baidu_enabled === undefined ? true : on(args.baidu_enabled) }, query_exclusion: on(args.query_exclusion), subscription_url: String(args.subscription_url || '').trim() };
  if (typeof $persistentStore !== 'undefined') {
    try {
      var raw = $persistentStore.read('search-filter.blacklist.v1');
      if (raw && raw.length <= 65536) {
        var state = JSON.parse(raw), settings = state && state.settings;
        if (state && state.schema === 1 && sfSettingsValid(settings)) result = { engines: { google: settings.engines.google, bing: settings.engines.bing, baidu: settings.engines.baidu }, query_exclusion: settings.query_exclusion, subscription_url: settings.subscription_url };
      }
    } catch (_) { /* Keep fixed defaults if settings cannot be read. */ }
  }
  return result;
}
// END GENERATED SEARCH RULES CORE

/* 搜索网站排除 v1.0.5 — Loon request script.
 * Docs: https://nsloon.app/docs/Script/script_api/
 * Only edits GET search query parameters; never logs search text.
 */
(function () {
  'use strict';
  var result = {};
  var logMeta = null;
  function finish(value, reason) {
    if (logMeta) sfLogRecord(args, Object.assign({}, logMeta, { reason: reason || (value.url ? 'rewritten' : 'unchanged') }));
    $done(value);
  }
  try {
    var args = typeof $argument === 'object' && $argument ? $argument : {};
    var settings = sfRuleSettings(args);
    var request = typeof $request === 'object' && $request ? $request : {};
    var url = String(request.url || '');
    var parsed = /^(https:\/\/([^/:?#]+)(?::443)?)(\/[^?#]*)\?([^#]*)(#.*)?$/i.exec(url);
    if (!parsed) return finish(result);
    var host = parsed[2].toLowerCase(), path = parsed[3], engine = '';
    if (/^(?:www\.)?google\.(?:com|com\.hk|com\.tw|co\.jp|co\.uk)$/.test(host) && path === '/search') engine = 'google';
    if (/^(?:www\.|cn\.)?bing\.com$/.test(host) && path === '/search') engine = 'bing';
    if (/^(?:www\.|m\.)?baidu\.com$/.test(host) && path === '/s') engine = 'baidu';
    if (!engine) return finish(result);
    logMeta = { phase: 'request', engine: engine, host: host, path: path };
    if (!settings.engines[engine]) return finish(result, 'disabled');
    if (request.method !== 'GET') return finish(result, 'non-get');
    if (!settings.query_exclusion) return finish(result, 'query-disabled');
    var local = sfRuleLocalList(args);
    if (local.limited) return finish(result, 'rules-limit');
    var domains = local.rules.filter(function (rule) { return rule.kind === 'url'; }).map(function (rule) { return rule.value; });
    if (domains.length > 100) return finish(result);
    if (typeof $persistentStore !== 'undefined' && settings.subscription_url) {
      try {
        var cache = JSON.parse($persistentStore.read('search-filter.subscription.v1') || '{}');
        if (cache.source === settings.subscription_url && Array.isArray(cache.rules) && cache.rules.length <= 100) cache.rules.forEach(function (rule) {
          if (sfRuleValid(rule) && rule.kind === 'url' && domains.indexOf(rule.value) < 0) domains.push(rule.value);
        });
      } catch (_) { /* Keep local domains. */ }
    }
    if (!domains.length) return finish(result);
    var parts = parsed[4].split('&'), queryIndex = -1, query = '', params = Object.create(null);
    function decode(value) { return decodeURIComponent(value.replace(/\+/g, ' ')); }
    parts.forEach(function (part, index) {
      var equal = part.indexOf('='), key = decode(equal < 0 ? part : part.slice(0, equal));
      var value = decode(equal < 0 ? '' : part.slice(equal + 1));
      if (Object.prototype.hasOwnProperty.call(params, key)) throw new Error('duplicate parameter');
      params[key] = value;
      if (engine === 'baidu' ? (key === 'wd' || key === 'word') : key === 'q') {
        if (queryIndex >= 0) throw new Error('ambiguous query');
        queryIndex = index; query = value;
      }
    });
    if (queryIndex < 0 || !query.trim()) return finish(result);
    if (engine === 'google' && (params.tbm || (params.udm && params.udm !== '14'))) return finish(result);
    if (engine === 'baidu' && params.tn && params.tn !== 'baidu' && params.tn !== 'baidulocal') return finish(result);
    // Quoted text is not an active exclusion; malformed quotes pass through.
    var quoted = false, unquoted = '';
    for (var i = 0; i < query.length; i++) {
      if (query[i] === '"') { quoted = !quoted; unquoted += ' '; }
      else unquoted += quoted ? ' ' : query[i];
    }
    if (quoted) return finish(result);
    var existing = [], operator = /(?:^|\s)-site:([a-z0-9.-]+)(?=\s|$)/gi, found;
    while ((found = operator.exec(unquoted))) existing.push(found[1].toLowerCase().replace(/\.$/, ''));
    var missing = domains.filter(function (domain) { return existing.indexOf(domain) < 0; });
    if (!missing.length) return finish(result);
    var next = query + ' ' + missing.map(function (domain) { return '-site:' + domain; }).join(' ');
    // Preserve every other parameter byte-for-byte, including tracking/pagination.
    parts[queryIndex] = parts[queryIndex].slice(0, parts[queryIndex].indexOf('=') + 1) + encodeURIComponent(next);
    var rewritten = parsed[1] + path + '?' + parts.join('&') + (parsed[5] || '');
    if (rewritten.length <= 16384) result = { url: rewritten };
  } catch (_) {
    // Unknown inputs or invalid encoding must not interrupt browsing.
    return finish(result, 'error');
  }
  finish(result);
}());
