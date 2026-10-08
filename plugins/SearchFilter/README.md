# 搜索结果网站屏蔽 · Loon

<img src="assets/search-filter.jpg" width="80" alt="搜索结果网站屏蔽图标">

**v1.1.0** · 作者：可莉唯一的狗、ChatGPT

从搜索结果中移除命中黑名单的网站，保留其他正常结果。名单通过本地网页管理，支持远程订阅，无需浏览器扩展。

适用于运行 Loon 的 iOS、iPadOS 和 macOS。不限制浏览器；搜索流量需要经过 Loon，并开启脚本与 HTTPS MitM、安装并信任证书。macOS 的安装条件以 [Loon App Store 页面](https://apps.apple.com/app/loon/id1373567447)为准。

## 安装与使用

在 Loon 中添加远程插件：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/SearchFilter/SearchFilter.plugin
```

1. 启用插件、脚本与 HTTPS MitM，并信任 Loon 证书。
2. 运行插件里的 **添加黑名单**，点击通知打开名单页；也可直接访问 [本地名单页](http://search-filter-list.invalid/)。
3. 勾选需要过滤的搜索引擎，点击 **保存设置**。引擎选择对整份本地名单与订阅生效。
4. 点击 **domain-keyword** 或 **domain-suffix**，填写内容后 **添加并保存**。支持粘贴多行规则，以及逐条编辑、删除。
5. 重新发起搜索，查看过滤结果。

Google、Bing、百度初始默认勾选，其他引擎需手动选择。更新会保留本地网页中已保存的名单与设置；更新后刷新插件和脚本缓存，再重新打开名单页。

## 页面样式

<img src="assets/list-preview.png" width="390" alt="手机名单页：搜索引擎复选框、规则列表与类型快捷按钮">

*手机尺寸浏览器预览；图片中的名单仅为示例。页面随系统切换浅色与深色样式。*

## 支持的搜索引擎

| 搜索引擎 | 网页搜索入口 |
| --- | --- |
| Google、Bing、百度 | 已登记的常用桌面与移动入口 |
| DuckDuckGo | 标准版及 HTML 版 |
| Yahoo | 国际站、部分地区站及日本站 |
| Brave、Yandex | 已登记的网页搜索入口；Yandex 包含移动搜索路径 |
| 搜狗、360 搜索 | 桌面与移动网页入口 |
| 神马 | 手机网页搜索入口 |
| Ecosia、Startpage | 已登记的网页搜索入口 |

过滤普通网页搜索中能明确识别目标域名的结果。图片、视频、新闻专页、AI 回答、广告与未知布局不保证覆盖；无法确定目标的网站条目会保留。当前处理 HTTPS GET 搜索页面，Startpage 的 POST 搜索不在覆盖范围内。

## 名单格式

**每行一条，冒号后留半角空格，不支持通配符。**

```text
domain-keyword: example
domain-suffix: example.com
domain-suffix: blog.example.org
```

| 类型 | 匹配方式 | 示例 |
| --- | --- | --- |
| `domain-keyword: example` | 倒数第二个域名标签完全匹配 | 匹配 `example.com`、`example.net`、`blog.example.net`；不匹配 `notexample.com` |
| `domain-suffix: example.com` | 指定域名本身及全部子域名 | 匹配 `example.com`、`blog.example.com`；不匹配 `example.net` |
| `domain-suffix: blog.example.org` | 指定子域名及其下层 | 不匹配父域名 `example.org` 或其他同级子域名 |

关键词不按标题、正文或任意子串匹配，也不推断注册域名；例如 `example.com.cn` 的倒数第二个标签是 `com`。裸域名、完整 URL 和带 `*` 的规则无效，中文域名请填写 Punycode。重复规则自动合并，本地名单最多 100 条。

## 订阅与可选设置

在名单页展开 **搜索排除与远程订阅**：

- **远程订阅**：填写公开 HTTPS 文本直链，先保存设置，再更新订阅。正文使用上面的每行规则格式，最多 100 条。与本地名单合并匹配；更新失败保留有效缓存，清空地址并保存可停用。
- **额外搜索排除**：默认关闭。在支持的引擎上为域名后缀规则追加 `-site:` 条件；其他规则仍由结果过滤处理。关闭后，已有搜索词中的排除条件需手动删除。

## 日志与隐私

Loon 参数中的 **日志工具** 默认关闭。开启后自动开始记录，并通知打开 [本地日志页](http://search-filter-logs.invalid/)，可查看、导出、暂停或清空日志。

日志仅保留固定搜索入口、处理状态与计数，不记录搜索词、完整 URL、结果内容、凭据、黑名单或订阅地址，也不会自动上传。名单与设置保存在本机 Loon，不跨设备同步。

若仍显示命中条目，请先确认名单格式、引擎勾选及保存状态，再重新搜索。开启日志后，可分别导出 Loon 日志与搜索页面状态按钮中的脱敏诊断。

普通结果的初始移除与动态过滤已通过自动化和浏览器样例检查；各引擎在实际设备上的布局仍可能不同。动态结果过滤需要浏览器允许页面脚本执行。
