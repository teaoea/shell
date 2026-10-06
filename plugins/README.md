# 代理插件

本目录按功能保存 YouTube、闲鱼和 ChatGPT 插件。YouTube 提供 Loon、圈 X 和 Surge 共用的请求、响应脚本与各平台配置；闲鱼提供 Loon 插件；ChatGPT 提供 Loon、圈 X、Stash、Surge 的网络选择和可选本地日志。本页列出安装入口，其他平台配置、使用条件及排查方法请阅读对应目录的 README。

## 插件介绍

- **ChatGPT 网络选择与本地日志**：支持 Loon、圈 X、Stash 和 Surge，手动选择直连或已有代理，可选本地元数据日志。默认不解密 ChatGPT。详见 [ChatGPT 说明](ChatGPT/README.md)。
- **YouTube 去广告**：支持 Loon、圈 X 和 Surge，清理已识别的广告配置和赞助卡片，可选后台播放、隐藏首页 Shorts、字幕翻译和本地日志。详见 [YouTube 说明](YouTube/README.md)。
- **闲鱼推送网络辅助**：提供 Loon 直连辅助及按客户端标识采集的本地开发日志。不能唤醒 App 或维持卖家在线。详见 [闲鱼说明](Xianyu/README.md)。

## 安装方式

在安装了 Loon 的 iPhone／iPad 上，点击下方「一键导入 Loon」，进入 Loon 后确认添加并启用插件。浏览器没有唤起 Loon 时，复制「插件安装 URL」的链接地址，在 Loon 插件页面添加远程插件。

安装链接：

**ChatGPT 网络选择与本地日志**

[一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Fplugins%2FChatGPT%2FChatGPT.plugin) · [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.plugin)

**YouTube 去广告**

[一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Fplugins%2FYouTube%2FYouTubeNoAds.plugin) · [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.plugin)

**闲鱼推送网络辅助**

[一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Fplugins%2FXianyu%2FXianyuPushNetwork.plugin) · [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/plugins/Xianyu/XianyuPushNetwork.plugin)

安装 URL 指向 GitHub `main` 分支。更新时在 Loon 刷新插件，并刷新脚本缓存／重新下载对应脚本。GitHub 已发布不等于手机已经加载新版，具体检查步骤见各插件的详细说明。

一键导入使用 [Loon 官方 URL Scheme 与通用链接](https://nsloon.app/docs/Scheme/)，插件地址已进行 URL 编码。
