/* Native HTML filtering before the response reaches the browser.
 * Tokenize tags and raw-text boundaries; never regex-delete across result cards.
 * Unknown, malformed and mixed result blocks are retained.
 */
function sfDomainMatches(host, rules) {
  if (!host) return false;
  return rules.some(function (entry) {
    var rule = entry.value;
    if (entry.kind === 'key') { var labels = host.split('.'); return labels.length >= 2 && labels[labels.length - 2] === rule; }
    return entry.kind === 'url' && rule.indexOf('*') < 0 && (host === rule || host.slice(-(rule.length + 1)) === '.' + rule);
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
  var wrapped = (/^(?:www\.|cn\.)?bing\.com$/.test(host) && path === '/ck/a') || (/^(?:www\.|safe\.|start\.|noai\.|html\.)?duckduckgo\.com$/.test(host) && path === '/l/') || host === 'r.search.yahoo.com' || (/^(?:www\.|m\.)?sogou\.com$/.test(host) && /(?:^|\/)tc$/.test(path)) || (/^(?:www\.|m\.)?so\.com$/.test(host) && path === '/jump');
  var pageEngine = sfEngines.filter(function (entry) { return entry.hosts.indexOf(pageHost) >= 0; })[0];
  if (!wrapped) return !parsed || host === pageHost || (pageEngine && pageEngine.hosts.indexOf(host) >= 0) ? '' : host;
  var parameters = Object.create(null), malformed = false;
  query.split('&').forEach(function (part) {
    if (!part) return;
    try {
      var equal = part.indexOf('='), key = decodeURIComponent(equal < 0 ? part : part.slice(0, equal));
      if (Object.prototype.hasOwnProperty.call(parameters, key)) { malformed = true; return; }
      parameters[key] = decodeURIComponent((equal < 0 ? '' : part.slice(equal + 1)).replace(/\+/g, ' '));
    } catch (_) { malformed = true; }
  });
  if (malformed) return '';
  var target = '';
  if (/^(?:www\.|cn\.)?bing\.com$/.test(host) && path === '/ck/a') {
    target = parameters.u || '';
    if (target.slice(0, 2) === 'a1') {
      var text = target.slice(2).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      if (!/^[A-Za-z0-9+/]+$/.test(text) || text.length % 4 === 1) return '';
      var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = '', bits = 0, value = 0;
      for (var i = 0; i < text.length; i++) { value = (value << 6) | alphabet.indexOf(text[i]); bits += 6; if (bits >= 8) { bits -= 8; bytes += String.fromCharCode((value >> bits) & 255); } }
      target = bytes;
    }
  } else if (/^(?:www\.|safe\.|start\.|noai\.|html\.)?duckduckgo\.com$/.test(host) && path === '/l/') target = parameters.uddg || '';
  else if (host === 'r.search.yahoo.com') {
    var ru = /\/RU=([^/]+)(?:\/RK=|\/RS=|$)/.exec(path);
    try { target = ru ? decodeURIComponent(ru[1]) : ''; } catch (_) { return ''; }
  } else if (/^(?:www\.|m\.)?sogou\.com$/.test(host) && /(?:^|\/)tc$/.test(path)) target = parameters.url || parameters.pcurl || '';
  else if (/^(?:www\.|m\.)?so\.com$/.test(host) && path === '/jump') target = parameters.u || '';
  if (target) return /^https?:\/\//i.test(target) ? sfHTMLURLHost(target, pageHost, (depth || 0) + 1) : '';
  if (!parsed || host === pageHost || host === 'r.search.yahoo.com' || (pageEngine && pageEngine.hosts.indexOf(host) >= 0)) return '';
  return host;
}
function sfHTMLDisplayedHost(markup, pageHost) {
  var text = sfHTMLEntities(markup.replace(/<[^>]*>/g, '')).trim();
  var match = /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+))(?=$|[\/\s›>])/i.exec(text);
  return match ? sfHTMLURLHost('https://' + match[1], pageHost) : '';
}
function sfHTMLMatches(node, selectors) {
  return selectors.split(',').some(function (selector) {
    selector = selector.trim();
    if (!selector) return false;
    var tag = /^[a-z][a-z0-9-]*/i.exec(selector);
    if (tag && node.tag !== tag[0].toLowerCase()) return false;
    var checks = /([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g, match;
    while ((match = checks.exec(selector))) {
      if (match[1] === '#' && node.attrs.id !== match[2]) return false;
      if (match[1] === '.' && (' ' + (node.attrs['class'] || '') + ' ').replace(/\s+/g, ' ').indexOf(' ' + match[2] + ' ') < 0) return false;
      if (match[3] && (!Object.prototype.hasOwnProperty.call(node.attrs, match[3]) || (match[4] !== undefined && node.attrs[match[3]] !== match[4]))) return false;
    }
    return true;
  });
}
function sfFilterHTML(html, engine, pageHost, rules) {
  var result = { body: html, recognized: 0, removed: 0, unresolved: 0 };
  var adapter = sfEngine(engine);
  if (!adapter) return result;
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
      if (['class', 'id', 'href', 'role', 'aria-level', 'data-sokoban-container', 'data-testid', 'data-type', 'data-tpl', 'data-landurl', 'data-mdurl'].indexOf(name) >= 0 && !Object.prototype.hasOwnProperty.call(attributes, name)) attributes[name] = attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] : attribute[4] || '';
    }
    var current = { tag: tag, attrs: attributes, start: match.index, open: tokens.lastIndex, end: 0, close: 0, parent: stack.length ? stack[stack.length - 1] : null, titles: 0 };
    current.foreign = tag === 'svg' || tag === 'math' || (current.parent && current.parent.foreign);
    nodes.push(current);
    if (sfHTMLMatches(current, adapter.title)) {
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
    } else if (current.foreign && /\/\s*>$/.test(match[0])) { current.end = tokens.lastIndex; current.close = tokens.lastIndex; }
    else if (!voidTags.test(tag)) stack.push(current);
  }
  var ranges = [], seen = [];
  headings.forEach(function (heading) {
    var card = null, link = heading.tag === 'a' ? heading : null, root = null;
    for (var ancestor = heading.parent; ancestor; ancestor = ancestor.parent) {
      if (!link && ancestor.tag === 'a') link = ancestor;
      if (!card && sfHTMLMatches(ancestor, adapter.card)) card = ancestor;
      if (!root && adapter.root && sfHTMLMatches(ancestor, adapter.root)) root = ancestor;
    }
    if ((adapter.root && (!root || !root.end)) || !card || !card.end || card.invalid || !heading.end || card.titles !== 1 || seen.indexOf(card) >= 0) return;
    seen.push(card); result.recognized++;
    var low = 0, high = nodes.length, inside = [];
    while (low < high) { var middle = Math.floor((low + high) / 2); if (nodes[middle].start < card.open) low = middle + 1; else high = middle; }
    for (var n = low; n < nodes.length && nodes[n].start < card.close; n++) {
      if (nodes[n].end && nodes[n].end <= card.close) inside.push(nodes[n]);
    }
    if (!link) {
      var links = inside.filter(function (node) { return node.tag === 'a' && ((node.start >= heading.open && node.end <= heading.close) || (engine === 'google' && (/(?:^|\s)UBFage(?:\s|$)/.test(node.attrs['class'] || '') || node.attrs.role === 'presentation'))); });
      if (links.length === 1) link = links[0];
    }
    if (!link) { result.unresolved++; return; }
    var host = link ? sfHTMLURLHost(link.attrs.href || '', pageHost) : '';
    if (!host) adapter.targetAttrs.some(function (name) { var target = link.attrs[name] || card.attrs[name] || ''; if (/^https?:\/\//i.test(target)) host = sfHTMLURLHost(target, pageHost); return !!host; });
    if (!host) {
      var cites = inside.filter(function (node) { return sfHTMLMatches(node, adapter.citation); });
      var primary = link ? cites.filter(function (node) { return node.start >= link.open && node.end <= link.close; }) : [];
      var values = (primary.length ? primary : cites).map(function (node) { return sfHTMLDisplayedHost(html.slice(node.open, node.close), pageHost); }).filter(Boolean);
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
