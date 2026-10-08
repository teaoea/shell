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
