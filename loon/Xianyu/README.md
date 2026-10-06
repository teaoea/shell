# 闲鱼推送网络辅助与开发日志

针对「锁屏后不提醒，打开闲鱼才看到消息」以及「通知晚几分钟」提供闲鱼业务域名与 APNs 直连规则，用于排查代理路径、规则拒绝或连接不稳定。仅当问题来自这些网络因素时才可能改善提醒。

新增闲鱼图标和默认关闭的开发日志。开启后收录带有闲鱼客户端标识、命中 Loon 脚本的 HTTP 请求与响应，保留请求 URL、URL 中直接使用的 IPv4／IPv6、请求头、状态码和可读取的正文，支持本地单文件导出，用于分析广告及后续网络连接策略。

**来源识别采用 User-Agent 标识，不是 iOS 进程归属证明。** 不凭 `goofish.com`、共享 CDN、淘宝接口域名、Referer 或 API 名就认定请求来自闲鱼；没有明确标识时跳过。Loon 公开脚本接口没有提供发起 App 的进程／Bundle ID，因此无法严格保证「所有 URL 与所有纯 IP 连接都能采集，并且一定由闲鱼发出」。本版优先避免把无识别依据的其他 App 请求混入日志，完整性和实际版本的标识仍需手机验证。

这不是闲鱼保活插件，不能定时唤醒闲鱼、阻止 iOS 回收后台、保证买家看到卖家在线，也不能代替闲鱼服务器发送消息推送。没有定时请求或心跳脚本：访问闲鱼首页、刷新 Cookie 或获取登录令牌，不能证明消息实时送达或维持卖家在线。

## 安装与更新

