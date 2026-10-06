/**
 * 功能：把 Quantumult X 的请求、响应、存储与完成回调转换为功能源码使用的 Loon 形式；阶段不符时直接放行。
 * 更新时间：2026-10-06
 * @param {string} phase 当前发布包对应的阶段，request 或 response。
 * @param {Object} options 构建时固定的开关。
 * @returns {Object|null} 适配后的运行时对象；阶段不符或缺少请求时返回 null。
 */
function ytQXRuntime(phase, options) {
  var nativeDone = $done;
  var hasResponse = typeof $response !== "undefined" && !!$response;
  if (typeof $request === "undefined" || !$request || (phase === "response") !== hasResponse) { nativeDone({}); return null; }

  /**
   * 功能：按不区分大小写的名称读取头部值。
   * 更新时间：2026-10-06
   * @param {Object} headers 头部对象。
   * @param {string} name 小写头部名称。
   * @returns {string} 头部值，缺失时为空字符串。
   */
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(headers[keys[i]]);
    return "";
  }
  /**
   * 功能：文本类型交给源码字符串正文，其余类型交给二进制正文，避免依赖 Quantumult X 中不存在的 TextDecoder。
   * 更新时间：2026-10-06
   * @param {Object} owner Quantumult X 的请求或响应对象。
   * @returns {string|Uint8Array|undefined} 源码可读取的正文。
   */
  function bodyOf(owner) {
    var text = /json|^text\//i.test(header(owner.headers, "content-type"));
    if (text && typeof owner.body === "string") return owner.body;
    if (owner.bodyBytes instanceof ArrayBuffer) return new Uint8Array(owner.bodyBytes);
    if (ArrayBuffer.isView(owner.bodyBytes)) return new Uint8Array(owner.bodyBytes.buffer, owner.bodyBytes.byteOffset, owner.bodyBytes.byteLength);
    return owner.body;
  }
  /**
   * 功能：把源码输出的正文写成 Quantumult X 的 body 或 bodyBytes 字段。
   * 更新时间：2026-10-06
   * @param {Object} target 待交给 Quantumult X 的结果对象。
   * @param {string|Uint8Array|ArrayBuffer} body 源码输出的正文。
   */
  function setBody(target, body) {
    if (typeof body === "string") { target.body = body; return; }
    var view = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
    if (!ArrayBuffer.isView(view)) return;
    if (!view.byteLength) { target.body = ""; return; }
    target.bodyBytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  /**
   * 功能：把 Loon 形式的完成结果转换为 Quantumult X 形式后结束脚本。
   * 更新时间：2026-10-06
   * @param {Object} output 源码输出。
   */
  function done(output) {
    var result = {};
    if (output && typeof output === "object") {
      if (output.response && typeof output.response === "object") {
        var status = Number(output.response.status) || 200;
        result.status = "HTTP/1.1 " + status + " " + (status === 200 ? "OK" : status === 204 ? "No Content" : "Status");
        result.headers = output.response.headers || {};
        setBody(result, output.response.body);
      } else {
        if (output.headers) result.headers = output.headers;
        if (Object.prototype.hasOwnProperty.call(output, "body")) setBody(result, output.body);
      }
    }
    nativeDone(result);
  }

  var request = {url:$request.url, method:$request.method, headers:$request.headers || {}};
  var response;
  if (hasResponse) response = {status:$response.statusCode, headers:$response.headers || {}, body:bodyOf($response)};
  else request.body = bodyOf($request);
  var store = typeof $prefs === "undefined" || !$prefs ? undefined : {
    read:function (key) { var value = $prefs.valueForKey(key); return value === null ? undefined : value; },
    write:function (value, key) { return value === undefined || value === null ? ($prefs.removeValueForKey(key), true) : $prefs.setValueForKey(String(value), key) === true; }
  };
  return {
    request:request, response:response, done:done, store:store,
    argument:{log_enabled:false, background_playback:options.background_playback === true, hide_home_shorts:options.hide_home_shorts === true, playback_region:String(options.playback_region || "original")}
  };
}

/**
 * 功能：仅对 YouTube App 的初始化 POST 返回 HTTP 200 的无轨道 MP4，对应 Loon 主插件的 reject_video(200)；其余请求放行。
 * 更新时间：2026-10-06
 * @param {Object} request 适配后的请求。
 * @param {Function} done 适配后的完成回调。
 */
function ytQXEmptyVideo(request, done) {
  var keys = Object.keys(request.headers), agent = "";
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === "user-agent") agent = String(request.headers[keys[i]]);
  if (String(request.method || "").toUpperCase() !== "POST" || !/(?:^|\s)com\.google\.ios\.youtube\//i.test(agent)) return done({});
  /**
   * 功能：生成一个 ISO BMFF 盒子。
   * 更新时间：2026-10-06
   * @param {string} type 四字符盒子类型。
   * @param {Array<number>} payload 盒子内容字节。
   * @returns {Array<number>} 含长度和类型的盒子字节。
   */
  function box(type, payload) {
    var size = payload.length + 8, out = [size >>> 24 & 255, size >>> 16 & 255, size >>> 8 & 255, size & 255];
    for (var j = 0; j < 4; j++) out.push(type.charCodeAt(j));
    return out.concat(payload);
  }
  /**
   * 功能：生成指定数量的零字节。
   * 更新时间：2026-10-06
   * @param {number} count 字节数。
   * @returns {Array<number>} 零字节数组。
   */
  function zeros(count) { var out = []; while (out.length < count) out.push(0); return out; }
  // mvhd 版本 0：时间刻度 1000、时长 0、速率 1.0、音量 1.0、单位矩阵、下一个轨道编号 1。
  var mvhd = zeros(12).concat([0, 0, 3, 232], zeros(4), [0, 1, 0, 0, 1, 0], zeros(10),
    [0, 1, 0, 0], zeros(12), [0, 1, 0, 0], zeros(12), [64, 0, 0, 0], zeros(24), [0, 0, 0, 1]);
  var ftyp = [105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50, 109, 112, 52, 49];
  done({response:{status:200, headers:{"Content-Type":"video/mp4", "Cache-Control":"no-store"}, body:new Uint8Array(box("ftyp", ftyp).concat(box("moov", box("mvhd", mvhd))))}});
}
