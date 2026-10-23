/* Claude 请求守卫：当前请求先探测，再指定节点或 REJECT；无后台检测。 */
(function () {
  "use strict";
  var finished = false;
  var node = "";
  function finish(policy, reason) {
    if (finished) return;
    finished = true;
    console.log("[Claude 请求守卫] " + reason);
    // 只控制当前请求，不修改全局模式或策略组，不缓存探测结果。
    $done({ node: policy });
  }
  function reject(reason) { finish("REJECT", reason); }
  try {
    // 不访问正文、请求头、Cookie 或账号。
    if (typeof $request === "undefined" || !$request) return reject("缺少请求上下文");
    var args = typeof $argument === "object" && $argument ? $argument : {};
    node = typeof args.claude_node === "string" ? args.claude_node.trim() : "";
    if (!node || /^(?:DIRECT|REJECT(?:-.*)?|PROXY)$/i.test(node) || /[\r\n,]/.test(node)) {
      return reject("未配置有效单节点，拒绝当前请求");
    }
    if ($config.getSelectedPolicy(node)) return reject("指定对象为策略组，拒绝当前请求");
    setTimeout(function () { reject("探测超时，拒绝当前请求"); }, 4500);
    $httpClient.get({
      url: "https://www.gstatic.com/generate_204",
      node: node,
      timeout: 3000,
      "auto-redirect": false,
      "auto-cookie": false,
      insecure: false
    }, function (error, response) {
      if (finished) return;
      try {
        if (error || !response || Number(response.status) !== 204) {
          return reject("探测失败，拒绝当前请求");
        }
        if ($config.getSelectedPolicy(node)) return reject("节点配置变化，拒绝当前请求");
        finish(node, "探测成功，当前请求使用指定节点");
      } catch (_) {
        reject("处理探测结果失败，拒绝当前请求");
      }
    });
  } catch (_) {
    reject("探测初始化失败，拒绝当前请求");
  }
}());
