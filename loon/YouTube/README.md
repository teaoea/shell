# YouTube 视频贴片去广告（自有 JS）

只维护一个 Loon 插件入口 `YouTubeNoAds.plugin`，按功能调用同目录的两份自有 JS。两份脚本均可直接在 Loon 独立运行，没有运行时模块导入、第三方实现、第三方服务、外部库、重定向或额外网络请求。

| 文件 | 功能 | 匹配位置 |
| --- | --- | --- |
| `YouTubePlaybackAds.js` | 清理播放接口返回的广告位 | `/youtubei/v1/player`、`get_watch` 的 JSON / Protobuf 响应 |
| `YouTubeStreamAds.js` | 清理视频流中的广告预取提示（试验） | `googlevideo.com/videoplayback` 的 UMP 响应 |
| `YouTubeLogger.js` | 本地日志控制、下载页面与 .log 导出 | 专用本地页面 |
| `YouTubeLogger.plugin` | 可选的独立日志插件 | 手动入口与浏览器请求 |
| `YouTubeNoAds.plugin` | 统一配置两份脚本、参数与 MitM | 只需启用这一个插件 |

原合并文件 `YouTubeNoAds.js` 已移除。两份脚本的二进制解析辅助函数各自保留，以便 Loon 直接执行，不需要再加载公共模块。后续播放接口功能改 `YouTubePlaybackAds.js`，视频流功能改 `YouTubeStreamAds.js`。

目标为 YouTube 插入的片头及中插广告。**当前实现能清理已识别 API 响应中的广告位，并提供 UMP 广告预取提示清理试验。它尚不能移除已经传输或播放的广告媒体，也未在真实 Loon 设备上验证。不能保证最新 YouTube App 的所有贴片广告都消失或没有黑屏。**

## 实现范围

- API 部分仅处理 `/youtubei/v1/player` 和 `/youtubei/v1/get_watch` 的成功响应，支持 `youtubei.googleapis.com`、`youtubei-att.googleapis.com` 及 `youtube.com`、`www`、`m`、`music` 子域上的这两个路径。
- JSON：删除播放器对象中的 `adPlacements`、`adSlots`、`playerAds`。保留播放地址、视频信息、字幕及其他配置；不会全局删除任意对象中同名字段。
- Protobuf：自行实现 wire format 读取，仅移除已识别 Player 消息的长度型字段 7（`adPlacements`）与 68（`adSlots`）。`get_watch` 使用已知的字段路径 `1 → 2 → Player`。保留非广告字段的原始字节、顺序及未知内容，只在嵌套消息改变时重算外层长度。
- 字段编号和 `get_watch` 路径来自已有逆向协议描述的核对，属于协议映射信息；未复制原脚本或其库实现。YouTube 未公开保证这些编号适用于所有客户端。脚本使用字段 2 的 playabilityStatus 及 wire type 作有限检查，不能证明所有未来协议变化都能识别。
- 空响应、非 200、损坏数据、已检测到的结构不匹配、未知内容类型、API 上的非预期 UMP、未解压的 gzip 及超限响应原样通过。限制为 2 MiB 响应、30,000 个解析字段、20,000 个 JSON 对象节点和 64 层 JSON 深度。
- 只拒绝两个 `googleapis.com` API 域名的 UDP/443，促使 API 的 QUIC 回退到可供 MitM 处理的 TCP。插件不拒绝播放媒体，不修改 `ctier`、签名或音视频字节。为 UMP 试验加入 `*.googlevideo.com` MitM，但 UMP 脚本入口默认关闭；关闭开关不会同时撤销此域名的解密。
- 无字幕翻译、按钮隐藏、画中画、后台播放或会员相关修改。旧插件中的这些第三方脚本参数已移除。

## 安装与更新

