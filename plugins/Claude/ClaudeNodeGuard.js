/* Claude 固定节点守卫：仅修改专用策略组，不读取业务请求或节点凭据。 */
(function () {
  "use strict";
  var GROUP = "Claude固定出口";
  var KEY = "claude.node.guard.generation.v1";
  var finished = false;
  var generation = "";
  var node = "";

  function done(message) {
    if (finished) return;
    finished = true;
    console.log("[Claude 守卫] " + message);
    $done();
  }

  function choose(policy) {
    if ($config.getSelectedPolicy(GROUP) === policy) return true;
    return $config.setSelectPolicy(GROUP, policy) === true &&
      $config.getSelectedPolicy(GROUP) === policy;
  }

  function reject(reason) {
    try {
      done(choose("REJECT") ? reason + "，已选择 REJECT" : "错误：无法选择 REJECT，请检查专用策略组及插件绑定");
    } catch (_) {
      done("错误：策略接口不可用，请保持专用策略组为 REJECT");
    }
  }

  // 迟到回调不得覆盖更新的一次检测结果。
  function current() {
    if (finished) return false;
    try {
      if ($persistentStore.read(KEY) !== generation) {
        done("本次检测已被新检测替代");
        return false;
      }
      return true;
    } catch (_) {
      reject("无法确认检测状态");
      return false;
    }
  }

  try {
    var args = typeof $argument === "object" && $argument ? $argument : {};
    node = typeof args.claude_node === "string" ? args.claude_node.trim() : "";
    generation = String(Date.now()) + ":" + String(Math.random());
    if (!$persistentStore.write(generation, KEY)) return reject("检测状态保存失败");
    if (!node || /^(?:DIRECT|REJECT(?:-.*)?|PROXY)$/i.test(node) || node === GROUP || /[\r\n,]/.test(node)) {
      return reject("未指定有效的单个节点");
    }
    // 不接受将另一个策略组伪装成固定节点。
    if ($config.getSelectedPolicy(node)) return reject("指定对象是策略组，请填写单个节点");
    var selected = $config.getSelectedPolicy(GROUP);
    if (selected !== "REJECT" && selected !== node) {
      if (!choose("REJECT")) return reject("专用策略组配置错误");
    }

    // 比 HTTP 超时稍长；也覆盖 getSubPolicies 不回调的情况。
    setTimeout(function () {
      if (current()) reject("检测超时");
    }, 4500);

    $config.getSubPolicies(GROUP, function (raw) {
      if (!current()) return;
      try {
        var children = JSON.parse(raw || "null");
        if (!Array.isArray(children) || children.length !== 2 ||
            children.indexOf("REJECT") === -1 || children.indexOf(node) === -1) {
          return reject("策略组必须仅包含 REJECT 和指定节点");
        }
        // 节点名称明确指定，拒绝重定向、Cookie 和不可信证书。
        // 204 只证明此节点到探测主机可达，不代表 Claude 账号或服务可用。
        $httpClient.get({
          url: "https://www.gstatic.com/generate_204",
          node: node,
          timeout: 3000,
          "auto-redirect": false,
          "auto-cookie": false,
          insecure: false
        }, function (error, response) {
          if (!current()) return;
          try {
            if (error || !response || Number(response.status) !== 204) {
              return reject("节点探测失败");
            }
            // 在放行前重新确认节点没有被改成策略组。
            if ($config.getSelectedPolicy(node)) return reject("节点配置已变化");
            if (!choose(node)) return reject("无法选择指定节点");
            done("节点探测成功，已选择指定节点");
          } catch (_) {
            reject("探测结果处理失败");
          }
        });
      } catch (_) {
        reject("策略读取或探测启动失败");
      }
    });
  } catch (_) {
    reject("守卫初始化失败");
  }
}());
