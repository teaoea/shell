# 代理插件

本目录按功能保存 YouTube 和闲鱼插件。YouTube 提供 Loon、圈 X 和 Surge 共用的请求、响应脚本与各平台配置；闲鱼提供 Loon 插件。本页列出 Loon 安装入口，其他平台配置、使用条件及排查方法请阅读对应目录的 README。

## 插件介绍与安装

| 插件 | 功能介绍 | 使用条件 | 安装与详细说明 |
| --- | --- | --- | --- |
| YouTube 去广告 | 清理已识别的播放器广告配置、首页／推荐／搜索赞助卡片及 Shorts 广告；可选后台播放、隐藏首页 Shorts 和本地日志导出。当前包含初始化空视频实验，不能保证所有视频无广告或零启动等待。 | 仅 iOS/iPadOS，暂不支持 Apple TV/tvOS；建议 Loon 3.5.1 Build 983 或更新版本；需开启 MitM 并信任证书，能下载插件及其两份发布脚本。 | [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Fplugins%2FYouTube%2FYouTubeNoAds.plugin) · [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.plugin) · [详细说明](YouTube/README.md) |
| 闲鱼推送网络辅助与开发日志 | 闲鱼及 Apple 推送连接直连辅助；新增图标、按客户端标识采集的请求／响应日志，单文件导出 URL 与字面 IP 清单，供广告和连接策略开发。客户端标识不等于进程归属证明，不能采集所有纯 IP 连接；不能唤醒 App 或维持在线。 | Loon 3.5.1 Build 983+，使用分流模式；仅分流无需 MitM，HTTPS 日志需 MitM 和证书。日志默认关闭，共享网关和 APNs 分流也影响其他 App；尚待实机验证。 | [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Fplugins%2FXianyu%2FXianyuPushNetwork.plugin) · [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/plugins/Xianyu/XianyuPushNetwork.plugin) · [详细说明](Xianyu/README.md) |

## 安装方式

在安装了 Loon 的 iPhone／iPad 上，点击表格中的「一键导入 Loon」，进入 Loon 后确认添加并启用插件。浏览器没有唤起 Loon 时，复制「插件安装 URL」的链接地址，在 Loon 插件页面添加远程插件。

可直接复制的安装 URL：

**YouTube 去广告**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.plugin
```

**闲鱼推送网络辅助**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/Xianyu/XianyuPushNetwork.plugin
```

安装 URL 指向 GitHub `main` 分支。更新时在 Loon 刷新插件，并刷新脚本缓存／重新下载对应脚本。GitHub 已发布不等于手机已经加载新版，具体检查步骤见各插件的详细说明。

一键导入使用 [Loon 官方 URL Scheme 与通用链接](https://nsloon.app/docs/Scheme/)，插件地址已进行 URL 编码。
