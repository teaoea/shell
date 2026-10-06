/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 文件：YouTubeRuntime.js
 * 功能：为共享请求包和响应包适配 Loon、Quantumult X、Surge 与 Stash 的平台接口。
 * 版本：1.0.0
 * 更新时间：2026-10-06
 */

/**
 * 功能：识别当前代理工具；未知环境按原有接口运行，不伪造平台能力。
 * 更新时间：2026-10-06
 * @returns {string} 当前平台名称。
 */
function ytRuntimePlatform() {
  if (typeof $loon !== 'undefined') return 'Loon';
  if (typeof $prefs !== 'undefined' && typeof $task !== 'undefined') return 'Quantumult X';
  if (typeof $environment === 'object' && $environment && ($environment['surge-version'] || $environment['surge-build'])) return 'Surge';
  if (typeof $environment === 'object' && $environment && ($environment['stash-version'] || $environment['stash-build'])) return 'Stash';
  return 'native';
}

/**
 * 功能：统一对象、JSON、查询串和圈 X URL 片段参数；只解析设置，不访问日志存储。
 * 更新时间：2026-10-06
 * @returns {Object} 当前规则提供的参数对象。
 */
function ytRuntimeOptions() {
  if (typeof $argument === 'object' && $argument) return ytRuntimeLogControl($argument);
  var options = Object.create(null);
  var env = typeof $environment === 'object' && $environment ? $environment : {};
  var fragment = typeof env.sourcePath === 'string' && env.sourcePath.indexOf('#') >= 0 ? env.sourcePath.split('#').slice(1).join('#') : '';
  var sources = [fragment, env.variables, typeof $argument === 'undefined' ? null : $argument];
  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    if (typeof source === 'string' && source.trim().charAt(0) === '{') {
      try { source = JSON.parse(source); } catch (_) { source = null; }
    }
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      var keys = Object.keys(source);
      for (var k = 0; k < keys.length; k++) {
        if (/^[a-z][a-z0-9_]*$/.test(keys[k]) && keys[k] !== 'constructor' && keys[k] !== 'prototype') options[keys[k]] = source[keys[k]];
      }
    } else if (typeof source === 'string' && source.length <= 8192) {
      var pairs = source.split('&');
      for (var j = 0; j < pairs.length; j++) {
        var equal = pairs[j].indexOf('=');
        if (equal < 1) continue;
        try {
          var key = decodeURIComponent(pairs[j].slice(0, equal));
          if (/^[a-z][a-z0-9_]*$/.test(key) && key !== 'constructor' && key !== 'prototype') options[key] = decodeURIComponent(pairs[j].slice(equal + 1).replace(/\+/g, '%20'));
        } catch (_) {}
      }
    }
  }
  return ytRuntimeLogControl(options);
}

/**
 * 功能：Stash 单插件日志开关由页面控制；默认关闭，暂停后同步停止业务日志和媒体采样。
 * 更新时间：2026-10-06
 * @param {Object} options 规则参数。
 * @returns {Object} 根据本机会话状态解析的参数，不写入存储。
 */
function ytRuntimeLogControl(options) {
  if (ytRuntimePlatform() !== 'Stash' || options.log_control !== 'page') return options;
  var result = Object.assign({}, options);
  result.log_enabled = false;
  if (typeof $request !== 'undefined' && /^http:\/\/youtube-logs\.invalid(?::80)?(?:\/|$)/.test(String($request.url || ''))) {
    result.log_enabled = true;
    return result;
  }
  try {
    if (typeof $persistentStore !== 'undefined') {
      var raw = $persistentStore.read('ytads.logger.config.v1');
      var config = raw && raw.length <= 8192 ? JSON.parse(raw) : null;
      result.log_enabled = !!(config && config.enabled === true && typeof config.session === 'string' && /^[a-z0-9-]{1,80}$/.test(config.session));
    }
  } catch (_) {}
  return result;
}

/**
 * 功能：延迟转换圈 X 的二进制正文与响应状态，不触碰不需要正文的请求。
 * 更新时间：2026-10-06
 * @param {Object|undefined} input 平台原始请求或响应。
 * @param {boolean} response 是否为响应对象。
 * @returns {Object|undefined} 核心脚本使用的对象视图。
 */
function ytRuntimeInput(input, response) {
  if (!input || ytRuntimePlatform() !== 'Quantumult X') return input;
  var view = Object.create(input);
  Object.defineProperty(view, 'body', {get: /** 功能：按需读取平台字段。更新时间：2026-10-06。 */ function () {
    var bytes = input.bodyBytes;
    return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : input.body;
  }});
  if (response) Object.defineProperty(view, 'status', {get: /** 功能：按需读取平台字段。更新时间：2026-10-06。 */ function () { return Number(input.statusCode || input.status || 200); }});
  return view;
}

/**
 * 功能：统一存储读写和单键删除；禁止调用清空其他脚本存储的接口。
 * 更新时间：2026-10-06
 * @returns {Object|undefined} 核心使用的存储适配器。
 */
