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
