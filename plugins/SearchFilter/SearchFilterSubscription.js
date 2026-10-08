/* 搜索结果屏蔽订阅 v1.0.0. Downloads only when explicitly configured. */
(function () {
  'use strict';
  var args = typeof $argument === 'object' && $argument ? $argument : {};
  var source = String(args.subscription_url || '').trim();
  var CACHE_KEY = 'search-filter.subscription.v1';
  function finish(content) { $done({ title: '搜索屏蔽订阅', content: content }); }
  // A credential-free HTTPS text URL only; no browser cookies are copied.
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?(?:\/[^\s#]*)?$/i.test(source) || /[\r\n]/.test(source)) return finish('未填写有效的 HTTPS 订阅 URL；未更新缓存。');
  try {
    $httpClient.get({ url: source, headers: { Accept: 'text/plain' }, timeout: 10 }, function (error, response, body) {
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
      if (invalid || rules.length > 100) return finish('订阅格式无效或超过 100 条；保留上次有效名单。');
      // Empty/comment-only text is intentional clearing; HTML/error text is rejected.
      var record = { source: source, rules: rules, updated_at: new Date().toISOString() };
      try {
        if (!$persistentStore.write(JSON.stringify(record), CACHE_KEY)) return finish('缓存保存失败；保留上次有效名单。');
        finish('已更新 ' + rules.length + ' 条订阅规则。重新加载搜索页后生效。');
      } catch (_) { finish('缓存保存失败；未更新名单。'); }
    });
  } catch (_) { finish('订阅下载失败；保留上次有效名单。'); }
}());