function ytRuntimeStore() {
  var platform = ytRuntimePlatform();
  if (platform === 'Quantumult X') return {
    read: /** 功能：读取单键。更新时间：2026-10-06。 */ function (key) { return $prefs.valueForKey(key); },
    write: /** 功能：写入或删除单键。更新时间：2026-10-06。 */ function (value, key) { return value === undefined || value === null ? $prefs.removeValueForKey(key) : $prefs.setValueForKey(String(value), key); }
  };
  if (typeof $persistentStore === 'undefined') return undefined;
  if (platform !== 'Surge') return $persistentStore;
  return {
    read: /** 功能：读取单键。更新时间：2026-10-06。 */ function (key) { return $persistentStore.read(key); },
    write: /** 功能：写入或删除单键。更新时间：2026-10-06。 */ function (value, key) { return $persistentStore.write(value === undefined ? null : value, key); }
  };
}

/**
 * 功能：将圈 X 的正文转换为精确长度的 ArrayBuffer，避免视图前后多余字节泄漏。
 * 更新时间：2026-10-06
 * @param {Object} output 待转换的结果对象。
 * @returns {Object} 圈 X 可接受的结果。
 */
function ytRuntimeQxResult(output) {
  var result = Object.assign({}, output);
  if (result.body instanceof ArrayBuffer) { result.bodyBytes = result.body; delete result.body; }
  else if (ArrayBuffer.isView(result.body)) {
    result.bodyBytes = result.body.buffer.slice(result.body.byteOffset, result.body.byteOffset + result.body.byteLength);
    delete result.body;
  }
  if (typeof result.status === 'number') {
    var labels = {200:'OK', 303:'See Other', 404:'Not Found', 405:'Method Not Allowed', 409:'Conflict', 503:'Service Unavailable'};
    result.status = 'HTTP/1.1 ' + result.status + ' ' + (labels[result.status] || 'Response');
  }
  delete result.h2_trailers;
  return result;
}

/**
 * 功能：按平台提交结果；圈 X 的合成响应仅用于明确配置的 echo 规则。
 * 更新时间：2026-10-06
 * @param {Object} output 核心处理结果。
 * @param {Object} options 当前规则参数。
 * @returns {void} 调用一次平台完成回调。
 */
function ytRuntimeFinish(output, options) {
  output = output || {};
  var platform = ytRuntimePlatform();
  if ((platform === 'Quantumult X' || platform === 'Surge' || platform === 'Stash') && typeof $response !== 'undefined' && /^https:\/\/[\w-]+\.googlevideo\.com\/(?:videoplayback|initplayback)(?:\?[^#]*)?$/i.test(String($request.url || ''))) {
    output = Object.assign({}, output);
    var headers = Object.assign({}, $response.headers || {}, output.headers || {});
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === 'alt-svc') delete headers[keys[i]];
    headers['Alt-Svc'] = 'clear';
    output.headers = headers;
  }
  if (platform !== 'Quantumult X') return $done(output);
  if (output.response) {
    if (options.echo_response !== true && options.echo_response !== 'true') return $done({});
    return $done(ytRuntimeQxResult(output.response));
  }
  var result = ytRuntimeQxResult(output);
  if (result.url) {
    var old = /^(https?:\/\/[^/?#]+)(\/[^#]*)?$/.exec(String($request.url || ''));
    var next = /^(https?:\/\/[^/?#]+)(\/[^#]*)?$/.exec(result.url);
    if (!old || !next || old[1].toLowerCase() !== next[1].toLowerCase()) return $done({});
    result.path = next[2] || '/';
    delete result.url;
  }
  $done(result);
}

/**
 * 功能：绑定平台适配接口后运行指定模块，保持源码模块可独立测试。
 * 更新时间：2026-10-06
 * @param {Function} handler 当前功能处理器。
 * @returns {*} 模块执行结果。
 */
function ytRuntimeInvoke(handler) {
  var options = ytRuntimeOptions();
  var request = ytRuntimeInput(typeof $request === 'undefined' ? undefined : $request, false);
  var response = ytRuntimeInput(typeof $response === 'undefined' ? undefined : $response, true);
  var done = typeof $done === 'function' ? /** 功能：提交平台结果。更新时间：2026-10-06。 */ function (value) { return ytRuntimeFinish(value, options); } : undefined;
  return handler(request, response, options, ytRuntimeStore(), done);
}

/**
 * 功能：圈 X、Surge 与 Stash 的媒体响应头入口清除 Alt-Svc，不访问媒体正文或日志。
 * 更新时间：2026-10-06
 * @returns {boolean} 已提交响应头时返回真。
 */
function ytRuntimeMediaHeaders() {
  if (ytRuntimePlatform() === 'Loon' || ytRuntimePlatform() === 'native' || typeof $response === 'undefined') return false;
  var headers = Object.assign({}, $response.headers || {});
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === 'alt-svc') delete headers[keys[i]];
  headers['Alt-Svc'] = 'clear';
  ytRuntimeFinish({headers:headers}, ytRuntimeOptions());
  return true;
}
