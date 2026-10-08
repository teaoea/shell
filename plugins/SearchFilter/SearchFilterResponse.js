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

// BEGIN GENERATED SEARCH BROWSER CORE
/* Browser filtering for desktop and mobile layouts; no network telemetry. */
function sfBrowserFilter(config) {
    'use strict';
    var saved = new WeakMap();
    var hiddenCards = new Set();
    var snapshot = { phase: "browser", reason: "scanned", engine: config.engine, rules: config.rules.length, headings: 0, recognized: 0, unresolved: 0, hidden: 0 };
    function restore(card) {
      var original = saved.get(card);
      if (!original) return;
      if (original.display) card.style.setProperty('display', original.display, original.priority);
      else card.style.removeProperty('display');
      if (original.aria === null) card.removeAttribute('aria-hidden');
      else card.setAttribute('aria-hidden', original.aria);
      card.removeAttribute('data-loon-search-filter');
      saved.delete(card);
      hiddenCards.delete(card);
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
        if (/^(?:www\.|safe\.|start\.|noai\.|html\.)?duckduckgo\.com$/.test(host) && url.pathname === '/l/') return domainOf(url.searchParams.get('uddg') || '', (depth || 0) + 1);
        if (host === 'r.search.yahoo.com') {
          var ru = /\/RU=([^/]+)(?:\/RK=|\/RS=|$)/.exec(url.pathname);
          return ru ? domainOf(decodeURIComponent(ru[1]), (depth || 0) + 1) : '';
        }
        if (/^(?:www\.|m\.)?sogou\.com$/.test(host) && /(?:^|\/)tc$/.test(url.pathname)) return domainOf(url.searchParams.get('url') || url.searchParams.get('pcurl') || '', (depth || 0) + 1);
        if (/^(?:www\.|m\.)?so\.com$/.test(host) && url.pathname === '/jump') return domainOf(url.searchParams.get('u') || '', (depth || 0) + 1);
        if (config.adapter.hosts.indexOf(host) >= 0 || host === location.hostname.toLowerCase()) return '';
        return host;
      } catch (_) { return ''; }
    }
    function blocked(host) {
      if (!host) return false;
      return config.rules.some(function (entry) {
        var rule = entry.value;
        // "Second-level" here is precisely the label before the final suffix.
        if (entry.kind === 'key') { var labels = host.split('.'); return labels.length >= 2 && labels[labels.length - 2] === rule; }
        return entry.kind === 'url' && rule.indexOf('*') < 0 && (host === rule || host.slice(-(rule.length + 1)) === '.' + rule);
      });
    }
    function displayedHost(node) {
      var shown = node && typeof node.textContent === 'string' ? node.textContent.trim() : '';
      var match = /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+))(?=$|[\/\s›>])/i.exec(shown);
      return match ? domainOf('https://' + match[1]) : '';
    }
    function citationHost(link, card, selector) {
      var primary = Array.from(link.querySelectorAll(selector));
      var nodes = primary.length ? primary : Array.from(card.querySelectorAll(selector));
      var hosts = nodes.map(displayedHost).filter(Boolean);
      return hosts.length && hosts.every(function (host) { return host === hosts[0]; }) ? hosts[0] : '';
    }
    function showDiagnostic() {
      if (!config.debug || !document.body) return;
      var panel = document.getElementById('loon-search-filter-status');
      if (!panel) { panel = document.createElement('aside'); panel.id = 'loon-search-filter-status'; document.body.appendChild(panel); }
      Object.assign(panel.style, { position: 'fixed', bottom: '12px', right: '12px', zIndex: '2147483647', background: '#162238', color: '#fff', borderRadius: '12px', padding: '10px', maxWidth: 'calc(100vw - 24px)', font: '12px/1.5 system-ui', boxShadow: '0 4px 20px #0003' });
      if (!panel.querySelector('button')) {
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        var toggle = document.createElement('button'), detail = document.createElement('pre'), download = document.createElement('button');
        toggle.type = download.type = 'button'; detail.hidden = download.hidden = true;
        toggle.style.cssText = download.style.cssText = 'background:none;color:inherit;border:0;padding:6px;font:inherit;cursor:pointer';
        detail.style.cssText = 'white-space:pre-wrap;margin:6px'; download.textContent = '下载脱敏页面诊断';
        toggle.addEventListener('click', function () { detail.hidden = !detail.hidden; download.hidden = detail.hidden; });
        download.addEventListener('click', function () {
          // These fields are constructed here; no DOM text, URLs or rules exported.
          var event = Object.assign({ time: new Date().toISOString(), version: '1.1.0' }, snapshot);
          var text = JSON.stringify({ format: 'search-filter-browser-diagnostic', version: '1.1.0', count: 1 }) + '\n' + JSON.stringify(event) + '\n';
          var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
          var anchor = document.createElement('a'); anchor.href = url; anchor.download = 'search-filter-browser.log'; anchor.hidden = true;
          panel.appendChild(anchor); anchor.click(); anchor.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        });
        panel.appendChild(toggle); panel.appendChild(detail); panel.appendChild(download);
      }
      var label = '搜索屏蔽 v1.1.0 · ' + (snapshot.reason === 'error' ? '页面处理异常' : '已运行 · 隐藏 ' + snapshot.hidden);
      var info = '规则 ' + snapshot.rules + ' · 标题 ' + snapshot.headings + '\n识别 ' + snapshot.recognized + ' · 目标不明 ' + snapshot.unresolved + ' · 隐藏 ' + snapshot.hidden + '\n仅当前页面统计，不含 Loon 初始移除数。';
      var button = panel.querySelector('button'), pre = panel.querySelector('pre');
      if (button.textContent !== label) button.textContent = label;
      if (pre.textContent !== info) pre.textContent = info;
    }
    function scan() {
      var visited = new Set();
      var counters = { headings: 0, recognized: 0, unresolved: 0, hidden: 0 };
      var adapter = config.adapter;
      var titleSelector = adapter.title;
      var headingSelector = adapter.root ? adapter.root.split(',').map(function (root) { return titleSelector.split(',').map(function (title) { return root.trim() + ' ' + title.trim(); }).join(','); }).join(',') : adapter.card.split(',').map(function (card) { return titleSelector.split(',').map(function (title) { return card.trim() + ' ' + title.trim(); }).join(','); }).join(',');
      document.querySelectorAll(headingSelector).forEach(function (heading) {
        counters.headings++;
        var link = heading.closest('a') || heading.querySelector('a');
        var card = heading.closest(adapter.card);
        if (!card) return;
        visited.add(card);
        if (card.querySelectorAll(titleSelector).length !== 1) { restore(card); return; }
        counters.recognized++;
        if (!link && config.engine === 'google') {
          var links = card.querySelectorAll('a.UBFage, a[role="presentation"]');
          if (links.length === 1) link = links[0];
        }
        if (!link) { counters.unresolved++; restore(card); return; }
        var host = domainOf(link.getAttribute('href') || '');
        if (!host) {
          adapter.targetAttrs.some(function (name) {
            var target = link.getAttribute(name) || card.getAttribute(name) || '';
            if (/^https?:\/\//i.test(target)) host = domainOf(target);
            return !!host;
          });
        }
        if (!host) host = citationHost(link, card, adapter.citation);
        if (!host) counters.unresolved++;
        if (blocked(host)) {
          counters.hidden++;
          if (!saved.has(card)) saved.set(card, { display: card.style.getPropertyValue('display'), priority: card.style.getPropertyPriority('display'), aria: card.getAttribute('aria-hidden') });
          hiddenCards.add(card);
          card.style.setProperty('display', 'none', 'important');
          card.setAttribute('aria-hidden', 'true');
          card.setAttribute('data-loon-search-filter', 'hidden');
        } else restore(card);
      });
      // Recycled cards may lose their title, result class or web type entirely.
      hiddenCards.forEach(function (card) { if (!visited.has(card)) restore(card); });
      Object.assign(snapshot, counters, { reason: 'scanned' });
      showDiagnostic();
    }
    function safelyScan() { try { scan(); } catch (_) { snapshot.reason = 'error'; try { showDiagnostic(); } catch (_) {} } }
    var pending = false;
    safelyScan();
    function schedule() {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; safelyScan(); }, 80);
    }
    new MutationObserver(schedule).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-landurl', 'data-mdurl', 'data-type', 'data-testid', 'data-tpl', 'role', 'aria-level', 'class'] });
    if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', schedule);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pageshow', schedule);
  }
