/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 更新时间：2026-10-08
 * Loon 定时网络心跳：检查闲鱼官网 HTTP 可达性，不维护 App 或账号会话。
 */
(function () {
  "use strict";
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var enabled = args.heartbeat_enabled === true || args.heartbeat_enabled === "true";
  // 防止误挂到 HTTP 规则后处理或修改业务流量。
  if (typeof $request !== "undefined") { $done({}); return; }
  if (!enabled) { $done({title:"闲鱼网络心跳", content:"未开启；请在插件参数中开启定时网络心跳。"}); return; }
  var URL = "https://goofish.com/", KEY = "xianyu.heartbeat.v1";
  var seconds = Number(args.heartbeat_timeout);
  if ([5, 10, 15].indexOf(seconds) < 0) seconds = 5;
  var started = Date.now(), finished = false;

  function finish(error, response) {
    if (finished) return;
    finished = true;
    var status = response && Number(response.status);
    var validStatus = Number.isInteger(status) && status >= 100 && status <= 599;
    var reason = error ? (/^[A-Z0-9_-]{1,64}$/.test(String(error.code)) ? String(error.code) : "network-error") : validStatus ? null : "invalid-response";
    var event = {
      type:"xianyu-network-heartbeat", version:1, actor:"Loon", source:"loon-script",
      time:new Date(started).toISOString(), url:URL, method:"HEAD",
      durationMs:Math.max(0, Date.now()-started), timeoutMs:seconds*1000,
      status:validStatus ? status : null, httpReachable:!error && validStatus,
      homepageOK:!error && validStatus && status >= 200 && status < 300,
      error:reason, appKeepalive:false, accountOnlineVerified:false
    };
    var saved = false;
    try {
      var raw = $persistentStore.read(KEY), history = [];
      if (typeof raw === "string" && raw.length <= 65536) {
        try { var old = JSON.parse(raw); if (old && old.schema === 1 && Array.isArray(old.events)) history = old.events.slice(-19); } catch (_) {}
      }
      history.push(event);
      saved = $persistentStore.write(JSON.stringify({schema:1, events:history}), KEY) === true;
    } catch (_) {}
    // 不输出 Cookie、请求／响应正文、响应头或运行时错误原文。
    console.log("[XianyuHeartbeat] " + JSON.stringify({event:event, saved:saved}));
    var message = event.httpReachable ? "收到 HTTP " + status + "，耗时 " + event.durationMs + " ms。" : "请求未成功完成：" + reason + "。";
    if (event.httpReachable && !event.homepageOK) message += "该状态仅说明收到 HTTP 响应，不能判定主页正常。";
    if (!saved) message += "本地心跳记录保存失败。";
    $done({title:"闲鱼网络心跳", content:message + "仅检查官网连通性，不代表闲鱼在线或后台保活。"});
  }

  // HTTP 超时失效／回调未发生时兜底；晚到或重复回调不能重复完成。
  setTimeout(function () { finish({code:"WATCHDOG_TIMEOUT"}, null); }, seconds*1000+1500);
  try {
    $httpClient.head({url:URL, timeout:seconds*1000, headers:{"User-Agent":"Loon-Xianyu-Network-Probe/1.0", "Cache-Control":"no-cache"}, "auto-redirect":false, "auto-cookie":false, insecure:false}, finish);
  } catch (_) { finish({code:"REQUEST_START_FAILED"}, null); }
})();
