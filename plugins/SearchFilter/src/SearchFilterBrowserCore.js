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