主插件的两个条目分别引用本仓库的对应文件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubePlaybackAds.js
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTube/YouTubeStreamAds.js
```

**本地新建或修改文件不会自动发布到该地址。发布前直接导入当前远程版配置，可能遇到脚本下载失败或仍取得旧文件。**

可选择以下一种方式：

1. 发布本仓库的插件与 JS 后，在 Loon 更新插件，并重新下载对应脚本。需要设备能访问 `raw.githubusercontent.com`。
2. 本地试用：把两份 JS 导入 Loon 的本地脚本资源，确认保存名称；主插件的播放接口条目改为 `script-path=YouTubePlaybackAds.js`，UMP 条目改为 `script-path=YouTubeStreamAds.js`，分别引用正确的文件。不是填写 Mac 上的 `/Users/...` 路径。仍只需启用一个插件入口。

更新时替换 `YouTubeNoAds.plugin`，不要保留另一份旧主插件。删除或禁用此前的 `YouTubeCtierAds.plugin` 及其他匹配 YouTube 的脚本，若曾复制过相关规则到主配置，也一并移除。

开启插件、脚本和 MitM，保持 Loon CA 证书完全信任；确认两个条目分别加载对应的自有 JS 后，完全退出 YouTube 再打开。若主配置的本地规则先放行了两个 API 域名的 UDP/443，可把主插件的两条 `[Rule]` 规则移到主配置对应放行规则之前。

## 查看结果

默认开启“排查日志”。日志前缀含脚本版本：

```text
[YouTubePlaybackAds 1.2.1] player changed: removed=3 format=protobuf
[YouTubePlaybackAds 1.2.1] get_watch pass: removed=0 format=protobuf
[YouTubePlaybackAds 1.2.1] player pass: truncated-field
```

- `changed` 表示删除了已识别广告字段，不能单独证明某次视频不会出现广告。`removed` 是字段出现次数，不是广告条数。
- `pass: removed=0` 表示没有可清理的已识别广告字段，也可能没有识别到已知 Player 结构。
- `pass: ...` 错误或格式原因表示整个响应未修改。
- 没有日志时，先确认新 JS 已下载及排查日志已开启，再查看是否出现匹配路径的请求。不要求每次播放必然访问 `youtubei.googleapis.com`。
- 脚本只记录接口名、格式、计数及固定错误原因，不输出完整 URL、token、签名或响应内容。Loon 自带的 debug 请求记录仍可能包含敏感内容，分享前请遮盖。

## 独立日志插件与文件导出

新增 `YouTubeLogger.plugin` 和 `YouTubeLogger.js`。日志插件独立启用，主去广告插件仍只有一个；日志插件不匹配 YouTube 响应，避免与两份去广告脚本重复处理同一请求。两份去广告 JS 已加入可选本地日志写入，更新到 1.2.1 后才会写入导出缓存。

1. 更新主插件及两份去广告 JS；导入并启用 `YouTubeLogger.plugin`，下载 `YouTubeLogger.js`。文件需要先发布到本仓库才能从插件中的远程地址取得；本地试用时将日志插件的两个 `script-path` 都改为 `YouTubeLogger.js`。
2. 在 Safari 输入完整地址 **`http://youtube-logs.invalid/`**，或在 Loon 手动运行“ YouTube 日志入口 ”后点击通知。必须使用 `http://`，该专用地址由 Loon 请求脚本直接返回页面，没有上游服务器。不需要为它添加 MitM 域名。
3. 页面点击“开始记录”，然后打开 YouTube 重现广告。普通控制台的“排查日志”开关可以关闭，本地记录仍会进行。要取得 UMP 结构信息，仍需在主插件开启“UMP 试验处理”，先用 `inspect` 模式。
4. 回到页面，点击“暂停记录”，再点“下载日志文件 .log”。生成的文件名类似 `YouTube-2026-10-02T02-30-00-000Z.log`，时间采用 UTC。Safari 若直接显示文本，可通过分享菜单保存到“文件”。
5. 页面“清空日志并暂停”只清理本项目日志，不会调用清空所有脚本存储的接口。停用日志插件前先暂停记录：插件停用不能自动删除持久化的记录开关。

日志含记录时间、脚本名与版本、接口名、处理结果、删除数量、UMP 部分计数与固定错误原因。只收集本项目处理摘要，不读完整 URL、签名、token、请求头或媒体正文，也无法读取 Loon 全局连接、证书失败和脚本超时日志。

默认未开始记录。每份去广告脚本分别保留最近 **300 条且最多 64 KiB 的序列化缓存**，到达上限覆盖旧记录；两份缓冲区共最多 128 KiB。相同脚本并发读写可能丢失个别条目，导出是排查摘要，不是完整抓包。存储失败不会改变去广告结果。此版本已通过本地模拟导出测试，手机上的 Safari 下载及 Loon 入口仍需实机验证。地址无法打开时检查日志插件、脚本下载和 Loon 连接是否启用，并确认没有被浏览器自动改为 HTTPS。

