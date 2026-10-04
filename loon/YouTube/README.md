# YouTube 信息流及视频贴片去广告（自有 JS）

只维护一个 Loon 插件入口 `YouTubeNoAds.plugin`，按功能调用同目录的去广告 JS 与日志 JS。去广告脚本均可直接在 Loon 独立运行，没有运行时模块导入、第三方实现、第三方服务、外部库、重定向或额外网络请求。

| 文件 | 功能 | 匹配位置 |
| --- | --- | --- |
| `YouTubeFeedAds.js` | 清理已识别的首页、播放页推荐及搜索赞助卡片，可手动隐藏首页 Shorts 推荐区 | `/youtubei/v1/browse`、`next`、`search` 的 JSON 及部分 Protobuf 列表 |
| `YouTubePlayerRequest.js` | 在请求广告媒体前清理播放器广告协商字段，不阻断广告或正片媒体 | `/youtubei/v1/player`、`get_watch` 的 JSON / Protobuf 请求 |
| `YouTubePlaybackAds.js` | 在播放器进入广告状态前清理广告位及 pagead 追踪，可按开关允许后台播放 | `/youtubei/v1/player`、`get_watch` 的 JSON / Protobuf 响应 |
| `YouTubeAdBreak.js` | 终止明确的片头/中插广告配置请求，不拦截视频媒体 | `/youtubei/v1/player/ad_break` 请求 |
| `YouTubeShortsAds.js` | 删除明确带有 `adClientParams.isAd=true` 的 Shorts 播放条目 | `/youtubei/v1/reel/reel_watch_sequence` 的 JSON / Protobuf 响应 |
| `YouTubeStreamAds.js` | 清理视频流中的广告预取提示（试验） | `googlevideo.com/videoplayback` 的 UMP 响应 |
| `YouTubeOnesieConfig.js` | 仅为 YouTube iOS 维护 Onesie 配置密钥及有效期，缺失或过期时请求完整配置 | `/youtubei/v1/config`、`log_event` |
| `YouTubeInitPlayback.js` | 在本机验证、解密、清理并重新签名 YouTube iOS 的 initplayback 播放器请求 | `googlevideo.com/initplayback` 请求 |
| `YouTubeLogger.js` | 本地日志控制、开发请求抓包、.log / .json 导出 | 专用页面和手动开启的请求入口 |
| `YouTubeNoAds.plugin` | 统一配置去广告、日志入口、参数与 MitM | 只需启用这一个插件 |

