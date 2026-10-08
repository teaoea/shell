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

/* 搜索结果网站屏蔽 v1.0.1 — Loon HTML response script.
 * Domain matching happens locally in the browser. No remote requests or logs.
 */
(function () {
  'use strict';
  var output = {};
  var logMeta = null;
  function finish(value, reason) {
    if (logMeta) sfLogRecord(args, Object.assign({}, logMeta, { reason: reason || 'unchanged' }));
    $done(value);
  }
  try {
    var args = typeof $argument === 'object' && $argument ? $argument : {};
    var request = typeof $request === 'object' && $request ? $request : {};
    var response = typeof $response === 'object' && $response ? $response : {};
    function on(value) { return value === true || value === 'true'; }
    var match = /^https:\/\/([^/:?#]+)(?::443)?(\/[^?#]*)\?/i.exec(request.url || '');
    if (!on(args.enabled) || request.method !== 'GET' || !match || typeof response.body !== 'string') return $done(output);
    var host = match[1].toLowerCase(), engine = '';
    if (/^(?:www\.)?google\.(?:com|com\.hk|com\.tw|co\.jp|co\.uk)$/.test(host) && match[2] === '/search') engine = 'google';
    if (/^(?:www\.|cn\.)?bing\.com$/.test(host) && match[2] === '/search') engine = 'bing';
    if (/^(?:www\.|m\.)?baidu\.com$/.test(host) && match[2] === '/s') engine = 'baidu';
    if (!engine) return finish(output);
    logMeta = { phase: 'response', engine: engine, host: host, path: match[2], status: Number(response.status || response.statusCode || 200) };
    if (!on(args[engine + '_enabled'])) return finish(output, 'disabled');
    var parameters = Object.create(null);
    String(request.url).split('?').slice(1).join('?').split('#')[0].split('&').forEach(function (part) {
      var equal = part.indexOf('='), key = decodeURIComponent((equal < 0 ? part : part.slice(0, equal)).replace(/\+/g, ' '));
      if (Object.prototype.hasOwnProperty.call(parameters, key)) throw new Error('duplicate parameter');
      parameters[key] = decodeURIComponent((equal < 0 ? '' : part.slice(equal + 1)).replace(/\+/g, ' '));
    });
    if (engine === 'baidu' ? !(parameters.wd || parameters.word) || (parameters.wd && parameters.word) : !parameters.q) return finish(output, 'invalid-input');
    if (engine === 'google' && (parameters.tbm || (parameters.udm && parameters.udm !== '14'))) return finish(output, 'non-web');
    if (engine === 'baidu' && parameters.tn && parameters.tn !== 'baidu' && parameters.tn !== 'baidulocal') return finish(output, 'non-web');
    var status = Number(response.status || response.statusCode || 200);
    if (status !== 200) return finish(output, 'http-status');
    var headers = response.headers || {}, contentType = '';
    Object.keys(headers).forEach(function (key) { if (key.toLowerCase() === 'content-type') contentType = headers[key]; });
    if (!/^text\/html\b/i.test(contentType)) return finish(output, 'non-html');
    var body = response.body;
    if (body.length > 4 * 1024 * 1024) return finish(output, 'body-limit');
    if (!/<\/body\s*>/i.test(body)) return finish(output, 'body-fragment');
    if (/id=["']loon-search-filter["']/i.test(body)) return finish(output, 'already-injected');
    var raw = String(args.blocked_domains || '');
    if (raw.length > 8192) return finish(output, 'rules-limit');
    var rules = [];
    raw.split(/[\s,，;；]+/).forEach(function (item) {
      var value = item.toLowerCase();
      if (/^https?:\/\//.test(value)) {
        var urlHost = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/.exec(value);
        value = urlHost ? urlHost[1] : '';
      }
      value = value.replace(/\.$/, '');
      // A bare word is a complete domain label, not a substring or page title.
      if (!value || value.length > 253 || !/^[a-z0-9*.-]+$/.test(value)) return;
      var labels = value.split('.');
      if (labels.some(function (label) { return !label || label.length > 63 || !/^(?:\*|[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?)$/.test(label); })) return;
      if (!/[a-z]/.test(value)) return;
      var kind = value.indexOf('.') < 0 && value.indexOf('*') < 0 ? 'key' : 'url';
      if (kind === 'url' && value.indexOf('.') < 0) return;
      if (!rules.some(function (rule) { return rule.kind === kind && rule.value === value; })) rules.push({ kind: kind, value: value });
    });
    if (rules.length > 100) return finish(output, 'rules-limit');
    if (typeof $persistentStore !== 'undefined' && String(args.subscription_url || '').trim()) {
      try {
        var cache = JSON.parse($persistentStore.read('search-filter.subscription.v1') || '{}');
        if (cache.source === String(args.subscription_url).trim() && Array.isArray(cache.rules) && cache.rules.length <= 100) {
          cache.rules.forEach(function (rule) {
            if (rule && /^(?:key|url)$/.test(rule.kind) && typeof rule.value === 'string' && /^[a-z0-9*.-]{1,253}$/.test(rule.value) && !rules.some(function (current) { return current.kind === rule.kind && current.value === rule.value; })) rules.push(rule);
          });
        }
      } catch (_) { /* Missing or invalid cache does not suppress local rules. */ }
    }
    logMeta.rules = rules.length;
    if (!rules.length) return finish(output, 'no-rules');
    // Preserve the page's CSP. Reuse an existing script nonce when available.
    // Without a nonce, only inject where inline scripts are already permitted.
    var nonceMatch = /<script\b[^>]*\bnonce\s*=\s*["']([a-zA-Z0-9+/_=-]+)["']/i.exec(body);
    var nonce = nonceMatch ? nonceMatch[1] : '';
    var policies = [];
    Object.keys(headers).forEach(function (key) { if (key.toLowerCase() === 'content-security-policy') policies.push(String(headers[key])); });
    var meta = /<meta\b[^>]*>/gi, tag;
    while ((tag = meta.exec(body))) {
      if (/http-equiv\s*=\s*["']content-security-policy["']/i.test(tag[0])) {
        var content = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag[0]);
        if (content) policies.push(content[2].replace(/&(?:quot|#34);/g, '"').replace(/&#39;|&apos;/g, "'"));
      }
    }
    var allowed = policies.every(function (policy) {
      var directives = {};
      policy.split(';').forEach(function (part) { var bits = part.trim().split(/\s+/); directives[bits.shift().toLowerCase()] = bits; });
      if (directives.sandbox && directives.sandbox.indexOf('allow-scripts') < 0) return false;
      var sources = directives['script-src-elem'] || directives['script-src'] || directives['default-src'];
      if (!sources) return true;
      if (nonce && sources.indexOf("'nonce-" + nonce + "'") >= 0) return true;
      return sources.indexOf("'unsafe-inline'") >= 0 && !sources.some(function (source) { return /^'(?:nonce-|sha(?:256|384|512)-)/.test(source); });
    });
    if (!allowed) return finish(output, 'csp-blocked');
    var config = JSON.stringify({ engine: engine, rules: rules }).replace(/</g, '\\u003c');
    var script = '<script id="loon-search-filter"' + (nonce ? ' nonce="' + nonce + '"' : '') + '>(' + browserFilter.toString() + ')(' + config + ');</script>';
    output = { body: body.replace(/<\/body\s*>/i, function (end) { return script + end; }) };
  } catch (_) { return finish(output, 'error'); }
  finish(output, 'injected');

  function browserFilter(config) {
    'use strict';
    var saved = new WeakMap();
    function restore(card) {
      var original = saved.get(card);
      if (!original) return;
      if (original.display) card.style.setProperty('display', original.display, original.priority);
      else card.style.removeProperty('display');
      if (original.aria === null) card.removeAttribute('aria-hidden');
      else card.setAttribute('aria-hidden', original.aria);
      card.removeAttribute('data-loon-search-filter');
      saved.delete(card);
    }
    function domainOf(value, depth) {
      try {
        if (!value || (depth || 0) > 3) return '';
        var url = new URL(value, location.href);
        if (!/^https?:$/.test(url.protocol)) return '';
        var host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (/^(?:www\.)?google\.(?:com|com\.hk|com\.tw|co\.jp|co\.uk)$/.test(host) && url.pathname === '/url') return domainOf(url.searchParams.get('q') || url.searchParams.get('url') || '', (depth || 0) + 1);
        if (/^(?:www\.|cn\.)?bing\.com$/.test(host) && url.pathname === '/ck/a') {
          var target = url.searchParams.get('u') || '';
          if (target.slice(0, 2) === 'a1') target = atob(target.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
          return /^https?:\/\//i.test(target) ? domainOf(target, (depth || 0) + 1) : '';
        }
        // Baidu redirect targets cannot be inferred from its opaque token.
        if (/^(?:www\.|m\.)?baidu\.com$/.test(host) || host === location.hostname.toLowerCase()) return '';
        return host;
      } catch (_) { return ''; }
    }
    function blocked(host) {
      if (!host) return false;
      return config.rules.some(function (entry) {
        var rule = entry.value;
        // "Second-level" here is precisely the label before the final suffix.
        if (entry.kind === 'key') { var labels = host.split('.'); return labels.length >= 2 && labels[labels.length - 2] === rule; }
        if (rule.indexOf('*') < 0) return host === rule || host.slice(-(rule.length + 1)) === '.' + rule;
        var suffix = rule.slice(0, 2) === '*.' ? rule.slice(2) : rule;
        var pattern = suffix.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*');
        // A leading *. includes the root as well as nested subdomains.
        return new RegExp('^' + (rule.slice(0, 2) === '*.' ? '(?:[^.]+\\.)*' : '') + pattern + '$', 'i').test(host);
      });
    }
    function scan() {
      var headingSelector = config.engine === 'bing' ? 'li.b_algo h2' : config.engine === 'baidu' ? '.result h3, .c-container h3' : '#search h3, #rso h3';
      document.querySelectorAll(headingSelector).forEach(function (heading) {
        var link = heading.closest('a') || heading.querySelector('a');
        if (!link) return;
        var card = heading.closest(config.engine === 'bing' ? 'li.b_algo' : config.engine === 'baidu' ? '.result, .c-container' : '.g, .MjjYud, [data-sokoban-container]');
        if (!card) return;
        if (card.querySelectorAll(config.engine === 'bing' ? 'h2' : 'h3').length !== 1) { restore(card); return; }
        var host = domainOf(link.getAttribute('href') || '');
        if (!host && config.engine === 'baidu') {
          var target = card.getAttribute('data-landurl') || link.getAttribute('data-landurl') || '';
          if (/^https?:\/\//i.test(target)) host = domainOf(target);
        }
        if (!host && (config.engine === 'google' || config.engine === 'baidu')) {
          // Google /goto?url=<opaque token> and Baidu redirects conceal targets.
          // Prefer the citation inside the title link, then the result citation;
          // never infer ownership from a brand name or snippet mentioning CSDN.
          var cite = link.querySelector('cite') || card.querySelector(config.engine === 'google' ? 'cite' : 'cite, .c-showurl, .c-showurl-color');
          var shown = cite ? cite.textContent.trim() : '';
          var displayed = /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+))(?=$|[\/\s›>])/i.exec(shown);
          if (displayed) host = domainOf('https://' + displayed[1]);
        }
        if (blocked(host)) {
          if (!saved.has(card)) saved.set(card, { display: card.style.getPropertyValue('display'), priority: card.style.getPropertyPriority('display'), aria: card.getAttribute('aria-hidden') });
          card.style.setProperty('display', 'none', 'important');
          card.setAttribute('aria-hidden', 'true');
          card.setAttribute('data-loon-search-filter', 'hidden');
        } else restore(card);
      });
    }
    var pending = false;
    scan();
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; scan(); }, 80);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-landurl'] });
  }
}());
