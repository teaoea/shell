# YouTube 信息流及视频贴片去广告（自有 JS）

只维护一个 Loon 插件入口 `YouTubeNoAds.plugin`，按功能调用同目录的去广告 JS 与日志 JS。去广告脚本均可直接在 Loon 独立运行，没有运行时模块导入、第三方实现、第三方服务、外部库、重定向或额外网络请求。

| 文件 | 功能 | 匹配位置 |
| --- | --- | --- |
| `YouTubeFeed.js` | 清理已识别的首页、播放页推荐及搜索赞助卡片，可手动隐藏首页 Shorts 推荐区 | `/youtubei/v1/browse`、`next`、`search` 的 JSON 及部分 Protobuf 列表 |
| `YouTubePlayback.js` | 集中处理播放器请求和响应、片头/中插配置、Shorts 播放广告、按开关允许后台播放；UMP 解析仅保留为离线研究 | `player`、`get_watch`、`player/ad_break`、`reel_watch_sequence` |
| `YouTubeConfig.js` | 独立管理 Onesie 配置兼容逻辑，并关闭新版播放信封中的片头广告请求标志 | `config`、`log_event`、`googlevideo.com/initplayback` |
| `YouTubeLogger.js` | 独立管理本地日志、开发抓包和唯一的完整 `.log` 导出页面 | 专用页面和各链路日志入口 |
| `YouTubeNoAds.plugin` | 统一配置去广告、日志入口、参数与 MitM | 只需启用这一个插件 |

