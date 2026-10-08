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
  var event = { time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.time || '') ? input.time : new Date().toISOString(), version: ['1.0.1', '1.0.2'].indexOf(input.version) >= 0 ? input.version : '1.0.3', phase: input.phase, reason: input.reason };
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

/* 搜索结果屏蔽订阅 v1.0.3. Downloads only when explicitly configured. */
(function () {
  'use strict';
  var args = typeof $argument === 'object' && $argument ? $argument : {};
  var source = String(args.subscription_url || '').trim();
  var CACHE_KEY = 'search-filter.subscription.v1';
  function finish(content, reason, rules) { sfLogRecord(args, { phase: 'subscription', reason: reason || 'download-failed', rules: rules }); $done({ title: '搜索屏蔽订阅', content: content }); }
  // A credential-free HTTPS text URL only; no browser cookies are copied.
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?(?:\/[^\s#]*)?$/i.test(source) || /[\r\n]/.test(source)) return finish('未填写有效的 HTTPS 订阅 URL；未更新缓存。', 'subscription-invalid');
  try {
    $httpClient.get({ url: source, headers: { Accept: 'text/plain' }, timeout: 10000, 'auto-cookie': false, insecure: false }, function (error, response, body) {
      if (error || !response || Number(response.status || response.statusCode) !== 200 || typeof body !== 'string' || body.length > 256 * 1024) return finish('订阅下载失败或正文超限；保留上次有效名单。');
      var rules = [], invalid = false;
      body.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line || /^(?:#|\/\/)/.test(line)) return;
        var item = /^\[(key|url):\s*([^\]\s]+)\s*\]$/i.exec(line);
        if (!item) { invalid = true; return; }
        var kind = item[1].toLowerCase(), value = item[2].toLowerCase().replace(/\.$/, '');
        if (kind === 'key') {
          if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) || !/[a-z]/.test(value)) { invalid = true; return; }
        } else {
          var labels = value.split('.');
          if (value.length > 253 || labels.length < 2 || !/[a-z]/.test(value) || labels.some(function (label) { return !label || label.length > 63 || !/^[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?$/.test(label); })) { invalid = true; return; }
        }
        if (!rules.some(function (rule) { return rule.kind === kind && rule.value === value; })) rules.push({ kind: kind, value: value });
      });
      if (invalid || rules.length > 100) return finish('订阅格式无效或超过 100 条；保留上次有效名单。', 'format-invalid');
      // Empty/comment-only text is intentional clearing; HTML/error text is rejected.
      var record = { source: source, rules: rules, updated_at: new Date().toISOString() };
      try {
        if (!$persistentStore.write(JSON.stringify(record), CACHE_KEY)) return finish('缓存保存失败；保留上次有效名单。', 'storage-failed');
        finish('已更新 ' + rules.length + ' 条订阅规则。重新加载搜索页后生效。', 'updated', rules.length);
      } catch (_) { finish('缓存保存失败；未更新名单。', 'storage-failed'); }
    });
  } catch (_) { finish('订阅下载失败；保留上次有效名单。'); }
}());
