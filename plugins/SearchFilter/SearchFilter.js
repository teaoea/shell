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

/* 搜索网站排除 v1.0.1 — Loon request script.
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
    var request = typeof $request === 'object' && $request ? $request : {};
    var enabled = function (value) { return value === true || value === 'true'; };
    var url = String(request.url || '');
    var parsed = /^(https:\/\/([^/:?#]+)(?::443)?)(\/[^?#]*)\?([^#]*)(#.*)?$/i.exec(url);
    if (!parsed) return finish(result);
    var host = parsed[2].toLowerCase(), path = parsed[3], engine = '';
    if (/^(?:www\.)?google\.(?:com|com\.hk|com\.tw|co\.jp|co\.uk)$/.test(host) && path === '/search') engine = 'google';
    if (/^(?:www\.|cn\.)?bing\.com$/.test(host) && path === '/search') engine = 'bing';
    if (/^(?:www\.|m\.)?baidu\.com$/.test(host) && path === '/s') engine = 'baidu';
    if (!engine) return finish(result);
    logMeta = { phase: 'request', engine: engine, host: host, path: path };
    if (!enabled(args.enabled) || !enabled(args[engine + '_enabled'])) return finish(result, 'disabled');
    if (request.method !== 'GET') return finish(result, 'non-get');
    if (!enabled(args.query_exclusion)) return finish(result, 'query-disabled');
    var raw = String(args.blocked_domains || '');
    if (raw.length > 8192) return finish(result);
    var domains = [];
    raw.split(/[\s,，;；]+/).forEach(function (item) {
      var domain = item.toLowerCase();
      // URL input uses its literal host, never guesses an apex domain.
      if (/^https?:\/\//.test(domain)) {
        var match = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/.exec(domain);
        domain = match ? match[1] : '';
      }
      domain = domain.replace(/\.$/, '');
      if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return;
      if (domains.indexOf(domain) < 0) domains.push(domain);
    });
    if (domains.length > 100) return finish(result);
    if (typeof $persistentStore !== 'undefined' && String(args.subscription_url || '').trim()) {
      try {
        var cache = JSON.parse($persistentStore.read('search-filter.subscription.v1') || '{}');
        if (cache.source === String(args.subscription_url).trim() && Array.isArray(cache.rules) && cache.rules.length <= 100) cache.rules.forEach(function (rule) {
          if (rule && rule.kind === 'url' && typeof rule.value === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rule.value) && domains.indexOf(rule.value) < 0) domains.push(rule.value);
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