主插件通过 Loon 的 `#!icon` 展示 YouTube 图标，`#!desc` 展示功能范围、默认关闭的试验/日志选项及使用条件，`#!homepage` 指向本说明。图标保存为 `assets/youtube.png`，来自 [YouTube 官方页面引用的 144×144 PNG](https://www.youtube.com/s/desktop/2b888666/img/favicon_144x144.png)（2026-10-02），随本仓库发布，不依赖其他人的图标仓库。插件信息字段见 [Loon 插件文档](https://nsloon.app/docs/Plugin/)。

Loon 脚本列表中的条目是执行规则，同一 JS 可以被不同阶段调用。主插件合并为 7 条规则：配置请求/响应各一条，播放请求/响应各一条，信息流响应一条，日志请求/响应各一条。日志请求同时处理记录和本地页面导出，取消重复的下载规则与手动 generic 入口；在 Safari 直接访问日志地址。媒体响应日志仍不读取正文。

JavaScript 按职责整理为四份文件：信息流及首页 Shorts、播放广告及后台播放、配置协商、日志与导出。每份文件由内部路由根据 URL 和请求/响应阶段调用对应处理逻辑，Loon 仍可直接执行，不需要运行时模块导入。文件头及每个函数都使用中文 JSDoc 注释，包含功能说明和更新时间，便于后续维护。

目标包括首页/推荐列表中的赞助卡片，以及 YouTube 插入的片头及中插广告。**当前实现清理已识别 API 响应中的广告位和普通 Player 广告协商，并关闭 Onesie 请求信封的片头广告标志。1.8.0 组合外层片头标志与本地认证后的内层广告协商清理，不强制返回空 initplayback 响应；未知结构原样放行。用户已确认退出视频后的首页广告改善，但仍报告偶发片头广告和无广告视频黑屏，新版效果尚待设备验证，不能保证所有贴片广告消失。**

### 从网页过滤方案迁移到 iOS API

网页端扩展通常在两层处理广告：网络过滤负责拦截广告请求，页面脚本再删除播放器响应中的广告元数据和页面里的广告组件。当前实现参考 [uBlock Origin 的 YouTube 过滤规则](https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters.txt) 所覆盖的 `playerAds`、`adPlacements`、`adSlots`、`pageadViewthroughconversion` 和 Shorts `isAd` 标记，并参考 [AdGuard Scriptlets](https://github.com/AdguardTeam/Scriptlets) 的响应属性替换思路。对已实际出现片头广告的新版 App，另采用[公开网页模块](https://gist.github.com/oiiogong/3b2f171141b54027e5db9a543b09b194)中的精确 `/youtubei/v1/player/ad_break` 广告配置拦截方案；Loon 无法在原生 YouTube App 内运行 DOM/scriptlet，因此这里把相同目标转换为对 `/youtubei/v1/*` JSON、Protobuf 响应和广告配置请求的定点处理。

Protobuf 字段和 UMP 封装另外与 [Maasea/YouTube](https://github.com/Maasea/sgmodule/tree/master/Script/Youtube) 及公开的 [Innertube 逆向 schema](https://github.com/davidzeng0/innertube) 交叉核对。仓库没有复制第三方压缩脚本、运行库或外部 Worker，也不在运行时请求这些项目；各项功能由本目录四份自有 JS 按职责完成。浏览器方案中直接屏蔽媒体 URL 的做法没有移植到 App，以避免把广告媒体拦成黑屏或同时破坏正片。

## 实现范围

- API 请求与响应都处理 `/youtubei/v1/player` 和 `/youtubei/v1/get_watch`，请求部分另处理精确的 `/youtubei/v1/player/ad_break`。支持 `youtubei.googleapis.com`、`youtubei-att.googleapis.com` 及 `youtube.com`、`www`、`m`、`music` 子域。
- 播放器请求：Protobuf 只沿已确认的 `PlayerRequest.context（字段 1）→ ad_signals_info（字段 9）`、`playback_context（字段 4）→ content_playback_context（字段 1）` 路径处理。删除广告信号、VAST 参数字段 12 和强制广告参数字段 25，并把协议已公开的 `is_inline_playback_no_ad（字段 50）` 写为 true；`get_watch` 另沿顶层字段 2 进入 `PlayerRequest`。JSON 对应删除 `adSignalsInfo`、`adParams`、`forceAdParameters` 并设置 `isInlinePlaybackNoAd=true`。修改请求后移除旧的 `Content-Encoding`、`Content-Length`，让 Loon 发送重新生成的未压缩正文，其他请求头和未知 Protobuf 字段保持原样。
- JSON：删除播放器对象中的 `adPlacements`、`adSlots`、`playerAds`、`adBreakHeartbeatParams`、`adParams`，删除 `playerConfig.adPlacementConfig`、`playerConfig.adSignalsConfig`，以及 `playbackTracking.pageadViewthroughconversion`。保留播放地址、视频信息、字幕及其他统计地址；不会全局删除任意对象中同名字段。
- Protobuf：自行实现 wire format 读取，移除已识别 Player 消息的字段 7（`adPlacements`）、字段 68（`adSlots`），并在字段 9（`playbackTracking`）中删除字段 18（`pageadViewthroughconversion`）。`get_watch` 使用已知的字段路径 `1 → 2 → Player`。保留非广告字段的原始字节、顺序及未知内容，只在嵌套消息改变时重算外层长度。
- Ad break：`YouTubePlayback.js` 只对精确的 `player/ad_break` 请求直接返回 HTTP 200 与合法的空 Protobuf，阻止客户端取得新的片头/中插广告配置。它不匹配 `googlevideo.com`，不返回 502，也不截断广告或正片媒体流；主插件固定启用该处理。
- Onesie 配置：`YouTubeConfig.js` 只接受 User-Agent 明确为 `com.google.ios.youtube/...` 的请求，按固定 Protobuf 路径读取 `clientKey`、`encryptKey`、有效期和热配置开关。密钥只写入 Loon 本地缓存，不进入普通日志或控制台；YouTube Music、网页和未知客户端不读写该状态。没有可用配置时，`log_event` 请求会去掉热配置哈希头，使服务端返回完整配置；已有有效配置时保留该哈希。脚本会移除 Loon 解码正文后失效的 `Content-Encoding` 请求头。
- Initplayback：精确匹配 YouTube App 请求后，验证 Onesie 外层字段 3 中的加密信封结构，设置信封字段 13（enable_ad_placements_preroll）为 false。已有单字节 true 标志时复制正文并原位改为 0；标志缺失时仅新增该字段并更新外层长度。外层标志处理保留密文、客户端密钥、IV、HMAC 和未知字段。1.8.0 随后尝试使用有效且匹配的本地配置校验 HMAC、解密内层 PlayerRequest、清理广告信号/VAST 参数并设置不请求内联广告，再重新加密签名；失败时保留原密文和已完成的外层标志改动，不返回合成响应。重复字段、错误类型、截断、超限或未知信封原样放行。该标志的公开定义和使用方式来自 [InnertubeRequest schema](https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/innertube_request.proto) 与 [Onesie 示例](https://github.com/LuanRT/googlevideo/blob/main/examples/onesie-request/main.ts)；服务端是否采纳 iOS 请求仍需实测。规则 requires-body=true 只读取小型请求正文，不读取视频媒体响应。
- Shorts 播放广告：`YouTubePlayback.js` 只删除响应字段 2 的条目中符合 `command（1）→ reelWatchEndpoint（139608561）→ adClientParams（16）→ isAd（1）= true` 的完整条目。普通 Shorts、未知命令及结构不完整的条目保持原样。
- 字段编号和 `get_watch` 路径来自已有逆向协议描述的核对，属于协议映射信息；未复制原脚本或其库实现。YouTube 未公开保证这些编号适用于所有客户端。脚本使用字段 2 的 playabilityStatus 及 wire type 作有限检查，不能证明所有未来协议变化都能识别。
- 空响应、非 200、损坏数据、已检测到的结构不匹配、未知内容类型、API 上的非预期 UMP、未解压的 gzip 及超限响应原样通过。限制为 2 MiB 响应、30,000 个解析字段、20,000 个 JSON 对象节点和 64 层 JSON 深度。
- 拒绝两个 `googleapis.com` API 域名和 `*.googlevideo.com` 的 UDP/443，只用于促使 API、`initplayback` 与媒体事件日志回退到可被 MitM 的 TCP。插件不拒绝 TCP 播放媒体，不修改 `ctier`、签名或音视频字节；精确命中且结构已识别的 YouTube App `initplayback` 请求只关闭片头广告标志。关闭日志工具不会同时撤销 `*.googlevideo.com` 的 MitM 和 UDP 回退规则。
- 无字幕翻译、按钮隐藏、画中画或会员相关修改。后台播放仅在独立开关开启时修改明确的播放能力字段，不伪造会员状态。

### 后台播放开关

主插件的“后台播放”默认关闭。开启后，`YouTubePlayback.js` 在已识别的播放器响应中把后台播放能力设为允许：JSON 同时写入 `playabilityStatus.playableInBackground` 和 `backgroundPlayerRender.backgroundAbility.active`；Protobuf 保留兼容字段 4，并写入 `PlayabilityStatus 字段 11 → BackgroundSupportedRenderer 扩展 64657230 → BackgroundAbility.active（字段 1）`。已有未知字段、播放地址和其他播放状态保持原样；开关关闭时不会修改服务端能力。

该开关用于普通视频切换 App 或锁屏后继续播放音频。它不修改画中画、会员身份、付费权益或媒体字节；直播、地区/年龄受限内容及 YouTube 客户端自身限制仍可能阻止后台播放。修改后需要在 Loon 更新主插件和脚本，并完全退出再打开 YouTube 才能让新响应生效。

## 安装与更新

主插件按请求路径调用本仓库的四份 JavaScript：

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeFeed.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubePlayback.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeConfig.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeLogger.js
```

**本地新建或修改文件不会自动发布到该地址。发布前直接导入当前远程版配置，可能遇到脚本下载失败或仍取得旧文件。**

可选择以下一种方式：

1. 发布本仓库的插件与 JS 后，在 Loon 更新插件，并重新下载对应脚本。需要设备能访问 `raw.githubusercontent.com`。
2. 本地试用：把四份 JS 导入 Loon 的本地脚本资源，确认保存名称；把主插件各条目的远程 `script-path` 改为对应的本地资源名。不是填写 Mac 上的 `/Users/...` 路径。仍只需启用一个插件入口。

更新时替换 `YouTubeNoAds.plugin`，不要保留另一份旧主插件。删除或禁用此前的 `YouTubeCtierAds.plugin` 及其他匹配 YouTube 的脚本，若曾复制过相关规则到主配置，也一并移除。

开启插件、脚本和 MitM，保持 Loon CA 证书完全信任；确认各功能条目分别加载对应的自有 JS 后，完全退出 YouTube 再打开。若主配置的本地规则先放行了相关域名的 UDP/443，可把主插件的三条 `[Rule]` 规则移到主配置对应放行规则之前。

## 查看结果

默认关闭日志工具。需要排查时只需在主插件开启“日志工具”，它会统一保存浏览、刷新、播放与 UMP 全链路脱敏结构；脚本控制台保持关闭，避免重复记录。日志前缀含脚本版本：

```text
[YouTubePlayback 2.1.0] player changed: removed=3 tracking_removed=1 background_modified=1 format=protobuf
[YouTubePlayback 1.0.0] player changed: context_ad_signals=1 playback_ad_params=1 inline_no_ad=1
[YouTubePlayback 1.0.0] ad_break blocked: empty-protobuf status=200
[YouTubeConfig 1.0.0] config updated: lifetime_seconds=600 hot_config=true
[YouTubeConfig 1.3.0] initplayback changed: authenticated=true encoding=gzip context_ad_signals=1 playback_ad_params=1 inline_no_ad=1
[YouTubePlayback 1.0.0] reel_watch_sequence changed: removed=1 format=protobuf
[YouTubePlayback 2.1.0] get_watch pass: removed=0 tracking_removed=0 background_modified=0 format=protobuf
```

- `changed` 表示删除了已识别广告字段或修改了后台播放能力，不能单独证明某次视频不会出现广告。`removed` 是字段或条目出现次数，不一定等于屏幕广告数；`tracking_removed` 是删除的 pagead 追踪字段数；`background_modified` 是本次实际改写的播放状态数量。
- `pass: removed=0` 表示没有可清理的已识别广告字段，也可能没有识别到已知 Player 结构。
- `pass: ...` 错误或格式原因表示整个响应未修改。
- 没有日志时，先确认新 JS 已下载且“日志工具”已开启，再查看是否出现匹配路径的请求。不要求每次播放必然访问 `youtubei.googleapis.com`。
- “日志工具”开启后，唯一导出的 `.log` 保存脱敏结构；凭据、签名及原始正文不写入日志缓存。Loon 自带的请求记录独立于本插件。

## 信息流赞助卡片清理

首页推荐列表里标注“赞助商广告”的 Robinhood 卡片属于信息流广告。它由推荐接口提供卡片数据，即使卡片自动播放视频，也应从推荐列表中移除卡片。`application/vnd.yt-ump` 是媒体封装，单独处理媒体下载不能移除该列表项。

`YouTubeFeed.js` 自行实现清理逻辑，不加载其他人的 JS。主插件默认启用信息流响应入口，匹配 `browse`、`next` 和 `search`。JSON 只在列表字段中删除具有明确广告 renderer 的整项，包括 `adSlotRenderer`、`inFeedAdLayoutRenderer`、`promotedVideoRenderer` 等，以及包在 `richItemRenderer.content` 中的广告卡片。正常视频、频道、购物内容、包含“广告”文字的普通标题和翻页 token 保留；Shorts 默认保留，可用下面的独立开关隐藏首页推荐区。广告与正常 renderer 同时出现在同一对象中时，整条响应保留，避免误删。

“自适应信息流广告”固定开启，用于 YouTube 新增了尚未登记的 EML 布局时补充固定映射。它不会扫描整条响应：只有进入已经确认的信息流卡片正文后，且该卡片达到最小结构长度并出现网页过滤规则也使用的精确 `pagead` 标记，才移除该卡片并记录 `adaptive_removed`。

Protobuf 仅沿已核对的路径处理：BrowseResponse 字段 9 / 10 中的 SectionListRenderer（49399797）及其列表字段 1，删除含 AdSlotRenderer（424701016）或 CompanionAdRenderer（55514441）的整个列表项；`next` 支持 SingleColumnWatchNextResults（51779735）中的 SectionList，以及字段 8 的 WatchNextSecondaryResults continuation（51779776），其列表支持广告位和 CompactPromotedVideoRenderer（73920376）。未知字段保持原字节，只在已修改的外层消息重算长度。`removed` 是被识别的广告字段/JSON 列表项计数，不等同于屏幕上广告的准确条数。

**尚未适配：其他 Tab/列表路径、二进制 search 响应及既没有严格 EML 映射、也没有卡片内 `pagead` 标记的 Elements/EML 卡片。** 当前不会在整条响应的任意字节中搜索“ad”或“Robinhood”并删除，也不根据展示文字猜测卡片性质。这些结构原样通过并保存开发样本。限制为 4 MiB 响应、30,000 个 Protobuf 字段、32 层已知消息路径、20,000 个 JSON 节点和 64 层 JSON 深度；截断、混合 renderer、解析错误或超限时整条原响应通过。

### iOS 首页 EML 卡片适配（1.1.0）

根据用户新提供的完整信息流导出，已补上初始首页路径 `9 → 58173949 → 1 → 58174010 → 4 → 49399797`，以及初始/延续列表内的 `ItemSectionRenderer（50195462）→ contents（1）→ ElementRenderer（153515154）`。只读取卡片本身的 `172660663 → 1 → 168777401`，不在共享模板库或其他任意二进制中搜索广告词。

以下七组布局和数据类型在 YouTube iOS 21.39.4 的样本中出现：

| 卡片布局 | Model 字段 | 广告操作路径（从 Model 正文起） |
| --- | --- | --- |
| `video_display_button_group_layout.eml` | 491441836 | 19 → 8 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |
| `full_width_portrait_image_layout.eml` | 478840678 | 27 → 7 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |
| `full_width_square_image_layout.eml`（1.2.1 新增） | 461080918 | 55 → 7 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |
| `video_display_carousel_button_group_layout.eml` | 33561652 | 14 → 8 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |
| `full_width_square_image_carousel_layout.eml`（1.2.2 新增） | 33562350 | 5 → 5 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |
| `carousel_footered_layout.eml`（1.2.2 新增） | 505359416 | 31 → 8 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |
| `video_display_full_buttoned_layout.eml`（1.2.2 新增） | 454362329 | 32 → 8 → 10 → 4 → 169495254 → 138681778 → 2 → 138681066 → 3 → 449330433 |

清理要求三项同时成立：布局标识为对应名称加样本中的 `.eml-fe|` 和 16 位十六进制版本后缀；Component 的 Model 是对应的唯一字段；广告操作路径末尾的字段 8 映射项包含明确的 `skip_ad_on_block` 键和长度型值。布局标识沿 `Component 字段 3 → 172035250 → 1` 读取，Model 沿字段 5 读取。仅有布局名称、模型编号或正文中出现广告词均不足以删除。

卡片内只删除已识别的广告内容。如果 ItemSection 的全部内容均为广告且剩下的只是已知追踪/标志字段 4、8，移除整个外层列表项。混合列表保留其他内容；不能确认的 type/model 保留该卡片。检测到混合 renderer、重复单数消息、字段类型异常或不完整数据时，整条响应原样通过。删除广告后，最多删除紧随其后的一个已识别 `cell_divider.eml`（Model 347043917）列表项，避免留下该广告对应的分隔占位。正常视频布局 `video_lockup_with_attachment.eml`、其他卡片、独立分隔项、Shelf、共享模板库和翻页数据保持原字节。

本次完整文件含 12 个事件，其中 6 份 `browse` 响应：离线回放时，4 份各识别并移除 1 个广告卡片和后续分隔项；其余 2 份无已识别广告，逐字节保持原样。独立比对验证，4 份修改结果与“只移除指定列表项、重算外层长度”的预期完全一致。此验证是实际响应样本的离线回放，仍需手机更新后确认界面结果。原日志、请求凭据和媒体正文均不上传仓库；提交的回归样本为自行构造的最小协议数据。

1.2.1 补上首页 BIGO LIVE 方形图片赞助卡片：新导出的记录显示该卡片为 `full_width_square_image_layout`、Model 461080918，其广告操作位于上表中的字段 55 路径。此前版本没有这一组映射，因此原样保留；新版仍要求布局、唯一 Model 和 `skip_ad_on_block` 映射键及值同时匹配，再删除整项及紧随其后的已识别分隔项。仅有方图、品牌名称或广告词不触发删除。

对此次完整导出的 12 份响应逐一离线回放，包括此前记录与新增记录。新版对遗漏的 BIGO LIVE 响应移除一个广告项及分隔项，其余广告清理和首页 Shorts 开关结果保持预期；12 份输出均与独立按指定列表项删除、重算长度的结果逐字节一致。原始开发日志仍只在本地处理。

1.2.2 根据手机更新到 1.2.1 后的完整导出，补上方图轮播、带底部按钮的图片轮播和带完整按钮的视频布局。其中后两种样本对应实机仍出现的 Niche、Ethereal Road 赞助卡片；此前版本没有对应映射而原样保留。新增三组仍要求布局、唯一 Model 和固定路径中的 `skip_ad_on_block` 键及值联合匹配，不依赖广告商名称。64 条事件中的 32 份响应已逐一离线回放：此前遗漏的三份各额外删除一个广告项及其分隔项，其他清理和 Shorts 开关保持预期；全部输出与独立按指定列表项删除、重算长度的结果逐字节一致。手机显示效果仍需更新后复测。

### 隐藏首页 Shorts（1.2.0）

主插件新增 **“隐藏首页 Shorts”** 开关，默认关闭。开启后移除首页推荐流中的整块 Shorts 推荐区，包含区块标题与短视频卡片。底部 Shorts 导航入口、Shorts 播放、搜索结果、订阅页和频道页保留。普通视频即使标题含有“Shorts”也保留。

使用步骤：

1. 在 Loon 更新 `YouTube去广告` 主插件，并重新下载其引用的 `YouTubeFeed.js`，确保使用 1.2.0 或更高版本。
2. 进入主插件设置，打开“隐藏首页 Shorts”。保持插件、脚本与 MitM 启用、证书完全信任；此功能不需要开启日志工具。
3. 完全退出 YouTube 后重新打开，进入首页并下拉刷新。已缓存的旧首页需要刷新才能取得修改后的推荐列表。
4. 如需恢复，关闭该开关，再退出 YouTube、重新打开并刷新首页。

首页识别只用于 `browse`：首次加载按 Tab 的 `FEwhat_to_watch` 标识确认；继续下滑的列表按已知 continuation 结构确认。Protobuf 首页 Tab 使用字段 11；continuation token 解码后读取样本中的 `80226972 → 2` browse ID。Next/Reload continuation 的字段编号与 token 字段参考 [SectionListSupportedContinuations](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/section_list_supported_continuations.proto) 和 [NextContinuationData](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/next_continuation_data.proto)。请求正文可用时，也读取明确的 browse ID 或 continuation；请求字段参考 [BrowseRequest](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/browse_request.proto)。无法确认首页的响应保留 Shorts，不把全部 `browse` 当作首页。

已提供的 iOS 21.39.4 样本中，区块为 `ShelfRenderer（51845067）→ content（5）→ HorizontalListRenderer（51431404）→ items（1）`。仅当所有条目都具有明确的 `shorts_video_cell.eml-fe|` 布局（16 位十六进制版本后缀）和唯一 Model 519005951 时，删除整个 Shelf 列表项。不会按标题或任意字节中的 Shorts 文本删除。HorizontalList 路径参考 [HorizontalListRenderer](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/horizontal_list_renderer.proto)；布局与 Model 对应关系来自本地实际响应。

JSON 支持 `reelShelfRenderer`、带 Shorts 图标的 `richShelfRenderer` 及其 `richSectionRenderer` 包装、只含 Shorts 的 ItemSection 和水平 Shelf；要求内部条目均为明确的 `reelItemRenderer` 或 `shortsLockupViewModel`。保留混合普通视频的列表、未知布局和共享模板库。JSON renderer 字段核对参考 [ReelShelf](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/ReelShelf.ts) 和 [RichShelf](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/RichShelf.ts)，未调用或复制这些解析器的实现。

日志新增 `hidden_shorts`，表示移除的 Shorts 区块数量，与广告计数 `removed` 分开。例如 `removed=0 ... hidden_shorts=1` 表示只隐藏一个 Shorts 区块。完整日志的响应处理参数也记录 `hide_home_shorts`。

已对此前完整导出的 6 份响应分别在开关关闭/开启状态离线回放：关闭时与此前去广告结果逐字节一致；开启时额外移除其中 2 份响应各自的 1 个 Shorts 区块，其他响应保持此前结果。12 次结果均与独立按指定列表项删除、重算长度的预期逐字节一致。尚需手机更新后确认显示效果；未知的新布局仍会保留。

### Shorts 播放广告清理

Shorts 广告清理固定开启，由合并后的 `YouTubePlayback.js` 处理 `reel/reel_watch_sequence`。JSON 只删除明确满足 `command.reelWatchEndpoint.adClientParams.isAd === true` 的 `entries` 项；Protobuf 只沿已核对的字段链定位相同布尔标记并删除外层条目。它不会按标题、频道、时长或任意广告文本判断，也不影响首页“隐藏首页 Shorts”开关、底部 Shorts 入口或普通 Shorts。

该脚本与首页 Shorts 功能分开，是因为一个处理 Shorts 播放序列里的广告条目，另一个处理首页推荐区块。前者固定启用；普通 Shorts 和结构未知的命令始终保留。

### 取得首页广告的样本

1. 发布后更新主插件和 JS；完全退出 YouTube，再打开。先观察首页赞助卡片是否消失。
2. 仍有卡片时，在主插件打开“日志工具”。它会保存信息流脱敏结构，并在开启期间读取初始化与 UMP 响应，可能增加播放等待。
3. Safari 打开 `http://youtube-logs.invalid/`，先保留需要的旧记录，然后清空并开始记录。回到 YouTube 首页，下拉刷新一次，让赞助卡片出现；不必点开视频。
4. 回到日志页面暂停，选择“导出完整日志文件 .log”。该文件同时包含 `browse/next/search` 信息流、刷新配置和播放链路，不再单独生成信息流文件。
5. 在 `.log` 中确认存在 `Endpoint: browse`（或 `next/search`）、`Phase: response`，并且 `Response-Before` 正文显示 `Available: true`。如果这些记录仍缺失，应先检查脚本更新、MitM 和实际请求路径。未知 EML 卡片需要该响应样本才能继续适配。

本次实际响应的离线回放日志（不是手机界面实测）：

```text
[YouTubeFeed 1.1.0] browse changed: removed=1 format=protobuf opaque_elements=12 removed_eml=1 removed_dividers=1
[YouTubeFeed 1.1.0] browse pass: removed=0 format=protobuf opaque_elements=0 removed_eml=0 removed_dividers=0
```

`removed_eml` 是确认移除的 EML 广告内容数，`removed_dividers` 是移除的关联分隔项数。`opaque_elements` 统计已知路径上保留的 ElementRenderer（含普通视频和分隔项），不代表广告数量，也不代表统计了所有 EML 卡片。

## 主插件日志工具与开发记录

只启用 `YouTubeNoAds.plugin`，不再使用独立的 `YouTubeLogger.plugin`。四份 JS 共用一个记录索引，日志和脱敏结构统一导出；结构诊断按块存储以避免把全部数据反复写入索引，按来源分类的多套日志缓存不会重新引入。

主插件参数：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| 后台播放 | 关闭 | 开启后在已识别的播放器响应中允许普通视频后台继续播放；关闭时保留服务端原值 |
| 隐藏首页 Shorts | 关闭 | 只隐藏首页推荐流的 Shorts 区块 |
| 日志工具 | 关闭 | 开启后保存浏览、刷新、播放和 UMP 全链路脱敏结构，并可标记、暂停和导出一个完整 `.log` |
| 播放请求地区 | original | 保持原地区；可选 CN 等地区，仅改变客户端 gl 参数 |
| 日志保存级别 | info | 控制新事件及其可用脱敏样本的保存级别 |
| 日志容量 MB | 32 | 可选 16 / 32 / 64 MiB，限制脱敏记录序列化总容量 |

插件界面只保留三个开关：后台播放、隐藏首页 Shorts、日志工具。播放器请求、片头/中插配置、新版 initplayback、Shorts 广告及自适应信息流广告清理均固定启用，不再显示重复开关。日志保存级别和容量是选择项，不是功能开关。

日志级别作用于新记录：`info` 保存完整脱敏链路，包括未修改的请求/响应、处理结果和错误；`error` 只保存错误事件及其可用的脱敏诊断，正常样本不写入缓存；`debug` 保存完整链路并保留调试级别；`warn` 保存警告和错误。改变级别不删除历史记录。“完整”指脚本实际观察到的数据，不能保证全部网络请求均被捕获。

2026-10-04T06:31:09Z 导出确认，广告通过 browse 延迟更新容器 `10 → 49399797 → 32 → 1 → 1 → 1 → 153515154` 下发。2.3.0 加入该路径，使用既有 EML 模板/模型和命令识别清理完整广告条目，保留更新位置元数据及未知字段。四份原先未修改的含 pagead 响应重放后广告标记均清零；此处为日志样本重放结果，更新后的实机界面仍需验证。

### 能保留哪些开发数据

2026-10-05 日志写入优化：四份脚本在脱敏样本分块写完后重新读取最新共享索引，再追加本次事件并重新核对条目数和容量。这样保留样本处理期间其他脚本已提交的记录，缩短使用旧索引的窗口。提交前复核会话及记录状态；暂停或清空后到达的旧事件放弃提交并删除本次样本块，旧写入失败也不会恢复旧会话。保留一个共享缓存和一个 `.log` 导出入口。公开存储接口没有原子读改写，最终提交恰好同时发生时仍可能覆盖，不能保证完整网络抓包。

下载的日志文件会列出实际记录的接口数量、是否观察到 initplayback/player/get_watch，以及对应版本；日志页面隐藏这些诊断信息。范围声明不等于完整抓到所有请求；缺失可能来自缓存、未命中、日志启停时序或并发索引覆盖，不能仅凭缺失认定请求没有发生。

日志在写入缓存前脱敏；单一 `.log` 保留浏览、刷新、播放的事件时间、脚本版本、接口路径、状态、耗时、删除计数、媒体响应头、UMP 分片目录、可解析的播放器响应结构和人工标记。

- URL 仅保留主机和路径，全部查询参数及片段移除。请求/响应头允许 Content-Type、Content-Length、Content-Encoding、Accept-Encoding，以及经过固定格式验证的 Transfer-Encoding、Accept-Ranges、Content-Range；Authorization、Cookie、Set-Cookie、访客及账号头、HTTP/2 trailers 不保存。
- Protobuf 响应保留字段号、wire type、长度、嵌套路径及布尔值。字符串只保留已知广告标记、模板名称和首页身份标记，模板哈希归零；未知叶节点不保存原始字节。非布尔数值不保存原值。
- JSON 响应保留合法字段名及层级，身份相关键移除；字符串只保留长度和固定广告标记。标题、账号、视频 ID、正文中的签名 URL 不保存原文。
- 普通 API 请求正文保存可用的脱敏字段结构及修改前后结果，原始字节不保存。已认证解密的 initplayback 内层播放器请求也保留脱敏结构。config/log_event 原始配置、密钥和媒体内容不进入日志。开启日志工具时等待 initplayback/videoplayback 完整响应，读取 UMP 分片目录与受支持的元数据，媒体分片只保存类型和长度；Onesie 播放器响应使用有效的本地配置进行 HMAC 验证、AES-CTR 解密和可用的 gzip 解压，保存其中 API 正文的脱敏字段树。未认证、缺少配置、未知压缩或未知类型会留下固定原因，不回退到保存密文或原文。配置密钥仍供功能处理使用，不进入日志缓存或导出。
- 异常只保留固定错误代码，不保存可能包含正文的异常消息和堆栈。脱敏失败或未知协议只留下省略标记，不回退到保存原文。
- 脱敏数据继续分块保存并校验长度和校验值。它能用于定位结构漏点，不能恢复为可重放的原始网络包；`Available:false` 配合 `Reason:privacy-structure-only` 表示主动脱敏，结构可见于 `Structure`。

首次使用新版日志时会清除旧索引引用的原始正文块，保留事件摘要和其他脚本数据；清除失败则停止本次日志写入。公开存储接口无法枚举未索引孤块，已经下载到“文件”的旧日志也不会被自动删除。升级期间应刷新主插件及全部四份 JS，避免旧缓存脚本继续写入原文。

### 完整日志操作

1. 更新主插件和四份 JS：`YouTubeFeed.js`、`YouTubePlayback.js`、`YouTubeConfig.js`、`YouTubeLogger.js`。文件需要发布后才能从远程地址下载；本地导入时所有条目都填写对应的本地资源名。
2. 主插件只需开启“日志工具”，选择容量。日志工具会自动保存 API 脱敏结构、初始化和 UMP 响应的开发结构，不再需要第二个开关。排查完整链路选择 info；只收集错误选择 error。
3. Safari 输入 **`http://youtube-logs.invalid/`**。地址由 Loon 在本地直接响应，不需要额外 MitM。先导出需要保留的旧记录；需要干净样本时清空，再点“开始记录”。
4. 重现一次广告和一次正常播放。在相近时间添加广告/正片标记，减少其他播放、预览或自动播放，以便比较样本。切换 App 添加标记会有时间误差，不把它当作精确的广告边界。
5. 回到页面点击 **“下载日志”**。页面自动暂停记录，读取分块、校验并生成唯一的 `.log` 文件，在当前页面触发下载，不跳转。Safari 若未显示下载提示，可点击生成后的“保存日志文件”链接。旧导出地址仅保留兼容已有书签。
6. 查看文件头的 `Stopped-Reason`，每个 `EVENT` 的 `Capture-Error`、各正文的 `Available/Reason`，以及末尾 `All-Referenced-Samples-Readable`。未修改响应的正文会用 `Reference` 指向原响应；修改响应会同时保存修改前后脱敏结构。
7. 全部停止新增时关闭“日志工具”；已有样本保留。页面清空会删除本项目索引、已索引诊断数据和旧日志缓存，保留其他脚本数据。

旧摘要没有保存过正文，不能恢复成原始二进制，需要用新模式重新录制。两次抓包都需先检查完整性，不把一次 `200 OK` 当成所有数据都已捕获。

### 单文件分块导出

此前直接把整个开发数据放进一个脚本响应，大文件可能在设备上无法完整生成或保存。当前页面会先读取一个小索引，再逐块读取本机样本，在浏览器中检查长度、校验值和元数据，最终合成 **一个完整 `.log` 文件**。导出前必须暂停记录，并保持 Loon 开启；会话变化、样本块缺失或校验失败时不提供保存按钮，保留原有缓存供重试。

唯一导出包含所有已匹配来源：`browse/next/search` 浏览与刷新、`log_event/config` 配置协商、`player/get_watch/initplayback/ad_break` 播放链路、Shorts 与 UMP 媒体事件。旧 `/download.log` 地址只跳转到这个完整导出；`/download.json`、`/download-feed.json` 和信息流专用出口已移除。页面内部使用的小型清单和分块接口只负责本机传输，不会作为日志文件提供给用户。

浏览器分块合成没有读取 Loon 未捕获的数据，也不能修复已经下载的不完整文件。Safari 内存、后台切换和保存行为仍需要实机验证。完整开发记录可能较大，浏览、刷新、播放共用唯一导出；导出失败时不要清空缓存。

### 保留策略和实际边界

- 不再自动覆盖旧记录。统一索引最多 600 条、128 KiB UTF-8 序列化内容；脱敏结构另按选定容量保存，结构序列化开销计入容量。达到任一上限即停止新增并显示停止状态，先导出，再清空重录。
- 单个运行时正文最多 8 MiB；单事件最多 32 MiB 字符内容、256 个存储块。超限停止抓包并给出原因，不保存一份看似完整的截断正文。请求和响应各算一个事件。
- 存储失败、序列化失败或正文超限时不改变去广告输出。存储本身不能写入时，停止标记也可能无法落盘，只能在控制台看到固定错误提示。
- Loon 公开存储 API 在这里没有原子追加；并发脚本可能丢失索引条目。脚本被系统终止时也可能留下未索引块，无法通过当前公开接口枚举并恢复。因此这是**尽可能保留运行时可见数据的开发记录**，不能保证整个网络会话无遗漏。
- 只匹配已配置的 `player/get_watch/player/ad_break/browse/next/search/reel_watch_sequence/log_event/config` 与 `googlevideo/videoplayback/initplayback`。没有命中 MitM、TLS 失败、脚本超时及其他接口不在本记录范围。响应脚本可见的请求正文可能缺失，独立请求阶段用于补充，但并发重复 URL 的精确配对无法保证；`correlation.urlMethodHash` 仅作分组提示。
- Loon 提供的正文可能已经解压，并非原始 TLS/HTTP 线上字节。记录的是运行时交给脚本数据的脱敏结构，需结合保存的头和 `available` 标记解释。
- 读取响应、结构脱敏及写本地诊断数据可能增加播放等待。建议只录制一次问题，随后关闭；不能保证抓包过程不影响播放时序。
- 手机上的脚本引擎、存储容量、页面入口和 Safari 大文件下载仍需实机验证。

升级时先打开日志页面：统一索引尚不存在时会合并当前会话旧缓存。只有新索引成功写入后才删除旧缓存；合并超限时保留旧数据并暂停，仍可导出旧摘要。统一索引已存在时不再重复导入旧缓存。

实现基于 Loon 的请求/响应正文、本地存储和生成响应接口：[Script API](https://nsloon.app/docs/Script/script_api/)。公开 API 没有直接写入 iOS “文件”App 的接口，导出通过浏览器下载保存。

## UMP 广告预取提示清理试验

UMP 是多部分播放封装，包含特殊前缀整数、音视频和控制消息。不是普通 Protobuf varint 连续流。`YouTubePlayback.js` 自写 UMP framing 读取与重组，不加载第三方运行代码。

当前能处理的是 Part 69 的 CuepointList：沿 `CuepointList.ssap_infos（字段 1）→ CuepointInfo.cuepoint（字段 1）`，只删除 `Cuepoint.type=1` 且 `event=6（PREFETCH）` 的条目。协议研究把 type 1 解释为广告，并记载 PREFETCH 会触发 `/player/ad_break` 广告配置预取。**这给出了可验证的预取提示清理目标，但不能证明删除提示就能避免实际广告插入。**

以下内容保持原始字节：MEDIA_HEADER（20）、MEDIA（21）、MEDIA_END（22）、加密部分（10/11/12）、其他广告事件、seek/时间线、SABR 上下文及未知 UMP 部分。不根据 `ctier=L` 推测并删除媒体，也不伪造播放器时间、跳过指令或正片内容。如果清理后 CuepointList 为空，保留其长度为零的 Part 69 封装，而非返回空 HTTP 响应。

完整输入及目标元数据先通过检查才输出改动。结构截断、未知 wire type、重复的单数 Cuepoint 消息或资源超限时，整条原响应通过；不输出已经完成的部分改动。UMP 限制为 8 MiB、10,000 个部分、128 种部分类型及 30,000 个解析的 Protobuf 字段。

### 当前运行方式

2026-10-04 起，主插件不再收齐或处理 videoplayback 正文，也不提供 UMP 模式选择。日志工具记录媒体请求与响应头，返回空修改结果，让 Loon 继续转发媒体；离线 UMP 解析与测试保留在播放器文件中，不接入实时媒体规则。这避免日志开关增加整包等待，但网络、播放器回退或其他 API 处理仍可能产生等待。

本轮日志中大媒体响应约在播放协商后四秒记录完成，未发现 Part 69 广告预取提示，现有 Part 69 清理无法命中该样本。get_watch 的 removed=1、tracking_removed=1 仅表示删除了跟踪项，不代表删除了广告位。用户确认退出视频后首页不再弹出广告；片头广告仍可能出现，本次减少媒体等待的效果尚需设备观察。


2026 年 7 月之后仍在维护的公开实现还覆盖 `youtubei/v1/log_event`、`youtubei/v1/config` 和 `googlevideo/initplayback`。其中 `initplayback` 属于新版加密 UMP/Onesie 播放链路；部分公开实现会把目标播放 URL 和客户端密钥转交外部 Worker 处理。本插件依据公开的 [Onesie 请求 schema 与示例](https://github.com/LuanRT/googlevideo/blob/main/examples/onesie-request/main.ts) 自行实现本地请求处理：缓存配置、按有效期更新、核对 `encryptedClientKey`，使用 AES-128-CTR 与 HMAC-SHA256 验证和改写内层 Player 请求，失配时清除旧状态并让客户端重新协商。没有加入 Worker 地址、重定向或额外网络请求，也不会自动上传播放地址或密钥。1.2.0 起使用脚本内置的标准 AES-128-CTR，避免依赖不同 Loon 运行时对 CTR 的具体实现。

本地脚本保留请求侧 HMAC 校验、AES-CTR 解密、广告协商清理、重新加密和签名实现，供协议测试和必要时的兼容回退使用。2026-10-04 的实机样本证明，即使内层请求已经成功清理并重签，服务端仍可通过普通 UMP MEDIA_HEADER/MEDIA 分片返回另一视频标识的片头广告。直接删除这些分片会造成黑屏或等待，因此 1.6.0 默认不再进入加解密路径，而是在精确命中 YouTube App `initplayback` 时立即返回空响应，让客户端回退到已清理的普通 Player 链路；不按 `ctier=L` 猜测媒体，也不修改签名。本地协议测试已覆盖该响应，真实设备是否无缝回退仍需验证。

2026-10-03 的实机导出进一步确认，`YouTubeInitPlayback 1.1.0` 命中了十条 `initplayback` 请求，但每条都记录 `pass: unsupported-wire`，没有产生 `requestAfter`，所以该版本实际上没有改写任何一条 Onesie 请求。1.1.1 为解密后的内层 Protobuf 增加 wire type 3/4 group 的配对读取；未知 group 连同起止标记按原字节保留，只允许修改独立的 JSON 正文字段。group 不闭合、结束字段不匹配、出现协议无效 wire type 或任何后续校验失败时仍整条原样放行。本地测试能证明这一结构可被安全保留，但片头广告是否消失仍需更新后的实机结果确认。

随后一轮实机日志确认 1.1.1 已加载，但六条 `initplayback` 仍全部为 `changed=false`。当时单独导出的信息流文件不含播放请求，无法区分下一处失败阶段。1.1.2 把安全的固定处理结果写入事件摘要，并为外层、加密信封、解密正文、内层 JSON、解密和加密分别增加固定阶段前缀；可看到例如 `decrypted-unsupported-wire`、`inner-json-failed` 或 `decrypt-failed`。1.9.0 日志工具取消信息流专用文件，统一导出浏览、刷新和播放全链路，避免再次遗漏 `initplayback/player/UMP`。

2026-10-03T18:13:15Z 的完整实机日志含五条 `initplayback`，五条都通过密钥匹配和 HMAC 校验，但都停在 `decrypted-unsupported-wire`，没有产生修改后的请求。公开 schema 再次确认明文应为 `OnesieInnertubeRequest`，正文 JSON 位于字段 3。1.2.0 因此将加解密改为脚本内置的标准 AES-128-CTR，并用 Node/OpenSSL 生成的 Onesie 密文做交叉测试；这证明本地脚本能解析、清理、重新加密及签名同一协议结构。真实片头广告结果仍需更新插件后的实机播放确认。

2026-10-03T18:31:39Z 的实机日志确认 1.2.0 已加载，但三条 `initplayback` 仍为 `decrypted-unsupported-wire`，同时片头广告实际出现。标准 AES-CTR 与 Loon 原生 AES-CTR 得到相同失败阶段，进一步把范围缩小到加密明文的封装。1.3.0 增加 gzip 魔数识别、解压、清理和重新压缩路径；若仍不是可识别的 Protobuf，摘要只记录解压类型和前四字节十六进制，不写入密钥、URL 或正文，以便下一轮判断其他封装格式。

2026-10-03T18:57:05Z 的实机日志确认 1.3.0 已完成 HMAC 验证、AES-CTR 解密、gzip 解压和 `OnesieInnertubeRequest` 解析，两条请求都停在 `inner-json-failed`。这证明该 iOS 版本把字段 3 的 PlayerRequest 作为二进制 Protobuf 传输，而不是公开示例中的 JSON 字符串。1.4.0 增加二进制 PlayerRequest 的精确字段清理，同时保留 JSON 兼容路径及所有未知字段。该日志的 `/next` 响应还确认播放页伴随赞助卡动作已被 2.1.0 从字段 15 删除；截图中随片头广告出现的 Trek 卡片属于广告播放界面，片头链路修复后才会一并消失。实机结果仍需更新插件后确认。

之前空 502 拦截导致几秒黑屏，当前实现不重新采用这一方法。**广告预取提示清理不等于删除正在播放的广告。单靠 Content-Type 不能定位广告，也无法从纯广告响应生成缺失的正片。**


2026-10-04T07:38:57Z 日志确认媒体记录已无正文缓冲，仍有两次 1.6.0 空响应回退；用户报告无广告时黑屏、有广告时正常显示。两者时间相关，但不能仅凭日志确认黑屏全部由回退引起。1.7.0 因此停用生产路径的空响应回退，改为只设置外层片头广告标志，保留完整播放初始化请求。上述 1.6.0 的空响应说明仅作为历史诊断记录。

Loon 官方 [Rewrite 文档](https://nsloon.app/en/docs/Rewrite/rewrite_v2/) 支持 reject(status) 空正文、reject_dict(status) 空对象、reject_array(status) 空数组、reject_img(status) 透明图片及 reject_video(status) 空白视频。它们是响应生成方式，不是 YouTube 跳过指令；空白视频不能代替 UMP 封装和缺失的正片。当前只对明确的 player/ad_break 返回空 Protobuf，不能把媒体 URL 全部替换为这些响应。

2026-10-04T08:21:24Z 日志中的 next 响应已清理字段 14/15 的广告组件，但处理后仍保留字段 37 的 fullscreen_engagement_companion（模型 252081505）和字段 42 的 engagement_header（模型 403122092），两者均含已确认路径上的 skip_ad_on_block 命令。信息流处理版本 2.4.0 新增精确模板/模型映射，并只删除匹配结构的伴随面板消息。正常面板、错误路径、弱标记、未知及损坏结构保持原样；合成结构测试不等于实机显示已验证。该日志没有 initplayback/player/get_watch，无法据此确认本次片头请求是否经过清理。

2026-10-04T08:30:44Z 完整日志确认：initplayback 1.7.0 在 08:30:17Z 新增了关闭片头标志的字段，但用户在 08:30:24Z 标记广告、08:30:35Z 标记正片。仅外层标志不能阻止该样本的播放广告；next 2.4.0 已分别删除 4 个伴随广告组件，这些删除不代表广告视频已消失。1.8.0 默认组合外层标志清理和经过 HMAC 验证的内层广告请求清理。日志仅记录固定状态，如 authenticated_cleaned、config_absent、key_mismatch、authentication_failed、compression_failed；不保存密钥、令牌或明文。没有有效配置或验证失败时保留原密文，并继续正常播放请求，不回退到空响应，也不缓冲视频媒体。实际去广告效果尚待设备验证。

## 本地验证

2026-10-05 初始化处理 1.9.0 修正已验证内层请求缺少播放上下文时不写入无广告标志的缺口：沿 PlayerRequest 字段 4 → PlaybackContext 字段 1 → ContentPlaybackContext 字段 50 补齐已知路径，JSON 使用相同的命名字段。定义核对自 [PlayerRequest](https://github.com/LuanRT/YouTube.js/blob/main/protos/youtube/api/pfiinnertube/player_request.proto) 和 [PlaybackContext](https://github.com/LuanRT/YouTube.js/blob/main/protos/youtube/api/pfiinnertube/playback_context.proto)。字段重复、类型冲突或认证失败时保留原密文。新增日志只记录内层格式、已知路径存在状态及标志原始状态；播放器响应 2.2.0 只记录有限的根字段号和类型。自建样本测试不能证明服务端采纳这些修改，实际去广告效果仍需实机确认。

日志工具 2.5.0 移除主页接口统计和初始化提示，在下载文件中保留诊断信息。info 保存完整脱敏链路，error 只保存错误；下载日志按钮在当前页面暂停记录、校验样本并触发下载。媒体正文仍不缓冲，凭据和签名仍不保存。

日志工具 2.6.0 统一 INFO/info 等大小写，并修正旧摘要分支仍过滤未修改事件的问题。普通播放器 API 请求的可用正文现在保留修改前后脱敏结构，未知字符串、身份数据及原始字节继续排除。现有媒体响应日志规则同时覆盖 initplayback，记录其响应状态与安全传输头；正文未读取时明确写出 headers-only-not-buffered。该入口不等待媒体正文，不能据此分析初始化响应内的广告配置。ERROR/error 保留脚本错误、已识别的认证/清理失败和 HTTP 4xx/5xx；正常事件不保存。未测量的处理耗时写为 null，避免把占位 0 当成真实耗时。

`tests/YouTubeFeedAds.test.mjs`、`tests/YouTubePlayerRequest.test.mjs`、`tests/YouTubePlaybackAds.test.mjs`、`tests/YouTubeAdBreak.test.mjs`、`tests/YouTubeShortsAds.test.mjs`、`tests/YouTubeStreamAds.test.mjs`、`tests/YouTubeOnesie.test.mjs`、`tests/YouTubeLogger.test.mjs` 和 `tests/YouTubeCapture.test.mjs` 使用 Node 模拟 Loon 环境，不需要下载其他 JS。共 303 项测试，覆盖：播放器请求广告信号、VAST/强制广告参数和不请求内联广告字段；播放器响应的广告位、配置和 pagead 追踪清理；播放页独立赞助卡片与 pagead 覆盖层；精确 `player/ad_break` 匹配；后台播放；Shorts；信息流；Onesie 配置字段、有期限缓存、`log_event` 刷新、initplayback 原位片头标志清理、未知请求不强制回退、密钥匹配/失配、HMAC 验证、AES-CTR 解密与重签、gzip 内层请求解压及重新压缩、JSON 与二进制 Protobuf 播放器正文、未知 Protobuf group/字段原字节保留、YouTube Music 隔离和共享抓包/导出。另验证 UMP 预取提示清理、异常数据原样通过，以及日志分级、分块单文件导出、容量、写入失败、跨会话隔离及人工标记。

```sh
node --check loon/YouTube/YouTubeFeed.js
node --check loon/YouTube/YouTubePlayback.js
node --check loon/YouTube/YouTubeConfig.js
node --check loon/YouTube/YouTubeLogger.js
node --test loon/YouTube/tests/*.test.mjs
```

这些验证不包含真实 Loon 配置解析器、设备脚本引擎或实际视频广告。本地修改不会自动上传，发布版本以仓库远程分支中的提交为准。

## 规范参考

- Maasea 两份上游构建文件的固定副本、可读还原与逻辑索引：[`vendor/Maasea/README.md`](vendor/Maasea/README.md)

- 推荐接口字段描述（2025-02-18 逆向 schema）：https://github.com/davidzeng0/innertube/tree/main/protos/youtube/api/innertube
- Protocol Buffers wire format：https://protobuf.dev/programming-guides/encoding/
- Loon Script 语法：https://nsloon.app/en/docs/Script/
- Loon Script API：https://nsloon.app/en/docs/Script/script_api/
- Loon 插件及对象参数：https://nsloon.app/en/docs/Plugin/
- UMP framing 格式研究：https://github.com/davidzeng0/innertube/blob/main/googlevideo/ump.md
- UMP 部分类型：https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/ump_part_id.proto
- Cuepoint 广告类型与事件：https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/cuepoint.proto
- CuepointList / CuepointInfo：https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/cuepoint_list.proto 和 https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/cuepoint_info.proto

以上为格式与接口参考，插件不会调用这些项目的代码或服务。


2026-10-05 INFO 开发记录补充：初始化请求经本地 HMAC 验证、解密及解压后，记录内层播放器请求修改前后的脱敏字段树，导出为 `Request-Inner-Before` / `Request-Inner-After`。JSON 保留字段层级、布尔开关和广告标记；Protobuf 保留字段号、线型、长度、布尔值和广告标记。原始明文、密钥、签名、身份字符串均不进入日志缓存。认证失败或未进入内层解析时没有这两段记录，不能据此认为播放器请求为空。该采样复用已有请求处理，不额外读取或缓冲响应正文；初始化响应及 UMP 媒体正文仍未采集，INFO 也无法凭响应头判断内部广告配置。它补充了开发证据，不代表片头广告已移除。


## 完整响应开发采样与手动地区参数（2026-10-05）

日志工具 2.8.0 在原有一个媒体响应入口读取完整 `application/vnd.yt-ump` 响应，不新增 JS 文件、日志缓存或下载接口。启用“日志工具”会让 Loon 等待该入口的完整响应，因此可能增加播放等待；页面暂停、容量停止及下载后的自动暂停只停止写入，不能撤销 Loon 的正文等待。复现并下载日志后，关闭主插件的“日志工具”，以停用此媒体响应入口。采样始终返回空修改结果，不重新封包、不改变音视频字节。

脱敏日志可见 `Response-Before → Structure → parts`：分片类型、声明长度、实际长度、部分元数据字段树以及 Part 69 的有限 Cue 类型/事件。Part 10/11 配对的 Onesie 播放器响应验证成功时，`onesie.status=authenticated`，`onesie.player` 保存脱敏 JSON/Protobuf；无配置写 `config-absent`，认证失败写 `authentication-failed` 并记录 ERROR。未知分片、加密媒体及媒体分片不保存原文；跨响应的部分分片不拼接，明确写 `partial-part`。每个元数据片段或解压后的播放器响应最多分析 8 MiB、最多 10000 个 UMP 分片。大媒体内容只读取目录，不转成 Base64，也不占用持久化正文容量；采样不能保证所有协议变体都能解密和解析。

主插件新增“播放请求地区”选择项：`original` 保持原值；`CN` 中国大陆，另可选 HK/TW/US/JP/KR/SG/GB/DE/RU。仅修改普通 player/get_watch 和可认证解密的 initplayback 内层 `context.client.gl`（Protobuf：1 → 1 → 2），保留语言、视频及其他字段。重复或错误类型的已知字段不改写。日志中的 `region_selected` 表示选择值，`region_applied` 表示可识别客户端上下文已应用的次数；没有内层认证或客户端上下文时可能为 0。该选项不更换出口 IP，不修改设备定位或账号地区，不保证服务端按所选地区投放，也尚未验证能减少片头广告。

QUIC 规则增加精确协议匹配，覆盖根域及子域，并保留原 UDP/443 兜底：

```ini
AND,((DOMAIN-SUFFIX,googlevideo.com),(PROTOCOL,QUIC)),REJECT
AND,((DOMAIN-SUFFIX,googlevideo.com),(PROTOCOL,UDP),(DEST-PORT,443)),REJECT
```

这两条规则不会拒绝 TCP 媒体，但实际优先级仍受主配置及其他插件影响；本地验证不等同于手机已命中规则。

2026-10-05 增加 googlevideo 根域与子域响应头复写，将 `Alt-Svc` 设置为 `clear`。按照 [RFC 7838](https://www.rfc-editor.org/rfc/rfc7838.html#section-3)，这会通知支持该机制的客户端清除当前源缓存的替代服务，避免响应头持续广告 HTTP/3 后反复尝试已被规则拒绝的 QUIC。采用 Loon 的响应头复写，不调用新的 JS，不读取或等待媒体正文，日志工具关闭时也生效。当前去广告请求处理和 QUIC 拦截保持原样。

这项优化尚未进行设备验证，不能据此认定几秒黑屏已解决；首次响应到达前的连接尝试、DNS 或客户端内置的 HTTP/3 发现、广告调度及初始化请求重试仍可能产生等待。更新主插件后关闭日志工具，完全退出并重新打开 YouTube，再对比首次和后续视频的启动时间；无需清除账号或重装 App。

协议依据：[Loon 协议规则](https://nsloon.app/docs/Rule/protocol_rule/)、[UMP 分片类型](https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/ump_part_id.proto)、[Onesie 响应结构](https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/onesie_innertube_response.proto)、[响应认证示例](https://github.com/LuanRT/googlevideo/blob/main/examples/onesie-request/utils.ts)、[客户端地区字段](https://github.com/LuanRT/YouTube.js/blob/main/protos/youtube/api/pfiinnertube/client_info.proto)。
