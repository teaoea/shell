/* 搜索结果网站屏蔽 v1.0.0 — Loon HTML response script.
 * Domain matching happens locally in the browser. No remote requests or logs.
 */
(function () {
  'use strict';
  var output = {};
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
    if (!engine || !on(args[engine + '_enabled'])) return $done(output);
    var parameters = Object.create(null);
    String(request.url).split('?').slice(1).join('?').split('#')[0].split('&').forEach(function (part) {
      var equal = part.indexOf('='), key = decodeURIComponent((equal < 0 ? part : part.slice(0, equal)).replace(/\+/g, ' '));
      if (Object.prototype.hasOwnProperty.call(parameters, key)) throw new Error('duplicate parameter');
      parameters[key] = decodeURIComponent((equal < 0 ? '' : part.slice(equal + 1)).replace(/\+/g, ' '));
    });
    if (engine === 'baidu' ? !(parameters.wd || parameters.word) || (parameters.wd && parameters.word) : !parameters.q) return $done(output);
    if (engine === 'google' && (parameters.tbm || (parameters.udm && parameters.udm !== '14'))) return $done(output);
    if (engine === 'baidu' && parameters.tn && parameters.tn !== 'baidu' && parameters.tn !== 'baidulocal') return $done(output);
    var status = Number(response.status || response.statusCode || 200);
    if (status !== 200) return $done(output);
    var headers = response.headers || {}, contentType = '';
    Object.keys(headers).forEach(function (key) { if (key.toLowerCase() === 'content-type') contentType = headers[key]; });
    if (!/^text\/html\b/i.test(contentType)) return $done(output);
    var body = response.body;
    if (body.length > 4 * 1024 * 1024 || !/<\/body\s*>/i.test(body) || /id=["']loon-search-filter["']/i.test(body)) return $done(output);
    var raw = String(args.blocked_domains || '');
    if (raw.length > 8192) return $done(output);
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
    if (rules.length > 100) return $done(output);
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
    if (!rules.length) return $done(output);
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
    if (!allowed) return $done(output);
    var config = JSON.stringify({ engine: engine, rules: rules }).replace(/</g, '\\u003c');
    var script = '<script id="loon-search-filter"' + (nonce ? ' nonce="' + nonce + '"' : '') + '>(' + browserFilter.toString() + ')(' + config + ');</script>';
    output = { body: body.replace(/<\/body\s*>/i, function (end) { return script + end; }) };
  } catch (_) { /* Unsupported inputs pass through. */ }
  $done(output);

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
          if (!host) {
            // Use explicit displayed URL only, never a brand name such as CSDN.
            var cite = card.querySelector('cite, .c-showurl, .c-showurl-color');
            var shown = cite ? cite.textContent.trim() : '';
            var displayed = /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?=$|[\/\s›>])/i.exec(shown);
            if (displayed) host = displayed[1].toLowerCase();
          }
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
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-landurl'] });
  }
}());
