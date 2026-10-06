# YouTube 去广告（Quantumult X）

[Loon 版](../../loon/YouTube/README.md) 的 Quantumult X 移植，只保留去广告核心。两份脚本由 `loon/YouTube/src/` 的同一份源码构建，构建时包一层接口适配，不另外维护一套逻辑。

## 设备反馈（2026-10-06）

用户在 Quantumult X 真机上使用当前构建（后台播放和隐藏首页 Shorts 已开启），反馈：

- 视频能正常播放；
- 片头／中插广告消失；
- 首页、推荐、搜索的赞助卡片和 Shorts 广告消失；
- 后台播放和隐藏首页 Shorts 生效。

这是整体使用效果的确认，没有逐视频统计、首帧计时或重写日志，不能据此承诺所有视频无广告或零启动等待，也不能单独证明下文每一项机制都已命中。本地测试另外证明：在模拟的 Quantumult X 接口下，清理结果与 Loon 发布包逐字节一致。

## 功能

| 功能 | 状态 |
| --- | --- |
| 播放器请求的广告协商字段清理（`player`、`get_watch`） | 固定启用 |
| `player/ad_break` 直接返回空 Protobuf | 固定启用 |
| 播放器响应的广告位清理 | 固定启用 |
| 首页、推荐、搜索的赞助卡片清理 | 固定启用 |
| Shorts 播放广告清理 | 固定启用 |
| 初始化 POST 返回空白视频（对应 Loon 的 `reject_video(200)`） | 固定启用 |
| 后台播放、隐藏首页 Shorts、播放请求地区 | 构建时由 `options.json` 决定；当前后台播放和隐藏首页 Shorts 已开启，地区保持 `original` |
| 日志工具、Onesie 配置缓存、媒体采样 | 未移植 |

## 安装

1. 在主配置 `[general]` 加入下面一行，让 YouTube 从 QUIC 回退到可解密的 TCP。它对所有 App 的 UDP 443 生效。

   ```text
   udp_drop_list = 443
   ```

2. 在重写引用里添加片段地址：

   ```text
   https://raw.githubusercontent.com/falconchen/shell/main/quantumultx/YouTube/YouTubeNoAds.snippet
   ```

3. 开启 MitM 和重写，安装并完全信任证书。
4. 删除或停用其他匹配 YouTube 的去广告重写，避免同一响应被处理两次。
5. 完全退出 YouTube 再打开。

片段和脚本地址指向 `falconchen/shell` 的 `main` 分支；本地改动推送后才会生效。更新后需要在 Quantumult X 里更新重写引用，让它重新下载片段和两份脚本。

## 修改开关

Quantumult X 的重写片段没有插件参数界面，开关写在 `options.json`，构建时固定进脚本：

```json
{
  "background_playback": true,
  "hide_home_shorts": true,
  "playback_region": "original"
}
```

`playback_region` 可选 `original`、`CN`、`HK`、`TW`、`US`、`JP`、`KR`、`SG`、`GB`、`DE`、`RU`。修改后在 `loon/YouTube/` 重新构建并推送：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run test
```

`dist/` 由构建生成，不手工修改。

## 与 Loon 版的差异

| Loon | Quantumult X |
| --- | --- |
| 插件参数界面 | `options.json`，改动需重新构建 |
| `[Rule]` 只拒绝三个域名的 UDP 443 | `udp_drop_list = 443`，全局生效 |
| 原生 `reject_video(200)`，按方法和 User-Agent 匹配 | 请求脚本内判断 POST 与 `com.google.ios.youtube/`，返回 144 字节的无轨道 MP4 |
| 清除 googlevideo 响应的 `Alt-Svc` | 未移植 |
| 日志工具与导出页面 | 未移植 |

## 尚未单独确认的机制

整体效果已有上面的设备反馈；下面几项是其中未被单独观察到的环节，出现异常时可按此排查。

- **请求脚本直接应答。** `player/ad_break` 和初始化空视频都靠请求脚本用 `$done({status, headers, body})` 直接返回响应。Quantumult X 官方示例没有写明这一用法。如果初始化规则不生效，改用片段末尾注释里的 `reject-200` 备用行；`ad_break` 不生效时广告配置请求会照常发出。
- **空白视频内容。** Loon `reject_video` 返回的具体字节没有公开，这里用的是自行生成的无轨道 MP4。用户在 Quantumult X 上确认带此规则时播放正常，但没有单独对比去掉这条规则的效果。
- **请求正文压缩。** 如果 Quantumult X 交给脚本的播放器请求正文仍是 gzip 压缩的，脚本会原样放行，不影响播放，但请求侧的广告协商清理不生效。
- **JSON 正文。** Quantumult X 的脚本环境没有 `TextDecoder`，适配层对 JSON 类型使用字符串正文，Protobuf 使用 `bodyBytes`。

排查时先在 Quantumult X 的重写日志里确认三条规则是否命中，再看 YouTube 的表现。
