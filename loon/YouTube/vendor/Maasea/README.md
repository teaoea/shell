# Maasea YouTube 构建文件可读还原

这里保存 [Maasea/sgmodule](https://github.com/Maasea/sgmodule/tree/master/Script/Youtube) 两份 YouTube JavaScript 构建文件的固定副本与可读格式化版本，方便审阅新版 `initplayback`、Protobuf 广告清理和配置缓存逻辑。

## 固定来源

- 上游提交：`65075cdb388fc5e3094afd7e7314c67b243f3525`
- 提交时间：2026-07-19 16:33:52 +08:00
- 提交说明：`#100 fix ad judgment`
- 许可证：Apache License 2.0，完整文本见 [`LICENSE`](LICENSE)

| 文件 | 上游 Build | 原始 SHA-256 |
| --- | --- | --- |
| `youtube.request.js` | 2026/7/12 22:44:32 | `3ecca15e06e76a31720092c581180f648ef2c45e494644941ba985c878efbb26` |
| `youtube.response.js` | 2026/7/19 16:16:39 | `f98483d5f5017514f82502253c0db5ce2d4ffb7839887aa2cadc22666f5a7f12` |

`original/` 是上游文件的逐字副本；`restored/` 使用固定版本 Prettier 3.6.2 解析并格式化，在文件头和核心入口增加说明注释。没有替换业务表达式、字符串、Protobuf 字段或网络地址。

## “还原”的边界

上游只发布打包压缩后的 JavaScript，没有提交对应 TypeScript、Proto 源文件或 source map。格式化可以恢复缩进、语句边界、类与函数结构，内嵌的 Protobuf 类型名和字段名也仍然存在；压缩时被改写的局部变量名、原文件拆分方式和原作者注释无法准确恢复。`restored/` 因而是可执行的可读构建，不是原始源代码。

## 请求脚本结构

[`restored/youtube.request.js`](restored/youtube.request.js) 包含 protobuf-ts 运行时、`youtube.request.init.OnesieRequest` 与 `EncryptedInnertubeRequest` 类型，以及 Loon、Surge、Quantumult X 三端适配器。

核心流程：

1. `log_event` 请求始终移除 `content-encoding`；未缓存当前平台 Onesie key 时还会移除 `x-youtube-hot-hash-data`。
2. `initplayback` 正文按 `OnesieRequest` 解码，读取 `encryptedClientKey`。
3. 若它与持久化的 `encryptKey` 相同，脚本把缓存的 `clientKey`、原目标 URL 和模块参数拼到 `https://init-stream.maasea.workers.dev/`，再把请求重定向到该 Worker。
4. key 缺失或不匹配时，脚本清除当前平台缓存，并返回 `200 text/plain` 空正文，让客户端回退到 `v1/player` 重新取得配置。

这意味着请求脚本不是纯本地 UMP 去广告：命中 `initplayback` 后，目标播放 URL 与客户端 key 会发送给 Maasea Worker。原脚本没有主动附加账号 Cookie，但目标 URL 本身可能包含播放签名与上下文参数。

## 响应脚本结构

[`restored/youtube.response.js`](restored/youtube.response.js) 包含大量由 protobuf-ts 生成的消息类型，并按 URL 分派：

| 接口 | 主要处理 |
| --- | --- |
| `browse` / `next` / `search` | 遍历 RichItem，结合未知字段中的 `pagead` 与 EML 模板缓存识别并删除广告卡片 |
| `player` | 清空字段 7 `adPlacements` 与字段 68 `adSlots`，删除 page-ad 跟踪，启用画中画和后台播放，并可增加翻译字幕 |
| `reel_watch_sequence` | 删除 `adClientParams.isAd` 为真的 Shorts 条目 |
| `guide` | 按参数隐藏上传、沉浸式音乐和 Shorts 入口 |
| `get_setting` | 增加后台播放、下载和智能下载设置 |
| `get_watch` | 同时处理内部 `player` 与 `next` |
| `config` / `log_event` | 从 Onesie hot config 读取 `clientKey`、`encryptKey`，按 YouTube/YouTube Music 分开保存到 `YouTubeConfig` |

广告识别缓存保存在 `YouTubeAdvertiseInfo`。固定黑名单包含 `inline_injection_entrypoint_layout.eml`；遇到未知字段号或 EML 时，脚本根据是否包含 ASCII `pagead` 将其加入白名单或黑名单。因此缓存会影响后续信息流判断。

## 文件用途

- `original/`：核对上游内容、校验哈希或重新执行其他还原工具。
- `restored/`：代码审阅、搜索 Protobuf 类型/字段、追踪请求与响应流程。
- 当前主插件不会自动加载这些副本；它们不会改变 `YouTubeNoAds.plugin` 的运行行为。

如果以后上游提交变化，应先保存新提交号和 SHA-256，再生成新的固定版本；不要直接覆盖后声称仍对应本页记录的提交。
