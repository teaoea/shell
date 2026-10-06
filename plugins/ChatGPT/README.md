# ChatGPT 网络选择与本地日志

为 Loon、Quantumult X（圈 X）、Stash、Surge 提供 ChatGPT 直连／代理切换，以及可选的本地网络诊断日志。网络选择使用软件原生策略，覆盖匹配域名下的连接，不依赖解密或请求脚本修改出口。

配置与脚本通过本仓库 `main` 分支提供，下面的远程 URL 可用于安装与更新。当前已做离线验证，四种软件的真实配置解析、手机日志采集、Safari 导出及出口切换仍待实机验证。

## 文件与安装

| 软件 | 合并入口 | 切换位置 |
| --- | --- | --- |
| Loon | [ChatGPT.plugin](https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.plugin) | 给插件绑定 DIRECT 或已有代理策略组；也可绑定包含 DIRECT 和代理的 ChatGPT 策略组，在策略页切换。 |
| 圈 X | [ChatGPT.quantumult.conf](https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.quantumult.conf) | 主配置的 ChatGPT 策略，选择 direct 或 proxy／已有代理节点。 |
| Stash | [ChatGPT.stoverride](https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.stoverride) | 覆写创建的 ChatGPT 策略组，选择 DIRECT 或订阅中的节点。 |
| Surge | [ChatGPT.surge.conf](https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.surge.conf) | 主配置的 ChatGPT 策略组，选择 DIRECT 或现有代理策略。 |

每个平台只有一个配置入口，同时包含业务分流、本地日志页面、请求／响应元数据采样及 MitM 主机。无需另装日志插件、日志模块、日志覆写或日志重写资源；圈 X 和 Surge 的业务规则也直接包含在同一文件中。共用的 `ChatGPTLogger.js` 是由入口引用的脚本资源，无需作为插件单独安装。

日志首次使用默认暂停；是否记录在本地页面控制。仅分流无需开启 MitM；采集 HTTPS 日志才需要成功解密。合并入口会登记 MitM 主机，**暂停日志不会移除这些主机**，全局 MitM 已开启时仍可能解密目标连接。只使用分流时，应关闭目标主机的解密或移除本入口添加的 MitM 主机，避免影响原生客户端。

已存在名为 ChatGPT 的策略组时，复用现有组或统一改名，避免重复定义；现有组仍需包含直连和可用代理。配置不包含代理服务器或账号凭据。

### 从拆分版更新

- Loon：刷新 `ChatGPT.plugin`，删除旧 `ChatGPTLogs.plugin`。
- Stash：刷新 `ChatGPT.stoverride`，删除旧 `ChatGPTLogs.stoverride`。
- 圈 X：先移除旧 ChatGPT 的 `filter_remote`、`rewrite_remote` 两项，再按新版片段合并策略、本地规则、重写和 MitM 主机；不要把旧片段与新片段重复叠加。
- Surge：删除旧 ChatGPT 的 `RULE-SET` 行和 `ChatGPTLogs.sgmodule`，再按新版片段合并对应段，保留已有策略组或更新其成员。

旧拆分入口已移除。日志数据仍沿用原存储键，更新不会主动清空记录，开始／暂停状态也会保留。

### Loon

导入或刷新上表的 `ChatGPT.plugin`，在插件策略中明确选择 DIRECT 或现有代理策略组。规则里的 `PROXY` 表示插件绑定的策略，不能将它当作自动选中的可用代理。

如要在策略页反复切换，可先在主配置中建立手动组，以下 `YOUR_PROXY` 要改成已经存在的节点或策略组名，再将插件绑定到 ChatGPT：

```ini
[Proxy Group]
ChatGPT = select, DIRECT, YOUR_PROXY
```

日志页面及采样脚本已经包含在插件内。需要 HTTPS 元数据日志时，启用 MitM 并安装、信任证书，然后打开本地日志页。使用传统 HTTP 脚本语法，不依赖新版正文采集接口。

### Quantumult X（圈 X）