- [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Floon%2FXianyu%2FXianyuPushNetwork.plugin)
- [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/loon/Xianyu/XianyuPushNetwork.plugin)
- [返回插件总览](../README.md)

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/Xianyu/XianyuPushNetwork.plugin
```

在 iPhone／iPad 上点击一键导入，在 Loon 中确认添加并启用；如浏览器没有唤起 Loon，复制上面的安装 URL，在 Loon 插件页面添加远程插件。需要 **Loon 3.5.1 Build 983 或更新版本**。使用分流模式；仅使用直连规则不需要开启 MitM，采集 HTTPS 请求头和正文则需要启用 MitM 并安装、信任 Loon 证书。不需要向插件填写账号凭据。

`XianyuPushNetwork.plugin` 是唯一安装入口，自动引用 `XianyuLogger.js` 和 `assets/xianyu.jpg`，无需另装日志插件。安装 URL 指向 GitHub `main` 分支；更新时刷新插件，再刷新／重新下载日志脚本缓存。插件中已登记可解密的已知主机，这些主机是否被解密由全局 MitM 设置决定，与日志开关独立。

关闭「开发日志」会停用四条业务采样脚本，但保留本地导出入口和原直连规则。停用／删除整个插件会关闭采样、日志页和本插件的直连规则；已有日志数据不会自动删除，需要在停用前从日志页导出并清空。若之前手动复制过规则到本地配置，需要单独删除那些规则。

当前没有 iPhone 实机验证结果，不能宣称修复了消息延迟。

## 日志使用方法

1. 更新插件和日志脚本，确认 Loon Build 983+。需要采集 HTTPS 时开启 MitM 并信任证书；以短时间复现为宜。
2. 在插件参数中开启「开发日志」。在 Loon 脚本列表运行「闲鱼开发日志」，点击通知打开日志页；也可在 Safari 打开 [本地日志页面](http://xianyu-logs.invalid/)。这是脚本直接生成的本地页面，不连接外部日志服务器。
3. 先导出需要保留的旧记录，再点击「清空并新建会话」→「开始／继续记录」。随后打开闲鱼，依次复现开屏、首页、搜索、商品详情等场景。插件记录的是从点击开始后的匹配流量，不能自动判断闲鱼前台启动时刻，也不能回补开启前的请求。
4. 广告出现时可切回日志页点击「标记广告出现」，正常页面可点「标记正常页面」。标记时间帮助定位样本，但切换页面和点击标记会有时间差；可以另外记下广告出现的准确时间。
5. 点击「暂停并下载全部日志」。它先暂停采集，再生成一个 `xianyu-<会话>.log` 文件，包含本会话全部**已保存**事件、URL／主机／字面 IP 汇总及导出结果。Safari 中可使用保存链接或文件分享入口保存。
6. 调试结束关闭「开发日志」。达到容量上限后先导出再清空，继续采集需要再次点击开始。不要把开启按钮的状态当成正在记录的证明，应检查日志页的状态、事件数和停止原因。

若事件数一直是 0，检查实际 User-Agent 是否具有支持的客户端标识、HTTPS 是否成功解密，以及其他脚本／Rewrite 是否先命中。**不要为补记录而改成“只要是闲鱼域名就收录”**，这会失去你要求的来源识别条件。可提供实际闲鱼请求头样本后再调整识别规则；请求头中的账号凭据需先遮盖。

## 来源识别与 URL／IP 记录

业务采样脚本先匹配请求头中的客户端标识，日志脚本内再检查一次。支持的候选形式包括 `AliApp(Fish/<版本>)`、`com.taobao.fleamarket/<版本>`、`IdleFish/<版本>`、`Goofish/<版本>`、`闲鱼/<版本>` 和 URL 编码形式的闲鱼名称。这里的形式用于过滤；**没有用你的 iPhone 验证当前版本实际发送哪一种标识**。Apple 的闲鱼 App Store 元数据显示 Bundle ID 为 `com.taobao.fleamarket`，不意味着每条网络请求都带有这个字符串。

| 请求情况 | 保存方式 |
| --- | --- |
| URL 主机为域名，且带闲鱼客户端标识 | 保存请求 URL、主机、协议和端口；不额外解析 IP。 |
| URL 主机为 IPv4／IPv6，且带闲鱼客户端标识 | 保存请求 URL，同时提取该 IP 字面值和端口，注明 `addressSource=request-url`。 |
| 访问闲鱼或共享域名，但没有匹配的客户端标识 | 跳过，不认定它来自闲鱼。 |
| 来源不能识别的 IP、纯 TCP／UDP、未解密 HTTPS、QUIC | 无法通过本 HTTP 日志脚本完整采集或确认 App 来源；不伪造 URL 或归属。 |

每条请求／响应保存 `source.method=user-agent-marker`、匹配标识和 `source.processVerified=false`，保留识别依据。User-Agent 可以被其他客户端复用或伪造，因此不能视为系统保证。

URL 保留路径和普通查询参数；`sign`、`token` 等已知敏感参数值遮盖，参数名仍保留。HTTP Fragment 不发送给服务端，日志中移除。**URL 含有 IP 字面值才提取 IP，不从 Host 请求头、响应中的资源链接、DNS 解析、固定地址清单或网段猜测目标连接地址。** 若 Loon 提供的请求 URL 使用域名，即使底层曾通过 HTTPDNS 连到某个 IP，此接口也不足以确认该地址，日志不会补写推测的 IP。

日志页导出的 `network-inventory` 汇总实际已保存请求的 URL、主机和 IP 字面值。响应正文内出现的资源 URL 仍保留在正文样本中，**不会当成已发出的请求混入连接清单**。后续编写策略应结合来源字段与实际请求记录，不应把单个地址自动扩成网段；本版不会根据日志自动新增直连／拒绝规则。

## 保存内容与参数

日志不设错误级别过滤：满足来源条件的正常请求、成功响应、重定向、失败状态响应均记录。请求和响应是两条独立事件；网络失败没有产生响应时，可能只有请求事件。重复方法和 URL 的事件可能共用 `correlationKey`，它不是 Loon 提供的一一对应连接 ID，不能据此计算准确网络耗时。

| 参数 | 默认值与作用 |
| --- | --- |
| 开发日志 | 关闭。打开后业务脚本才会运行；暂停会话仍需点击开始恢复。 |
| 日志容量 MB | 32，可选 16／32／64／128。达到容量或 4096 条事件时停止；不滚动丢弃已有记录。容量计算为序列化事件的 UTF-8 大小，另有索引与存储开销。 |
| 单份正文上限 KB | 1024，可选 256／1024／4096。超限保留 URL 和头部等信息，正文注明 `body-limit`，不保存半份正文。读取完整正文在判断上限之前已经消耗内存和等待。 |
| 保存未知二进制 | 开启。以 Base64 保留可读取的未知二进制协议，注明 `redacted=false`；关闭后注明 `binary-capture-disabled`。 |
| 保存图片音视频正文 | 关闭。默认保存媒体 URL、请求／响应头，不读取媒体正文，注明 `media-headers-only`；开启后仍受正文与日志容量限制。 |

JSON、JSONP、表单和 UTF-8 文本保存可分析结构，遮盖已知 Cookie、Authorization、签名、令牌和部分个人字段。未知二进制、聊天内容、订单字段及尚未识别的个人信息不保证脱敏；样本仅保存在 Loon 本地，导出不会自动上传。正文超过解析深度限制时注明 `depth-limit`。

事件分块保存并校验，导出时缺块／校验失败会列在文件末尾的 `issues` 中，不能把这类文件称为完整导出。Loon 的公开持久化 API 没有原子追加和键枚举能力；提交前重读索引可减少竞争，但高并发时仍不能证明没有丢事件，需手机完整率验证。WebSocket 握手即使命中，后续帧也不在本 HTTP 正文日志范围内。

共享 HTTPS 主机登记包括 `*.goofish.com`、淘宝共享网关、`*.alicdn.com`、`*.mmstat.com`、`iyes.youku.com` 和 `amdc.alipay.com`，会影响这些主机的解密资格，日志过滤本身不会给其他 App 分配归属。未知主机即使带有闲鱼标识，也需先经过现有解密配置才可能捕获 HTTPS；插件不会自动添加全设备 `*` 解密，也没有额外阻断 QUIC 的规则。Apple 推送主机不登记到 MitM。

## 本地日志接口与文件格式

所有接口位于 `http://xianyu-logs.invalid`，只在 Loon 启用本插件、流量命中日志脚本时有效；它不是公网服务。

