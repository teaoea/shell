/**
 * Bilibili 增强：Loon 广告与播放引导过滤、本地开发日志。
 * 作者：可莉唯一的狗、ChatGPT
 * 版本：1.10.1；更新时间：2026-10-07
 * 只处理已登记的 JSON 与二进制接口；异常、未知结构与未发生修改的响应原样放行。
 */
(function () {
  'use strict';
  const defaults = {
    remove_splash_ads: true, remove_feed_ads: true,
    hide_live: false, hide_game: false, hide_member_shop: false,
    hide_publish: false, hide_search_discovery: false,
    blocked_uids: '', blocked_keywords: '', log_enabled: false
  };
  const paths = {
    '/x/v2/splash/list': 'splash', '/x/v2/splash/show': 'splash', '/x/v2/splash/event/list2': 'splash',
    '/x/v2/feed/index': 'feed', '/x/v2/feed/index/story': 'feed',
    '/x/resource/show/tab': 'tab', '/x/resource/show/tab/v2': 'tab',
    '/x/v2/search/square': 'search_square', '/x/v2/search/trending/ranking': 'search_trending',
    '/x/v2/account/mine': 'mine', '/x/v2/account/mine/ipad': 'mine',
    '/x/v2/search/default': 'search_default', '/x/v2/search/defaultwords': 'search_defaultwords'
  };
  const memberPromoFields = ['vip_section', 'vip_section_v2', 'modular_vip_section'];
  const TABS_KEY = 'bilibili.enhance.tabs.v1';
  const DEFAULT_WORDS_PATH = '/bilibili.app.interface.v1.Search/DefaultWords';
  const VIDEO_RPC = {
    '/bilibili.app.view.v1.View/View': 'view', '/bilibili.app.view.v1.View/RelatesFeed': 'view_feed',
    '/bilibili.app.viewunite.v1.View/View': 'unite', '/bilibili.app.viewunite.v1.View/RelatesFeed': 'unite_feed',
    '/bilibili.community.service.dm.v1.DM/DmView': 'dm', '/x/v2/dm/web/view': 'web_dm',
    '/bilibili.app.view.v1.View/ViewProgress': 'progress', '/bilibili.app.viewunite.v1.View/ViewProgress': 'unite_progress'
  };
  function videoAds(raw, route, framed = true) {
    if (!raw || !ArrayBuffer.isView(raw)) throw new Error('binary');
    const frame = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (frame.length > 2097152 || (framed && (frame.length < 5 || frame[0] > 1))) throw new Error('frame');
    const size = frame[1] * 16777216 + frame[2] * 65536 + frame[3] * 256 + frame[4];
    if (framed && size !== frame.length - 5) throw new Error('frame');
    let payload = framed ? frame.subarray(5) : frame;
    if (framed && frame[0] === 1) {
      if (typeof $utils === 'undefined' || typeof $utils.ungzip !== 'function') throw new Error('gzip');
      payload = $utils.ungzip(payload);
    }
    if (!ArrayBuffer.isView(payload) || payload.byteLength > 2097152) throw new Error('size');
    let removed = 0;
    function fields(input) {
      let offset = 0;
      const result = [];
      function integer(strict = true) {
        let n = 0;
        for (let i = 0; i < 10; i++) {
          if (offset >= input.length) throw new Error('truncated');
          const byte = input[offset++]; n += (byte & 127) * Math.pow(2, 7 * i);
          if (i === 9 && byte > 1) throw new Error('varint');
          if (!(byte & 128)) { if (strict && !Number.isSafeInteger(n)) throw new Error('integer'); return n; }
        }
        throw new Error('varint');
      }
      while (offset < input.length) {
        if (result.length >= 20000) throw new Error('fields');
        const start = offset, tag = integer(), number = Math.floor(tag / 8), wire = tag % 8;
        if (!number || number > 536870911) throw new Error('tag');
        let value;
        if (wire === 0) value = integer(false);
        else if (wire === 2) {
          const length = integer();
          if (offset + length > input.length) throw new Error('length');
          value = input.subarray(offset, offset + length); offset += length;
        } else if (wire === 1 || wire === 5) { offset += wire === 1 ? 8 : 4; if (offset > input.length) throw new Error('truncated'); }
        else throw new Error('wire');
        result.push({ number, wire, value, raw: input.subarray(start, offset) });
      }
      return result;
    }
    function integer(n) { const bytes = []; do { const byte = n % 128; n = Math.floor(n / 128); bytes.push(byte + (n ? 128 : 0)); } while (n); return bytes; }
    function message(number, bytes) {
      const head = integer(number * 8 + 2).concat(integer(bytes.length)), result = new Uint8Array(head.length + bytes.length);
      result.set(head); result.set(bytes, head.length); return result;
    }
    function combine(chunks) {
      const result = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
      let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
    }
    function rewrite(bytes, level) {
      const chunks = [];
      for (const field of fields(bytes)) {
        if (field.wire !== 2) { chunks.push(field.raw); continue; }
        // 精确识别三连／关注互动指令，保留 #UP#、投票和未知互动弹幕。
        if ((level === 'guide' && field.number === 2) || (level === 'dm' && field.number === 22) || (level === 'web_dm' && field.number === 9)) {
          const attention = '#ATTENTION#';
          if (fields(field.value).some(item => item.number === 4 && item.wire === 2 && item.value.length === attention.length &&
            item.value.every((byte, index) => byte === attention.charCodeAt(index)))) { removed++; continue; }
        }
        // 只删除引导层中的关注卡与契约（三连）卡；章节、弹幕和未知字段保留。
        if ((level === 'guide' && [1, 5].includes(field.number)) || (level === 'unite_guide' && field.number === 3)) { removed++; continue; }
        if ((level === 'view' && [30, 31, 41, 48].includes(field.number)) || (level === 'unite' && field.number === 7)) { removed++; continue; }
        if ((level === 'view' && field.number === 10) || (level === 'view_feed' && field.number === 1)) {
          if (fields(field.value).some(item => item.number === 28 && item.wire === 2 && item.value.length > 0)) { removed++; continue; }
        }
        if (['unite_cards', 'unite_feed'].includes(level) && field.number === 1) {
          if (fields(field.value).some(item => (item.number === 1 && item.wire === 0 && item.value === 5) ||
            ([6, 11].includes(item.number) && item.wire === 2 && item.value.length > 0))) { removed++; continue; }
        }
        const child = level === 'progress' && field.number === 1 ? 'guide' :
          level === 'unite_progress' && field.number === 1 ? 'unite_guide' :
          level === 'unite' && field.number === 5 ? 'unite_tab' :
          level === 'unite_tab' && field.number === 1 ? 'unite_tab_module' :
          level === 'unite_tab_module' && field.number === 2 ? 'unite_intro' :
          level === 'unite_intro' && field.number === 2 ? 'unite_module' :
          level === 'unite_module' && field.number === 22 ? 'unite_cards' : null;
        if (child) { const before = removed, next = rewrite(field.value, child); chunks.push(before !== removed ? message(field.number, next) : field.raw); }
        else chunks.push(field.raw);
      }
      return combine(chunks);
    }
    const next = rewrite(payload, route);
    if (!removed) return { removed: 0 };
    if (!framed) return { body: next, removed };
    const result = new Uint8Array(next.length + 5);
    result[1] = Math.floor(next.length / 16777216); result[2] = Math.floor(next.length / 65536) % 256;
    result[3] = Math.floor(next.length / 256) % 256; result[4] = next.length % 256; result.set(next, 5);
    return { body: result, removed };
  }
  function blankDefaultWords() {
    // DefaultWordsReply：默认显示为空格（视觉空白），避免空串触发 App 兜底推荐。
    // 2=param，3=show，4=word，5=show_front，7=goto，8=value，9=uri。
    const payload = [18, 0, 26, 1, 32, 34, 0, 40, 1, 58, 0, 66, 0, 74, 0];
    return { response: { status: 200, headers: { 'Content-Type': 'application/grpc', 'grpc-status': '0',
      'grpc-message': '', 'bili-status-code': '0', 'Cache-Control': 'no-store' }, h2_trailers: { 'grpc-status': '0' },
      body: new Uint8Array([0, 0, 0, 0, payload.length].concat(payload)) } };
  }
  const REGION_URL = 'https://app.bilibili.com/bilibili.app.show.v1.Mixture/RegionList';
  function publicTabURI(value) {
    if (typeof value !== 'string' || value.length > 1024) return null;
    // 仅保留公开分区／服务路由以及展示参数。未知路径和凭据参数全部排除。
    const parts = value.split('?');
    if (parts.length > 2 || value.includes('#')) return null;
    const base = parts[0];
    if (!/^(?:bilibili:\/\/(?:main\/regionv2\/detail\/\d+|pgc\/(?:partition_page|page\/operation_list|cinema|home|cinema-tab)|pegasus\/(?:promo|hottopic)|live\/home|rank\/|game_center|comic\/home|article\/category\/)|https:\/\/(?:www\.bilibili\.com\/(?:blackroom|h5\/match\/data\/home|blackboard\/era\/[\w-]+\.html)|music\.bilibili\.com\/h5\/music-center|mall\.bilibili\.com\/neul-next\/index\.html|m\.bilibili\.com\/cheese\/home))$/.test(base)) return null;
    const allowed = ['page_name', 'page_id', 'title', 'select_id', 'from', 'page', 'noTitleBar', 'navhide', 'is_live_webview', 'hybrid_set_header', 'native.theme', 'night', 'auto_media_playback', '-Abrowser'];
    const query = [];
    for (const pair of (parts[1] || '').split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const key = pair.slice(0, eq);
      if (!allowed.includes(key)) continue;
      let decoded;
      try { decoded = decodeURIComponent(pair.slice(eq + 1)); } catch (_) { return null; }
      if (decoded.length > 64 || !/^[\w\u4e00-\u9fff .-]*$/.test(decoded)) continue;
      query.push(key + '=' + encodeURIComponent(decoded));
    }
    return base + (query.length ? '?' + query.join('&') : '');
  }
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function tabInfo(item) {
    if (!object(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 64) return null;
    // 当前导航只保存 ID 与展示名；完整分区另保存受限的公开跳转信息。
    const id = typeof item.tab_id === 'string' && /^[\w\u4e00-\u9fff:/.-]{1,96}$/.test(item.tab_id) ? 'tab:' + item.tab_id :
      Number.isSafeInteger(item.id) && item.id >= 0 ? 'id:' + item.id : null;
    return id ? { id, name: item.name } : null;
  }
  function readTabs() {
    try {
      const state = JSON.parse($persistentStore.read(TABS_KEY) || '{}');
      const catalog = Array.isArray(state.catalog) ? state.catalog.map(tabInfoStored).filter(Boolean).slice(0, 100) : [];
      return { catalog, selected: Array.isArray(state.selected) ? state.selected.filter(id => catalog.some(tab => tab.id === id)) : null };
    } catch (_) { return { catalog: [], selected: null }; }
  }
  function customTabURI(value) {
    if (typeof value !== 'string') return null;
    const uri = value.trim();
    if (!uri || uri.length > 2048 || /[\s\x00-\x1f\x7f]/.test(uri)) return null;
    if (!/^(?:https?:\/\/[^/?#@]+|bilibili:\/\/[a-zA-Z0-9_.-]+)(?:[/?#][^\s]*)?$/.test(uri)) return null;
    let decoded;
    try { decoded = decodeURIComponent(uri); } catch (_) { return null; }
    if (/[\x00-\x1f\x7f]/.test(decoded) || /(?:[?&#]|^)(?:access_key|access_token|token|authorization|cookie|sign|password|passwd|secret|api_key)=/i.test(decoded) || /(?:javascript|data|file):/i.test(decoded)) return null;
    return uri;
  }
  function tabInfoStored(item) {
    if (!object(item) || typeof item.id !== 'string' || !/^(?:tab:[\w\u4e00-\u9fff:/.-]{1,96}|id:\d{1,16})$/.test(item.id) ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 64) return null;
    const result = { id: item.id, name: item.name };
    if (item.source === 'custom') {
      const uri = customTabURI(item.uri);
      if (!uri || !Number.isSafeInteger(item.native_id) || item.native_id < 900000001 || item.native_id > 999999999 ||
        item.id !== 'tab:loon_custom_' + item.native_id) return null;
      return Object.assign(result, { source: 'custom', native_id: item.native_id, native_tab_id: 'loon_custom_' + item.native_id, uri });
    }
    const nativeTab = typeof item.native_tab_id === 'string' && /^[\w\u4e00-\u9fff:/.-]{1,96}$/.test(item.native_tab_id) ? item.native_tab_id : String(item.native_id);
    if (item.source === 'region' && Number.isSafeInteger(item.native_id) && item.native_id > 0 && item.id === 'tab:' + nativeTab) {
      const uri = publicTabURI(item.uri);
      if (uri) Object.assign(result, { source: 'region', native_id: item.native_id, native_tab_id: nativeTab, uri, enabled: item.enabled === true });
    }
    return result;
  }
  function saveTabs(state) {
    try { return $persistentStore.write(JSON.stringify(state), TABS_KEY) === true; } catch (_) { return false; }
  }
  function regionTabs(raw) {
    if (!raw || !ArrayBuffer.isView(raw)) throw new Error('binary');
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (bytes.length < 5 || bytes.length > 262144 || bytes[0] !== 0) throw new Error('frame');
    const size = bytes[1] * 16777216 + bytes[2] * 65536 + bytes[3] * 256 + bytes[4];
    if (size !== bytes.length - 5) throw new Error('length');
    function fields(input) {
      let offset = 0;
      function integer() {
        let value = 0;
        for (let i = 0; i < 10; i++) {
          if (offset >= input.length) throw new Error('truncated');
          const byte = input[offset++];
          value += (byte & 127) * Math.pow(2, 7 * i);
          if (!(byte & 128)) return value;
        }
        throw new Error('varint');
      }
      const result = [];
      while (offset < input.length) {
        if (result.length >= 4096) throw new Error('fields');
        const tag = integer(), number = Math.floor(tag / 8), wire = tag % 8;
        if (!Number.isSafeInteger(tag) || number < 1) throw new Error('tag');
        if (wire === 0) result.push({ number, wire, value: integer() });
        else if (wire === 2) {
          const length = integer();
          if (!Number.isSafeInteger(length) || length < 0 || offset + length > input.length) throw new Error('length');
          result.push({ number, wire, value: input.subarray(offset, offset + length) }); offset += length;
        } else if (wire === 1 || wire === 5) {
          offset += wire === 1 ? 8 : 4;
          if (offset > input.length) throw new Error('truncated');
        } else throw new Error('wire');
      }
      return result;
    }
    function text(data) {
      if (data.length > 1024) throw new Error('text');
      let escaped = '';
      for (const byte of data) escaped += '%' + ('0' + byte.toString(16)).slice(-2);
      return decodeURIComponent(escaped);
    }
    const result = [];
    for (const group of fields(bytes.subarray(5))) {
      if (![1, 2].includes(group.number) || group.wire !== 2) continue;
      for (const icon of fields(group.value)) {
        if (icon.number !== 2 || icon.wire !== 2) continue;
        const values = fields(icon.value);
        const title = values.find(field => field.number === 2 && field.wire === 2);
        const url = values.find(field => field.number === 3 && field.wire === 2);
        const id = values.find(field => field.number === 4 && field.wire === 0);
        if (!title || !url || !id || !Number.isSafeInteger(id.value) || id.value <= 0) continue;
        const name = text(title.value), uri = publicTabURI(text(url.value));
        if (!name.trim() || name.length > 64 || !uri) continue;
        if (!result.some(tab => tab.native_id === id.value)) result.push({ id: 'tab:' + id.value, native_id: id.value, name, uri, source: 'region' });
        if (result.length > 100) throw new Error('limit');
      }
    }
    if (!result.length) throw new Error('empty');
    return result;
  }
  function fetchRegions(callback) {
    if (typeof $httpClient === 'undefined' || typeof $httpClient.post !== 'function') return callback(false);
    $httpClient.post({ url: REGION_URL, headers: { 'Content-Type': 'application/grpc', 'grpc-accept-encoding': 'identity' },
      body: new Uint8Array(5), 'binary-mode': true, 'auto-cookie': false, 'auto-redirect': false, insecure: false, alpn: 'h2', timeout: 3000 }, (error, response, raw) => {
      try {
        if (error || !response || Number(response.status) !== 200) throw new Error('request');
        const headers = Object.assign({}, response.headers, response.h2_trailers);
        const grpcKey = Object.keys(headers).find(key => key.toLowerCase() === 'grpc-status');
        if (grpcKey && String(headers[grpcKey]) !== '0') throw new Error('grpc');
        const entries = regionTabs(raw), state = readTabs();
        for (const tab of entries) {
          const index = state.catalog.findIndex(item => item.id === tab.id);
          if (index >= 0) state.catalog[index] = Object.assign(tab, { enabled: state.catalog[index].source !== 'region' || state.catalog[index].enabled === true });
          else if (state.catalog.length < 100) state.catalog.push(tab);
        }
        if (!saveTabs(state)) throw new Error('storage');
        // 匿名首页补充直播／推荐／热门等基础项，不受账号已启用列表限制。
        if (typeof $httpClient.get !== 'function') return callback(true, entries.length);
        $httpClient.get({ url: 'https://app.bilibili.com/x/resource/show/tab/v2?mobi_app=iphone&platform=ios&build=80000100',
          'auto-cookie': false, 'auto-redirect': false, insecure: false, timeout: 3000 }, (error, response, raw) => {
          try {
            if (error || !response || Number(response.status) !== 200 || typeof raw !== 'string' || raw.length > 262144) throw new Error('home');
            const body = JSON.parse(raw);
            if (body.code !== 0 || !object(body.data) || !Array.isArray(body.data.tab)) throw new Error('schema');
            const latest = readTabs();
            for (const item of body.data.tab) {
              const info = tabInfo(item), uri = object(item) && publicTabURI(item.uri);
              if (!info || !uri || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.tab_id !== 'string') continue;
              const index = latest.catalog.findIndex(tab => tab.id === info.id);
              const tab = Object.assign(info, { source: 'region', native_id: item.id, native_tab_id: item.tab_id, uri,
                enabled: index >= 0 && (latest.catalog[index].source !== 'region' || latest.catalog[index].enabled === true) });
              if (index >= 0) latest.catalog[index] = tab;
              else if (latest.catalog.length < 100) latest.catalog.push(tab);
            }
            if (!saveTabs(latest)) throw new Error('storage');
            callback(true, entries.length, true);
          } catch (_) { callback(true, entries.length, false); }
        });
      } catch (_) { callback(false); }
    });
  }
  function tabsPage(message = '') {
    const state = readTabs();
    const ordered = state.selected === null ? state.catalog : state.selected.map(id => state.catalog.find(tab => tab.id === id)).filter(Boolean).concat(state.catalog.filter(tab => !state.selected.includes(tab.id)));
    const rows = ordered.map(tab => '<div class="tab-row"><label><input type="checkbox" name="tab" value="' + escapeHTML(tab.id) + '"' +
      ((state.selected === null ? !['region', 'custom'].includes(tab.source) || tab.enabled === true : state.selected.includes(tab.id)) ? ' checked' : '') + '><span>' + escapeHTML(tab.name) + '</span></label>' + (tab.source === 'custom' ? '<button class="delete-custom" type="submit" form="custom-delete" name="id" value="' + escapeHTML(tab.id) + '" aria-label="删除自定义标签：' + escapeHTML(tab.name) + '">×</button>' : '') + '<button type="button" class="drag-handle" aria-label="拖动排序：' + escapeHTML(tab.name) + '" title="拖动排序；键盘方向键也可移动">≡</button></div>').join('');
    const selectedTabs = ordered.filter(tab => state.selected === null ? !['region', 'custom'].includes(tab.source) || tab.enabled === true : state.selected.includes(tab.id));
    const preview = selectedTabs.map((tab, index) => '<span class="preview-tab' + (index === 0 ? ' first' : '') + '">' + escapeHTML(tab.name) + '</span>').join('');
    // 所有调整与预览只在页面内完成；点击保存才提交，不轮询或逐项请求。
    const previewScript = `<script>(function(){
      var list=document.getElementById("tab-list"),preview=document.getElementById("tab-preview"),status=document.getElementById("preview-status"),save=document.getElementById("tabs-save");
      if(!list)return;
      function update(){
        var rows=list.children,names=[];
        for(var i=0;i<rows.length;i++){
          var input=rows[i].querySelector("input[name=tab]");
          if(input&&input.checked)names.push(rows[i].querySelector("label span").textContent);
        }
        if(!preview)return;
        preview.textContent="";
        names.forEach(function(name,index){var item=document.createElement("span");item.className="preview-tab"+(index===0?" first":"");item.textContent=name;preview.appendChild(item);});
        if(!names.length){var empty=document.createElement("span");empty.className="preview-empty";empty.textContent="请至少选择一个标签";preview.appendChild(empty);}
        status.textContent="已选 "+names.length+" 项 · 按此顺序显示";
        save.disabled=names.length===0;
      }
      var drag=null,animation=0,pending=null,ignoreClick=false;
      function place(x,y){
        var target=document.elementFromPoint(x,y),row=target&&target.closest(".tab-row");
        if(!row||!list.contains(row)||row===drag.row)return;
        var rows=Array.from(list.children),down=rows.indexOf(drag.row)<rows.indexOf(row);
        list.insertBefore(drag.row,down?row.nextElementSibling:row);update();
      }
      function scroll(){
        if(!drag)return;
        var edge=64,height=window.innerHeight,delta=drag.y<edge?-12:drag.y>height-edge?12:0;
        if(delta){window.scrollBy(0,delta);place(drag.x,drag.y);}
        animation=requestAnimationFrame(scroll);
      }
      function finish(cancel){
        if(!drag)return;
        var ended=drag;drag=null;cancelAnimationFrame(animation);
        if(cancel)ended.order.forEach(function(row){list.appendChild(row);});
        ended.row.classList.remove("dragging");ended.handle.setAttribute("aria-pressed","false");
        if(ended.mode==="pointer"&&typeof list.hasPointerCapture==="function"&&list.hasPointerCapture(ended.id))list.releasePointerCapture(ended.id);
        update();ended.handle.focus({preventScroll:true});
      }
      function begin(row,handle,id,x,y,mode){
        drag={row:row,handle:handle,id:id,x:x,y:y,mode:mode,order:Array.from(list.children)};
        row.classList.add("dragging");handle.setAttribute("aria-pressed","true");
        if(mode==="pointer"&&typeof list.setPointerCapture==="function"){
          try{list.setPointerCapture(id);}catch(_){}
        }
        animation=requestAnimationFrame(scroll);
      }
      function clearPending(){if(pending){clearTimeout(pending.timer);pending=null;}}
      list.addEventListener("pointerdown",function(event){
        // iPhone 触摸走非被动 Touch Events，避免浏览器把拖动交给滚动／取消指针。
        if(event.pointerType==="touch"&&"ontouchstart" in window)return;
        var handle=event.target.closest(".drag-handle");
        if(!handle||!list.contains(handle)||drag||event.isPrimary===false||event.button!==0)return;
        event.preventDefault();ignoreClick=false;
        begin(handle.closest(".tab-row"),handle,event.pointerId,event.clientX,event.clientY,"pointer");
      });
      document.addEventListener("pointermove",function(event){
        if(!drag||drag.mode!=="pointer"||event.pointerId!==drag.id)return;
        event.preventDefault();drag.x=event.clientX;drag.y=event.clientY;place(drag.x,drag.y);
      });
      document.addEventListener("pointerup",function(event){if(drag&&drag.mode==="pointer"&&event.pointerId===drag.id)finish(false);});
      document.addEventListener("pointercancel",function(event){if(drag&&drag.mode==="pointer"&&event.pointerId===drag.id)finish(true);});
      list.addEventListener("touchstart",function(event){
        clearPending();ignoreClick=false;
        if(drag||event.touches.length!==1||event.target.closest(".delete-custom"))return;
        var row=event.target.closest(".tab-row");if(!row||!list.contains(row))return;
        var touch=event.touches[0],handle=row.querySelector(".drag-handle");
        if(event.target.closest(".drag-handle")){
          event.preventDefault();begin(row,handle,touch.identifier,touch.clientX,touch.clientY,"touch");
        }else{
          var candidate={row:row,handle:handle,id:touch.identifier,x:touch.clientX,y:touch.clientY};
          candidate.timer=setTimeout(function(){if(pending!==candidate)return;pending=null;ignoreClick=true;begin(row,handle,candidate.id,candidate.x,candidate.y,"touch");},280);
          pending=candidate;
        }
      },{passive:false});
      document.addEventListener("touchmove",function(event){
        if(pending){
          var first=Array.from(event.touches).find(function(t){return t.identifier===pending.id;});
          if(!first||Math.abs(first.clientX-pending.x)>8||Math.abs(first.clientY-pending.y)>8)clearPending();
        }
        if(!drag||drag.mode!=="touch")return;
        var touch=Array.from(event.touches).find(function(t){return t.identifier===drag.id;});
        if(!touch)return;
        event.preventDefault();drag.x=touch.clientX;drag.y=touch.clientY;place(drag.x,drag.y);
      },{passive:false});
      document.addEventListener("touchend",function(event){
        clearPending();if(!drag||drag.mode!=="touch")return;
        if(Array.from(event.changedTouches).some(function(t){return t.identifier===drag.id;})){
          event.preventDefault();ignoreClick=true;finish(false);
        }
      },{passive:false});
      document.addEventListener("touchcancel",function(){clearPending();if(drag&&drag.mode==="touch"){ignoreClick=true;finish(true);}});
      list.addEventListener("click",function(event){if(ignoreClick){event.preventDefault();event.stopPropagation();ignoreClick=false;}},true);
      list.addEventListener("keydown",function(event){
        if(event.key==="Escape"&&drag){event.preventDefault();finish(true);return;}
        var handle=event.target.closest(".drag-handle");if(!handle||!list.contains(handle)||drag)return;
        var row=handle.closest(".tab-row"),up=["ArrowUp","ArrowLeft"].includes(event.key),down=["ArrowDown","ArrowRight"].includes(event.key);
        if(!up&&!down)return;event.preventDefault();var next=up?row.previousElementSibling:row.nextElementSibling;
        if(next){list.insertBefore(row,up?next:next.nextElementSibling);update();handle.focus({preventScroll:true});}
      });
      list.addEventListener("change",update);update();
    })();</script>`;
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Bilibili 首页标签</title><style>' +
      ':root{color-scheme:light dark}body{font:16px/1.7 -apple-system,sans-serif;margin:0;background:light-dark(#f6f7fb,#14151b);color:light-dark(#202532,#f1f2f7)}main{max-width:620px;margin:auto;padding:24px 18px}h1{font-size:26px}.catalog-count{font-size:13px;margin:8px 0}details{font-size:14px;margin-top:16px}summary{cursor:pointer}p{opacity:.75}label{display:flex;gap:12px;padding:14px;border-bottom:1px solid #8884}input{width:22px;height:22px;accent-color:#fb7299}button,a{display:block;box-sizing:border-box;width:100%;padding:13px;margin:12px 0;border:0;border-radius:12px;text-align:center;font:inherit;background:#fb7299;color:white;text-decoration:none}#tab-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tab-row{display:flex;align-items:center;min-width:0;min-height:44px;border:1px solid #8883;border-radius:10px;background:light-dark(#fff,#20222b)}.tab-row label{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;flex:1;min-width:0;gap:7px;padding:8px 0 8px 9px;border:0;align-items:center;font-size:14px;line-height:1.3}.tab-row input{flex:none;width:18px;height:18px;margin:0}.tab-row span{overflow-wrap:anywhere}.delete-custom{flex:none;width:24px;height:44px;margin:0;padding:0;background:transparent;color:#888;font-size:19px}.custom-form label{display:block;padding:8px 0;border:0}.custom-form input{display:block;box-sizing:border-box;width:100%;height:42px;margin-top:6px;padding:8px 10px;border:1px solid #8884;border-radius:8px;background:light-dark(#fff,#20222b);color:inherit;font:inherit}.drag-handle{flex:none;width:32px;min-height:44px;padding:0;margin:0;background:transparent;color:#888;font-size:23px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.drag-handle:focus-visible{outline:2px solid #fb7299;outline-offset:-3px}.tab-row.dragging{border-color:#fb7299;background:#fb729922;box-shadow:0 0 0 2px #fb729933}.tab-row.dragging .drag-handle{cursor:grabbing;color:#fb7299}@media(min-width:540px){#tab-list{grid-template-columns:repeat(3,minmax(0,1fr))}}.preview-card{position:sticky;top:0;z-index:1;padding:14px 0;background:light-dark(#f6f7fb,#14151b);border-bottom:1px solid #8884}.preview-title{display:flex;justify-content:space-between;gap:8px;font-size:14px}.preview-title small{opacity:.65}#tab-preview{display:flex;gap:24px;overflow-x:auto;white-space:nowrap;padding:12px 4px 4px;min-height:32px}.preview-tab{flex:none;font-size:19px;padding-bottom:7px}.preview-tab.first{color:#fb7299;border-bottom:3px solid #fb7299;font-weight:600}.preview-empty{opacity:.6}#tabs-save:disabled{opacity:.4}.message{padding:12px;background:#fb729922;border-radius:12px}</style></head><body><main><h1>首页标签管理</h1>' +
      (message ? '<div class="message" role="status">' + escapeHTML(message) + '</div>' : '') +
      '<form method="post" action="/tabs/load"><button type="submit">获取全部标签</button></form><p>获取未启用的客户端分区与服务；已获取后无需重复加载。</p>' +
      '<p>勾选显示，按住 ≡ 拖动，或长按标签后排序，预览同步更新。完成后保存并重新打开 B 站。</p>' +
      '<section class="preview-card" aria-label="首页标签预览"><div class="preview-title"><strong>首页标签预览</strong><small id="preview-status" aria-live="polite">已选 ' + selectedTabs.length + ' 项 · 按此顺序显示</small></div><div id="tab-preview">' + (preview || '<span class="preview-empty">请至少选择一个标签</span>') + '</div></section>' +
      '<p class="catalog-count">可选 ' + state.catalog.length + ' 项 · 分区与服务 ' + state.catalog.filter(tab => tab.source === 'region').length + ' 项</p>' +
      (rows ? '<form method="post" action="/tabs/save"><div id="tab-list">' + rows + '</div><button id="tabs-save" type="submit">保存选择与排序</button></form>' : '<p>尚未收到标签，请确认 MitM 已开启并刷新 B 站插件与脚本。</p>') +
      '<form id="custom-delete" method="post" action="/tabs/delete"></form><details><summary>手动添加标签</summary><form class="custom-form" method="post" action="/tabs/add"><label>标签名称<input type="text" name="name" maxlength="64" placeholder="例如：a" required></label><label>对应 URL<input type="text" name="url" maxlength="2048" placeholder="https://example.com 或 bilibili://…" autocapitalize="none" autocorrect="off" spellcheck="false" required></label><p>支持网页链接和 B 站客户端链接。添加后勾选、拖动并保存；自定义项右侧 × 可删除。</p><button type="submit">添加标签</button></form></details>' +
      '<form method="post" action="/tabs/reset"><button type="submit">恢复全部标签</button></form><a href="/tabs">刷新标签列表</a><details><summary>使用说明</summary><p>标签按从左到右、从上到下排序。至少保留一项，新获取项默认不勾选。按住右侧拖动柄直接移动，或长按标签约 0.3 秒再拖动；普通滑动仍可滚动列表，拖到屏幕边缘也可滚动；手势取消会恢复本次拖动前的顺序。键盘方向键也可排序。预览突出第一项仅示意排列，不改变客户端默认选中项。</p><p>设置保存在本机，不依赖日志开关。保存后无需再运行管理按钮或获取全部标签；维持自定义效果需保持插件启用。</p></details></main>' + previewScript + '</body></html>';
  }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function options(raw) {
    let source = raw;
    const result = Object.assign({}, defaults);
    if (typeof source === 'string') {
      if (source.trim().startsWith('{')) source = JSON.parse(source);
      else {
        source = Object.create(null);
        for (const pair of raw.split('&')) {
          const equal = pair.indexOf('=');
          if (equal < 1) continue;
          const decode = text => decodeURIComponent(text.replace(/\+/g, ' '));
          source[decode(pair.slice(0, equal))] = decode(pair.slice(equal + 1));
        }
      }
    }
    if (object(source)) for (const key of Object.keys(defaults)) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (typeof defaults[key] === 'boolean') {
        if (source[key] === true || source[key] === 'true') result[key] = true;
        if (source[key] === false || source[key] === 'false') result[key] = false;
      } else if (typeof source[key] === 'string') result[key] = source[key];
    }
    return result;
  }
  function ad(item) {
    if (!object(item)) return false;
    if (item.is_ad === true || item.is_ad === 1 || item.is_ad === '1') return true;
    if (object(item.ad_info) && Object.keys(item.ad_info).length > 0) return true;
    return ['cm_v2', 'cm_double_v9'].includes(item.card_type) &&
      ['ad_web_s', 'ad_av', 'ad_web_gif', 'ad_player', 'ad_inline_3d', 'ad_inline_eggs', 'ad_inline_av'].includes(item.card_goto);
  }
  function memberShop(item) {
    // 只识别商品跳转／明确的会员购标签，不按视频标题或 UP 主名称过滤。
    if (item.card_goto === 'mall') return true;
    if (object(item.rcmd_reason_style) && item.rcmd_reason_style.text === '会员购') return true;
    if (object(item.desc_button) && item.desc_button.text === '会员购') return true;
    return typeof item.uri === 'string' &&
      /^(?:bilibili:\/\/mall(?:[/?#]|$)|https?:\/\/mall\.bilibili\.com(?::443)?(?:[/?#]|$))/i.test(item.uri);
  }
  function losslessJSON(raw) {
    // 先校验原文，避免占位替换将异常 JSON 意外修复为合法数据。
    let value = JSON.parse(raw);
    let prefix = '__bili_raw_number__';
    const normalized = JSON.stringify(value);
    for (let attempts = 0; raw.includes(prefix) || normalized.includes(prefix); attempts++) {
      if (attempts >= 16) throw new Error('number marker collision');
      prefix += '_';
    }
    const numbers = new Map();
    const strings = /"(?:[^"\\]|\\[\s\S])*"/g;
    const masked = raw.replace(/"(?:[^"\\]|\\[\s\S])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
      if (token[0] === '"') return token;
      const number = Number(token);
      if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number))) return token;
      const marker = JSON.stringify(prefix + numbers.size);
      numbers.set(marker, token);
      return marker;
    });
    if (numbers.size) value = JSON.parse(masked);
    return {
      value,
      text: number => numbers.get(JSON.stringify(number)) || String(number),
      stringify: data => {
        const serialized = JSON.stringify(data);
        return numbers.size ? serialized.replace(strings, token => numbers.get(token) || token) : serialized;
      }
    };
  }
  const LOG_KEY = 'bilibili.enhance.logs.v1';
  const NOTICE_KEY = 'bilibili.enhance.notice.v1';
  const LIMIT = 300;
  const rpcPaths = [
    DEFAULT_WORDS_PATH,
    '/bilibili.community.service.dm.v1.DM/DmView', '/x/v2/dm/web/view',
    '/bilibili.app.view.v1.View/ViewProgress', '/bilibili.app.viewunite.v1.View/ViewProgress',
    '/bilibili.app.view.v1.View/RelatesFeed', '/bilibili.app.viewunite.v1.View/RelatesFeed',
    '/bilibili.app.view.v1.View/View', '/bilibili.app.viewunite.v1.View/View',
    '/bilibili.app.dynamic.v2.Dynamic/DynAll', '/bilibili.app.show.v1.Popular/Index',
    '/bilibili.app.playurl.v1.PlayURL/PlayView', '/bilibili.app.playerunite.v1.Player/PlayViewUnite'
  ];
  const outcomes = ['modified', 'unchanged', 'http_error', 'unsupported_body', 'api_error', 'invalid_json', 'unsupported_schema', 'metadata_only'];
  const cardTypes = ['small_cover_v2', 'small_cover_v10', 'banner_v8', 'cm_v2', 'cm_double_v9'];
  const cardGotos = ['av', 'live', 'live_rcmd', 'game', 'mall', 'banner', 'ad_web_s', 'ad_av', 'ad_web_gif', 'ad_player', 'ad_inline_3d', 'ad_inline_eggs', 'ad_inline_av'];
  const fields = ['data', 'type', 'items', 'list', 'event_list', 'top_list', 'show', 'tab', 'top', 'bottom', 'card_type', 'card_goto', 'is_ad', 'ad_info', 'banner_item', 'args', 'title'].concat(memberPromoFields);
  function kind(value) {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : object(value) ? 'object' :
      ['string', 'number', 'boolean'].includes(typeof value) ? typeof value : 'other';
  }
  function schema(value) {
    const result = {};
    if (object(value)) for (const key of fields) if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = kind(value[key]);
    return result;
  }
  function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 2097152 ? value : 0; }
  // 重新投影存储中的每条记录，防止污染或旧数据在页面／导出中泄漏任意字符串。
  function safeEvent(event) {
    if (!object(event)) return null;
    const endpoints = Object.keys(paths).concat(rpcPaths, ['other_api']);
    if (!endpoints.includes(event.endpoint) || !outcomes.includes(event.outcome)) return null;
    const result = {
      time: typeof event.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.time) ? event.time : '',
      endpoint: event.endpoint, outcome: event.outcome,
      method: ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(event.method) ? event.method : 'OTHER',
      status: Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : null,
      before: count(event.before), after: count(event.after), removed: count(event.removed),
      body_length: count(event.body_length)
    };
    // 不保存接口 message、原始字段名、字段值、标题、UID 或广告对象内容。
    for (const name of ['data_schema', 'item_schema']) {
      result[name] = {};
      if (object(event[name])) for (const key of fields) {
        if (['null', 'array', 'object', 'string', 'number', 'boolean', 'other'].includes(event[name][key])) result[name][key] = event[name][key];
      }
    }
    result.cards = [];
    if (Array.isArray(event.cards)) for (const card of event.cards.slice(0, 20)) if (object(card)) result.cards.push({
      type: cardTypes.includes(card.type) ? card.type : 'other',
      goto: cardGotos.includes(card.goto) ? card.goto : 'other', count: count(card.count)
    });
    return result;
  }
  function readLogs() {
    const raw = $persistentStore.read(LOG_KEY);
    if (!raw) return { events: [], evicted: 0 };
    if (typeof raw !== 'string' || raw.length > 262144) throw new Error('storage');
    const value = JSON.parse(raw);
    if (!object(value) || !Array.isArray(value.events) || value.events.length > LIMIT) throw new Error('storage');
    return { events: value.events.map(safeEvent).filter(Boolean), evicted: count(value.evicted) };
  }
  function saveLogs(state) {
    let raw = JSON.stringify(state);
    while (raw.length > 262144 && state.events.length) {
      state.events.shift(); state.evicted++; raw = JSON.stringify(state);
    }
    if ($persistentStore.write(raw, LOG_KEY) !== true) throw new Error('storage');
  }
  function append(event) {
    try {
      const state = readLogs();
      state.events.push(safeEvent(event));
      while (state.events.length > LIMIT) { state.events.shift(); state.evicted++; }
      saveLogs(state);
    } catch (_) { /* 日志故障不得影响过滤，不输出异常内容。 */ }
  }
  function syncLogging(config) {
    if (config.log_enabled) return true;
    try {
      // 无需解析旧数据：关闭时也能清空损坏或旧版本留下的日志。
      const raw = $persistentStore.read(LOG_KEY);
      const empty = JSON.stringify({ events: [], evicted: 0 });
      if (raw && raw !== empty && $persistentStore.write(empty, LOG_KEY) !== true) return false;
      if ($persistentStore.read(NOTICE_KEY) === 'on') $persistentStore.write('off', NOTICE_KEY);
      return true;
    } catch (_) { return false; }
  }
  function notifyLogging(config, manual = false) {
    try {
      const previous = $persistentStore.read(NOTICE_KEY);
      if (!config.log_enabled && previous === 'on') $persistentStore.write('off', NOTICE_KEY);
      if (!manual && (!config.log_enabled || previous === 'on')) return;
      if (typeof $notification === 'undefined' || typeof $notification.post !== 'function') return;
      if (config.log_enabled && $persistentStore.write('on', NOTICE_KEY) !== true) return;
      $notification.post('Bilibili 开发日志', config.log_enabled ? '日志已开启' : '打开日志页',
        '点击此通知，在浏览器查看、导出或清空记录。', { openUrl: 'http://bilibili-logs.invalid/' });
    } catch (_) { /* 通知与存储异常不影响业务，不输出异常内容。 */ }
  }
  function renderPage(state, config, cleared = false) {
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const labels = { modified: '已过滤', unchanged: '无需修改', http_error: '响应异常', unsupported_body: '正文未处理', api_error: '接口异常', invalid_json: '解析后放行', unsupported_schema: '结构未识别', metadata_only: '仅元数据' };
    const removed = state.events.reduce((sum, entry) => sum + entry.removed, 0);
    const rows = state.events.slice(-20).reverse().map(entry => {
      const time = entry.time && Number.isFinite(Date.parse(entry.time)) ? new Date(Date.parse(entry.time) + 8 * 3600000).toISOString().slice(5, 19).replace('T', ' ') : '时间未知';
      return '<article class="record"><div class="record-head"><time>' + escape(time) + '</time><span class="result">' + labels[entry.outcome] + '</span></div><p class="endpoint">' + escape(entry.endpoint) + '</p><div class="record-meta"><span>HTTP ' + (entry.status || '—') + '</span><span>' + entry.before + ' → ' + entry.after + ' 项</span><span>移除 ' + entry.removed + ' 项</span></div></article>';
    }).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Bilibili 开发日志</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20256%20256%22%3E%3Crect%20width%3D%22256%22%20height%3D%22256%22%20rx%3D%2256%22%20fill%3D%22%23fb7299%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%23fff%22%20stroke-width%3D%2214%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M92%2044l22%2024m50-24l-22%2024%22%2F%3E%3Crect%20x%3D%2249%22%20y%3D%2275%22%20width%3D%22158%22%20height%3D%22121%22%20rx%3D%2224%22%2F%3E%3Cpath%20d%3D%22M91%20112v25m74-25v25m-48%2021h22M84%20198v12m88-12v12%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E"><style>
      :root{color-scheme:light dark;--bg:#f6f7fb;--panel:#fff;--text:#202532;--muted:#6d7485;--line:#e8ebf1;--accent:#d83c75;--soft:#fff0f5;--green:#138356;--danger:#bd3045}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:760px;margin:0 auto;padding:24px 18px 40px;padding-bottom:calc(40px + env(safe-area-inset-bottom))}.brand-icon{width:48px;height:48px;flex:none;border-radius:12px}.brand-icon svg{display:block;width:100%;height:100%}.heading{display:flex;align-items:center;gap:12px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 22px}h1{font-size:24px;letter-spacing:-.5px;margin:0}.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:2px;margin:0 0 5px}.status{font-size:12px;white-space:nowrap;border-radius:24px;padding:6px 12px;background:var(--line);color:var(--muted)}.status.on{background:#e5f5ed;color:var(--green)}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px}.stat,.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px}.stat{padding:16px 12px}.stat strong{display:block;font-size:27px;line-height:1.2}.stat span{display:block;margin-top:7px;color:var(--muted);font-size:12px}.panel{padding:18px;margin-top:16px}h2{font-size:17px;margin:0 0 12px}p{margin:8px 0;color:var(--muted)}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}a,button{-webkit-tap-highlight-color:transparent;display:block;width:100%;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);font:inherit;font-weight:600;text-decoration:none;text-align:center;padding:12px;min-height:48px;cursor:pointer}.primary{background:var(--accent);color:white;border-color:var(--accent)}form{grid-column:1/-1;margin:0}.clear{color:var(--danger);background:var(--soft);border-color:transparent}.note{font-size:13px;margin-top:14px}.success{padding:12px 16px;background:#e5f5ed;color:var(--green);border-radius:12px;margin-bottom:16px}.empty{text-align:center;padding:18px 10px}.empty strong{display:block;margin-bottom:8px}.record{border-top:1px solid var(--line);padding:14px 0}.record:last-child{padding-bottom:0}.record-head,.record-meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px}.result{color:var(--accent)}.endpoint{color:var(--text);font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;margin:9px 0}.record-meta{justify-content:flex-start;flex-wrap:wrap;gap:8px 16px}details{color:var(--muted);font-size:13px}summary{cursor:pointer;color:var(--text);font-weight:600}footer{font-size:12px;color:var(--muted);text-align:center;margin-top:22px}@media(prefers-color-scheme:dark){:root{--bg:#14151b;--panel:#20222c;--text:#f1f2f7;--muted:#a4aabd;--line:#343744;--soft:#352330;--accent:#fa79a7;--danger:#ff9ba9}.status.on,.success{background:#18372d;color:#8de0b8}.primary{color:#25141b}}@media(max-width:360px){main{padding:16px 12px}h1{font-size:21px}.stat{padding:14px 9px}}
      </style></head><body><main><header><div class="heading"><div class="brand-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#fb7299"/><g fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M92 44l22 24m50-24l-22 24"/><rect x="49" y="75" width="158" height="121" rx="24"/><path d="M91 112v25m74-25v25m-48 21h22M84 198v12m88-12v12"/></g></svg></div><div><p class="eyebrow">BILIBILI</p><h1>开发日志</h1></div></div><span class="status ${config.log_enabled ? 'on' : ''}">${config.log_enabled ? '● 记录中' : '已关闭'}</span></header>
      ${cleared ? '<div class="success" role="status">记录已清空。' + (config.log_enabled ? '日志仍在开启，新请求会继续记录。' : '日志保持关闭。') + '</div>' : ''}
      <section class="stats" aria-label="日志统计"><div class="stat"><strong>${state.events.length}</strong><span>已保存记录</span></div><div class="stat"><strong>${removed}</strong><span>已移除项目</span></div><div class="stat"><strong>${state.evicted}</strong><span>已淘汰记录</span></div></section>
      <section class="panel"><h2>记录管理</h2><div class="actions"><a class="primary" href="/export" download="bilibili-development.log">导出日志</a><a href="/">刷新记录</a><form method="post" action="/clear"><button class="clear" type="submit">清空记录</button></form></div><p class="note">${config.log_enabled ? '开启后自动记录。请先导出文件，再关闭日志；关闭后会自动清空记录。' : '日志已关闭，记录会自动清空。开启「开发日志」后刷新 B 站首页即可自动记录。'}</p></section>
      <section class="panel"><h2>最近记录 <small style="font-size:12px;color:var(--muted);font-weight:400">最多展示 20 条</small></h2>${rows || '<div class="empty"><strong>还没有记录</strong><p>' + (config.log_enabled ? '打开 Bilibili 并刷新首页，再回来刷新记录。' : '开启日志后，打开 Bilibili 并刷新首页。') + '</p></div>'}</section>
      <section class="panel"><details><summary>隐私与记录范围</summary><p>记录仅保存在本机，最多保留 300 条。只保存接口类别、处理结果、数量和白名单结构类型，不保存令牌、Cookie、查询参数、标题、UID 或原始正文。</p><p>仅记录可被 Loon 解密的 app.bilibili.com 响应；二进制接口只记元数据。并发请求可能丢失部分记录。</p></details></section><footer>时间显示为北京时间 · Bilibili 增强 1.9.0</footer></main></body></html>`;
  }
  function localPage(request, local, config) {
    function respond(status, type, body, extra = {}) {
      return $done({ response: { status, headers: Object.assign({
        'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      }, extra), body } });
    }
    try {
      if (!syncLogging(config)) throw new Error('storage');
      const path = (local[1] || '/').split('?')[0];
      const method = request.method || 'GET';
      if (path.startsWith('/tabs')) {
        if (path === '/tabs' && method === 'GET') return respond(200, 'text/html', tabsPage());
        if (!['/tabs/save', '/tabs/reset', '/tabs/load', '/tabs/add', '/tabs/delete'].includes(path)) return respond(404, 'text/plain', '页面不存在');
        if (method !== 'POST') return respond(405, 'text/plain', '请使用页面按钮', { Allow: 'POST' });
        const headers = request.headers || {};
        const originKey = Object.keys(headers).find(key => key.toLowerCase() === 'origin');
        const origin = originKey && headers[originKey];
        if (origin && origin !== 'null' && !['http://bilibili-logs.invalid', 'http://bilibili-logs.invalid:80'].includes(origin)) return respond(403, 'text/plain', '请在本地标签页操作');
        if (path === '/tabs/load') return fetchRegions((success, total, homepage) => respond(success ? 200 : 503, 'text/html', tabsPage(success ?
          '已获取 ' + total + ' 个分区与服务，包含未在首页启用的项。' + (homepage === false ? '基础首页标签补充失败，可稍后重试；分区列表已保留。' : '请勾选并保存。') : '完整列表获取失败，已保留现有标签与选择，请稍后重试。')));
        const state = readTabs();
        if (path === '/tabs/add' || path === '/tabs/delete') {
          if (typeof request.body !== 'string' || request.body.length > 32768) return respond(400, 'text/html', tabsPage('请填写有效的名称和 URL。'));
          const form = Object.create(null);
          try {
            for (const pair of request.body.split('&')) {
              const equal = pair.indexOf('=');
              if (equal < 1) continue;
              const key = pair.slice(0, equal);
              if (['name', 'url', 'id'].includes(key)) form[key] = decodeURIComponent(pair.slice(equal + 1).replace(/\+/g, ' '));
            }
          } catch (_) { return respond(400, 'text/html', tabsPage('输入格式不正确，请重试。')); }
          let message;
          if (path === '/tabs/add') {
            const name = typeof form.name === 'string' ? form.name.trim() : '', uri = customTabURI(form.url);
            if (!name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name) || !uri) return respond(400, 'text/html', tabsPage('请填写名称和有效的 http(s):// 或 bilibili:// 链接，不支持凭据参数。'));
            if (state.catalog.length >= 100) return respond(400, 'text/html', tabsPage('标签已达 100 项，请先删除不需要的自定义标签。'));
            if (state.catalog.some(tab => tab.source === 'custom' && tab.name === name && tab.uri === uri)) return respond(400, 'text/html', tabsPage('相同的自定义标签已存在。'));
            let nativeID = 900000001;
            while (state.catalog.some(tab => tab.native_id === nativeID || tab.id === 'tab:loon_custom_' + nativeID)) nativeID++;
            state.catalog.push({ id: 'tab:loon_custom_' + nativeID, source: 'custom', native_id: nativeID, native_tab_id: 'loon_custom_' + nativeID, name, uri });
            message = '自定义标签已添加，请勾选并保存选择与排序。';
          } else {
            const target = state.catalog.find(tab => tab.id === form.id && tab.source === 'custom');
            if (!target) return respond(400, 'text/html', tabsPage('只能删除已存在的自定义标签。'));
            state.catalog = state.catalog.filter(tab => tab !== target);
            if (state.selected !== null) state.selected = state.selected.filter(id => id !== target.id);
            message = '自定义标签已删除，请重新打开 B 站。';
            if (state.selected !== null && !state.selected.length) { state.selected = null; message += '已恢复客户端原有标签。'; }
          }
          if (!saveTabs(state)) return respond(503, 'text/html', tabsPage('标签设置保存失败，请稍后重试。'));
          return respond(200, 'text/html', tabsPage(message));
        }
        if (path === '/tabs/reset') state.selected = null;
        else {
          if (typeof request.body !== 'string' || request.body.length > 32768) return respond(400, 'text/html', tabsPage('请选择至少一个标签。'));
          const selected = [];
          for (const pair of request.body.split('&')) {
            const equal = pair.indexOf('=');
            if (pair.slice(0, equal) !== 'tab') continue;
            const id = decodeURIComponent(pair.slice(equal + 1).replace(/\+/g, ' '));
            if (!state.catalog.some(tab => tab.id === id)) return respond(400, 'text/html', tabsPage('标签列表已变化，请刷新后选择。'));
            if (!selected.includes(id)) selected.push(id);
          }
          if (!selected.length) return respond(400, 'text/html', tabsPage('请至少保留一个首页标签。'));
          state.selected = selected;
        }
        if (!saveTabs(state)) return respond(503, 'text/plain', '标签设置保存失败，请稍后重试。');
        return respond(200, 'text/html', tabsPage(path === '/tabs/reset' ? '已恢复全部标签，请重新打开 B 站。' : '选择与排序已保存，请重新打开 B 站。'));
      }
      if (path === '/clear') {
        if (method !== 'POST') return respond(405, 'text/plain', '请使用页面清空按钮', { Allow: 'POST' });
        const headers = request.headers || {};
        const originKey = Object.keys(headers).find(key => key.toLowerCase() === 'origin');
        const origin = originKey && headers[originKey];
        // Safari / 代理本地响应可能没有 Origin 或提供 null；不再依赖页面 nonce。
        if (origin && origin !== 'null' && !['http://bilibili-logs.invalid', 'http://bilibili-logs.invalid:80'].includes(origin)) return respond(403, 'text/plain', '请在本地日志页使用清空按钮');
        const state = { events: [], evicted: 0 };
        saveLogs(state);
        return respond(200, 'text/html', renderPage(state, config, true));
      }
      const state = readLogs();
      if (path === '/' && method === 'GET') {
        return respond(200, 'text/html', renderPage(state, config));
      }
      if (path === '/export' && method === 'GET') {
        const header = { format: 'bilibili-development-log', version: 1, exported: new Date().toISOString(), count: state.events.length, evicted: state.evicted };
        return respond(200, 'text/plain', [header, ...state.events].map(value => JSON.stringify(value)).join('\n') + '\n', { 'Content-Disposition': 'attachment; filename="bilibili-development.log"' });
      }
      return respond(404, 'text/plain', '页面不存在');
    } catch (_) { return respond(503, 'text/plain', '日志存储不可用；未覆盖已有记录。'); }
  }
  let event = null;
  let config;
  function finish(result, outcome) {
    if (event && config.log_enabled) { event.outcome = outcome; append(event); }
    return $done(result);
  }
  try {
    const request = typeof $request === 'object' && $request;
    const response = typeof $response === 'object' && $response;
    config = options(typeof $argument === 'undefined' ? null : $argument);
    if (!request) {
      syncLogging(config);
      if (typeof $script === 'object' && $script && $script.name === 'Bilibili 首页标签管理') {
        if (typeof $notification !== 'undefined') $notification.post('Bilibili 首页标签', '管理首页上方标签', '点击通知，选择要保留的标签。', { openUrl: 'http://bilibili-logs.invalid/tabs' });
        return $done({});
      }
      const manual = typeof $script === 'object' && $script && $script.name === 'Bilibili 打开日志页';
      notifyLogging(config, manual);
      return $done({});
    }
    const local = /^http:\/\/bilibili-logs\.invalid(?::80)?(\/[^#]*)?$/.exec(String(request.url || ''));
    if (local) return localPage(request, local, config);
    const videoMatch = /^https:\/\/(?:app\.bilibili\.com|grpc\.biliapi\.net|app\.biliapi\.net)(?::443)?(\/(?:bilibili\.app\.(?:view|viewunite)\.v1\.View\/(?:View|RelatesFeed|ViewProgress)|bilibili\.community\.service\.dm\.v1\.DM\/DmView))(?:\?[^#]*)?$/.exec(String(request.url || ''));
    const webDmMatch = /^https:\/\/api\.bilibili\.com(?::443)?(\/x\/v2\/dm\/web\/view)(?:\?[^#]*)?$/.exec(String(request.url || ''));
    const binaryMatch = videoMatch || webDmMatch;
    if (binaryMatch && request.method === (webDmMatch ? 'GET' : 'POST')) {
      if (!response) {
        if (webDmMatch) return $done({});
        const headers = Object.assign({}, request.headers || {});
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'grpc-accept-encoding') delete headers[key];
        headers['grpc-accept-encoding'] = 'identity';
        return $done({ headers });
      }
      syncLogging(config); notifyLogging(config);
      const status = Number(response.statusCode || response.status || 200);
      if (config.log_enabled) event = { time: new Date().toISOString(), endpoint: binaryMatch[1], method: webDmMatch ? 'GET' : 'POST', status,
        body_length: ArrayBuffer.isView(response.body) ? response.body.byteLength : 0, before: 0, after: 0, removed: 0 };
      if (status < 200 || status >= 300) return finish({}, 'http_error');
      const headers = Object.assign({}, response.headers, response.h2_trailers);
      const grpcKey = Object.keys(headers).find(key => key.toLowerCase() === 'grpc-status');
      if (grpcKey && String(headers[grpcKey]) !== '0') return finish({}, 'api_error');
      try {
        const result = videoAds(response.body, VIDEO_RPC[binaryMatch[1]], !webDmMatch);
        if (event) { event.before = result.removed; event.removed = result.removed; }
        return finish(result.body ? { body: result.body } : {}, result.body ? 'modified' : 'unchanged');
      } catch (_) { return finish({}, 'unsupported_body'); }
    }
    // 定向本地响应，不读取请求正文或凭据，也不把其他 RPC 纳入正文处理。
    if (!response && /^https:\/\/(?:app\.bilibili\.com|grpc\.biliapi\.net|app\.biliapi\.net)(?::443)?\/bilibili\.app\.interface\.v1\.Search\/DefaultWords(?:\?[^#]*)?$/.test(String(request.url || '')) && request.method === 'POST') {
      syncLogging(config);
      notifyLogging(config);
      if (config.log_enabled) event = { time: new Date().toISOString(), endpoint: DEFAULT_WORDS_PATH, method: 'POST', status: 200,
        body_length: 0, before: 0, after: 0, removed: 0 };
      return finish(blankDefaultWords(), 'modified');
    }
    if (!response) return $done({});
    // 不依赖代理脚本环境是否提供 URL 类。
    const match = /^https:\/\/(?:app\.bilibili\.com|app\.biliapi\.net)(?::443)?(\/[^?#]*)(?:\?[^#]*)?$/.exec(String(request.url || ''));
    const route = match && paths[match[1]];
    const status = Number(response.statusCode || response.status || 200);
    if (!match) return $done({});
    syncLogging(config);
    notifyLogging(config);
    if (config.log_enabled) event = {
      time: new Date().toISOString(), endpoint: (route || rpcPaths.includes(match[1])) ? match[1] : 'other_api',
      method: request.method || 'GET', status, body_length: route && typeof response.body === 'string' ? response.body.length : 0
    };
    if (!route || (request.method && request.method !== 'GET')) return finish({}, 'metadata_only');
    if (!Number.isFinite(status) || status < 200 || status >= 300) return finish({}, 'http_error');
    if (typeof response.body !== 'string' || response.body.length > 2097152) return finish({}, 'unsupported_body');
    const json = losslessJSON(response.body);
    const body = json.value;
    if (!object(body) || body.code !== 0) return finish({}, 'api_error');
    if (!(route === 'search_square' ? Array.isArray(body.data) :
      route === 'search_defaultwords' ? Array.isArray(body.data) || object(body.data) : object(body.data))) return finish({}, 'unsupported_schema');
    const data = body.data;
    const contentCount = () => Array.isArray(body.data) ? body.data.length :
      ['items', 'list', 'event_list', 'show', 'tab', 'top', 'bottom'].concat(route === 'search_trending' ? ['top_list'] : [])
        .reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0) +
        (route === 'mine' ? memberPromoFields.filter(key => Object.prototype.hasOwnProperty.call(data, key) && data[key] !== null).length : 0);
    if (event) {
      event.data_schema = Array.isArray(data) ? schema(body) : schema(data);
      event.before = contentCount();
      const items = Array.isArray(data.items) ? data.items : [];
      event.item_schema = {};
      event.cards = [];
      for (const item of items.slice(0, 200)) if (object(item)) {
        Object.assign(event.item_schema, schema(item));
        const type = cardTypes.includes(item.card_type) ? item.card_type : 'other';
        const goto = cardGotos.includes(item.card_goto) ? item.card_goto : 'other';
        const found = event.cards.find(card => card.type === type && card.goto === goto);
        if (found) found.count++;
        else if (event.cards.length < 20) event.cards.push({ type, goto, count: 1 });
      }
    }
    let changed = false;
    function filter(parent, key, keep) {
      if (!Array.isArray(parent[key])) return;
      const previous = parent[key];
      const next = previous.filter(keep);
      if (next.length !== previous.length) { parent[key] = next; changed = true; }
    }
    if (route === 'mine') {
      // 默认隐藏开通／续订大会员的推广模块，不修改 vip 身份或其他服务入口。
      for (const key of memberPromoFields) if (Object.prototype.hasOwnProperty.call(data, key)) {
        delete data[key]; changed = true;
      }
    }
    if (route === 'search_default' || route === 'search_defaultwords') {
      // 仅清空专用默认词响应；不修改用户输入、搜索历史、联想或搜索结果。
      if (Array.isArray(body.data)) {
        if (body.data.length) { body.data = []; changed = true; }
      } else {
        for (const key of ['show', 'show_name', 'name', 'word', 'keyword', 'param', 'goto', 'value', 'uri']) if (typeof data[key] === 'string' && data[key] !== '') {
          data[key] = ''; changed = true;
        }
        for (const key of ['list', 'items', 'default_words', 'defaultwords', 'words']) filter(data, key, () => false);
      }
    }
    if (config.hide_search_discovery) {
      if (route === 'search_square') {
        // 公开 App 响应的模块类型：trending 为热搜，recommend 为搜索发现。
        // 保留 history 和所有未知模块，不按标题猜测类型。
        filter(body, 'data', module => !object(module) || !['trending', 'recommend'].includes(module.type));
      } else if (route === 'search_trending') {
        for (const key of ['list', 'top_list']) filter(data, key, () => false);
      }
    }
    if (route === 'splash' && config.remove_splash_ads) {
      // 仅清理开屏投放列表，保留启动配置和其他未知字段。
      for (const key of ['list', 'show', 'event_list']) if (Array.isArray(data[key]) && data[key].length) {
        data[key] = []; changed = true;
      }
    }
    if (route === 'feed') {
      const uids = new Set(config.blocked_uids.split(/[\s,，;；]+/).filter(uid => /^\d+$/.test(uid)));
      // 关键词使用字面包含匹配，以换行或逗号分隔；不执行用户输入的正则表达式。
      const keywords = config.blocked_keywords.split(/[\n,，]+/).map(word => word.trim().toLowerCase()).filter(Boolean);
      filter(data, 'items', item => {
        if (!object(item)) return true;
        if (config.remove_feed_ads && ad(item)) return false;
        if (config.hide_live && ['live', 'live_rcmd'].includes(item.card_goto)) return false;
        if (config.hide_game && item.card_goto === 'game') return false;
        if (config.hide_member_shop && memberShop(item)) return false;
        const uid = object(item.args) ? item.args.up_id : undefined;
        if (uid !== undefined && uids.has(json.text(uid))) return false;
        if (typeof item.title === 'string' && keywords.some(word => item.title.toLowerCase().includes(word))) return false;
        if (config.remove_feed_ads && item.card_type === 'banner_v8' && item.card_goto === 'banner' && Array.isArray(item.banner_item)) {
          filter(item, 'banner_item', banner => !object(banner) || banner.type !== 'ad');
          if (item.banner_item.length === 0) return false;
        }
        return true;
      });
    }
    if (route === 'tab') {
      if (Array.isArray(data.tab)) {
        const state = readTabs();
        let catalogChanged = false;
        for (const item of data.tab) {
          const tab = tabInfo(item);
          if (!tab) continue;
          const existing = state.catalog.find(entry => entry.id === tab.id);
          if (existing) {
            if (existing.name !== tab.name) { existing.name = tab.name; catalogChanged = true; }
            if (existing.source === 'region' && existing.enabled !== true) { existing.enabled = true; catalogChanged = true; }
          } else if (state.catalog.length < 100) { state.catalog.push(tab); catalogChanged = true; }
        }
        if (catalogChanged) saveTabs(state);
        const additions = state.selected === null ? [] : state.catalog.filter(tab => ['region', 'custom'].includes(tab.source) && state.selected.includes(tab.id) &&
          !data.tab.some(item => { const info = tabInfo(item); return info && info.id === tab.id; }));
        // 已选的隐藏分区可由受限公开路由新增；没有任何可用选项时保留原导航。
        if (state.selected !== null && (additions.length || data.tab.some(item => { const tab = tabInfo(item); return tab && state.selected.includes(tab.id); }))) {
          const before = data.tab;
          filter(data, 'tab', item => { const tab = tabInfo(item); return !tab || state.selected.includes(tab.id); });
          if (additions.length) {
            data.tab = data.tab.concat(additions.map(tab => ({ id: tab.native_id, tab_id: tab.native_tab_id || String(tab.native_id), name: tab.name, uri: tab.uri, pos: 0 })));
            changed = true;
          }
          // 按保存时的勾选顺序排列可识别标签；未知结构保留在原槽位。
          const known = data.tab.filter(item => tabInfo(item)).sort((a, b) => state.selected.indexOf(tabInfo(a).id) - state.selected.indexOf(tabInfo(b).id));
          let cursor = 0;
          const ordered = data.tab.map(item => tabInfo(item) ? known[cursor++] : item);
          if (ordered.some((item, index) => item !== data.tab[index])) { data.tab = ordered; changed = true; }
          if (data.tab !== before) {
            const hasDefault = data.tab.some(item => object(item) && item.default_selected === 1);
            const firstSelected = data.tab.find(item => { const tab = tabInfo(item); return tab && state.selected.includes(tab.id); });
            data.tab.forEach((item, index) => {
              if (!object(item)) return;
              if (typeof item.pos === 'number') item.pos = index + 1;
              if (!hasDefault) item.default_selected = item === firstSelected ? 1 : 0;
            });
          }
        }
      }
      for (const key of ['top', 'bottom']) {
        const before = data[key];
        filter(data, key, item => {
          if (!object(item)) return true;
          if (config.hide_game && item.name === '游戏中心') return false;
          if (config.hide_member_shop && (item.name === '会员购' || item.tab_id === '会员购Bottom')) return false;
          return !(config.hide_publish && item.name === '发布');
        });
        if (data[key] !== before) data[key].forEach((item, index) => {
          if (object(item) && typeof item.pos === 'number') item.pos = index + 1;
        });
      }
    }
    if (event) {
      event.after = contentCount();
      event.removed = Math.max(0, event.before - event.after);
    }
    return finish(changed ? { body: json.stringify(body) } : {}, changed ? 'modified' : 'unchanged');
  } catch (_) {
    // 不输出请求 URL、Cookie、账号数据或响应正文。
    return finish({}, 'invalid_json');
  }
})();
