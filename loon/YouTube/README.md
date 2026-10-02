# YouTube 信息流及视频贴片去广告（自有 JS）

只维护一个 Loon 插件入口 `YouTubeNoAds.plugin`，按功能调用同目录的去广告 JS 与日志 JS。去广告脚本均可直接在 Loon 独立运行，没有运行时模块导入、第三方实现、第三方服务、外部库、重定向或额外网络请求。

| 文件 | 功能 | 匹配位置 |
| --- | --- | --- |
| `YouTubeFeedAds.js` | 清理已识别的首页、推荐及搜索赞助卡片，可手动隐藏首页 Shorts 推荐区 | `/youtubei/v1/browse`、`next`、`search` 的 JSON 及部分 Protobuf 列表 |
| `YouTubePlaybackAds.js` | 清理播放接口返回的广告位 | `/youtubei/v1/player`、`get_watch` 的 JSON / Protobuf 响应 |
| `YouTubeStreamAds.js` | 清理视频流中的广告预取提示（试验） | `googlevideo.com/videoplayback` 的 UMP 响应 |
| `YouTubeLogger.js` | 本地日志控制、开发请求抓包、.log / .json 导出 | 专用页面和手动开启的请求入口 |
| `YouTubeNoAds.plugin` | 统一配置去广告、日志入口、参数与 MitM | 只需启用这一个插件 |