| 接口 | 用途 |
| --- | --- |
| `GET /` | 日志状态、控制按钮和下载入口。 |
| `POST /start`、`POST /pause` | 开始／继续或暂停。 |
| `POST /mark-ad`、`POST /mark-content` | 追加广告／正常页面标记。 |
| `POST /clear` | 删除当前闲鱼会话数据并新建暂停会话，不清空其他插件的数据。 |
| `GET /manifest` | 暂停后返回导出元数据和事件索引；记录中返回 409。 |
| `GET /event/<会话>/<事件>` | 暂停后读取并校验单个事件；会话变化返回 409，缺块／损坏返回 422。 |

控制 POST 需要日志页当前会话提供的 `csrf` 字段；页面生成表单和下载按钮自动携带它，并检查浏览器 Origin。文件为 UTF-8 JSON Lines：首行为 `xianyu-diagnostic-log` 元数据，中间为请求、响应及手工标记，随后是 `network-inventory` 汇总，末行为 `export-result`，包含成功导出的事件数和损坏记录列表。正常导出数应与元数据的事件数一致。

离线验证命令：

```sh
node --test loon/Xianyu/tests/XianyuLogger.test.mjs
```

当前自动化用**合成请求头**验证来源过滤、普通与 IP URL、正文保存／省略、脱敏、暂停和容量保留、存储异常、交错写入、校验及单文件导出。它不证明真实闲鱼版本的 User-Agent、Loon 配置解析、Safari 下载或手机采集完整率；这些仍待实机测试。

## 规则及影响

直连规则保持原有 22 条；本版新增脚本使用新版语法，整份插件需 Loon 3.5.1 Build 983 或更新版本，并在分流模式下测试。