实现使用 Loon 公开的本地存储及请求脚本直接生成响应接口：[Script API](https://nsloon.app/docs/Script/script_api/)。公开 API 清单没有直接写入 iOS “文件”App 的接口，因此文件通过浏览器下载保存。

## UMP 广告预取提示清理试验

UMP 是多部分播放封装，包含特殊前缀整数、音视频和控制消息。不是普通 Protobuf varint 连续流。`YouTubeStreamAds.js` 自写 UMP framing 读取与重组，不加载第三方运行代码。

当前能处理的是 Part 69 的 CuepointList：沿 `CuepointList.ssap_infos（字段 1）→ CuepointInfo.cuepoint（字段 1）`，只删除 `Cuepoint.type=1` 且 `event=6（PREFETCH）` 的条目。协议研究把 type 1 解释为广告，并记载 PREFETCH 会触发 `/player/ad_break` 广告配置预取。**这给出了可验证的预取提示清理目标，但不能证明删除提示就能避免实际广告插入。**

以下内容保持原始字节：MEDIA_HEADER（20）、MEDIA（21）、MEDIA_END（22）、加密部分（10/11/12）、其他广告事件、seek/时间线、SABR 上下文及未知 UMP 部分。不根据 `ctier=L` 推测并删除媒体，也不伪造播放器时间、跳过指令或正片内容。如果清理后 CuepointList 为空，保留其长度为零的 Part 69 封装，而非返回空 HTTP 响应。

完整输入及目标元数据先通过检查才输出改动。结构截断、未知 wire type、重复的单数 Cuepoint 消息或资源超限时，整条原响应通过；不输出已经完成的部分改动。UMP 限制为 8 MiB、10,000 个部分、128 种部分类型及 30,000 个解析的 Protobuf 字段。

### 在设备上验证

1. 确认主插件和 JS 都更新为此版本。打开“排查日志”和“UMP 试验处理”，将“UMP 模式”保持为 `inspect`。该模式只检查，不修改响应。
2. 主插件已包含 `*.googlevideo.com` MitM。若播放请求走 UDP/QUIC，可能无法命中脚本；只有观察到该现象时，才考虑在主配置中增加仅针对 `googlevideo.com` UDP/443 的回退规则。不要拒绝 TCP 播放连接。
3. 完全退出 YouTube，重开并播放可能出现广告的视频。找 `YouTube 视频流广告提示清理（试验）` 日志，前缀为 `[YouTubeStreamAds 1.2.1] ump`。
4. 先看是否记录到 `parts=...69:...` 和 `ad_prefetch` 大于零。如果没有，当前清理策略没有命中该广告，打开清理模式也不会移除其媒体。
5. 只有命中明确预取提示时，再把模式改为 `clean_prefetch`，退出重开后测试。`removed_prefetch` 大于零只代表删除了提示，必须另外观察广告、正片和拖动进度是否正常。关闭 UMP 开关可以撤销响应脚本处理；完整撤销媒体解密还需从主插件 MitM 列表移除 `*.googlevideo.com`。

示例日志是说明用的合成结果，不是用户设备上的实测：

```text
[YouTubeStreamAds 1.2.1] ump pass: mode=inspect removed_prefetch=0 ad_cues=1 ad_prefetch=1 other_ad_cues=0 bytes=130 parts=20:1,21:1,22:1,69:1
```

这里的 `20:1` 表示类型 20 出现 1 次；`ad_prefetch` 是符合两个条件的元数据条目数。日志不输出媒体内容、视频 ID、签名、token 或上下文原文。

### 当前缺少的证据

用户先前抓到的广告请求为 `POST /videoplayback`，带 `c=IOS`、`sabr=1`、`ctier=L`，响应为 `200 OK`、`Content-Type: application/vnd.yt-ump`。目前没有它的二进制响应体，所以不能确认它含 Part 69，还是仅含广告音视频/加密数据。必须取得广告和正常视频各一份实际响应体或先取得上述结构日志，才能确定下一步是否能清理，以及需要哪些时间线和请求状态处理。

之前空 502 拦截导致几秒黑屏，当前实现不重新采用这一方法。**广告预取提示清理不等于删除正在播放的广告。单靠 Content-Type 不能定位广告，也无法从纯广告响应生成缺失的正片。**

Loon 响应脚本需要读取完整响应体。即使 `inspect` 不修改数据，等待整个播放响应完成也可能增加延迟或影响播放；这里尚未验证真实设备行为。如果出现新的等待或黑屏，关闭 UMP 试验入口。不能仅凭“不删除媒体”保证没有黑屏。

## 本地验证

`tests/YouTubePlaybackAds.test.mjs`、`tests/YouTubeStreamAds.test.mjs` 和 `tests/YouTubeLogger.test.mjs` 使用 Node 模拟 Loon 环境，不需要下载其他 JS。共 77 个测试，覆盖：两种 API 域名、两种响应结构、重复广告字段、未知 wire 数据保留、嵌套长度跨界、二进制视图偏移、JSON、异常结构、资源限制、日志内容及单次完成；另外验证 UMP 前缀整数的十个固定向量、预取提示清理、媒体和其他广告事件保留、跨边界长度重组、异常数据整体原样通过及试验开关；确认两个脚本各自只处理所负责的接口。日志测试覆盖开始/暂停、两份脚本合并导出、关闭控制台仍记录、数量与容量限制、存储失败仍完成清理、会话清空与隔离、下载文件名与敏感信息不进入摘要。

```sh
node --check loon/YouTube/YouTubePlaybackAds.js
node --check loon/YouTube/YouTubeStreamAds.js
node --check loon/YouTube/YouTubeLogger.js
node --test loon/YouTube/tests/*.test.mjs
```

这些验证不包含真实 Loon 配置解析器、设备脚本引擎或实际视频广告。文件目前仅在本地修改，尚未推送。

## 规范参考

- Protocol Buffers wire format：https://protobuf.dev/programming-guides/encoding/
- Loon Script 语法：https://nsloon.app/en/docs/Script/
- Loon Script API：https://nsloon.app/en/docs/Script/script_api/
- Loon 插件及对象参数：https://nsloon.app/en/docs/Plugin/
- UMP framing 格式研究：https://github.com/davidzeng0/innertube/blob/main/googlevideo/ump.md
- UMP 部分类型：https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/ump_part_id.proto
- Cuepoint 广告类型与事件：https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/cuepoint.proto
- CuepointList / CuepointInfo：https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/cuepoint_list.proto 和 https://github.com/LuanRT/googlevideo/blob/main/protos/video_streaming/cuepoint_info.proto

以上为格式与接口参考，插件不会调用这些项目的代码或服务。