// END GENERATED SEARCH BROWSER CORE

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
// END GENERATED SEARCH HTML CORE

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

/* 搜索结果网站屏蔽 v1.1.0 — Loon HTML response script.
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
    var settings = sfRuleSettings(args);
    var request = typeof $request === 'object' && $request ? $request : {};
    var response = typeof $response === 'object' && $response ? $response : {};
    function on(value) { return value === true || value === 'true'; }
    var match = /^https:\/\/([^/:?#]+)(?::443)?(\/[^?#]*)\?/i.exec(request.url || '');
    if (request.method !== 'GET' || !match || typeof response.body !== 'string') return $done(output);
    var host = match[1].toLowerCase(), entry = sfEngineEntry(host, match[2]);
    if (!entry) return finish(output);
    var engine = entry.id;
    logMeta = { phase: 'response', engine: engine, host: host, path: match[2], status: Number(response.status || response.statusCode || 200) };
    if (!settings.engines[engine]) return finish(output, 'disabled');
    var parameters = Object.create(null);
    String(request.url).split('?').slice(1).join('?').split('#')[0].split('&').forEach(function (part) {
      var equal = part.indexOf('='), key = decodeURIComponent((equal < 0 ? part : part.slice(0, equal)).replace(/\+/g, ' '));
      if (Object.prototype.hasOwnProperty.call(parameters, key)) throw new Error('duplicate parameter');
      parameters[key] = decodeURIComponent((equal < 0 ? '' : part.slice(equal + 1)).replace(/\+/g, ' '));
    });
    if (!sfEngineQuery(entry, parameters)) return finish(output, 'invalid-input');
    if (!sfEngineWeb(entry, parameters)) return finish(output, 'non-web');
    var status = Number(response.status || response.statusCode || 200);
    if (status !== 200) return finish(output, 'http-status');
    var headers = response.headers || {}, contentType = '';
    Object.keys(headers).forEach(function (key) { if (key.toLowerCase() === 'content-type') contentType = headers[key]; });
    if (!/^text\/html\b/i.test(contentType)) return finish(output, 'non-html');
    var body = response.body;
    if (body.length > 4 * 1024 * 1024) return finish(output, 'body-limit');
    if (!/<\/body\s*>/i.test(body)) return finish(output, 'body-fragment');
    if (/id=["']loon-search-filter["']/i.test(body)) return finish(output, 'already-injected');
    var local = sfRuleLocalList(args);
    if (local.limited) return finish(output, 'rules-limit');
    var rules = local.rules;
    if (rules.length > 100) return finish(output, 'rules-limit');
    if (typeof $persistentStore !== 'undefined' && settings.subscription_url) {
      try {
        var cache = JSON.parse($persistentStore.read('search-filter.subscription.v1') || '{}');
        if (cache.source === settings.subscription_url && Array.isArray(cache.rules) && cache.rules.length <= 100) {
          cache.rules.forEach(function (rule) {
            if (sfRuleValid(rule) && !rules.some(function (current) { return current.kind === rule.kind && current.value === rule.value; })) rules.push(rule);
          });
        }
      } catch (_) { /* Missing or invalid cache does not suppress local rules. */ }
    }
    logMeta.rules = rules.length;
    if (!rules.length) return finish(output, 'no-rules');
    var filtered = sfFilterHTML(body, engine, host, rules);
    body = filtered.body;
    {
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
    var config = JSON.stringify({ engine: engine, adapter: entry, rules: rules, debug: on(args.log_enabled) }).replace(/</g, '\\u003c');
    var script = '<script id="loon-search-filter"' + (nonce ? ' nonce="' + nonce + '"' : '') + '>(' + sfBrowserFilter.toString() + ')(' + config + ');</script>';
    // Start observing before Google's bootstrap scripts replace/load result DOM.
    var head = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i;
    body = head.test(body) ? body.replace(head, function (part) {
      var first = part.search(/<script\b/i);
      return first >= 0 ? part.slice(0, first) + script + part.slice(first) : part.replace(/<\/head\s*>/i, function (end) { return script + end; });
    }) : body.replace(/<\/body\s*>/i, function (end) { return script + end; });
    if (on(args.log_enabled)) body = body.replace(/<\/body\s*>/i, '<aside id="loon-search-filter-status" style="position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#162238;color:white;padding:10px;border-radius:12px;font:12px system-ui">搜索屏蔽 v1.1.0 · 脚本尚未执行</aside>$&');
    output = { body: body };
  } catch (_) { return finish(output, 'error'); }
  finish(output, filtered.removed ? 'static-and-injected' : 'injected');

}());