| 规则 | 范围与依据 |
| --- | --- |
| `DOMAIN-SUFFIX,goofish.com,DIRECT` | 闲鱼官网及子域名，包含 `acs.m.goofish.com`、`h5api.m.goofish.com`、`passport.goofish.com` 等接口；官网和开源接口实现可确认相关用途。 |
| `DOMAIN,wss-goofish.dingtalk.com,DIRECT` | 开源实现使用的闲鱼网页版 WebSocket 消息端点；不代表 iOS App 一定使用此主机。 |
| `DOMAIN,acs.m.taobao.com,DIRECT` | 社区闲鱼／淘宝插件中可见闲鱼接口的共享网关；精确匹配主机，也会使同一主机上其他 App 的请求直连。 |
| `DOMAIN-SUFFIX,push.apple.com,DIRECT` | Apple 推送域名及子域名。 |
| APNs IP 逻辑规则，共 18 条 | Apple 官方列出的五个 IPv4、四个 IPv6 APNs 网段，只有 TCP 5223 和 TCP 443 连接设为 `DIRECT`。IP 子规则带 `no-resolve`，不为其他域名增加 DNS 查询。 |

共 22 条直连规则。域名规则覆盖目标域名下的 URL，无需按 HTTPS 路径解密。未添加 `taobao.com`、`dingtalk.com`、`alicdn.com` 全域直连；覆盖范围不等于闲鱼所有版本的完整端点清单。

没有可靠资料确认闲鱼独占的固定 IP 网段，因此没有添加闲鱼业务的 IP-CIDR 规则，也不会把 DNS 单次解析得到的地址扩成网段。域名分流适合地址随 DNS 调度变化的服务；若 App 使用纯 IP／HTTPDNS 且 Loon 无法关联域名，本次新增的域名规则可能不命中，需要依据实机连接记录再补。

APNs 是所有 App 共用的 Apple 推送连接，不能仅针对闲鱼设置。直连是否更稳定取决于当前网络；如果原来已经直连，插件可能没有额外效果。官方网段列表也不是所有可能的 APNs 地址，未命中的连接继续按原配置处理。

直连规则只更改所列连接的出口策略。日志脚本记录业务流量后原样放行；本地工具 URL 由脚本直接返回页面，不修改闲鱼业务 API、DNS、系统通知或后台权限。**DIRECT 分流不等于禁用 MitM 或 Rewrite**；如已有配置解密 Apple 推送域名，应单独将它们排除在解密范围外。其他插件仍可能通过 Rewrite／脚本拒绝闲鱼请求；同一请求／响应只执行第一条命中的对应脚本，其他脚本也可能让日志缺失。采集广告样本时应检查插件顺序和现有去广告 Rewrite，避免广告在进入日志之前被修改或拒绝。

Loon 官方规则优先级为本地规则 > 插件规则 > 订阅规则；有域名时先匹配域名规则。已有本地域名规则仍可能把闲鱼或 APNs 送去代理或拒绝，需要看实际连接记录，不能只凭插件启用状态判断已生效。系统推送流量如果没有经过 Loon，插件也不会改变它。

## 在 iPhone 上测试

优先使用上面的安装 URL 添加远程插件，便于开关对比。如果需要检查本地规则冲突，也可以先备份配置，再把插件文件 `[Rule]` 下的非注释规则复制到现有本地 `[Rule]` 段，并放在冲突的本地规则前面。不要重复粘贴插件元信息或创建第二个 `[Rule]` 段。以本地规则测试时，回滚需要删除本次添加的规则。