`ChatGPT.quantumult.conf` 是合并配置片段，不是替换整份订阅的完整配置。把 `[policy]`、`[filter_local]`、`[rewrite_local]` 中的内容合并到主配置对应段，把业务规则放在冲突规则之前。在策略页选择 ChatGPT → direct 或 proxy。`proxy` 使用圈 X 内置代理策略，也可以将它换成已有节点／策略组名称。

将 `[mitm]` 的主机列表追加到现有 `hostname`，保留原主机；不要重复新建一个 MitM 段或覆盖全部列表。采集 HTTPS 时启用 MitM 并信任证书。本地页面使用 `script-echo-response`；采样使用请求／响应 header 脚本，三条重写已经直接包含在同一片段。

### Stash

导入并启用上表的 `ChatGPT.stoverride`，一次添加网络选择和日志入口。它创建 ChatGPT 手动策略组，以 `include-all: true` 引用已有节点和代理集合，同时提供 DIRECT。没有可用节点时，不能据此认为已配置代理。

需要 HTTPS 日志时开启 HTTP 引擎、MitM 并信任证书。覆写只为本地日志域名强制 HTTP 引擎，新增的 MitM 主机由软件合并处理。核对最终配置和实际规则命中结果。

### Surge

将 `ChatGPT.surge.conf` 的 `[Proxy Group]`、`[Rule]`、`[Script]` 内容合并到主配置对应段：把 `YOUR_PROXY` 替换为已存在的代理节点或策略组，把业务规则放在冲突规则与 `FINAL` 之前。将 `[MITM]` 主机追加到现有 `hostname`，保留原列表，不重复建立相同段。在策略页切换 ChatGPT → DIRECT 或代理。

Surge 模块不能修改 `[Proxy Group]`，模块规则也只能引用内置策略，因此这个合并入口采用主配置片段，不能作为模块导入。业务分流、本地页面和采样脚本均已包含，无需额外日志模块。需要 HTTPS 日志时启用 MitM 并信任证书。

## 日志使用