主插件通过 Loon 的 `#!icon` 展示 YouTube 图标，`#!desc` 展示功能范围、默认关闭的试验/日志选项及使用条件，`#!homepage` 指向本说明。图标保存为 `assets/youtube.png`，来自 [YouTube 官方页面引用的 144×144 PNG](https://www.youtube.com/s/desktop/2b888666/img/favicon_144x144.png)（2026-10-02），随本仓库发布，不依赖其他人的图标仓库。插件信息字段见 [Loon 插件文档](https://nsloon.app/docs/Plugin/)。

原合并文件 `YouTubeNoAds.js` 已移除。八份功能脚本的二进制解析和日志辅助函数各自保留，以便 Loon 直接执行，不需要再加载公共模块。新版 Onesie 配置和 `initplayback` 校验分别由 `YouTubeOnesieConfig.js`、`YouTubeInitPlayback.js` 负责；其他功能继续修改对应的独立文件。

目标包括首页/推荐列表中的赞助卡片，以及 YouTube 插入的片头及中插广告。**当前实现能清理已识别 API 响应中的广告位，并在本机清理普通 Player 与新版 Onesie 播放器请求的广告协商。它不删除已经传输的媒体字节，本次 Onesie 改动也尚未在真实 Loon 设备上验证。不能保证最新 YouTube App 的所有贴片广告都消失。**

### 从网页过滤方案迁移到 iOS API

网页端扩展通常在两层处理广告：网络过滤负责拦截广告请求，页面脚本再删除播放器响应中的广告元数据和页面里的广告组件。当前实现参考 [uBlock Origin 的 YouTube 过滤规则](https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters.txt) 所覆盖的 `playerAds`、`adPlacements`、`adSlots`、`pageadViewthroughconversion` 和 Shorts `isAd` 标记，并参考 [AdGuard Scriptlets](https://github.com/AdguardTeam/Scriptlets) 的响应属性替换思路。对已实际出现片头广告的新版 App，另采用[公开网页模块](https://gist.github.com/oiiogong/3b2f171141b54027e5db9a543b09b194)中的精确 `/youtubei/v1/player/ad_break` 广告配置拦截方案；Loon 无法在原生 YouTube App 内运行 DOM/scriptlet，因此这里把相同目标转换为对 `/youtubei/v1/*` JSON、Protobuf 响应和广告配置请求的定点处理。

Protobuf 字段和 UMP 封装另外与 [Maasea/YouTube](https://github.com/Maasea/sgmodule/tree/master/Script/Youtube) 及公开的 [Innertube 逆向 schema](https://github.com/davidzeng0/innertube) 交叉核对。仓库没有复制第三方压缩脚本、运行库或外部 Worker，也不在运行时请求这些项目；每项功能由本目录中对应的自有 JS 独立完成。浏览器方案中直接屏蔽媒体 URL 的做法没有移植到 App，以避免把广告媒体拦成黑屏或同时破坏正片。

## 实现范围

- API 请求与响应都处理 `/youtubei/v1/player` 和 `/youtubei/v1/get_watch`，请求部分另处理精确的 `/youtubei/v1/player/ad_break`。支持 `youtubei.googleapis.com`、`youtubei-att.googleapis.com` 及 `youtube.com`、`www`、`m`、`music` 子域。
- 播放器请求：Protobuf 只沿已确认的 `PlayerRequest.context（字段 1）→ ad_signals_info（字段 9）`、`playback_context（字段 4）→ content_playback_context（字段 1）` 路径处理。删除广告信号、VAST 参数字段 12 和强制广告参数字段 25，并把协议已公开的 `is_inline_playback_no_ad（字段 50）` 写为 true；`get_watch` 另沿顶层字段 2 进入 `PlayerRequest`。JSON 对应删除 `adSignalsInfo`、`adParams`、`forceAdParameters` 并设置 `isInlinePlaybackNoAd=true`。修改请求后移除旧的 `Content-Encoding`、`Content-Length`，让 Loon 发送重新生成的未压缩正文，其他请求头和未知 Protobuf 字段保持原样。
- JSON：删除播放器对象中的 `adPlacements`、`adSlots`、`playerAds`、`adBreakHeartbeatParams`、`adParams`，删除 `playerConfig.adPlacementConfig`、`playerConfig.adSignalsConfig`，以及 `playbackTracking.pageadViewthroughconversion`。保留播放地址、视频信息、字幕及其他统计地址；不会全局删除任意对象中同名字段。
- Protobuf：自行实现 wire format 读取，移除已识别 Player 消息的字段 7（`adPlacements`）、字段 68（`adSlots`），并在字段 9（`playbackTracking`）中删除字段 18（`pageadViewthroughconversion`）。`get_watch` 使用已知的字段路径 `1 → 2 → Player`。保留非广告字段的原始字节、顺序及未知内容，只在嵌套消息改变时重算外层长度。
- Ad break：`YouTubeAdBreak.js` 只对精确的 `player/ad_break` 请求直接返回 HTTP 200 与合法的空 Protobuf，阻止客户端取得新的片头/中插广告配置。它不匹配 `googlevideo.com`，不返回 502，也不截断广告或正片媒体流；可用主插件开关单独关闭。
- Onesie 配置：`YouTubeOnesieConfig.js` 只接受 User-Agent 明确为 `com.google.ios.youtube/...` 的请求，按固定 Protobuf 路径读取 `clientKey`、`encryptKey`、有效期和热配置开关。密钥只写入 Loon 本地缓存，不进入普通日志或控制台；YouTube Music、网页和未知客户端不读写该状态。没有可用配置时，`log_event` 请求会去掉热配置哈希头，使服务端返回完整配置；已有有效配置时保留该哈希。脚本会移除 Loon 解码正文后失效的 `Content-Encoding` 请求头。
- Initplayback：`YouTubeInitPlayback.js` 先核对 `OnesieRequest 字段 3 → InnertubeRequest 字段 5` 的 `encryptedClientKey`。匹配后使用只保存在 Loon 本机的 `clientKey` 验证 `HMAC-SHA256(ciphertext || iv)`，再通过脚本内置的标准 AES-128-CTR 解密。若明文带 gzip 标记，先用 Loon 本机 `$utils.ungzip` 解压 `OnesieInnertubeRequest`。内层 URL、Header 和未知 Protobuf 字段保持原样；字段 3 的播放器正文同时支持 JSON 和 iOS 使用的二进制 PlayerRequest Protobuf，删除 `adSignalsInfo`、`adParams`、`forceAdParameters`，写入 `isInlinePlaybackNoAd=true`，随后按原压缩格式重新编码、使用原 IV 加密并生成新 HMAC。加密载荷外明确出现的 `enable_ad_placements_preroll（字段 13）` 会写为 false；缺省时保留缺省值。正文改变后移除旧的 `Content-Encoding` 和 `Content-Length`，交给 Loon 重新生成传输长度。HMAC、正文、字段、压缩或加解密任一检查失败均原样放行。仅在确认客户端密钥失配时清除旧缓存并返回一次 HTTP 200 空 Protobuf，使客户端重新取得配置。压缩正文处理要求 Loon Build 988 或更高版本；该处理不阻断 `videoplayback`、不修改媒体字节，也不把 URL 或密钥发送到外部 Worker。
- Shorts：独立脚本只删除响应字段 2 的条目中符合 `command（1）→ reelWatchEndpoint（139608561）→ adClientParams（16）→ isAd（1）= true` 的完整条目。普通 Shorts、未知命令及结构不完整的条目保持原样。
- 字段编号和 `get_watch` 路径来自已有逆向协议描述的核对，属于协议映射信息；未复制原脚本或其库实现。YouTube 未公开保证这些编号适用于所有客户端。脚本使用字段 2 的 playabilityStatus 及 wire type 作有限检查，不能证明所有未来协议变化都能识别。
- 空响应、非 200、损坏数据、已检测到的结构不匹配、未知内容类型、API 上的非预期 UMP、未解压的 gzip 及超限响应原样通过。限制为 2 MiB 响应、30,000 个解析字段、20,000 个 JSON 对象节点和 64 层 JSON 深度。
- 拒绝两个 `googleapis.com` API 域名和 `*.googlevideo.com` 的 UDP/443，只用于促使 API、`initplayback` 与开发抓包中的 UMP 检查回退到可被 MitM 的 TCP。插件不拒绝 TCP 播放媒体，不修改 `ctier`、签名或音视频字节。关闭开发抓包或 Onesie 开关不会同时撤销 `*.googlevideo.com` 的 MitM 和 UDP 回退规则。
- 无字幕翻译、按钮隐藏、画中画或会员相关修改。后台播放仅在独立开关开启时修改明确的播放能力字段，不伪造会员状态。

### 后台播放开关

主插件的“后台播放”默认关闭。开启后，`YouTubePlaybackAds.js` 在已识别的播放器响应中把后台播放能力设为允许：JSON 同时写入 `playabilityStatus.playableInBackground` 和 `backgroundPlayerRender.backgroundAbility.active`；Protobuf 保留兼容字段 4，并写入 `PlayabilityStatus 字段 11 → BackgroundSupportedRenderer 扩展 64657230 → BackgroundAbility.active（字段 1）`。已有未知字段、播放地址和其他播放状态保持原样；开关关闭时不会修改服务端能力。

该开关用于普通视频切换 App 或锁屏后继续播放音频。它不修改画中画、会员身份、付费权益或媒体字节；直播、地区/年龄受限内容及 YouTube 客户端自身限制仍可能阻止后台播放。修改后需要在 Loon 更新主插件和脚本，并完全退出再打开 YouTube 才能让新响应生效。

## 安装与更新

主插件的八个功能条目分别引用本仓库的对应文件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeFeedAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubePlayerRequest.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubePlaybackAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeAdBreak.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeShortsAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeStreamAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeOnesieConfig.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeInitPlayback.js
```

**本地新建或修改文件不会自动发布到该地址。发布前直接导入当前远程版配置，可能遇到脚本下载失败或仍取得旧文件。**

可选择以下一种方式：

1. 发布本仓库的插件与 JS 后，在 Loon 更新插件，并重新下载对应脚本。需要设备能访问 `raw.githubusercontent.com`。
2. 本地试用：把八份功能 JS 导入 Loon 的本地脚本资源，确认保存名称；把主插件各条目的远程 `script-path` 改为对应的本地资源名。不是填写 Mac 上的 `/Users/...` 路径。仍只需启用一个插件入口。

更新时替换 `YouTubeNoAds.plugin`，不要保留另一份旧主插件。删除或禁用此前的 `YouTubeCtierAds.plugin` 及其他匹配 YouTube 的脚本，若曾复制过相关规则到主配置，也一并移除。

开启插件、脚本和 MitM，保持 Loon CA 证书完全信任；确认各功能条目分别加载对应的自有 JS 后，完全退出 YouTube 再打开。若主配置的本地规则先放行了相关域名的 UDP/443，可把主插件的三条 `[Rule]` 规则移到主配置对应放行规则之前。

## 查看结果

默认关闭控制台日志和日志工具，需要时在主插件手动开启“控制台日志”。日志前缀含脚本版本：

```text
[YouTubePlaybackAds 2.1.0] player changed: removed=3 tracking_removed=1 background_modified=1 format=protobuf
[YouTubePlayerRequest 1.0.0] player changed: context_ad_signals=1 playback_ad_params=1 inline_no_ad=1
[YouTubeAdBreak 1.0.0] ad_break blocked: empty-protobuf status=200
[YouTubeOnesieConfig 1.0.0] config updated: lifetime_seconds=600 hot_config=true
[YouTubeInitPlayback 1.3.0] initplayback changed: authenticated=true encoding=gzip context_ad_signals=1 playback_ad_params=1 inline_no_ad=1
[YouTubeShortsAds 1.0.0] reel_watch_sequence changed: removed=1 format=protobuf
[YouTubePlaybackAds 2.1.0] get_watch pass: removed=0 tracking_removed=0 background_modified=0 format=protobuf
```

- `changed` 表示删除了已识别广告字段或修改了后台播放能力，不能单独证明某次视频不会出现广告。`removed` 是字段或条目出现次数，不一定等于屏幕广告数；`tracking_removed` 是删除的 pagead 追踪字段数；`background_modified` 是本次实际改写的播放状态数量。
- `pass: removed=0` 表示没有可清理的已识别广告字段，也可能没有识别到已知 Player 结构。
- `pass: ...` 错误或格式原因表示整个响应未修改。
- 没有日志时，先确认新 JS 已下载及控制台日志已开启，再查看是否出现匹配路径的请求。不要求每次播放必然访问 `youtubei.googleapis.com`。
- 控制台及未开启开发抓包时的普通记录只含接口名、格式、计数及固定错误原因；手动开启开发抓包后，唯一导出的 `.log` 包含完整 URL、请求头、文本正文和 Base64 二进制。Loon 自带的 debug 请求记录也可能包含敏感内容，分享前请检查。

## 信息流赞助卡片清理

首页推荐列表里标注“赞助商广告”的 Robinhood 卡片属于信息流广告。它由推荐接口提供卡片数据，即使卡片自动播放视频，也应从推荐列表中移除卡片。`application/vnd.yt-ump` 是媒体封装，单独处理媒体下载不能移除该列表项。

`YouTubeFeedAds.js` 自行实现清理逻辑，不加载其他人的 JS。主插件默认启用信息流响应入口，匹配 `browse`、`next` 和 `search`。JSON 只在列表字段中删除具有明确广告 renderer 的整项，包括 `adSlotRenderer`、`inFeedAdLayoutRenderer`、`promotedVideoRenderer` 等，以及包在 `richItemRenderer.content` 中的广告卡片。正常视频、频道、购物内容、包含“广告”文字的普通标题和翻页 token 保留；Shorts 默认保留，可用下面的独立开关隐藏首页推荐区。广告与正常 renderer 同时出现在同一对象中时，整条响应保留，避免误删。

“自适应信息流广告”默认开启，用于 YouTube 新增了尚未登记的 EML 布局时补充固定映射。它不会扫描整条响应：只有进入已经确认的信息流卡片正文后，且该卡片达到最小结构长度并出现网页过滤规则也使用的精确 `pagead` 标记，才移除该卡片并记录 `adaptive_removed`。如发现误删，可单独关闭此开关，七种严格 EML 映射和 JSON renderer 清理仍继续工作。

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

1. 在 Loon 更新 `YouTube去广告` 主插件，并重新下载其引用的 `YouTubeFeedAds.js`，确保使用 1.2.0 或更高版本。
2. 进入主插件设置，打开“隐藏首页 Shorts”。保持插件、脚本与 MitM 启用、证书完全信任；此功能不需要开启日志或开发抓包。
3. 完全退出 YouTube 后重新打开，进入首页并下拉刷新。已缓存的旧首页需要刷新才能取得修改后的推荐列表。
4. 如需恢复，关闭该开关，再退出 YouTube、重新打开并刷新首页。

首页识别只用于 `browse`：首次加载按 Tab 的 `FEwhat_to_watch` 标识确认；继续下滑的列表按已知 continuation 结构确认。Protobuf 首页 Tab 使用字段 11；continuation token 解码后读取样本中的 `80226972 → 2` browse ID。Next/Reload continuation 的字段编号与 token 字段参考 [SectionListSupportedContinuations](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/section_list_supported_continuations.proto) 和 [NextContinuationData](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/next_continuation_data.proto)。请求正文可用时，也读取明确的 browse ID 或 continuation；请求字段参考 [BrowseRequest](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/browse_request.proto)。无法确认首页的响应保留 Shorts，不把全部 `browse` 当作首页。

已提供的 iOS 21.39.4 样本中，区块为 `ShelfRenderer（51845067）→ content（5）→ HorizontalListRenderer（51431404）→ items（1）`。仅当所有条目都具有明确的 `shorts_video_cell.eml-fe|` 布局（16 位十六进制版本后缀）和唯一 Model 519005951 时，删除整个 Shelf 列表项。不会按标题或任意字节中的 Shorts 文本删除。HorizontalList 路径参考 [HorizontalListRenderer](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/horizontal_list_renderer.proto)；布局与 Model 对应关系来自本地实际响应。

JSON 支持 `reelShelfRenderer`、带 Shorts 图标的 `richShelfRenderer` 及其 `richSectionRenderer` 包装、只含 Shorts 的 ItemSection 和水平 Shelf；要求内部条目均为明确的 `reelItemRenderer` 或 `shortsLockupViewModel`。保留混合普通视频的列表、未知布局和共享模板库。JSON renderer 字段核对参考 [ReelShelf](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/ReelShelf.ts) 和 [RichShelf](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/RichShelf.ts)，未调用或复制这些解析器的实现。

日志新增 `hidden_shorts`，表示移除的 Shorts 区块数量，与广告计数 `removed` 分开。例如 `removed=0 ... hidden_shorts=1` 表示只隐藏一个 Shorts 区块。开发抓包的响应处理参数也记录 `hide_home_shorts`。

已对此前完整导出的 6 份响应分别在开关关闭/开启状态离线回放：关闭时与此前去广告结果逐字节一致；开启时额外移除其中 2 份响应各自的 1 个 Shorts 区块，其他响应保持此前结果。12 次结果均与独立按指定列表项删除、重算长度的预期逐字节一致。尚需手机更新后确认显示效果；未知的新布局仍会保留。

### Shorts 播放广告清理

“清理 Shorts 广告”默认开启，由 `YouTubeShortsAds.js` 单独处理 `reel/reel_watch_sequence`。JSON 只删除明确满足 `command.reelWatchEndpoint.adClientParams.isAd === true` 的 `entries` 项；Protobuf 只沿已核对的字段链定位相同布尔标记并删除外层条目。它不会按标题、频道、时长或任意广告文本判断，也不影响首页“隐藏首页 Shorts”开关、底部 Shorts 入口或普通 Shorts。

该脚本与首页 Shorts 功能分开，是因为一个处理 Shorts 播放序列里的广告条目，另一个处理首页推荐区块。关闭“清理 Shorts 广告”只停用前者；普通 Shorts 和结构未知的命令始终保留。

### 取得首页广告的样本

1. 发布后更新主插件和 JS；完全退出 YouTube，再打开。先观察首页赞助卡片是否消失。
2. 仍有卡片时，在主插件打开“日志工具”和“开发抓包”。开发抓包现在也会记录 UMP 响应；只浏览首页、不打开视频，可以减少无关媒体样本和播放等待。
3. Safari 打开 `http://youtube-logs.invalid/`，先保留需要的旧记录，然后清空并开始记录。回到 YouTube 首页，下拉刷新一次，让赞助卡片出现；不必点开视频。
4. 回到日志页面暂停，选择“导出完整日志文件 .log”。该文件同时包含 `browse/next/search` 信息流、刷新配置和播放链路，不再单独生成信息流文件。
5. 在 `.log` 中确认存在 `Endpoint: browse`（或 `next/search`）、`Phase: response`，并且 `Response-Before` 正文显示 `Available: true`。如果这些记录仍缺失，应先检查脚本更新、MitM 和实际请求路径。未知 EML 卡片需要该响应样本才能继续适配。

本次实际响应的离线回放日志（不是手机界面实测）：

```text
[YouTubeFeedAds 1.1.0] browse changed: removed=1 format=protobuf opaque_elements=12 removed_eml=1 removed_dividers=1
[YouTubeFeedAds 1.1.0] browse pass: removed=0 format=protobuf opaque_elements=0 removed_eml=0 removed_dividers=0
```

`removed_eml` 是确认移除的 EML 广告内容数，`removed_dividers` 是移除的关联分隔项数。`opaque_elements` 统计已知路径上保留的 ElementRenderer（含普通视频和分隔项），不代表广告数量，也不代表统计了所有 EML 卡片。

## 主插件日志工具与开发记录

只启用 `YouTubeNoAds.plugin`，不再使用独立的 `YouTubeLogger.plugin`。八份功能脚本共用一个记录索引，日志和原始样本统一导出；样本按块存储以避免把全部二进制反复写入索引，按来源分类的多套日志缓存不会重新引入。

主插件参数：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| 关闭播放器广告协商 | 开启 | 在 `player/get_watch` 请求中移除广告信号与 VAST 参数，并设置协议已有的不请求内联广告字段 |
| 拦截片头/中插广告配置 | 开启 | 对精确的 `player/ad_break` 请求返回空 Protobuf；不拦截视频媒体 |
| 后台播放 | 关闭 | 开启后在已识别的播放器响应中允许普通视频后台继续播放；关闭时保留服务端原值 |
| 新版播放链路去广告 | 开启 | 本机验证、解密、按需解压、清理并重签 initplayback；压缩正文处理要求 Loon Build 988+ |
| 隐藏首页 Shorts | 关闭 | 只隐藏首页推荐流的 Shorts 区块 |
| 清理 Shorts 广告 | 开启 | 删除 Shorts 播放序列中明确标记 `isAd=true` 的条目 |
| 自适应信息流广告 | 开启 | 在已确认卡片内用精确 `pagead` 标记补充 EML 固定映射 |
| 日志工具 | 关闭 | 手动开启后可开始记录、标记和下载；关闭后停止新增记录 |
| 日志保存级别 | info | 只控制普通摘要的最低严重程度 |
| 控制台日志 | 关闭 | 单独控制 Loon 脚本控制台输出 |
| 开发抓包 | 关闭 | 手动开启后保存匹配接口的原始请求和响应数据，并同时启用 UMP 响应读取；不受摘要级别过滤 |
| 开发抓包容量 MB | 32 | 可选 16 / 32 / 64 MiB，限制原始样本序列化总容量 |
| UMP 模式 | inspect | 开发抓包开启时，`inspect` 只读取和记录；`clean_prefetch` 还会清理明确的广告预取提示 |

普通摘要级别从低到高为 `debug → info → warn → error`：`debug` 保存全部处理摘要和 UMP 计数；`info` 保存实际清理结果、警告和错误；`warn` 保存状态/结构/大小异常和错误；`error` 保存未预期解析或运行错误。级别只影响新摘要，不删除历史记录。开发抓包保存每次匹配脚本收到的数据及其处理结果，避免过滤掉未修改样本；没有另外重复写入该响应的普通摘要。

### 能保留哪些开发数据

- 请求阶段：完整 URL、方法、请求头、HTTP/2 trailers、请求正文。信息流和媒体抓包入口只读取并返回原请求；`player/get_watch` 由 `YouTubePlayerRequest.js` 在同一条开发事件中另存 `requestAfter`，用于比较广告协商清理前后的正文与头覆盖。
- 响应阶段：运行时可见的请求信息、原始响应状态/头/trailers/正文、修改后的正文或“沿用原正文”的引用。处理后的传输头由 Loon 重算，不能把原响应头当成最终网络头。
- 时间、来源、版本、Loon 运行时版本（若提供）、处理摘要、删除计数、UMP 部分计数、异常名称/消息/堆栈（若发生）、耗时和运行参数。
- 二进制正文以 Base64 保存，可还原为 Protobuf、Brotli 或 UMP 样本；文本保留运行时字符串。空正文与未提供正文分开记录，未提供的数据标明 `available:false`，不会伪造一个空样本。
- 原始样本带长度与 FNV-1a UTF-16 校验值，导出时检查块、长度和校验。校验是存储一致性检查，不是密码学完整性保证。丢失/损坏样本单独标记，不丢弃其他可读记录。
- 页面可添加“正在播放广告”或“正在播放正片”的人工标记，用时间比较两个状态。标记是用户观察，不代表脚本已识别广告。

**完整 `.log` 会包含播放签名、请求头和正文，可能含 Cookie、Authorization 或账号相关数据。数据只在本机保存，插件没有自动上传；分享前应检查敏感内容。**未开启“开发抓包”时，同一出口只能导出已保存的摘要和标记，无法补回之前未保存的正文。

### 开发抓包操作

1. 更新主插件和九份 JS。开发记录要求 `YouTubeFeedAds.js` 为 2.1.0、`YouTubePlayerRequest.js` 为 1.0.0、`YouTubePlaybackAds.js` 为 2.1.0、`YouTubeAdBreak.js` 为 1.0.0、`YouTubeShortsAds.js` 为 1.0.0、`YouTubeStreamAds.js` 为 1.5.0、`YouTubeOnesieConfig.js` 为 1.0.0、`YouTubeInitPlayback.js` 为 1.4.0、`YouTubeLogger.js` 为 1.9.0。文件需要发布后才能从远程地址下载；本地导入时所有条目都填写对应的本地资源名。
2. 主插件开启“日志工具”和“开发抓包”，选择容量，并把“UMP 模式”保持为 `inspect`。开发抓包会自动启用 UMP 响应读取，不再需要第二个开关。普通摘要级别不会过滤开发样本。
3. Safari 输入 **`http://youtube-logs.invalid/`**，或手动运行主插件的“ YouTube 日志入口 ”后点通知。地址由 Loon 在本地直接响应，不需要额外 MitM。先导出需要保留的旧记录；需要干净样本时清空，再点“开始记录”。
4. 重现一次广告和一次正常播放。在相近时间添加广告/正片标记，减少其他播放、预览或自动播放，以便比较样本。切换 App 添加标记会有时间误差，不把它当作精确的广告边界。
5. 回到页面暂停记录，只点击 **“导出完整日志文件 .log（浏览、刷新、播放全链路）”**。等待显示文件已生成，再点击“保存日志文件”，通过 Safari 保存到“文件”。这是唯一的用户日志出口。
6. 查看文件头的 `Stopped-Reason`，每个 `EVENT` 的 `Capture-Error`、各正文的 `Available/Reason`，以及末尾 `All-Referenced-Samples-Readable`。未修改响应的正文会用 `Reference` 指向原响应；修改响应会同时保存修改前后正文。
7. 复现后关闭“开发抓包”。全部停止新增时关闭“日志工具”；已有样本保留。页面清空会删除本项目索引、已索引原始样本和旧日志缓存，保留其他脚本数据。

旧摘要没有保存过正文，不能恢复成原始二进制，需要用新模式重新录制。两次抓包都需先检查完整性，不把一次 `200 OK` 当成所有数据都已捕获。

### 单文件分块导出

此前直接把整个开发数据放进一个脚本响应，大文件可能在设备上无法完整生成或保存。当前页面会先读取一个小索引，再逐块读取本机样本，在浏览器中检查长度、校验值和元数据，最终合成 **一个完整 `.log` 文件**。导出前必须暂停记录，并保持 Loon 开启；会话变化、样本块缺失或校验失败时不提供保存按钮，保留原有缓存供重试。

唯一导出包含所有已匹配来源：`browse/next/search` 浏览与刷新、`log_event/config` 配置协商、`player/get_watch/initplayback/ad_break` 播放链路、Shorts 与 UMP 媒体事件。旧 `/download.log` 地址只跳转到这个完整导出；`/download.json`、`/download-feed.json` 和信息流专用出口已移除。页面内部使用的小型清单和分块接口只负责本机传输，不会作为日志文件提供给用户。

浏览器分块合成没有读取 Loon 未捕获的数据，也不能修复已经下载的不完整文件。Safari 内存、后台切换和保存行为仍需要实机验证。完整开发记录可能较大，排查首页广告优先使用信息流导出；导出失败时不要清空缓存。

### 保留策略和实际边界

- 不再自动覆盖旧记录。统一索引最多 600 条、128 KiB UTF-8 序列化内容；原始样本另按选定容量保存，Base64 和 JSON 开销计入容量。达到任一上限即停止新增并显示停止状态，先导出，再清空重录。
- 单个运行时正文最多 8 MiB；单事件最多 32 MiB 字符内容、256 个存储块。超限停止抓包并给出原因，不保存一份看似完整的截断正文。请求和响应各算一个事件。
- 存储失败、序列化失败或正文超限时不改变去广告输出。存储本身不能写入时，停止标记也可能无法落盘，只能在控制台看到固定错误提示。
- Loon 公开存储 API 在这里没有原子追加；并发脚本可能丢失索引条目。脚本被系统终止时也可能留下未索引块，无法通过当前公开接口枚举并恢复。因此这是**尽可能保留运行时可见数据的开发记录**，不能保证整个网络会话无遗漏。
- 只匹配已配置的 `player/get_watch/player/ad_break/browse/next/search/reel_watch_sequence/log_event/config` 与 `googlevideo/videoplayback/initplayback`。没有命中 MitM、TLS 失败、脚本超时及其他接口不在本记录范围。响应脚本可见的请求正文可能缺失，独立请求阶段用于补充，但并发重复 URL 的精确配对无法保证；`correlation.urlMethodHash` 仅作分组提示。
- Loon 提供的正文可能已经解压，并非原始 TLS/HTTP 线上字节。完整记录的是运行时交给脚本的字节及字符串，需结合保存的头和 `available` 标记解释。
- 完整读取响应、Base64 编码及写本地样本可能增加播放等待。建议只录制一次问题，随后关闭；不能保证抓包过程不影响播放时序。
- 手机上的脚本引擎、存储容量、页面入口和 Safari 大文件下载仍需实机验证。

升级时先打开日志页面：统一索引尚不存在时会合并当前会话旧缓存。只有新索引成功写入后才删除旧缓存；合并超限时保留旧数据并暂停，仍可导出旧摘要。统一索引已存在时不再重复导入旧缓存。

实现基于 Loon 的请求/响应正文、本地存储和生成响应接口：[Script API](https://nsloon.app/docs/Script/script_api/)。公开 API 没有直接写入 iOS “文件”App 的接口，导出通过浏览器下载保存。

## UMP 广告预取提示清理试验

UMP 是多部分播放封装，包含特殊前缀整数、音视频和控制消息。不是普通 Protobuf varint 连续流。`YouTubeStreamAds.js` 自写 UMP framing 读取与重组，不加载第三方运行代码。

当前能处理的是 Part 69 的 CuepointList：沿 `CuepointList.ssap_infos（字段 1）→ CuepointInfo.cuepoint（字段 1）`，只删除 `Cuepoint.type=1` 且 `event=6（PREFETCH）` 的条目。协议研究把 type 1 解释为广告，并记载 PREFETCH 会触发 `/player/ad_break` 广告配置预取。**这给出了可验证的预取提示清理目标，但不能证明删除提示就能避免实际广告插入。**

以下内容保持原始字节：MEDIA_HEADER（20）、MEDIA（21）、MEDIA_END（22）、加密部分（10/11/12）、其他广告事件、seek/时间线、SABR 上下文及未知 UMP 部分。不根据 `ctier=L` 推测并删除媒体，也不伪造播放器时间、跳过指令或正片内容。如果清理后 CuepointList 为空，保留其长度为零的 Part 69 封装，而非返回空 HTTP 响应。

完整输入及目标元数据先通过检查才输出改动。结构截断、未知 wire type、重复的单数 Cuepoint 消息或资源超限时，整条原响应通过；不输出已经完成的部分改动。UMP 限制为 8 MiB、10,000 个部分、128 种部分类型及 30,000 个解析的 Protobuf 字段。

### 在设备上验证

1. 确认主插件和 JS 都更新为此版本。打开“控制台日志”和“开发抓包”，将“UMP 模式”保持为 `inspect`。开发抓包会自动启用 UMP 响应脚本，该模式只检查和记录，不修改响应。
2. 主插件已包含 `*.googlevideo.com` MitM。若播放请求走 UDP/QUIC，可能无法命中脚本；只有观察到该现象时，才考虑在主配置中增加仅针对 `googlevideo.com` UDP/443 的回退规则。不要拒绝 TCP 播放连接。
3. 完全退出 YouTube，重开并播放可能出现广告的视频。找 `YouTube 开发抓包 UMP 响应处理` 日志，前缀为 `[YouTubeStreamAds 1.5.0] ump`。
4. 先看是否记录到 `parts=...69:...` 和 `ad_prefetch` 大于零。如果没有，当前清理策略没有命中该广告，打开清理模式也不会移除其媒体。
5. 只有命中明确预取提示时，再把模式改为 `clean_prefetch`，退出重开后测试。`removed_prefetch` 大于零只代表删除了提示，必须另外观察广告、正片和拖动进度是否正常。关闭“开发抓包”即可停止 UMP 响应脚本；完整撤销媒体 MitM 还需从主插件 MitM 列表移除 `*.googlevideo.com`。

示例日志是说明用的合成结果，不是用户设备上的实测：

```text
[YouTubeStreamAds 1.5.0] ump pass: mode=inspect removed_prefetch=0 ad_cues=1 ad_prefetch=1 other_ad_cues=0 bytes=130 parts=20:1,21:1,22:1,69:1
```

这里的 `20:1` 表示类型 20 出现 1 次；`ad_prefetch` 是符合两个条件的元数据条目数。控制台和普通摘要不输出媒体内容、视频 ID、签名、token 或上下文原文；开启开发抓包后，完整 `.log` 会保留运行时可见的原始数据。

### 片头广告完整样本结论

2026-10-02 导出的完整记录包含一份 39,447 字节的 `player` Protobuf 响应。旧响应脚本报告 `removed=0`，只改了后台播放字段；该响应的播放清单、追踪地址和视频信息均指向正片，没有旧版字段 7/68 广告位，也没有命中独立的 `/player/ad_break`。广告出现后捕获到两条 `POST /videoplayback` 请求同时带 `c=IOS`、`sabr=1`、`ctier=L`，之后同一时间段的正片请求不再带 `ctier=L`。这解释了直接阻断 `ctier=L` 时先黑屏等待、数秒后才进入正片的现象。

同一份原始 `player` 请求中确认存在 `PlayerRequest.context.ad_signals_info（1 → 9）`，以及 `playback_context.content_playback_context（4 → 1）` 内包含 `output=xml_vast2` 的字段 12。新加入的 `YouTubePlayerRequest.js` 在服务端返回播放方案之前清理这些精确广告协商字段，并设置已公开 schema 中的 `is_inline_playback_no_ad（字段 50）`。这是根据真实请求和公开协议进行的定点处理，不阻断 `googlevideo` 媒体；是否覆盖账号、地区和未来客户端产生的全部片头/中插广告仍需实机结果确认。

2026 年 7 月之后仍在维护的公开实现还覆盖 `youtubei/v1/log_event`、`youtubei/v1/config` 和 `googlevideo/initplayback`。其中 `initplayback` 属于新版加密 UMP/Onesie 播放链路；部分公开实现会把目标播放 URL 和客户端密钥转交外部 Worker 处理。本插件依据公开的 [Onesie 请求 schema 与示例](https://github.com/LuanRT/googlevideo/blob/main/examples/onesie-request/main.ts) 自行实现本地请求处理：缓存配置、按有效期更新、核对 `encryptedClientKey`，使用 AES-128-CTR 与 HMAC-SHA256 验证和改写内层 Player 请求，失配时清除旧状态并让客户端重新协商。没有加入 Worker 地址、重定向或额外网络请求，也不会自动上传播放地址或密钥。1.2.0 起使用脚本内置的标准 AES-128-CTR，避免依赖不同 Loon 运行时对 CTR 的具体实现。

本地脚本现在具备请求侧 HMAC 校验、AES-CTR 解密、广告协商清理、重新加密和签名逻辑；它仍不解密或重建返回的 UMP 媒体流，也不删除广告媒体片段。因此，`changed: authenticated=true` 只证明内层 Player 请求已在发送前完成改写，实际广告是否消失仍取决于服务端是否接受这些请求标志。失配回退不是按 `ctier=L` 阻断媒体，但仍可能让客户端多做一次协商；若出现等待，可关闭“新版播放链路去广告”。

2026-10-03 的实机导出进一步确认，`YouTubeInitPlayback 1.1.0` 命中了十条 `initplayback` 请求，但每条都记录 `pass: unsupported-wire`，没有产生 `requestAfter`，所以该版本实际上没有改写任何一条 Onesie 请求。1.1.1 为解密后的内层 Protobuf 增加 wire type 3/4 group 的配对读取；未知 group 连同起止标记按原字节保留，只允许修改独立的 JSON 正文字段。group 不闭合、结束字段不匹配、出现协议无效 wire type 或任何后续校验失败时仍整条原样放行。本地测试能证明这一结构可被安全保留，但片头广告是否消失仍需更新后的实机结果确认。

随后一轮实机日志确认 1.1.1 已加载，但六条 `initplayback` 仍全部为 `changed=false`。当时单独导出的信息流文件不含播放请求，无法区分下一处失败阶段。1.1.2 把安全的固定处理结果写入事件摘要，并为外层、加密信封、解密正文、内层 JSON、解密和加密分别增加固定阶段前缀；可看到例如 `decrypted-unsupported-wire`、`inner-json-failed` 或 `decrypt-failed`。1.9.0 日志工具取消信息流专用文件，统一导出浏览、刷新和播放全链路，避免再次遗漏 `initplayback/player/UMP`。

2026-10-03T18:13:15Z 的完整实机日志含五条 `initplayback`，五条都通过密钥匹配和 HMAC 校验，但都停在 `decrypted-unsupported-wire`，没有产生修改后的请求。公开 schema 再次确认明文应为 `OnesieInnertubeRequest`，正文 JSON 位于字段 3。1.2.0 因此将加解密改为脚本内置的标准 AES-128-CTR，并用 Node/OpenSSL 生成的 Onesie 密文做交叉测试；这证明本地脚本能解析、清理、重新加密及签名同一协议结构。真实片头广告结果仍需更新插件后的实机播放确认。

2026-10-03T18:31:39Z 的实机日志确认 1.2.0 已加载，但三条 `initplayback` 仍为 `decrypted-unsupported-wire`，同时片头广告实际出现。标准 AES-CTR 与 Loon 原生 AES-CTR 得到相同失败阶段，进一步把范围缩小到加密明文的封装。1.3.0 增加 gzip 魔数识别、解压、清理和重新压缩路径；若仍不是可识别的 Protobuf，摘要只记录解压类型和前四字节十六进制，不写入密钥、URL 或正文，以便下一轮判断其他封装格式。

2026-10-03T18:57:05Z 的实机日志确认 1.3.0 已完成 HMAC 验证、AES-CTR 解密、gzip 解压和 `OnesieInnertubeRequest` 解析，两条请求都停在 `inner-json-failed`。这证明该 iOS 版本把字段 3 的 PlayerRequest 作为二进制 Protobuf 传输，而不是公开示例中的 JSON 字符串。1.4.0 增加二进制 PlayerRequest 的精确字段清理，同时保留 JSON 兼容路径及所有未知字段。该日志的 `/next` 响应还确认播放页伴随赞助卡动作已被 2.1.0 从字段 15 删除；截图中随片头广告出现的 Trek 卡片属于广告播放界面，片头链路修复后才会一并消失。实机结果仍需更新插件后确认。

之前空 502 拦截导致几秒黑屏，当前实现不重新采用这一方法。**广告预取提示清理不等于删除正在播放的广告。单靠 Content-Type 不能定位广告，也无法从纯广告响应生成缺失的正片。**

Loon 响应脚本需要读取完整响应体。即使 `inspect` 不修改数据，等待整个播放响应完成也可能增加延迟或影响播放；这里尚未验证真实设备行为。如果出现新的等待或黑屏，关闭“开发抓包”即可同时停止 UMP 响应处理。不能仅凭“不删除媒体”保证没有黑屏。

## 本地验证

`tests/YouTubeFeedAds.test.mjs`、`tests/YouTubePlayerRequest.test.mjs`、`tests/YouTubePlaybackAds.test.mjs`、`tests/YouTubeAdBreak.test.mjs`、`tests/YouTubeShortsAds.test.mjs`、`tests/YouTubeStreamAds.test.mjs`、`tests/YouTubeOnesie.test.mjs`、`tests/YouTubeLogger.test.mjs` 和 `tests/YouTubeCapture.test.mjs` 使用 Node 模拟 Loon 环境，不需要下载其他 JS。共 240 项测试，覆盖：播放器请求广告信号、VAST/强制广告参数和不请求内联广告字段；播放器响应的广告位、配置和 pagead 追踪清理；播放页独立赞助卡片；精确 `player/ad_break` 匹配；后台播放；Shorts；信息流；Onesie 配置字段、有期限缓存、`log_event` 刷新、initplayback 密钥匹配/失配、HMAC 验证、AES-CTR 解密与重签、gzip 内层请求解压及重新压缩、JSON 与二进制 Protobuf 播放器正文、未知 Protobuf group/字段原字节保留、YouTube Music 隔离和共享抓包/导出。另验证 UMP 预取提示清理、异常数据原样通过，以及日志分级、分块单文件导出、容量、写入失败、跨会话隔离及人工标记。

```sh
node --check loon/YouTube/YouTubeFeedAds.js
node --check loon/YouTube/YouTubePlayerRequest.js
node --check loon/YouTube/YouTubePlaybackAds.js
node --check loon/YouTube/YouTubeAdBreak.js
node --check loon/YouTube/YouTubeShortsAds.js
node --check loon/YouTube/YouTubeStreamAds.js
node --check loon/YouTube/YouTubeOnesieConfig.js
node --check loon/YouTube/YouTubeInitPlayback.js
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