1. 在 iPhone「设置 → 通知 → 闲鱼」允许通知，开启锁定屏幕、横幅、声音；如存在立即推送选项，选立即推送，并从定时推送摘要中移除闲鱼。在常用专注模式中允许闲鱼通知。再检查闲鱼 App 自身的消息通知选项和对应会话是否静音。实际菜单名称以设备版本为准。
2. 打开闲鱼确认已经登录，再正常返回主屏幕并锁屏，不从多任务界面划掉 App。
3. 请另一账号在锁屏约 2、10、30 分钟后发送不同的测试消息。分别记录发送时间、通知出现时间，以及打开闲鱼后消息是否才出现。
4. 对比原 Loon 配置、本规则启用、临时关闭 Loon 三种情况，每种重复测试。Wi-Fi 和蜂窝数据分别测试，避免把不同网络的结果混在一起。
5. 改分流后，已有长连接可能仍沿用原路径；可在方便时重连一次 Loon，再开始同条件测试。查看 Loon 连接记录，确认实际出现的闲鱼域名／接口网关及可见的 APNs 连接最终策略是 `DIRECT`。不要求网页版消息域名在 iOS App 中出现，不要求 APNs 一定可见，也不能用普通 HTTP 请求成功来替代 APNs 长连接验证。

如果关闭 Loon 后也同样延迟，不能据此断言一定是闲鱼服务器问题，但说明继续添加直连规则未必有效。如果本规则改善延迟，仍应多次锁屏复测；如果变差，恢复原配置。

## 在线状态的验证边界

需用另一个账号观察锁屏后卖家的「在线／最近活跃」显示，记录其变化。消息通知及时、APNs 连接成功以及闲鱼业务请求成功，都不能证明卖家在线。当前插件没有维护闲鱼消息会话，因此没有持续在线能力。

现有开源网页版消息实现使用认证后的 WebSocket 会话、心跳和令牌刷新。Loon 公开脚本 API 列表没有 WebSocket 客户端；在只使用 iPhone 上 Loon 的限制下，目前没有已验证的实现路径。即使未来找到 HTTP 轮询接口，也要验证认证、未读状态和副作用，不能直接把它称为在线保活。

## 资料

- [闲鱼官方网站](https://www.goofish.com/)
- [开源参考：XianyuAutoAgent 的登录与业务接口](https://github.com/shaxiu/XianyuAutoAgent/blob/main/XianyuApis.py)
- [社区插件参考：闲鱼与淘宝共享接口网关](https://github.com/Thelongdarkorg/loon-plugins)（只参考端点，不引入其去广告规则）。
- [Apple：设备无法收到推送通知时的主机、端口与网段](https://support.apple.com/zh-cn/102266)
- [Apple：企业网络主机列表与 HTTPS 解密限制](https://support.apple.com/zh-cn/101555)
- [Apple：通知设置、定时摘要与专注模式](https://support.apple.com/zh-cn/guide/iphone/iph7c3d96bab/ios)
- [Apple：用户可见通知与 App 是否运行的关系](https://developer.apple.com/documentation/usernotifications)
- [Apple：iOS 后台执行限制](https://developer.apple.com/forums/thread/685525)
- [Loon：规则优先级](https://nsloon.app/docs/Rule/)
- [Loon：逻辑规则](https://nsloon.app/docs/Rule/logic_rule/)
- [Loon：IP 规则与 no-resolve](https://nsloon.app/docs/Rule/ip_rule/)
- [Loon：公开脚本 API](https://nsloon.app/docs/Script/script_api/)
- [Loon：新版脚本语法、请求头匹配与首条命中规则](https://nsloon.app/docs/Script/script_v2/)
- [Apple：闲鱼 App Store 页面](https://apps.apple.com/cn/app/id510909506)；图标来自该 App 的 [App Store 图标资源](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/a7/7d/97/a77d970b-9da7-9154-56ab-46f114ea7736/AppIcon-0-0-1x_U007epad-0-1-0-sRGB-85-220.png/512x512bb.jpg)，元数据可通过 [Apple Lookup API](https://itunes.apple.com/lookup?id=510909506&country=cn) 核对。图标与名称用于辨识，本插件为非官方项目。
- [Loon：URL Scheme 与一键导入通用链接](https://nsloon.app/docs/Scheme/)
- [开源参考：XianyuAutoAgent 的消息连接实现](https://github.com/shaxiu/XianyuAutoAgent/blob/main/main.py)（非闲鱼官方接口文档，尚未用你的账号验证）。
