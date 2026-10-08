/* Local list controls; domain values are deliberately visible here, never logged. */
function sfEditorClient(initial) {
  'use strict';
  var state = initial, busy = false, editing = -1;
  var get = function (id) { return document.getElementById(id); };
  var field = get('entry');
  function line(rule) { return (rule.kind === 'key' ? 'domain-keyword' : 'domain-suffix') + ': ' + rule.value; }
  function tell(text, error) { get('notice').textContent = text; get('notice').className = error ? 'notice error' : 'notice'; }
  function render() {
    get('count').textContent = state.rules.length;
    get('empty').hidden = state.rules.length > 0;
    get('add').textContent = editing < 0 ? '添加并保存' : '保存修改';
    get('cancel').hidden = editing < 0;
    get('refresh').disabled = busy; get('add').disabled = busy; field.disabled = busy;
    get('keyword').disabled = busy; get('suffix').disabled = busy;
    ['google', 'bing', 'baidu'].forEach(function (engine) { get(engine).checked = state.settings.engines[engine]; get(engine).disabled = busy; });
    get('query').checked = state.settings.query_exclusion; get('query').disabled = busy;
    get('save-settings').disabled = busy; get('subscription-update').disabled = busy || !state.settings.subscription_url;
    get('subscription-url').disabled = busy;
    get('subscription-status').textContent = !state.settings.subscription_url ? '订阅未启用' : '有效缓存 ' + state.subscription.count + ' 条' + (state.subscription.updated_at ? ' · ' + new Date(state.subscription.updated_at).toLocaleString() : ' · 请先更新订阅');
    var list = get('rules');
    while (list.firstChild) list.removeChild(list.firstChild);
    state.rules.forEach(function (rule, index) {
      var row = document.createElement('li'), label = document.createElement('code'), actions = document.createElement('div');
      label.textContent = line(rule); row.appendChild(label);
      var edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑'; edit.disabled = busy;
      edit.addEventListener('click', function () { editing = index; field.value = line(rule); render(); field.focus(); field.setSelectionRange(field.value.length, field.value.length); });
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '删除'; remove.disabled = busy;
      remove.addEventListener('click', function () { var next = state.rules.filter(function (_, i) { return i !== index; }); update(next, '已删除并保存。', true); });
      actions.appendChild(edit); actions.appendChild(remove); row.appendChild(actions); list.appendChild(row);
    });
  }
  async function configure(path, payload, message) {
    if (busy) return;
    busy = true;
    // Preserve current form values until the request finishes.
    ['google', 'bing', 'baidu', 'query', 'subscription-url', 'save-settings', 'subscription-update', 'refresh', 'add', 'keyword', 'suffix'].forEach(function (id) { get(id).disabled = true; });
    try {
      payload.token = state.token;
      var response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { tell(response.status === 403 ? '页面已过期，请刷新后重试。' : response.status === 400 ? '订阅需要公开 HTTPS 文本地址，不支持凭据、片段或非标准端口。' : '订阅更新或保存未完成；保留已有有效缓存，请检查地址及规则格式。', true); return; }
      state = await response.json(); get('subscription-url').value = state.settings.subscription_url; tell(message, false);
    } catch (_) { tell('未完成操作，请确认 Loon 和插件已启用后重试。', true); }
    finally { busy = false; render(); }
  }
  get('save-settings').addEventListener('click', function () {
    var settings = { engines: { google: get('google').checked, bing: get('bing').checked, baidu: get('baidu').checked }, query_exclusion: get('query').checked, subscription_url: get('subscription-url').value.trim() };
    configure('/settings', { settings: settings }, '设置已保存，重新搜索后生效；更改订阅地址后请更新订阅。');
  });
  get('subscription-update').addEventListener('click', function () { configure('/subscription', {}, '订阅已更新，重新搜索后生效。'); });
  async function update(rules, message, reset) {
    if (busy) return;
    busy = true; render();
    try {
      var response = await fetch(rules ? '/save' : '/state', rules ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: state.token, text: rules.map(line).join('\n') }), credentials: 'same-origin', cache: 'no-store' } : { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { tell(response.status === 403 ? '页面已过期，请点刷新后重试。' : response.status === 400 ? '请检查规则格式，最多 100 条；不支持通配符。' : '未保存，请稍后重试。', true); return; }
      state = await response.json();
      get('subscription-url').value = state.settings.subscription_url;
      if (reset) { editing = -1; field.value = ''; }
      tell(message, false);
    } catch (_) { tell('无法读取本地名单，请确认 Loon 和插件已启用。', true); }
    finally { busy = false; render(); }
  }
  function prefix(value) {
    var text = field.value, start = field.selectionStart, begin = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    var end = text.indexOf('\n', start); if (end < 0) end = text.length;
    var current = text.slice(begin, end).replace(/^(?:domain-keyword|domian-keyword|domain-keywrod|domian-keywrod|domain-suffix):\s*/i, '');
    var inserted = value + ': ';
    field.value = text.slice(0, begin) + inserted + current + text.slice(end);
    field.focus(); field.setSelectionRange(begin + inserted.length, begin + inserted.length); tell('已插入类型；填写规则内容后保存。', false);
  }
  get('keyword').addEventListener('click', function () { prefix('domain-keyword'); });
  get('suffix').addEventListener('click', function () { prefix('domain-suffix'); });
  get('add').addEventListener('click', function () {
    var parsed = sfRuleParseList(field.value, false);
    if (parsed.invalid || !parsed.rules.length || (editing >= 0 && parsed.rules.length !== 1)) { tell('每行使用“类型: 内容”，冒号后留空格；关键词填单个域名标签，后缀填完整域名；不支持通配符。', true); field.focus(); return; }
    var next = state.rules.slice();
    if (editing >= 0) next.splice(editing, 1, parsed.rules[0]);
    else parsed.rules.forEach(function (rule) { if (!next.some(function (existing) { return existing.kind === rule.kind && existing.value === rule.value; })) next.push(rule); });
    if (next.length > 100) { tell('最多保留 100 条本地规则，请先删除不需要的条目。', true); return; }
    update(next, '已保存，重新发起搜索后生效。', true);
  });
  get('cancel').addEventListener('click', function () { editing = -1; field.value = ''; render(); tell('已取消本次编辑。', false); });
  get('refresh').addEventListener('click', function () { update(null, '已刷新本地名单。', true); });
  function keyboard() {
    var vv = window.visualViewport, focus = document.activeElement === field, composer = get('composer');
    var inset = focus && vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    composer.style.setProperty('--keyboard', inset + 'px');
    // Reserve the actual toolbar height instead of a large fixed blank area.
    document.documentElement.style.setProperty('--composer-space', Math.ceil(composer.getBoundingClientRect().height) + 16 + 'px');
  }
  field.addEventListener('focus', keyboard); field.addEventListener('blur', keyboard);
  window.addEventListener('resize', keyboard);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(keyboard).observe(get('composer'));
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', keyboard); window.visualViewport.addEventListener('scroll', keyboard); }
  get('subscription-url').value = state.settings.subscription_url;
  render();
  keyboard();
}
function sfEditorMarkup(view) {
  var data = JSON.stringify(view).replace(/</g, '\\u003c');
  var scripts = sfRuleValid.toString() + '\n' + sfRuleParseLine.toString() + '\n' + sfRuleParseList.toString();
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>搜索屏蔽名单 v' + view.version + '</title><style>' +
    ':root{--bg:#f4f6fa;--surface:#fff;--text:#182238;--muted:#617087;--line:#e2e7ef;--accent:#315ee7;--soft:#eef3ff;--danger:#b84248;--composer-space:180px}*{box-sizing:border-box}html{width:100%;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{width:100%;margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:100%;max-width:850px;margin:auto;padding:20px 16px var(--composer-space)}.eyebrow{font-size:11px;color:var(--muted);margin:0}h1{font-size:22px;line-height:1.25;margin:5px 0}.hint{font-size:12px;color:var(--muted);margin:8px 0;overflow-wrap:anywhere}.top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.top h1{min-width:0}.top button{flex-shrink:0}.settings{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;margin:12px 0}.more summary{cursor:pointer;color:var(--muted);font-size:12px;margin:8px 0}.more .option{margin-top:10px}.settings h2{font-size:14px;margin:0 0 8px}.engines{display:flex;flex-wrap:wrap;gap:8px 14px;margin:6px 0 8px}.engines label,.option{display:flex;align-items:center;gap:6px;min-height:36px;min-width:0}.settings input[type=checkbox]{width:18px;height:18px;flex-shrink:0;accent-color:var(--accent);margin:0}.settings input[type=url]{display:block;width:100%;max-width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);padding:9px;font:16px ui-monospace,monospace;margin:6px 0}.setting-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.count{font-size:12px;color:var(--muted);margin:0 0 10px}.rules{list-style:none;padding:0;margin:0;display:grid;min-width:0;gap:8px}.rules li{display:flex;align-items:center;justify-content:space-between;min-width:0;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px}.rules code{flex:1;min-width:0;font-size:12px;overflow-wrap:anywhere;word-break:break-word}.rules li div{display:flex;flex-shrink:0;gap:4px}button{font:inherit;font-size:12px;min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;color:var(--text);background:var(--surface);cursor:pointer;touch-action:manipulation}button:disabled{opacity:.5}button:focus-visible,textarea:focus-visible,input[type=url]:focus-visible{outline:3px solid #91aaff;outline-offset:2px}.primary{color:#fff;background:var(--accent);border-color:var(--accent)}.remove{color:var(--danger)}.empty{padding:24px 12px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px}.composer{position:fixed;bottom:var(--keyboard,0px);left:0;right:0;width:100%;min-width:0;z-index:10;background:var(--surface);border-top:1px solid var(--line);padding:8px max(10px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));box-shadow:0 -4px 16px #00000008}.composer-inner{max-width:810px;min-width:0;margin:auto}.types{display:flex;min-width:0;gap:6px;margin-bottom:6px}.types button{font:12px ui-monospace,monospace;min-width:0;padding:8px 4px;background:var(--soft);color:var(--accent);flex:1}.input{display:flex;align-items:stretch;min-width:0;gap:6px}textarea{display:block;flex:1;width:0;max-width:100%;min-width:0;min-height:54px;max-height:110px;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px;color:var(--text);background:var(--bg);font:16px/1.35 ui-monospace,monospace}.input button{flex-shrink:0;max-width:84px;padding:8px}.notice{font-size:11px;color:#187c55;margin:6px 0 0;overflow-wrap:anywhere}.notice:empty{display:none}.error{color:var(--danger)}.privacy{font-size:12px;color:var(--muted);margin-top:14px;overflow-wrap:anywhere}.privacy summary{cursor:pointer;color:var(--text)}[hidden]{display:none!important}@media(max-width:450px){main{padding:14px 10px var(--composer-space)}h1{font-size:20px}.rules li{align-items:flex-start}.rules li div button{padding:7px;min-height:36px}.engines{gap:8px 12px}.input .primary{width:84px}}@media(max-width:340px){.rules li{flex-wrap:wrap}.rules li code{flex-basis:100%}.rules li div{margin-left:auto}.input #cancel{max-width:48px;padding:6px}.types button{font-size:11px}}@media(max-height:500px){.composer{padding-top:5px}.types{margin-bottom:4px}.types button{min-height:34px;padding:6px 4px}textarea{min-height:46px;max-height:70px}.notice{margin-top:4px}}@media(prefers-color-scheme:dark){:root{--bg:#101622;--surface:#1a2232;--text:#e6ecf6;--muted:#9cabc0;--line:#303b4d;--accent:#5e86ff;--soft:#26334f;--danger:#ff979c}.notice{color:#8bd8b2}.error{color:var(--danger)}}' +
    '</style></head><body><main><p class="eyebrow">本地管理 · v' + view.version + '</p><div class="top"><h1>搜索屏蔽名单</h1><button id="refresh" type="button">刷新名单</button></div><p class="hint">选择类型后填写内容，每行一条。保存后重新搜索。</p><section class="settings" aria-label="过滤设置"><h2>生效搜索引擎</h2><div class="engines"><label><input id="google" type="checkbox">Google</label><label><input id="bing" type="checkbox">Bing</label><label><input id="baidu" type="checkbox">百度</label></div><p class="hint">整份本地名单与订阅共用；只过滤已勾选的引擎，修改后保存。</p><details class="more"><summary>搜索排除与远程订阅</summary><label class="option"><input id="query" type="checkbox">额外追加搜索排除条件</label><p class="hint">默认关闭。开启后仅域名后缀规则追加 -site 条件；域名关键词由页面过滤。关闭后旧查询条件需手动删除。</p><label for="subscription-url">远程名单订阅 URL</label><input id="subscription-url" type="url" maxlength="2048" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="公开 HTTPS 文本直链，留空停用"><p class="hint">使用相同的每行规则格式。保存后更新订阅；更新失败保留上次有效缓存。</p><p id="subscription-status" class="hint"></p><div class="setting-actions"><button id="subscription-update" type="button">更新订阅</button></div></details><div class="setting-actions"><button id="save-settings" type="button" class="primary">保存设置</button></div></section><p class="count">本地规则 <strong id="count">0</strong> / 100</p><div id="empty" class="empty">暂无本地规则，使用下方快捷按钮添加。</div><ul id="rules" class="rules" aria-label="屏蔽名单"></ul><details class="privacy"><summary>规则说明与隐私</summary><p>domain-keyword：匹配倒数第二个域名标签，覆盖不同后缀及子域名，不按标题或正文匹配。domain-suffix：匹配指定域名本身及所有子域名，不影响其他域名后缀。不支持通配符。中文域名请填写 Punycode。</p><p>名单只保存在本机 Loon，不上传，不写入开发日志，不跨设备同步。远程订阅与本地名单按任一命中即隐藏合并；删除本地条目不会删除订阅规则。旧版插件输入框不再用于名单，旧条目需在此重新添加。</p></details><noscript>请允许本地页面运行 JavaScript 以管理名单。</noscript></main><section id="composer" class="composer" aria-label="添加规则"><div class="composer-inner"><div class="types"><button id="keyword" type="button">domain-keyword</button><button id="suffix" type="button">domain-suffix</button></div><div class="input"><textarea id="entry" rows="2" maxlength="8192" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="规则内容" placeholder="点击上方按钮插入类型，或粘贴多行规则"></textarea><button id="add" type="button" class="primary">添加并保存</button><button id="cancel" type="button" hidden>取消编辑</button></div><p id="notice" class="notice" role="status" aria-live="polite"></p></div></section><script nonce="' + view.token + '">' + scripts + '\n(' + sfEditorClient.toString() + ')(' + data + ');</script></body></html>';
}
