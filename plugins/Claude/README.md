# Claude 固定节点与故障拒绝（Loon）

![Claude 图标](assets/claude.jpg)

**每个匹配请求先探测指定节点：成功后当前请求使用该节点，失败或超时当前请求选择 `REJECT`。没有定时任务，也不缓存前一次探测结果。** 无 Claude 请求时不会主动探测；页面的并发资源请求会分别探测，可能增加加载时间和探测流量。

HTTPS 请求必须开启 MitM 并安装、信任 Loon 证书。原生 App 如使用证书绑定或拒绝 Loon 证书，此模式无法使用；它不再是旧版的免解密分流模式。未经解密的 HTTPS 无法进入请求脚本，不能宣称完成请求前探测。

## 安装与设置

远程入口：[安装 Claude.plugin](https://raw.githubusercontent.com/teaoea/shell/main/plugins/Claude/Claude.plugin)。插件不声明系统限制，要求 Loon 3.5.1 (983) 或更新版本；平台可用性及脚本支持取决于 Loon。守卫脚本由插件自动引用。

1. 在 Loon 中安装并信任 MitM 证书，开启 MitM。插件已声明业务解密主机，无需手动填写整站通配符 `*`。
2. 插件参数「指定节点」填写已有的单个节点完整名称，不能填写 `PROXY`、DIRECT 或其他策略组。
3. 「代理指向的策略 → PROXY」直接绑定同一个单节点。例如参数填 `美国 01`，此处也选择 `美国 01`。不再绑定旧的 `Claude固定出口` 组。
4. 使用规则分流模式，将本插件请求脚本放在冲突脚本之前。同一请求只运行第一条匹配的请求脚本。
5. 保存后关闭旧连接，再打开 Claude。核对脚本日志、当前请求实际节点和拒绝行为。

从定时检测版升级：刷新插件及 `ClaudeNodeGuard.js` 脚本缓存；确认旧的定时／手动检测入口已消失；将 PROXY 改为实际单节点；开启并信任 MitM。旧 `Claude固定出口` 组若无其他引用可移除。[Claude.loon.conf](Claude.loon.conf) 现仅保留迁移提示，不需要合并策略组。

安装地址：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/Claude/Claude.plugin
```

## 覆盖范围

| 域名 | 范围 |
| --- | --- |
| `anthropic.com` | 官网、API、静态资源及子域名 |
| `claude.ai` | 网页、登录、下载及子域名 |
| `claude.com` | 产品页、控制台、SSO、文档及子域名 |
| `claude.app` | 应用相关域名及子域名 |
| `claudeusercontent.com` | 文件、Artifact、桥接服务及子域名 |
| `claudemcpcontent.com` | MCP 交互内容及子域名 |
| `challenges.cloudflare.com` | Cloudflare 验证主机，精确匹配 |
| `fonts.googleapis.com`、`fonts.gstatic.com` | Artifact 字体，精确匹配 |
| `cdnjs.cloudflare.com`、`cdn.jsdelivr.net`、`cdn.tailwindcss.com`、`code.jquery.com`、`unpkg.com` | Artifact 脚本资源，精确匹配 |

域名规则覆盖对应主机的所有路径，浏览器和 App 使用相同规则。共享字体、脚本和验证主机在其他网站中的请求也会走指定节点。没有把整个 Cloudflare 或 Google 域名加入规则。

域名规则不能识别“某个第三方链接是否来自 Claude”。从 Claude 点开的任意外部网站、企业自有身份提供商、第三方 API 网关、纯 IP 连接，以及未来新增且未列出的依赖不保证命中。Claude Code 使用的 GitHub、npm 等开发工具依赖也没有整体接管。Anthropic 云端发起的搜索与连接器请求不经过手机 Loon。发现漏网目标时，应先在连接记录确认真实域名，再补充规则。

## 请求处理与边界

1. 匹配的 HTTP 请求或成功解密的 HTTPS 请求在请求头阶段进入脚本；不等待或读取聊天、上传等业务正文。
2. 脚本通过指定节点请求 `https://www.gstatic.com/generate_204`，等待探测结果后再结束当前请求脚本。此探测主机不在请求脚本匹配范围内，避免递归触发。
3. 可信 HTTPS 的 204 响应通过，脚本返回 `$done({node: 指定节点})`；网络错误、其他状态、配置异常或超时返回 `$done({node: "REJECT"})`。不修改策略组、全局模式或业务请求内容。
4. HTTP 探测超时 3 秒，额外看门狗 4.5 秒，入口执行上限 8 秒。迟到或重复回调不会再次处理当前请求。并发请求各自探测，不共享成功状态。

所有已列域名的 UDP／QUIC 始终执行 `REJECT`，避免 UDP 不支持时回退直连。HTTP/3 被拒绝后，支持 TCP 的客户端通常会改用 TCP；仅 UDP 的功能可能不可用。WebSocket 只在可见的 HTTP 升级握手请求阶段探测，不逐帧探测；SSE 只在建立请求前探测，不在每个流式片段前探测。

探测结果仅表示指定节点到检测主机可达，不证明 Claude 账号、地区或业务接口可用；检测地址单独不可达也会保守拒绝。脚本不发送 Claude Cookie、Authorization 或聊天正文，不保存业务日志或节点凭据；只输出不含节点名称的检测结果。

**请求前探测以脚本实际运行并成功完成为前提。** MitM 未开启、客户端不接受证书、脚本下载失败、入口未命中、其他脚本抢先命中或运行时被终止时，不能保证“先探测再放行”。未进入脚本的流量仍由 PROXY 绑定处理，因此必须绑定相同的固定单节点，不能绑定自动组或 DIRECT。该限制意味着本模式不是对所有未解密原生 App 连接的无条件保护。

关闭 Loon、停用插件、绕过 TUN、全局直连及冲突分流规则均可能使本插件不生效。仅修改参数不代表实际出口已改变；请以新连接记录和脚本运行记录验收。

## 验证

```sh
node --test plugins/Claude/tests/ClaudeNodeGuard.test.mjs
node --check plugins/Claude/ClaudeNodeGuard.js
```

25 项模拟测试覆盖等待探测后放行、连接失败／非 204／超时拒绝、迟到与重复回调、并发隔离、每请求重新探测、配置异常、无业务字段读取，以及规则／请求匹配／MitM 主机一致性。模拟中的返回值验证不代表真实 Loon 已接受该请求策略。

尚未在真实 Loon 验证配置解析、TLS 证书兼容、`$done({node: "REJECT"})` 的拒绝效果、流式请求或最终出口。实机应确认：不访问 Claude 时无探测；请求时先出现探测结果再转发；断开指定节点后当前请求被拒绝；恢复后下一次请求自动通过。检查登录、上传、Artifact、SSE 和可见的 WebSocket 握手。

## 官方参考

- [Loon 插件支持的策略与配置段](https://nsloon.app/en/docs/Plugin/)
- [Loon 逻辑规则](https://nsloon.app/en/docs/Rule/logic_rule/)与[协议规则](https://nsloon.app/en/docs/Rule/protocol_rule/)
- [Loon UDP 回退设置](https://nsloon.app/en/docs/General/)
- [Loon 脚本 API：指定探测节点](https://nsloon.app/en/docs/Script/script_api/)
- [Claude Desktop 网络域名](https://code.claude.com/docs/en/desktop#network-access-requirements)
- [Claude 网络要求及 Artifact 第三方依赖](https://code.claude.com/docs/en/network-config#network-access-requirements)

非官方插件，与 Anthropic、Loon 无隶属关系。许可证沿用仓库 MIT。

图标来自 Anthropic 发布的 [Claude App Store 应用](https://apps.apple.com/us/app/claude-by-anthropic/id6473753684)，通过 Apple Lookup API 核对应用名称和开发者为 Anthropic PBC 后保存为 `assets/claude.jpg`，用于辨识本插件。
