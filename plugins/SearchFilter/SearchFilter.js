/* 搜索网站排除 v1.0.0 — Loon request script.
 * Docs: https://nsloon.app/docs/Script/script_api/
 * Only edits GET search query parameters; never logs search text.
 */
(function () {
  'use strict';
  var result = {};
  try {
    var args = typeof $argument === 'object' && $argument ? $argument : {};
    var request = typeof $request === 'object' && $request ? $request : {};
    var enabled = function (value) { return value === true || value === 'true'; };
    if (!enabled(args.enabled) || !enabled(args.query_exclusion) || request.method !== 'GET') return $done(result);
    var raw = String(args.blocked_domains || '');
    if (raw.length > 8192) return $done(result);
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
    if (domains.length > 100) return $done(result);
    if (typeof $persistentStore !== 'undefined' && String(args.subscription_url || '').trim()) {
      try {
        var cache = JSON.parse($persistentStore.read('search-filter.subscription.v1') || '{}');
        if (cache.source === String(args.subscription_url).trim() && Array.isArray(cache.rules) && cache.rules.length <= 100) cache.rules.forEach(function (rule) {
          if (rule && rule.kind === 'url' && typeof rule.value === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rule.value) && domains.indexOf(rule.value) < 0) domains.push(rule.value);
        });
      } catch (_) { /* Keep local domains. */ }
    }
    if (!domains.length) return $done(result);
    var url = String(request.url || '');
    var parsed = /^(https:\/\/([^/:?#]+)(?::443)?)(\/[^?#]*)\?([^#]*)(#.*)?$/i.exec(url);
    if (!parsed) return $done(result);
    var host = parsed[2].toLowerCase(), path = parsed[3], engine = '';
    if (/^(?:www\.)?google\.(?:com|com\.hk|com\.tw|co\.jp|co\.uk)$/.test(host) && path === '/search') engine = 'google';
    if (/^(?:www\.|cn\.)?bing\.com$/.test(host) && path === '/search') engine = 'bing';
    if (/^(?:www\.|m\.)?baidu\.com$/.test(host) && path === '/s') engine = 'baidu';
    if (!engine || !enabled(args[engine + '_enabled'])) return $done(result);
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
    if (queryIndex < 0 || !query.trim()) return $done(result);
    if (engine === 'google' && (params.tbm || (params.udm && params.udm !== '14'))) return $done(result);
    if (engine === 'baidu' && params.tn && params.tn !== 'baidu' && params.tn !== 'baidulocal') return $done(result);
    // Quoted text is not an active exclusion; malformed quotes pass through.
    var quoted = false, unquoted = '';
    for (var i = 0; i < query.length; i++) {
      if (query[i] === '"') { quoted = !quoted; unquoted += ' '; }
      else unquoted += quoted ? ' ' : query[i];
    }
    if (quoted) return $done(result);
    var existing = [], operator = /(?:^|\s)-site:([a-z0-9.-]+)(?=\s|$)/gi, found;
    while ((found = operator.exec(unquoted))) existing.push(found[1].toLowerCase().replace(/\.$/, ''));
    var missing = domains.filter(function (domain) { return existing.indexOf(domain) < 0; });
    if (!missing.length) return $done(result);
    var next = query + ' ' + missing.map(function (domain) { return '-site:' + domain; }).join(' ');
    // Preserve every other parameter byte-for-byte, including tracking/pagination.
    parts[queryIndex] = parts[queryIndex].slice(0, parts[queryIndex].indexOf('=') + 1) + encodeURIComponent(next);
    var rewritten = parsed[1] + path + '?' + parts.join('&') + (parsed[5] || '');
    if (rewritten.length <= 16384) result = { url: rewritten };
  } catch (_) {
    // Unknown inputs or invalid encoding must not interrupt browsing.
  }
  $done(result);
}());
