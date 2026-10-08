// BEGIN GENERATED SEARCH LOG CORE
/* Privacy allowlist shared by the generated Loon scripts. */
function sfLogFresh() {
  return { schema: 1, active: true, token: Date.now().toString(36) + Math.random().toString(36).slice(2), evicted: 0, events: [] };
}
function sfLogClean(input) {
  if (!input || typeof input !== 'object') return null;
  var phases = ['request', 'response', 'subscription'];
  var reasons = ['captured', 'disabled', 'query-disabled', 'rewritten', 'unchanged', 'error', 'non-get', 'non-web', 'non-html', 'http-status', 'body-limit', 'body-fragment', 'already-injected', 'no-rules', 'rules-limit', 'invalid-input', 'csp-blocked', 'injected', 'static-removed', 'static-and-injected', 'subscription-invalid', 'download-failed', 'format-invalid', 'storage-failed', 'updated'];
  if (phases.indexOf(input.phase) < 0 || reasons.indexOf(input.reason) < 0) return null;
  var event = { time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time || '') ? input.time : new Date().toISOString(), version: input.version === '1.0.1' ? '1.0.1' : '1.0.2', phase: input.phase, reason: input.reason };
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

// BEGIN GENERATED SEARCH HTML CORE
/* Native HTML filtering before the response reaches the browser.
 * Tokenize tags and raw-text boundaries; never regex-delete across result cards.
 * Unknown, malformed and mixed result blocks are retained.
 */
function sfDomainMatches(host, rules) {
  if (!host) return false;
  return rules.some(function (entry) {
    var rule = entry.value;
    if (entry.kind === 'key') { var labels = host.split('.'); return labels.length >= 2 && labels[labels.length - 2] === rule; }
    if (rule.indexOf('*') < 0) return host === rule || host.slice(-(rule.length + 1)) === '.' + rule;
    var suffix = rule.slice(0, 2) === '*.' ? rule.slice(2) : rule;
    var pattern = suffix.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*');
    return new RegExp('^' + (rule.slice(0, 2) === '*.' ? '(?:[^.]+\\.)*' : '') + pattern + '$', 'i').test(host);
  });
}
function sfHTMLEntities(text) {
  return text.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[a-f\d]+);/gi, function (entity) {
    var key = entity.slice(1, -1).toLowerCase();
    var values = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    var code = key.slice(0, 2) === '#x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}
function sfHTMLURLHost(value, pageHost, depth) {
  if (!value || (depth || 0) > 3) return '';
  value = sfHTMLEntities(value).trim();
  var parsed = /^(?:https?:)?\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i.exec(value);
  var authority = parsed && /^([^:@]+)(?::(\d+))?$/.exec(parsed[1]);
  // Reject ambiguous authorities, credentials and invalid ports instead of
  // interpreting a URL username as the destination hostname.
  if (parsed && (!authority || (authority[2] && Number(authority[2]) > 65535))) return '';
  var host = parsed ? authority[1].toLowerCase().replace(/\.$/, '') : pageHost;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)) return '';
  var path = parsed ? parsed[2] || '/' : value.split(/[?#]/)[0];
  var query = parsed ? parsed[3] || '' : (value.split('?')[1] || '').split('#')[0];
  var google = /^(?:www\.)?google\.(?:com|com\.hk|com\.tw|co\.jp|co\.uk)$/.test(host);
  if (google && path === '/url') {
    var target = '';
    query.split('&').some(function (part) {
      var match = /^(?:q|url)=(.*)$/.exec(part);
      if (!match) return false;
      try { target = decodeURIComponent(match[1].replace(/\+/g, ' ')); } catch (_) {}
      return /^https?:\/\//i.test(target);
    });
    return /^https?:\/\//i.test(target) ? sfHTMLURLHost(target, pageHost, (depth || 0) + 1) : '';
  }
  if (!parsed || host === pageHost || /^(?:www\.|m\.)?baidu\.com$/.test(host)) return '';
  return host;
}
function sfHTMLDisplayedHost(markup, pageHost) {
  var text = sfHTMLEntities(markup.replace(/<[^>]*>/g, '')).trim();
  var match = /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+))(?=$|[\/\s›>])/i.exec(text);
  return match ? sfHTMLURLHost('https://' + match[1], pageHost) : '';
}
function sfFilterHTML(html, engine, pageHost, rules) {
  // Start with Google; Bing/Baidu retain the existing browser filter.
  var result = { body: html, recognized: 0, removed: 0, unresolved: 0 };
  if (engine !== 'google') return result;
  var tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  var stack = [], nodes = [], headings = [], match, count = 0;
  var voidTags = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
  while ((match = tokens.exec(html))) {
    if (++count > 60000 || stack.length > 256) return result;
    if (!match[1]) continue;
    var tag = match[1].toLowerCase(), closing = /^<\//.test(match[0]);
    if (closing) {
      for (var index = stack.length - 1; index >= 0; index--) {
        if (stack[index].tag === tag) {
          // Unmatched children are incomplete and cannot be removed safely.
          if (index !== stack.length - 1) stack.forEach(function (item) { item.invalid = true; });
          var node = stack[index]; node.end = tokens.lastIndex; node.close = match.index;
          stack.length = index;
          break;
        }
      }
      continue;
    }
    var attributes = Object.create(null), attribute;
    var attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    var attributeText = match[0].slice(tag.length + 1, -1);
    while ((attribute = attributePattern.exec(attributeText))) {
      var name = attribute[1].toLowerCase();
      if (['class', 'id', 'href', 'data-sokoban-container'].indexOf(name) >= 0 && !Object.prototype.hasOwnProperty.call(attributes, name)) attributes[name] = attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] : attribute[4] || '';
    }
    var current = { tag: tag, attrs: attributes, start: match.index, open: tokens.lastIndex, end: 0, close: 0, parent: stack.length ? stack[stack.length - 1] : null, titles: 0 };
    nodes.push(current);
    if (tag === 'h3') {
      headings.push(current);
      for (var ancestor = current.parent; ancestor; ancestor = ancestor.parent) ancestor.titles++;
    }
    if (tag === 'template') {
      // Templates may nest. They are inert; never treat their headings as results.
      var depth = 1, inert;
      while (depth && (inert = tokens.exec(html))) {
        if (++count > 60000) return result;
        var inertTag = (inert[1] || '').toLowerCase();
        if (inertTag === 'template') depth += /^<\//.test(inert[0]) ? -1 : 1;
        else if (!/^<\//.test(inert[0]) && /^(?:script|style|textarea|title|noscript)$/.test(inertTag)) {
          var inertEnd = new RegExp('</' + inertTag + '\\s*>', 'gi'); inertEnd.lastIndex = tokens.lastIndex;
          if (!inertEnd.exec(html)) return result;
          tokens.lastIndex = inertEnd.lastIndex;
        }
      }
      if (depth) return result;
      current.end = tokens.lastIndex; current.close = inert.index;
    } else if (/^(?:script|style|textarea|title|noscript)$/.test(tag)) {
      // Ignore script text, styles and inert templates, including fake HTML.
      var endPattern = new RegExp('</' + tag + '\\s*>', 'gi'); endPattern.lastIndex = tokens.lastIndex;
      var rawEnd = endPattern.exec(html);
      if (!rawEnd) return result;
      tokens.lastIndex = endPattern.lastIndex; current.end = tokens.lastIndex; current.close = rawEnd.index;
    } else if (!voidTags.test(tag)) stack.push(current);
  }
  var ranges = [], seen = [];
  headings.forEach(function (heading) {
    var card = null, link = null, root = null;
    for (var ancestor = heading.parent; ancestor; ancestor = ancestor.parent) {
      if (!link && ancestor.tag === 'a') link = ancestor;
      if (!card && ancestor.tag === 'div' && (/(?:^|\s)(?:g|MjjYud|tF2Cxc)(?:\s|$)/.test(ancestor.attrs['class'] || '') || Object.prototype.hasOwnProperty.call(ancestor.attrs, 'data-sokoban-container'))) card = ancestor;
      if (!root && (ancestor.attrs.id === 'search' || ancestor.attrs.id === 'rso' || ancestor.attrs.id === 'main')) root = ancestor;
    }
    if (!root || !root.end || root.invalid || !card || !link || !card.end || card.invalid || !heading.end || card.titles !== 1 || seen.indexOf(card) >= 0) return;
    seen.push(card); result.recognized++;
    var host = sfHTMLURLHost(link.attrs.href || '', pageHost);
    if (!host) {
      var low = 0, high = nodes.length, cites = [];
      while (low < high) { var middle = Math.floor((low + high) / 2); if (nodes[middle].start < card.open) low = middle + 1; else high = middle; }
      for (var n = low; n < nodes.length && nodes[n].start < card.close; n++) {
        if (nodes[n].tag === 'cite' && nodes[n].end && nodes[n].end <= card.close) cites.push(nodes[n]);
      }
      var primary = cites.filter(function (node) { return node.start >= link.open && node.end <= link.close; });
      var values = (primary.length ? primary : cites).map(function (node) { return sfHTMLDisplayedHost(html.slice(node.open, node.close), pageHost); }).filter(Boolean);
      // Conflicting destination citations are retained, never guessed.
      if (values.length && values.every(function (value) { return value === values[0]; })) host = values[0];
    }
    if (!host) { result.unresolved++; return; }
    if (sfDomainMatches(host, rules)) ranges.push([card.start, card.end]);
  });
  ranges.sort(function (a, b) { return a[0] - b[0]; });
  var end = 0, pieces = [];
  ranges.forEach(function (range) { if (range[0] >= end) { pieces.push(html.slice(end, range[0])); end = range[1]; result.removed++; } });
  pieces.push(html.slice(end)); result.body = pieces.join('');
  return result;
}
// END GENERATED SEARCH HTML CORE

