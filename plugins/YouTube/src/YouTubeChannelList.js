/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 文件：YouTubeChannelList.js
 * 功能：仅在 Loon 定时或手动任务下载频道文本名单；信息流过滤不发起网络请求。
 * 更新时间：2026-10-07
 */
(function () {
  'use strict';
  var KEY = 'ytads.channels.remote.v1';
  var args = typeof $argument === 'object' && $argument ? $argument : {};
  var finished = false, timer = null;
  /** 功能：只报告状态及条目数，完成后忽略迟到回调，不输出名单地址或内容。更新时间：2026-10-07。 */
  function finish(content) {
    if (finished) return;
    finished = true;
    if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
    console.log('[YouTubeChannelList] ' + content);
    $done({title:'YouTube UP 主名单',content:content});
  }
  if (typeof $loon !== 'string' || typeof $request !== 'undefined' || typeof $response !== 'undefined') return $done({});
  var url = typeof args.blocked_channels_url === 'string' ? args.blocked_channels_url.trim() : '';
  if (!url) return finish('远程名单未启用；手动名单不受影响。');
  // 仅接受公开 HTTPS 文本直链；不发送凭据，不接受带用户信息、查询参数或片段的 URL。
  if (url.length > 2048 || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?::443)?\/[^\s?#<>]*$/i.test(url)) return finish('地址无效：请填写公开 HTTPS 文本直链。');
  if (typeof $persistentStore === 'undefined' || typeof $httpClient === 'undefined' || typeof $httpClient.get !== 'function') return finish('当前环境无法更新名单；已有缓存保留。');
  /** 功能：按 UTF-8 字节数限制文本，拒绝孤立代理字符。更新时间：2026-10-07。 */
  function size(text) {
    var bytes=0;for(var i=0;i<text.length;i++){var c=text.charCodeAt(i);
      if(c<128)bytes++;else if(c<2048)bytes+=2;else if(c>=0xd800&&c<=0xdbff){var next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error('invalid-utf8');bytes+=4;}
      else if(c>=0xdc00&&c<=0xdfff)throw Error('invalid-utf8');else bytes+=3;
    }return bytes;
  }
  /** 功能：验证文本名单，拒绝网页、脚本、JSON、超限和无效频道 URL；空文件可清空远程名单。更新时间：2026-10-07。 */
  function list(data) {
    if (typeof data !== 'string' || data.length > 65536 || size(data)>65536 || /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data)) throw Error('invalid-list');
    var plain = data.replace(/^\uFEFF/, '').split(/\r?\n/).filter(/** 功能：忽略整行注释。更新时间：2026-10-07。 */ function (line) {return !/^\s*#/.test(line);}).join(' ').trim();
    if (!plain) return '';
    var tokens = plain.split(/\s+/), seen = Object.create(null), result = [];
    if (tokens.length > 256) throw Error('list-limit');
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token.length > 160 || /[{},;="'`\\]/.test(token)) throw Error('invalid-list');
      if (/^(?:[a-z]+:|\/)/i.test(token) && !/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:channel\/UC[\w-]{22}|@[^/?#\s]+)\/?$/i.test(token) && !/^\/(?:channel\/UC[\w-]{22}|@[^/?#\s]+)\/?$/.test(token)) throw Error('invalid-list');
      if (!seen[token]) {seen[token] = true; result.push(token);}
    }
    plain = result.join(' ');
    if (plain.length > 8192 || size(plain)>8192) throw Error('list-limit');
    return plain;
  }
  if (typeof setTimeout === 'function') timer = setTimeout(/** 功能：独立任务超时后保留缓存。更新时间：2026-10-07。 */ function () {finish('更新超时；同一地址的已有缓存保留。');}, 6000);
  try {
    $httpClient.get({url:url, timeout:5000, headers:{Accept:'text/plain'}, 'auto-cookie':false, 'auto-redirect':false, insecure:false},
      /** 功能：仅在成功获取有效文本后原子替换缓存；失败不覆盖旧名单。更新时间：2026-10-07。 */
      function (error, response, data) {
        if (finished) return;
        if (error || !response || Number(response.status) !== 200) return finish('下载失败；同一地址的已有缓存保留。');
        try {
          var type = '', headers = response.headers || {};
          Object.keys(headers).forEach(/** 功能：大小写无关读取内容类型。更新时间：2026-10-07。 */ function (key) {if (key.toLowerCase() === 'content-type') type = String(headers[key]).split(';')[0].trim().toLowerCase();});
          if (type && type !== 'text/plain' && type !== 'application/octet-stream') throw Error('invalid-type');
          var text = list(data), count = text ? text.split(' ').length : 0;
          if ($persistentStore.write(JSON.stringify({schema:1,url:url,text:text,fetchedAt:Date.now()}), KEY) !== true) throw Error('store-failed');
          finish('已更新远程名单：' + count + ' 条。请重新刷新 YouTube 列表。');
        } catch (_) {finish('名单格式无效或保存失败；同一地址的已有缓存保留。');}
      });
  } catch (_) {finish('下载失败；同一地址的已有缓存保留。');}
})();