主插件通过 Loon 的 `#!icon` 展示 YouTube 图标，`#!desc` 展示功能范围、默认关闭的试验/日志选项及使用条件，`#!homepage` 指向本说明。图标保存为 `assets/youtube.png`，来自 [YouTube 官方页面引用的 144×144 PNG](https://www.youtube.com/s/desktop/2b888666/img/favicon_144x144.png)（2026-10-02），随本仓库发布，不依赖其他人的图标仓库。插件信息字段见 [Loon 插件文档](https://nsloon.app/docs/Plugin/)。

原合并文件 `YouTubeNoAds.js` 已移除。三份去广告脚本的二进制解析和日志辅助函数各自保留，以便 Loon 直接执行，不需要再加载公共模块。后续信息流卡片功能改 `YouTubeFeedAds.js`，播放接口功能改 `YouTubePlaybackAds.js`，UMP 媒体流功能改 `YouTubeStreamAds.js`。

目标包括首页/推荐列表中的赞助卡片，以及 YouTube 插入的片头及中插广告。**当前实现能清理已识别 API 响应中的广告位，并提供 UMP 广告预取提示清理试验。它尚不能移除已经传输或播放的广告媒体，也未在真实 Loon 设备上验证。不能保证最新 YouTube App 的所有贴片广告都消失或没有黑屏。**

## 实现范围

- API 部分仅处理 `/youtubei/v1/player` 和 `/youtubei/v1/get_watch` 的成功响应，支持 `youtubei.googleapis.com`、`youtubei-att.googleapis.com` 及 `youtube.com`、`www`、`m`、`music` 子域上的这两个路径。
- JSON：删除播放器对象中的 `adPlacements`、`adSlots`、`playerAds`。保留播放地址、视频信息、字幕及其他配置；不会全局删除任意对象中同名字段。
- Protobuf：自行实现 wire format 读取，仅移除已识别 Player 消息的长度型字段 7（`adPlacements`）与 68（`adSlots`）。`get_watch` 使用已知的字段路径 `1 → 2 → Player`。保留非广告字段的原始字节、顺序及未知内容，只在嵌套消息改变时重算外层长度。
- 字段编号和 `get_watch` 路径来自已有逆向协议描述的核对，属于协议映射信息；未复制原脚本或其库实现。YouTube 未公开保证这些编号适用于所有客户端。脚本使用字段 2 的 playabilityStatus 及 wire type 作有限检查，不能证明所有未来协议变化都能识别。
- 空响应、非 200、损坏数据、已检测到的结构不匹配、未知内容类型、API 上的非预期 UMP、未解压的 gzip 及超限响应原样通过。限制为 2 MiB 响应、30,000 个解析字段、20,000 个 JSON 对象节点和 64 层 JSON 深度。
- 只拒绝两个 `googleapis.com` API 域名的 UDP/443，促使 API 的 QUIC 回退到可供 MitM 处理的 TCP。插件不拒绝播放媒体，不修改 `ctier`、签名或音视频字节。为 UMP 试验加入 `*.googlevideo.com` MitM，但 UMP 脚本入口默认关闭；关闭开关不会同时撤销此域名的解密。
- 无字幕翻译、按钮隐藏、画中画、后台播放或会员相关修改。旧插件中的这些第三方脚本参数已移除。

## 安装与更新

主插件的三个去广告条目分别引用本仓库的对应文件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeFeedAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubePlaybackAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeStreamAds.js
```

**本地新建或修改文件不会自动发布到该地址。发布前直接导入当前远程版配置，可能遇到脚本下载失败或仍取得旧文件。**

可选择以下一种方式：

1. 发布本仓库的插件与 JS 后，在 Loon 更新插件，并重新下载对应脚本。需要设备能访问 `raw.githubusercontent.com`。
2. 本地试用：把三份去广告 JS 导入 Loon 的本地脚本资源，确认保存名称；主插件的信息流条目改为 `script-path=YouTubeFeedAds.js`，播放接口条目改为 `script-path=YouTubePlaybackAds.js`，UMP 条目改为 `script-path=YouTubeStreamAds.js`，分别引用正确的文件。不是填写 Mac 上的 `/Users/...` 路径。仍只需启用一个插件入口。

更新时替换 `YouTubeNoAds.plugin`，不要保留另一份旧主插件。删除或禁用此前的 `YouTubeCtierAds.plugin` 及其他匹配 YouTube 的脚本，若曾复制过相关规则到主配置，也一并移除。

开启插件、脚本和 MitM，保持 Loon CA 证书完全信任；确认三个去广告条目分别加载对应的自有 JS 后，完全退出 YouTube 再打开。若主配置的本地规则先放行了两个 API 域名的 UDP/443，可把主插件的两条 `[Rule]` 规则移到主配置对应放行规则之前。

## 查看结果

默认关闭控制台日志和日志工具，需要时在主插件手动开启“控制台日志”。日志前缀含脚本版本：

```text
[YouTubePlaybackAds 1.4.0] player changed: removed=3 format=protobuf
[YouTubePlaybackAds 1.4.0] get_watch pass: removed=0 format=protobuf
[YouTubePlaybackAds 1.4.0] player pass: truncated-field
```

- `changed` 表示删除了已识别广告字段，不能单独证明某次视频不会出现广告。`removed` 是字段出现次数，不是广告条数。
- `pass: removed=0` 表示没有可清理的已识别广告字段，也可能没有识别到已知 Player 结构。
- `pass: ...` 错误或格式原因表示整个响应未修改。
- 没有日志时，先确认新 JS 已下载及控制台日志已开启，再查看是否出现匹配路径的请求。不要求每次播放必然访问 `youtubei.googleapis.com`。
- 控制台及普通摘要只记录接口名、格式、计数及固定错误原因；手动开启开发抓包后，JSON 文件包含完整 URL、请求头和正文。Loon 自带的 debug 请求记录仍可能包含敏感内容，分享前请遮盖。

## 信息流赞助卡片清理

首页推荐列表里标注“赞助商广告”的 Robinhood 卡片属于信息流广告。它由推荐接口提供卡片数据，即使卡片自动播放视频，也应从推荐列表中移除卡片。`application/vnd.yt-ump` 是媒体封装，单独处理媒体下载不能移除该列表项。

`YouTubeFeedAds.js` 自行实现清理逻辑，不加载其他人的 JS。主插件默认启用信息流响应入口，匹配 `browse`、`next` 和 `search`。JSON 只在列表字段中删除具有明确广告 renderer 的整项，包括 `adSlotRenderer`、`inFeedAdLayoutRenderer`、`promotedVideoRenderer` 等，以及包在 `richItemRenderer.content` 中的广告卡片。正常视频、频道、购物内容、包含“广告”文字的普通标题和翻页 token 保留；Shorts 默认保留，可用下面的独立开关隐藏首页推荐区。广告与正常 renderer 同时出现在同一对象中时，整条响应保留，避免误删。

Protobuf 仅沿已核对的路径处理：BrowseResponse 字段 9 / 10 中的 SectionListRenderer（49399797）及其列表字段 1，删除含 AdSlotRenderer（424701016）或 CompanionAdRenderer（55514441）的整个列表项；`next` 支持 SingleColumnWatchNextResults（51779735）中的 SectionList，以及字段 8 的 WatchNextSecondaryResults continuation（51779776），其列表支持广告位和 CompactPromotedVideoRenderer（73920376）。未知字段保持原字节，只在已修改的外层消息重算长度。`removed` 是被识别的广告字段/JSON 列表项计数，不等同于屏幕上广告的准确条数。

**尚未适配：其他 Tab/列表路径、二进制 search 响应及未识别的 Elements/EML 卡片。** 当前不会在任意字节中搜索“ad”或“Robinhood”并删除，也不根据展示文字猜测 EML 卡片性质。这些结构原样通过并保存开发样本。限制为 4 MiB 响应、30,000 个 Protobuf 字段、32 层已知消息路径、20,000 个 JSON 节点和 64 层 JSON 深度；截断、混合 renderer、解析错误或超限时整条原响应通过。

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
2. 进入主插件设置，打开“隐藏首页 Shorts”。保持插件、脚本与 MitM 启用、证书完全信任；此功能不需要开启日志、开发抓包或 UMP 试验处理。
3. 完全退出 YouTube 后重新打开，进入首页并下拉刷新。已缓存的旧首页需要刷新才能取得修改后的推荐列表。
4. 如需恢复，关闭该开关，再退出 YouTube、重新打开并刷新首页。

首页识别只用于 `browse`：首次加载按 Tab 的 `FEwhat_to_watch` 标识确认；继续下滑的列表按已知 continuation 结构确认。Protobuf 首页 Tab 使用字段 11；continuation token 解码后读取样本中的 `80226972 → 2` browse ID。Next/Reload continuation 的字段编号与 token 字段参考 [SectionListSupportedContinuations](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/section_list_supported_continuations.proto) 和 [NextContinuationData](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/next_continuation_data.proto)。请求正文可用时，也读取明确的 browse ID 或 continuation；请求字段参考 [BrowseRequest](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/browse_request.proto)。无法确认首页的响应保留 Shorts，不把全部 `browse` 当作首页。

已提供的 iOS 21.39.4 样本中，区块为 `ShelfRenderer（51845067）→ content（5）→ HorizontalListRenderer（51431404）→ items（1）`。仅当所有条目都具有明确的 `shorts_video_cell.eml-fe|` 布局（16 位十六进制版本后缀）和唯一 Model 519005951 时，删除整个 Shelf 列表项。不会按标题或任意字节中的 Shorts 文本删除。HorizontalList 路径参考 [HorizontalListRenderer](https://github.com/davidzeng0/innertube/blob/main/protos/youtube/api/innertube/horizontal_list_renderer.proto)；布局与 Model 对应关系来自本地实际响应。

JSON 支持 `reelShelfRenderer`、带 Shorts 图标的 `richShelfRenderer` 及其 `richSectionRenderer` 包装、只含 Shorts 的 ItemSection 和水平 Shelf；要求内部条目均为明确的 `reelItemRenderer` 或 `shortsLockupViewModel`。保留混合普通视频的列表、未知布局和共享模板库。JSON renderer 字段核对参考 [ReelShelf](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/ReelShelf.ts) 和 [RichShelf](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/RichShelf.ts)，未调用或复制这些解析器的实现。

日志新增 `hidden_shorts`，表示移除的 Shorts 区块数量，与广告计数 `removed` 分开。例如 `removed=0 ... hidden_shorts=1` 表示只隐藏一个 Shorts 区块。开发抓包的响应处理参数也记录 `hide_home_shorts`。

已对此前完整导出的 6 份响应分别在开关关闭/开启状态离线回放：关闭时与此前去广告结果逐字节一致；开启时额外移除其中 2 份响应各自的 1 个 Shorts 区块，其他响应保持此前结果。12 次结果均与独立按指定列表项删除、重算长度的预期逐字节一致。尚需手机更新后确认显示效果；未知的新布局仍会保留。

### 取得首页广告的样本

1. 发布后更新主插件和 JS；完全退出 YouTube，再打开。先观察首页赞助卡片是否消失。
2. 仍有卡片时，在主插件打开“日志工具”“开发抓包”，关闭“UMP 试验处理”。抓首页接口不需要 UMP；关闭它能减少无关媒体样本和播放等待。
3. Safari 打开 `http://youtube-logs.invalid/`，先保留需要的旧记录，然后清空并开始记录。回到 YouTube 首页，下拉刷新一次，让赞助卡片出现；不必点开视频。
4. 回到日志页面暂停，选择“导出信息流开发记录 .json（排查首页赞助卡片）”。等待合成完成后保存一个 JSON 文件。它从同一缓存筛选 `YouTubeFeedAds` 请求、响应及人工标记，不建立第二套日志缓存。
5. 先确认文件能作为 JSON 完整打开，事件中有 `endpoint: "browse"`（或 `next/search`）、`phase: "response"`，且 `responseBefore.body.available` 为 `true`。如果这些记录仍缺失，应先检查脚本更新、MitM 和实际请求路径。未知 EML 卡片需要该响应样本才能继续适配。

本次实际响应的离线回放日志（不是手机界面实测）：

```text
[YouTubeFeedAds 1.1.0] browse changed: removed=1 format=protobuf opaque_elements=12 removed_eml=1 removed_dividers=1
[YouTubeFeedAds 1.1.0] browse pass: removed=0 format=protobuf opaque_elements=0 removed_eml=0 removed_dividers=0
```

`removed_eml` 是确认移除的 EML 广告内容数，`removed_dividers` 是移除的关联分隔项数。`opaque_elements` 统计已知路径上保留的 ElementRenderer（含普通视频和分隔项），不代表广告数量，也不代表统计了所有 EML 卡片。

## 主插件日志工具与开发记录

只启用 `YouTubeNoAds.plugin`，不再使用独立的 `YouTubeLogger.plugin`。三份去广告脚本共用一个记录索引，日志和原始样本统一导出；样本按块存储以避免把全部二进制反复写入索引，按来源分类的多套日志缓存不会重新引入。

主插件参数：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| 日志工具 | 关闭 | 手动开启后可开始记录、标记和下载；关闭后停止新增记录 |
| 日志保存级别 | info | 只控制普通摘要的最低严重程度 |
| 控制台日志 | 关闭 | 单独控制 Loon 脚本控制台输出 |
| 开发抓包 | 关闭 | 手动开启后保存匹配接口的原始请求和响应数据，不受摘要级别过滤 |
| 开发抓包容量 MB | 32 | 可选 16 / 32 / 64 MiB，限制原始样本序列化总容量 |

普通摘要级别从低到高为 `debug → info → warn → error`：`debug` 保存全部处理摘要和 UMP 计数；`info` 保存实际清理结果、警告和错误；`warn` 保存状态/结构/大小异常和错误；`error` 保存未预期解析或运行错误。级别只影响新摘要，不删除历史记录。开发抓包保存每次匹配脚本收到的数据及其处理结果，避免过滤掉未修改样本；没有另外重复写入该响应的普通摘要。

### 能保留哪些开发数据

- 独立的请求阶段：完整 URL、方法、请求头、HTTP/2 trailers、请求正文。该入口只读取，返回原请求，不修改签名、头或正文。
- 响应阶段：运行时可见的请求信息、原始响应状态/头/trailers/正文、修改后的正文或“沿用原正文”的引用。处理后的传输头由 Loon 重算，不能把原响应头当成最终网络头。
- 时间、来源、版本、Loon 运行时版本（若提供）、处理摘要、删除计数、UMP 部分计数、异常名称/消息/堆栈（若发生）、耗时和运行参数。
- 二进制正文以 Base64 保存，可还原为 Protobuf、Brotli 或 UMP 样本；文本保留运行时字符串。空正文与未提供正文分开记录，未提供的数据标明 `available:false`，不会伪造一个空样本。
- 原始样本带长度与 FNV-1a UTF-16 校验值，导出时检查块、长度和校验。校验是存储一致性检查，不是密码学完整性保证。丢失/损坏样本单独标记，不丢弃其他可读记录。
- 页面可添加“正在播放广告”或“正在播放正片”的人工标记，用时间比较两个状态。标记是用户观察，不代表脚本已识别广告。

**开发 JSON 会包含完整播放签名、请求头，可能含 Cookie、Authorization 或账号相关数据。数据只在本机保存，插件没有自动上传；分享开发文件前应检查敏感内容。**普通 `.log` 仍只包含摘要与标记。

### 开发抓包操作

1. 更新主插件和四份 JS。开发记录要求 `YouTubeFeedAds.js` 为 1.1.0、`YouTubePlaybackAds.js` / `YouTubeStreamAds.js` 为 1.4.0、`YouTubeLogger.js` 为 1.3.0。文件需要发布后才能从远程地址下载；本地导入时所有引用日志 JS 的条目都填写本地资源名 `YouTubeLogger.js`。
2. 主插件开启“日志工具”和“开发抓包”，选择容量。要取得媒体响应，**还必须开启“UMP 试验处理”并先选择 `inspect`**；关闭 UMP 响应入口时仍能取得开发请求，但不会取得媒体响应。普通摘要级别不会过滤开发样本。
3. Safari 输入 **`http://youtube-logs.invalid/`**，或手动运行主插件的“ YouTube 日志入口 ”后点通知。地址由 Loon 在本地直接响应，不需要额外 MitM。先导出需要保留的旧记录；需要干净样本时清空，再点“开始记录”。
4. 重现一次广告和一次正常播放。在相近时间添加广告/正片标记，减少其他播放、预览或自动播放，以便比较样本。切换 App 添加标记会有时间误差，不把它当作精确的广告边界。
5. 回到页面暂停记录，点击 **“导出完整开发记录 .json（合成一个文件）”**，等待显示文件已生成，再点击“保存日志文件”，通过 Safari 保存到“文件”。也可另外下载 `.log` 快速查看摘要；开发 JSON 本身包含摘要，不要求下载两个文件。
6. 查看 JSON 中的 `stoppedReason`、`completeness.issues` 和每个事件的 `captureError` / 正文 `available` 字段。未修改响应的 `responseAfter.body.reference` 指向 `responseBefore.body`；修改响应会同时保存两个正文。
7. 复现后关闭“开发抓包”。全部停止新增时关闭“日志工具”；已有样本保留。页面清空会删除本项目索引、已索引原始样本和旧日志缓存，保留其他脚本数据。

旧摘要没有保存过正文，不能恢复成原始二进制，需要用新模式重新录制。两次抓包都需先检查完整性，不把一次 `200 OK` 当成所有数据都已捕获。

### 单文件分块导出

此前直接把整个开发 JSON 放进一个脚本响应，大文件可能在设备上无法完整生成或保存；用户提供的文件已出现不完整 JSON，但仅凭文件无法确定截断发生在哪一步。当前页面会先读取一个小索引，再逐块读取本机样本，在浏览器中检查长度、校验值和元数据，最终合成 **一个 JSON 文件**。导出前必须暂停记录，并保持 Loon 开启；会话变化、样本块缺失或校验失败时不提供保存按钮，保留原有缓存供重试。

“导出完整开发记录”包含所有来源；“导出信息流开发记录”仅筛选首页/推荐/搜索来源及人工标记。二者使用同一个缓存。已有直接下载地址 `/download.json` 和 `/download-feed.json` 仍可导出不超过 4 MiB 的文件；超过时返回明确错误并引导使用页面上的分块导出，不返回截断正文。4 MiB 是保守的响应大小上限，不能证明所有设备都支持该大小。

浏览器分块合成没有读取 Loon 未捕获的数据，也不能修复已经下载的不完整文件。Safari 内存、后台切换和保存行为仍需要实机验证。完整开发记录可能较大，排查首页广告优先使用信息流导出；导出失败时不要清空缓存。

### 保留策略和实际边界

- 不再自动覆盖旧记录。统一索引最多 600 条、128 KiB UTF-8 序列化内容；原始样本另按选定容量保存，Base64 和 JSON 开销计入容量。达到任一上限即停止新增并显示停止状态，先导出，再清空重录。
- 单个运行时正文最多 8 MiB；单事件最多 32 MiB 字符内容、256 个存储块。超限停止抓包并给出原因，不保存一份看似完整的截断正文。请求和响应各算一个事件。
- 存储失败、序列化失败或正文超限时不改变去广告输出。存储本身不能写入时，停止标记也可能无法落盘，只能在控制台看到固定错误提示。
- Loon 公开存储 API 在这里没有原子追加；并发脚本可能丢失索引条目。脚本被系统终止时也可能留下未索引块，无法通过当前公开接口枚举并恢复。因此这是**尽可能保留运行时可见数据的开发记录**，不能保证整个网络会话无遗漏。
- 只匹配已配置的 `player/get_watch/browse/next/search` 与 `googlevideo/videoplayback`。没有命中 MitM、TLS 失败、脚本超时及其他接口不在本记录范围。响应脚本可见的请求正文可能缺失，独立请求阶段用于补充，但并发重复 URL 的精确配对无法保证；`correlation.urlMethodHash` 仅作分组提示。
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

1. 确认主插件和 JS 都更新为此版本。打开“控制台日志”和“UMP 试验处理”，将“UMP 模式”保持为 `inspect`。该模式只检查，不修改响应。
2. 主插件已包含 `*.googlevideo.com` MitM。若播放请求走 UDP/QUIC，可能无法命中脚本；只有观察到该现象时，才考虑在主配置中增加仅针对 `googlevideo.com` UDP/443 的回退规则。不要拒绝 TCP 播放连接。
3. 完全退出 YouTube，重开并播放可能出现广告的视频。找 `YouTube 视频流广告提示清理（试验）` 日志，前缀为 `[YouTubeStreamAds 1.4.0] ump`。
4. 先看是否记录到 `parts=...69:...` 和 `ad_prefetch` 大于零。如果没有，当前清理策略没有命中该广告，打开清理模式也不会移除其媒体。
5. 只有命中明确预取提示时，再把模式改为 `clean_prefetch`，退出重开后测试。`removed_prefetch` 大于零只代表删除了提示，必须另外观察广告、正片和拖动进度是否正常。关闭 UMP 开关可以撤销响应脚本处理；完整撤销媒体解密还需从主插件 MitM 列表移除 `*.googlevideo.com`。

示例日志是说明用的合成结果，不是用户设备上的实测：

```text
[YouTubeStreamAds 1.4.0] ump pass: mode=inspect removed_prefetch=0 ad_cues=1 ad_prefetch=1 other_ad_cues=0 bytes=130 parts=20:1,21:1,22:1,69:1
```

这里的 `20:1` 表示类型 20 出现 1 次；`ad_prefetch` 是符合两个条件的元数据条目数。控制台和普通摘要不输出媒体内容、视频 ID、签名、token 或上下文原文；开发 JSON 会保留运行时可见的原始数据。

### 当前缺少的证据

用户先前抓到的广告请求为 `POST /videoplayback`，带 `c=IOS`、`sabr=1`、`ctier=L`，响应为 `200 OK`、`Content-Type: application/vnd.yt-ump`。此前只有请求和响应头；本次导出文件的可读前缀已包含 UMP 二进制样本，但整个文件不完整，且没有首页卡片响应。未在本次信息流改动中验证这些媒体样本与广告/正常视频状态的对应关系，不能据此声称解决了贴片广告。进一步适配 UMP 仍需完整文件与明确的广告/正片观察，才能确定时间线和请求状态处理。

之前空 502 拦截导致几秒黑屏，当前实现不重新采用这一方法。**广告预取提示清理不等于删除正在播放的广告。单靠 Content-Type 不能定位广告，也无法从纯广告响应生成缺失的正片。**

Loon 响应脚本需要读取完整响应体。即使 `inspect` 不修改数据，等待整个播放响应完成也可能增加延迟或影响播放；这里尚未验证真实设备行为。如果出现新的等待或黑屏，关闭 UMP 试验入口。不能仅凭“不删除媒体”保证没有黑屏。

## 本地验证

`tests/YouTubeFeedAds.test.mjs`、`tests/YouTubePlaybackAds.test.mjs`、`tests/YouTubeStreamAds.test.mjs`、`tests/YouTubeLogger.test.mjs` 和 `tests/YouTubeCapture.test.mjs` 使用 Node 模拟 Loon 环境，不需要下载其他 JS。共 196 项测试通过，覆盖：两种 API 域名、两种响应结构、重复广告字段、未知 wire 数据保留、嵌套长度跨界、二进制视图偏移、JSON、异常结构、资源限制、日志内容及单次完成；另外验证 UMP 前缀整数的十个固定向量、预取提示清理、媒体和其他广告事件保留、跨边界长度重组、异常数据整体原样通过及试验开关；确认各去广告脚本只处理所负责的接口。信息流测试另验证首页 Shorts 开关默认关闭、首次加载和延续列表识别、JSON/Protobuf 整块移除、其他页面及混合列表保留、首页 Tab 之间的范围隔离、广告/Shorts 计数分开、整项赞助卡片删除、推荐翻页保留、正常标题/Shorts 保留、未知 EML/Tab 原样通过、七种 EML 布局及广告操作联合识别、关联分隔项清理、混合 ItemSection 保留、共享模板库保留、已知 Protobuf 列表和长度重组、错误响应整体通过；日志测试验证共用信息流缓存与筛选导出、大样本分块单文件合成、校验失败不给出文件及跨会话隔离。日志测试覆盖开始/暂停、两份脚本合并导出、关闭控制台仍记录、主插件手动开关、四级过滤、旧缓存合并、数量与容量限制、存储失败仍完成清理、会话清空与隔离、下载文件名与敏感信息不进入普通摘要。开发测试另验证请求原样通过、原始/修改正文的二进制还原、空/缺失正文区分、中文/emoji 与分块边界、文件附件、容量满后保留旧证据、写失败回滚、损坏样本提示、异常细节及人工广告/正片标记。

```sh
node --check loon/YouTube/YouTubeFeedAds.js
node --check loon/YouTube/YouTubePlaybackAds.js
node --check loon/YouTube/YouTubeStreamAds.js
node --check loon/YouTube/YouTubeLogger.js
node --test loon/YouTube/tests/*.test.mjs
```

这些验证不包含真实 Loon 配置解析器、设备脚本引擎或实际视频广告。本地修改不会自动上传，发布版本以仓库远程分支中的提交为准。

## 规范参考

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
