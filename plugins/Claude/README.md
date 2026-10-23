# Claude 固定节点与故障拒绝（Loon）

![Claude 图标](assets/claude.jpg)

将 Claude 官网、App、登录、API、文件与 Artifact 内容的已列域名统一绑定指定节点。无需安装证书或开启 HTTPS 解密。

**正常时使用指定节点；探测失败或超时自动选择 `REJECT`；节点恢复后自动回切。** 守卫每 15 秒运行一次，通过指定节点请求 HTTPS 204 探测地址。HTTP 超时 3 秒，整次检测设有 4.5 秒看门狗；正常调度下，故障发现约需 0–19.5 秒，系统调度暂停时可能更久。这不是逐连接、零延迟的故障拦截。

## 安装与设置

远程入口：[安装 Claude.plugin](https://raw.githubusercontent.com/teaoea/shell/main/plugins/Claude/Claude.plugin)。插件不声明系统限制，需使用 Loon 3.5.1 (983) 或更新版本；具体平台仍取决于 Loon 本身的可用性及脚本接口支持。插件自动引用同目录的远程守卫脚本，无需单独安装脚本。配套策略组仍需按下方步骤合并一次。

1. 将 [Claude.loon.conf](Claude.loon.conf) 中的 `YOUR_CLAUDE_NODE` 替换为已经存在的**单个节点**名称，把策略组行合并到主配置的 `[Proxy Group]` 段。不要用自动组或整个订阅替代节点。
2. 导入 `Claude.plugin`，先保持插件关闭。在插件详情的「代理指向的策略 → PROXY」中绑定 `Claude固定出口`。
3. 在插件参数「指定节点」填写同一个节点的完整名称，**不要填 `PROXY` 或其他策略组名称**。留空、填写策略组或配置不匹配时，守卫尝试保持 `REJECT`。
4. 策略组默认选择 `REJECT`。确认绑定无误后启用插件，手动运行「Claude 立即检测节点」，核对成功后组已自动选中指定节点。之后每 15 秒自动检测与切换。
5. 使用规则分流模式，将本插件安排在冲突的分流资源之前，并核对连接记录中的实际命中规则、策略与最终节点。修改后结束旧连接，再重新打开 Claude 验证。

主配置片段：

```ini
[Proxy Group]
Claude固定出口 = select,REJECT,YOUR_CLAUDE_NODE
```

例如实际节点名为 `美国 01`，组应写成 `Claude固定出口 = select,REJECT,美国 01`；插件「指定节点」填写 `美国 01`，而「代理指向的策略 → PROXY」选择 `Claude固定出口`。这两处填写的对象不同。

`PROXY` 是 Loon 插件的固定策略入口。**插件未绑定或专用组被删除时，守卫无法控制实际出口，也不能保证默认拒绝**，启用前和订阅更新后应核对绑定。节点被删除但专用组仍保留 `REJECT` 时，守卫会尝试切到 `REJECT`。不要绑定其他策略组，不要手动向专用组添加 DIRECT 或其他候选；守卫只接受 `REJECT` 加指定节点这两个成员。

守卫会自动管理专用组的选择，不应把手动选中 `REJECT` 当作持久暂停：下次探测成功会回切节点。临时保持拒绝时，清空插件「指定节点」并立即运行一次检测，确认策略为 `REJECT`。退出 Loon 或停用整个插件也会停用分流保护。

在 Loon 中添加远程插件，填写以下安装地址：

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

## 拒绝与故障行为

- 所有已列域名的 UDP／QUIC 都先执行 `REJECT`，防止节点不支持 UDP 时按主配置回退直连；支持 TCP 的客户端通常会重新使用 TCP。仅支持 UDP 的功能可能不可用。
- TCP 使用专用组当前选中的固定节点或 `REJECT`，没有其他出口。守卫使用 `$config.setSelectPolicy` 实际修改选择；探测通过 `$httpClient` 的 `node` 参数指定单节点，不经过当前可能为 `REJECT` 的业务组，因此可检测恢复。
- 只有可信 HTTPS 的 204 响应放行；网络错误、超时、其他状态、配置异常、状态保存失败均尝试选择 `REJECT`。探测不携带 Claude Cookie、账号或聊天内容，不记录节点名称和凭据。
- 探测地址是 `https://www.gstatic.com/generate_204`。结果表示节点到此主机可达，不能判断 Claude 地区限制、账号风控或特定业务接口是否可用；探测主机单独不可达也会保守拒绝。探测不修改该域名的其他流量规则。
- 故障发生到下一次检测完成之间，业务仍可能尝试原节点，失败表现可能是连接错误；选择 `REJECT` 后新连接执行拒绝。策略切换不主动终止已有连接。脚本停止调度或执行接口不可用时，不保证切到 `REJECT`；不能将本方案视为操作系统级永久断网锁。
- 不要在代理规则后再添加相同域名的 `REJECT` 并期待故障回落：节点连接失败不会继续匹配下一条规则。插件不能自行创建 `[Proxy Group]`，所以专用组需要手动合并一次。
- 以上行为以流量进入 Loon 且实际命中插件为前提；关闭 Loon、全局直连、绕过 TUN 或其他规则抢先命中时，本插件无法拦截。

## 验证

已进行离线规则结构、域名边界、UDP／QUIC 拒绝顺序、策略组候选检查及守卫模拟测试。测试命令：`node --test plugins/Claude/tests/ClaudeNodeGuard.test.mjs`。模拟覆盖成功、失败、超时、恢复、配置错误与迟到回调，不代表真实 Loon 验收。

尚未在真实 Loon 验证配置解析、定时调度和网络出口。实机应依次确认：默认 `REJECT` 时无法访问；检测成功后自动选中指定节点；阻断节点后下一次检测自动选择 `REJECT`，新连接明确命中拒绝；恢复后自动回切。确认没有直连或其他节点连接，订阅更新后绑定仍有效。检查登录、聊天流式响应、上传与 Artifact 的连接记录，补充未列依赖。

## 官方参考

- [Loon 插件支持的策略与配置段](https://nsloon.app/en/docs/Plugin/)
- [Loon 策略组](https://nsloon.app/en/docs/Policy/policygroup/)
- [Loon 逻辑规则](https://nsloon.app/en/docs/Rule/logic_rule/)与[协议规则](https://nsloon.app/en/docs/Rule/protocol_rule/)
- [Loon UDP 回退设置](https://nsloon.app/en/docs/General/)
- [Loon 脚本 API：指定请求节点与修改策略组](https://nsloon.app/en/docs/Script/script_api/)
- [Claude Desktop 网络域名](https://code.claude.com/docs/en/desktop#network-access-requirements)
- [Claude 网络要求及 Artifact 第三方依赖](https://code.claude.com/docs/en/network-config#network-access-requirements)

非官方插件，与 Anthropic、Loon 无隶属关系。许可证沿用仓库 MIT。

图标来自 Anthropic 发布的 [Claude App Store 应用](https://apps.apple.com/us/app/claude-by-anthropic/id6473753684)，通过 Apple Lookup API 核对应用名称和开发者为 Anthropic PBC 后保存为 `assets/claude.jpg`，用于辨识本插件。
