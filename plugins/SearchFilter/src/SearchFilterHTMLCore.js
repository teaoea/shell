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