/* 搜索结果网站屏蔽 v1.0.2 — Loon HTML response script.
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
    var filtered = sfFilterHTML(body, engine, host, rules);
    body = filtered.body;
    if (engine === 'google') {
      logMeta.recognized = filtered.recognized;
      logMeta.removed = filtered.removed;
      logMeta.unresolved = filtered.unresolved;
    }
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
    if (!allowed) return finish(filtered.removed ? { body: body } : output, filtered.removed ? 'static-removed' : 'csp-blocked');
    var config = JSON.stringify({ engine: engine, rules: rules }).replace(/</g, '\\u003c');
    var script = '<script id="loon-search-filter"' + (nonce ? ' nonce="' + nonce + '"' : '') + '>(' + browserFilter.toString() + ')(' + config + ');</script>';
    output = { body: body.replace(/<\/body\s*>/i, function (end) { return script + end; }) };
  } catch (_) { return finish(output, 'error'); }
  finish(output, filtered.removed ? 'static-and-injected' : 'injected');

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
      var headingSelector = config.engine === 'bing' ? 'li.b_algo h2' : config.engine === 'baidu' ? '.result h3, .c-container h3' : '#search h3, #rso h3, #main h3';
      document.querySelectorAll(headingSelector).forEach(function (heading) {
        var link = heading.closest('a') || heading.querySelector('a');
        if (!link) return;
        var card = heading.closest(config.engine === 'bing' ? 'li.b_algo' : config.engine === 'baidu' ? '.result, .c-container' : '.g, .MjjYud, .tF2Cxc, [data-sokoban-container]');
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