在启用合并配置后，用 Safari 打开 **[http://chatgpt-logs.invalid/](http://chatgpt-logs.invalid/)**。这是代理软件的脚本生成的本地页面，不需要公网日志服务器，不会上传日志。

1. 默认状态为暂停，点击「开启日志」，随后复现登录、发消息、上传等问题。
2. 返回页面点击「刷新」查看记录。点击「暂停日志」后导出，可以减少导出时仍有流量进入的情况。
3. 点击「导出日志」，得到 UTF-8 JSON Lines 文件 `chatgpt-network.log`。第一行包含保存数量和淘汰数量，后续每行为一条事件。
4. 点击「清空并暂停」删除本插件已保存的记录。它只操作 `chatgpt.network.logger.v1`，不清除其他插件数据。
5. 调试结束后点击「暂停日志」，网络选择继续生效。若要停止目标主机解密，同时移除本入口添加的 MitM 主机或关闭相应解密。停用整个合并入口会一并停用网络规则和日志入口；圈 X／Surge 手动合并的内容需要自行移除。

日志开关会在本机保存，重新启动软件后沿用之前的状态；首次使用默认暂停。停用合并配置前需要清空的，应先在页面清空；停用整个配置不会自动删除保存的数据。

每条事件只记录 UTC 时间、请求／响应阶段、目标主机、接口类别、HTTP 方法和可获得的响应状态码。接口类别只有 `root`、`api`、`auth`、`static`、`other`，不保存路径中的会话 ID、完整 URL、查询参数、请求头、Cookie、Authorization、正文或文件内容。只采集六个核心域名族；第三方登录验证主机参与分流，但不进入自定义日志。

最多保留最近 **300 条事件**，请求和响应分别计一条；超过上限淘汰最早事件并累计淘汰数。导出不是完整历史。各平台公开存储接口不提供原子追加，高并发时可能丢记录；导出首行也说明这一限制。没有请求耗时或出口策略推断：实际节点、DNS／TLS 错误及连接耗时请使用各软件原生连接记录。

脚本不请求业务正文，不缓冲 SSE 回答或媒体正文。响应阶段记录出现的时间由软件运行时决定，不能当作首字时间。WebSocket 帧、HTTP/3 未经解密的连接、原生客户端证书校验失败、DNS／TCP／TLS 失败和纯 IP 连接均不在自定义 HTTP 日志范围。存储失败时业务请求继续放行，本地页面返回错误，不宣称保存成功；已有异常数据不会自动覆盖。

## 规则范围与局限

核心域名族来自 OpenAI 公布的网络建议：`chatgpt.com`、`openai.com`、`oaistatic.com`、`oaiusercontent.com`、`oaistatsig.com`、`openaimerge.com`。其中 `openai.com` 的规则也影响 OpenAI API 及其他子域名服务；它不是基于进程的“只作用于 ChatGPT App”。另外精确匹配 Cloudflare 验证与 WorkOS 登录／静态主机，这些共享主机也可能被其他网站使用。

没有把 Cloudflare、Stripe、Intercom、Sentry 等第三方整站域名加入分流。此范围是针对 ChatGPT 主要业务和登录依赖的选择，不是官方所有允许列表的完整复制。发现未命中的端点时先以连接记录确认，再修改 `domains.json`；纯 IP 的实时语音 UDP 连接不保证命中这份域名规则，当前不维护动态语音 IP 网段。

使用规则／分流模式，并核对已有本地规则、其他插件及资源顺序。启用配置或选择某策略不代表业务连接必然命中；规则冲突、全局模式和连接复用都可能影响结果。切换后重新建立 ChatGPT 连接，再在原生连接记录中确认新连接命中 ChatGPT 规则且出口符合选择。

HTTPS 分流无需 MitM。HTTP 脚本日志需要软件成功解密；部分原生客户端会拒绝 TLS 检查，OpenAI 也提示解密可能造成证书错误。若目标主机解密后无法使用 ChatGPT，暂停日志并移除本入口添加的 MitM 主机或关闭相应解密，保留网络规则，用软件原生连接记录排查。插件不会绕过证书校验、地区可用性或服务端限制，选择直连也不能保证所在网络可以访问。

## 开发与验证

```sh
node plugins/ChatGPT/tools/build.mjs
node --test plugins/ChatGPT/tests/*.test.mjs
git diff --check
```

生成器把 `domains.json` 转为四平台网络配置及日志入口，避免手动更新遗漏。日志匹配与 MitM 使用核心域名族；新增核心域名时也需更新生成器与脚本的匹配范围。

离线测试覆盖四个平台接口的本地页面、开始／暂停／清空、导出、主机边界、敏感字段排除、不访问正文、容量淘汰、存储损坏／写入失败、跨平台规则一致性及合并入口完整性。这些测试使用模拟运行时，不证明真实软件接受所有配置，也不证明手机请求采集完整率或网络出口可用。

实机验收：分别导入配置，确认无解析错误；核对 DIRECT 和代理两种状态下新连接的实际出口；在浏览器开启日志复现一次请求，暂停并导出，检查事件数量和无敏感正文；暂停日志后确认分流仍生效；原生 App 如拒绝解密，使用其原生连接记录完成网络验收。

## 官方参考

- [OpenAI：ChatGPT 网络建议与域名列表](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps)
- [Loon：插件策略及参数](https://nsloon.app/docs/Plugin/) · [脚本 API](https://nsloon.app/docs/Script/script_api/)
- [Quantumult X：官方配置与脚本接口示例](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)
- [Stash：覆写合并规则](https://stash.wiki/en/configuration/override) · [策略组](https://stash.wiki/en/proxy-protocols/proxy-groups) · [HTTP 脚本](https://stash.wiki/en/script/rewrite-requests)
- [Surge：模块限制](https://manual.nssurge.com/profile/module.html) · [策略组](https://manual.nssurge.com/policy-groups/overview.html) · [请求脚本](https://manual.nssurge.com/scripting/http-request.html)

非官方插件，与 OpenAI、Loon、Quantumult X、Stash、Surge 无隶属关系。许可证沿用仓库 MIT。
