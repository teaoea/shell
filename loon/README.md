# YouTube 视频贴片去广告（自有 JS）

只维护一个 Loon 插件入口 `YouTubeNoAds.plugin`，由它调用同目录的 `YouTubeNoAds.js`。JS 为本仓库自行编写，运行时不下载第三方实现，不调用第三方服务，无外部库、存储、重定向或额外网络请求。

目标为 YouTube 插入的片头及中插广告。**当前实现能清理已识别 API 响应中的广告位，但尚不支持抓包中 `application/vnd.yt-ump` 的播放广告，也未在真实 Loon 设备上验证。不能保证最新 YouTube App 的所有贴片广告都消失。**

## 实现范围

- 仅处理 `/youtubei/v1/player` 和 `/youtubei/v1/get_watch` 的成功响应，支持 `youtubei.googleapis.com`、`youtubei-att.googleapis.com` 及 `youtube.com`、`www`、`m`、`music` 子域上的这两个路径。
- JSON：删除播放器对象中的 `adPlacements`、`adSlots`、`playerAds`。保留播放地址、视频信息、字幕及其他配置；不会全局删除任意对象中同名字段。
- Protobuf：自行实现 wire format 读取，仅移除已识别 Player 消息的长度型字段 7（`adPlacements`）与 68（`adSlots`）。`get_watch` 使用已知的字段路径 `1 → 2 → Player`。保留非广告字段的原始字节、顺序及未知内容，只在嵌套消息改变时重算外层长度。
- 字段编号和 `get_watch` 路径来自已有逆向协议描述的核对，属于协议映射信息；未复制原脚本或其库实现。YouTube 未公开保证这些编号适用于所有客户端。脚本使用字段 2 的 playabilityStatus 及 wire type 作有限检查，不能证明所有未来协议变化都能识别。
- 空响应、非 200、损坏数据、已检测到的结构不匹配、未知内容类型、UMP、未解压的 gzip 及超限响应原样通过。限制为 2 MiB 响应、30,000 个解析字段、20,000 个 JSON 对象节点和 64 层 JSON 深度。
- 只拒绝两个 `googleapis.com` API 域名的 UDP/443，促使 API 的 QUIC 回退到可供 MitM 处理的 TCP。插件不拒绝、重写或解密 `googlevideo.com` 播放媒体，不修改 `ctier`、签名或媒体内容。
- 无字幕翻译、按钮隐藏、画中画、后台播放或会员相关修改。旧插件中的这些第三方脚本参数已移除。

## 安装与更新

主插件当前的脚本地址指向本仓库：

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/YouTubeNoAds.js
```

**本地新建或修改文件不会自动发布到该地址。发布前直接导入当前远程版配置，可能遇到脚本下载失败或仍取得旧文件。**

可选择以下一种方式：

1. 发布本仓库的插件与 JS 后，在 Loon 更新插件，并重新下载对应脚本。需要设备能访问 `raw.githubusercontent.com`。
2. 本地试用：把 `YouTubeNoAds.js` 导入 Loon 的本地脚本资源，确认保存名称；在主插件的唯一 `[Script]` 条目中，将 `script-path=` 的远程 URL 改为该本地脚本资源名，例如 `script-path=YouTubeNoAds.js`。不是填写 Mac 上的 `/Users/...` 路径。仍只需启用一个插件入口。

更新时替换 `YouTubeNoAds.plugin`，不要保留另一份旧主插件。删除或禁用此前的 `YouTubeCtierAds.plugin` 及其他匹配 YouTube 的脚本，若曾复制过相关规则到主配置，也一并移除。

开启插件、脚本和 MitM，保持 Loon CA 证书完全信任；确认加载的是自有 JS 后，完全退出 YouTube 再打开。若主配置的本地规则先放行了两个 API 域名的 UDP/443，可把主插件的两条 `[Rule]` 规则移到主配置对应放行规则之前。

## 查看结果

默认开启“排查日志”。日志前缀含脚本版本：

```text
[YouTubeNoAds 1.0.0] player changed: removed=3 format=protobuf
[YouTubeNoAds 1.0.0] get_watch pass: removed=0 format=protobuf
[YouTubeNoAds 1.0.0] player pass: truncated-field
```

- `changed` 表示删除了已识别广告字段，不能单独证明某次视频不会出现广告。`removed` 是字段出现次数，不是广告条数。
- `pass: removed=0` 表示没有可清理的已识别广告字段，也可能没有识别到已知 Player 结构。
- `pass: ...` 错误或格式原因表示整个响应未修改。
- 没有日志时，先确认新 JS 已下载及排查日志已开启，再查看是否出现匹配路径的请求。不要求每次播放必然访问 `youtubei.googleapis.com`。
- 脚本只记录接口名、格式、计数及固定错误原因，不输出完整 URL、token、签名或响应内容。Loon 自带的 debug 请求记录仍可能包含敏感内容，分享前请遮盖。

## 黑屏与 UMP 限制

此前用户在广告播放期间抓到 `POST /videoplayback`，含 `c=IOS`、`sabr=1`、`ctier=L`，原响应为 `200 OK`、`Content-Type: application/vnd.yt-ump`。对该请求返回空 502 后，部分广告变成几秒黑屏再播放正片。用户要求没有此类黑屏，因此已撤销整个试验，不在自有 JS 中重做该媒体阻断。

UMP 属于不同的播放封装，不能直接当作这里的 API Protobuf 消息或 JSON 处理。当前 JS 不匹配 `/videoplayback`，即使意外传入 UMP 类型也会原样通过。**这意味着该类广告可能保留；自行编写 JS 并不等于已经具备无黑屏清理 UMP 的实现。**

若更新后仍有黑屏，先确认设备没有旧 `ctier=L` / `videoplayback` 拒绝、空响应或 502 规则；禁用本插件并完全退出 YouTube 后重试，可以用于比较是否由当前配置引起。没有异常时，测试几个不同视频和拖动进度；一次无广告不能证明全覆盖。

## 本地验证

`tests/YouTubeNoAds.test.mjs` 使用 Node 模拟 Loon 响应环境，不需要下载其他 JS。覆盖 38 个测试：两种 API 域名、两种响应结构、重复广告字段、未知 wire 数据保留、嵌套长度跨界、二进制视图偏移、JSON、异常结构、资源限制、日志内容及单次完成。

```sh
node --check loon/YouTubeNoAds.js
node --test loon/tests/YouTubeNoAds.test.mjs
```

这些验证不包含真实 Loon 配置解析器、设备脚本引擎或实际视频广告。文件目前仅在本地修改，尚未推送。

## 规范参考

- Protocol Buffers wire format：https://protobuf.dev/programming-guides/encoding/
- Loon Script 语法：https://nsloon.app/en/docs/Script/
- Loon Script API：https://nsloon.app/en/docs/Script/script_api/
- Loon 插件及对象参数：https://nsloon.app/en/docs/Plugin/
- UMP / SABR 格式研究参考：https://github.com/LuanRT/googlevideo

以上为格式与接口参考，插件不会调用这些项目的代码或服务。
