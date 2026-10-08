# 代理插件

本目录按功能保存 YouTube、Bilibili、闲鱼和 ChatGPT 插件。YouTube 提供 Loon、圈 X、Surge 和 Stash 共用的请求、响应脚本与各平台配置；Bilibili 以 Loon 为主入口，其他平台通过转换使用；闲鱼提供 Loon 与 Stash 插件；ChatGPT 提供 Loon、圈 X、Stash、Surge 的网络选择和可选本地日志。本页列出安装入口，其他平台配置、使用条件及排查方法请阅读对应目录的 README。

## 插件介绍

- **Bilibili 增强**：Loon 插件，过滤已识别的 JSON 开屏及首页广告，可选推荐／导航过滤与默认关闭的本地开发日志。不保存令牌或原始正文，暂不处理 gRPC／Protobuf 广告。详见 [Bilibili 说明](Bilibili/README.md)。
- **ChatGPT 网络选择与本地日志**：支持 Loon、圈 X、Stash 和 Surge，手动选择直连或已有代理，可选本地元数据日志。默认不解密 ChatGPT。详见 [ChatGPT 说明](ChatGPT/README.md)。
- **YouTube 去广告**：支持 Loon、圈 X、Surge 和 Stash，清理已识别的广告配置和赞助卡片，可选后台播放、隐藏首页 Shorts、字幕翻译和本地日志。详见 [YouTube 说明](YouTube/README.md)。
- **闲鱼推送网络辅助**：提供 Loon 与 Stash 直连辅助及按客户端标识采集的本地开发日志；Loon 可选定时网络心跳检查官网连通性。不能唤醒 App、防止后台回收或维持卖家在线。详见 [闲鱼说明](Xianyu/README.md)。
- **搜索结果网站屏蔽**：Loon 插件，声明 iOS、iPadOS、macOS 支持，Google 优先，适配 Bing、百度的已识别网页结果；手动名单和远程订阅支持域名、通配符和二级域名关键词，隐藏匹配条目并保留正常结果；默认关闭的本地开发日志不采集搜索词、完整 URL、正文或凭据。需 MitM，效果待实机验证。详见 [搜索屏蔽说明](SearchFilter/README.md)。

## 安装方式

复制对应软件的安装 URL，在软件中添加远程插件、复写资源或模块。其他平台的具体配置步骤见各插件 README。

安装链接：

**搜索结果网站屏蔽**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/SearchFilter/SearchFilter.plugin
```

**Bilibili 增强**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/Bilibili/BilibiliEnhance.plugin
```

**ChatGPT 网络选择与本地日志**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.plugin
```

ChatGPT Stash 覆写插件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/ChatGPT.stoverride
```

**YouTube 去广告**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.plugin
```

圈 X 复写资源：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.snippet
```

Surge 模块：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.sgmodule
```

Stash 覆写插件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/YouTube/YouTubeNoAds.stoverride
```

圈 X 请使用原生复写资源，无需转换 Loon 插件或 Surge 模块。

**闲鱼推送网络辅助**

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/Xianyu/XianyuPushNetwork.plugin
```

闲鱼 Stash 覆写插件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/Xianyu/XianyuPushNetwork.stoverride
```

安装 URL 指向 GitHub `main` 分支。更新时在 Loon 刷新插件，并刷新脚本缓存／重新下载对应脚本。GitHub 已发布不等于手机已经加载新版，具体检查步骤见各插件的详细说明。
