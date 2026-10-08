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
