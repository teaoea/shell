# 搜索结果网站屏蔽（Loon）

版本：`1.0.0`。作者：可莉唯一的狗、ChatGPT。

在 Loon 中手动配置黑名单或远程订阅，隐藏搜索页面中目标域名匹配的结果条目，并保留其他普通结果。主要支持 Google，同时适配 Bing、百度的已识别网页结果。不限浏览器，不按浏览器名称或 User-Agent 过滤请求；无需制作或安装浏览器扩展。插件没有网站访问拒绝规则：验收标准是搜索条目消失，而非链接无法访问。

例如在“屏蔽网站名单”中填写：

```text
csdn
*.example.net
blog.example.org
```

## 安装与设置

在 Loon 中添加以下远程插件地址：

```text
https://raw.githubusercontent.com/teaoea/shell/main/plugins/SearchFilter/SearchFilter.plugin
```

1. 在 Loon 添加上面的远程插件并启用，插件会引用同目录的请求、页面过滤和订阅更新脚本。
2. 开启 Loon 的脚本和 HTTPS MitM，安装并信任 Loon 证书；仅安装插件不足以处理 HTTPS 搜索请求。
3. 在插件参数的“屏蔽网站名单”输入域名、通配符或域名段关键词，多个用空格、英文／中文逗号或分号分隔。默认留空，不预设任何被屏蔽网站。
4. Google、Bing、百度有独立开关，默认开启。“额外追加搜索排除条件”默认关闭，默认保持查询词原样，仅过滤结果页面。
5. 在任意浏览器发起新搜索。已识别的匹配条目会隐藏；页面后续插入或更新的已识别条目也会检查。

更新时刷新插件和脚本缓存。网站名单在每台设备的 Loon 中设置，不自动跨设备同步。

## 名单规则

- 输入 `csdn`，按二级域名标签匹配，覆盖 `csdn.com`、`csdn.net`、`blog.csdn.net`；不匹配 `notcsdn.com` 或 `csdn.example.org`。这里的“二级域名标签”严格指倒数第二个标签，例如 `blog.csdn.net` 中的 `csdn`；不提供 Public Suffix List 注册域名推断，因此 `csdn.com.cn` 的倒数第二个标签是 `com`。不按结果标题或正文中的“csdn”删除正常网站。
- 输入 `*.csdn.*`，匹配 `csdn.com`、`csdn.net` 及其子域名；不匹配 `notcsdn.net` 或 `csdn.net.evil.com`。开头的 `*.` 可匹配零级或多级子域名；其他 `*` 只匹配当前域名段中的零个或多个字符，不跨越 `.`。
- 输入 `example.com`，页面过滤匹配该域名及其子域名。输入 `blog.example.com`，不自动扩展为 `example.com`。
- 输入 `https://blog.example.com/article`，仅取 `blog.example.com`，不提供单篇文章或路径级屏蔽。
- 重复规则合并，大小写统一。不接受端口、IP、用户名密码。中文域名请填写 Punycode，如 `xn--…`；不自动猜测转换。
- 原始名单超过 8192 字符或某层过滤的有效规则超过 100 条，该层放行。请求条件排除和页面过滤分别校验各自可用条目；无效条目忽略。建议先用少量规则核对边界。

## 远程订阅

在插件参数“远程名单订阅 URL”填写公开 HTTPS 文本直链，保存后运行“更新搜索屏蔽订阅”。插件启用时每小时整点尝试更新；Loon 的系统调度不保证设备休眠或锁屏时准时运行。搜索时只读取本地缓存，不等待远程下载。

每行一条规则，支持空行、`#` 和 `//` 开头的整行注释，类型和域名不区分大小写：

```text
# 匹配倒数第二标签为 csdn 的域名，覆盖 .com、.net 等
[key: csdn]

# 匹配 csdn.com 本身及其所有子域名
[url: *.csdn.com]
```

| 规则 | 隐藏 | 保留 |
| --- | --- | --- |
| `[key: csdn]` | `csdn.com`、`csdn.net`、`blog.csdn.net` | `notcsdn.com`、`csdn.example.com` |
| `[url: *.csdn.com]` | `csdn.com`、`blog.csdn.com`、`a.blog.csdn.com` | `csdn.net`、`blog.csdn.net`、`csdn.com.evil.net` |

所有本地和订阅规则按“任一命中即隐藏”合并。**只想屏蔽 `.com` 而保留 `.net` 时，订阅仅保留 `[url: *.csdn.com]`，同时确认本地名单没有 `csdn`、`*.csdn.*` 或 `csdn.net`，远程没有 `[key: csdn]`。** 添加较窄规则不会覆盖较宽规则；没有白名单或优先级例外语法。

`key` 是单个标签，不支持通配符；`url` 是域名模式，不是完整网页 URL，不支持路径或端口。`[url: csdn.com]` 也覆盖该域名及其子域名。订阅最多 100 条去重规则，正文最多 256 KiB；与本地最多 100 条规则合并使用。格式错误、非 200、下载或保存失败均保留上次有效缓存，不用部分有效行覆盖旧名单。空文件或仅注释的文件视为有意清空远程名单。

修改订阅 URL 后，旧地址的缓存不再参与过滤，直到新地址成功更新；订阅 URL 留空立即停用远程规则，本地规则继续生效。删除某条订阅规则后需先更新订阅并重新加载页面。更新失败的旧名单没有自动过期，请通过手动更新结果判断是否使用了最新订阅。

订阅更新由 Loon 独立发出 HTTPS 请求，不复制搜索浏览器的 Cookie、Authorization 或搜索词。建议使用公开、不带凭据的 HTTPS 文本直链；插件本身无跨设备同步，每台设备各自缓存。

## 支持范围

| 搜索引擎 | 明确覆盖的主机与入口 | 状态 |
| --- | --- | --- |
| Google | `google.com`、`google.com.hk`、`google.com.tw`、`google.co.jp`、`google.co.uk`，以及各自的 `www`；`/search?q=…` | 主要适配：`#search`／`#rso` 下带 `h3` 的单结果 `.g`／`.MjjYud` 等容器 |
| Bing | `bing.com`、`www.bing.com`、`cn.bing.com`；`/search?q=…` | 适配 `li.b_algo` 普通结果和已识别的编码跳转链接 |
| 百度 | `baidu.com`、`www.baidu.com`、`m.baidu.com`；`/s?wd=…` 或 `/s?word=…` | 适配 `.result`／`.c-container`；依据真实链接、明确的目标 URL 或显示的完整域名 |

只处理 HTTPS GET。Google 图片、新闻等 `tbm` 页面和除 `udm=14` 外的特殊 `udm` 页面放行；百度仅处理上述普通入口，已带其他垂直搜索 `tn` 标记时放行。POST、搜索建议、翻译、登录、其他主机、其他搜索引擎不处理。百度移动端 `/from=…/s` 等嵌套路径暂未覆盖。

iOS、iPadOS、macOS 共用同一插件。不限制 Safari、Chrome、Firefox、Edge 或其他浏览器，只要搜索请求经过 Loon 并成功解密，就会进入相同处理逻辑；结果隐藏还需要浏览器支持并允许 JavaScript、页面 CSP 允许注入脚本且结果布局已被识别。不能据此声称已在每种浏览器上实测。

浏览器内置代理、独立 VPN、隐私转发等路径如果实际绕过 Loon，插件无法处理该流量；禁用页面脚本的浏览器无法执行页面过滤，但可以尝试精确域名的可选请求条件。macOS 还受 Loon 自身安装条件约束：[Loon App Store](https://apps.apple.com/us/app/loon/id1373567447?platform=mac) 当前列出的 Mac 要求是 macOS 11 或更高、Apple M1 或更新芯片；不承诺 Intel Mac 可用。三套系统均尚未完成实机验证。

## 效果与排查

插件通过 Loon 修改搜索 HTML，在页面中加入本地过滤脚本，按真实目标域名隐藏对应的已识别结果容器，不改写正常结果的链接、标题或摘要。容器含多个标题、目标域名不明、布局不认识时保留，避免误删邻近结果。只提到被屏蔽网站的正常页面会保留。脚本监听动态结果；同一容器被复用为正常结果时恢复原来的显示属性。

百度不透明的 `/link?url=…` 不能直接解出域名；只有明确目标 URL 或显示完整域名才过滤，不根据“CSDN 官方网站”这样的名称猜测。广告、AI 回答、知识卡片、图片／视频结果以及未知布局目前不保证覆盖。

页面过滤仅处理 HTTP 200、`text/html`、含闭合 `body` 且正文不超过 4 MiB 的响应。保留原页面的内容安全策略（CSP），可复用既有脚本 nonce；如果策略不允许注入脚本且没有可用 nonce，页面放行，精确域名的可选搜索条件仍可尝试排除。不会删除 CSP 来强行执行脚本。严格策略、浏览器禁用脚本、动态片段无初始注入等情况可能导致页面过滤未运行。过滤在浏览器脚本执行后隐藏条目，不能保证首次绘制前完全没有短暂显示。

插件自身不记录搜索词、不持久化浏览记录。只有配置订阅时才请求远程名单，并在本机缓存规则、来源 URL 和更新时间。页面中的规则可被当前搜索页面脚本读取；开启额外条件后，精确域名还会随查询发送给当前搜索引擎。

可选的“额外追加搜索排除条件”只对精确域名追加 `-site:`，帮助搜索引擎直接返回更多未屏蔽结果；关键词、通配符始终由页面过滤。已存在的相同排除条件不重复追加，改写 URL 超过 16384 字符放行。Google 官方支持网站排除；Bing 文档说明只使用前 10 个搜索词，长名单可能失效；百度执行 `-site:` 的效果待实测。这些限制不替代页面条目过滤。

验收时保持额外条件关闭，选一个能同时搜到目标域名和正常网站的关键词：先保存关闭插件时的结果，再开启插件、名单填 `csdn` 并重新搜索。目标条目应消失，邻近正常网站应保留；再翻页或滚动加载检查动态条目。也要测试 `notcsdn.com` 不误删。不能仅凭请求成功、HTTP 200 或脚本命中判断过滤成功。

如果条目未消失，检查名单、总开关和引擎开关、Loon 脚本缓存、实际主机与路径、MitM 证书是否信任、浏览器流量是否绕过 Loon、页面 CSP 和结果布局。HTTP/3／QUIC 连接若未进入可解密脚本链路，需要在 Loon 中针对实际搜索主机配置回退或使用可处理的连接；本插件没有自动拒绝 QUIC 的规则。缓存页面需要重新发起搜索。

关闭插件或总开关后重新加载页面，即可恢复结果；已打开页面中的过滤脚本不会被远程撤回。如果曾开启额外条件，已进入搜索框、地址栏、历史或分页链接的旧条件需要手动删除后重新搜索。

## 验证状态与来源

本地模拟测试覆盖 Google、Bing、百度请求改写，二级域名关键词／通配符／精确域名匹配，跳转链接识别，邻近正常结果保留，动态容器更新和恢复，CSP 放行、订阅解析与缓存、订阅失败保留、URL 切换隔离及配置主机边界。DOM 测试使用模拟容器，不等同于真实浏览器渲染或当前搜索引擎页面布局验证。尚未在真实 Loon 中导入验证，未实测各浏览器或三家引擎返回的搜索结果；GitHub 发布与下载检查也不等于设备已加载或过滤效果已确认。

- [Loon 插件参数和系统声明](https://nsloon.app/docs/Plugin/)
- [Loon 请求脚本 API](https://nsloon.app/docs/Script/script_api/)
- [Google 官方网站排除说明](https://support.google.com/websearch/answer/134479?hl=en-GB)
- [Bing 高级搜索关键词](https://support.microsoft.com/en-us/bing/advanced-search-keywords)
- [Bing 高级搜索选项与词数限制](https://support.microsoft.com/en-us/bing/advanced-search-options)
- [百度官方网页搜索帮助](https://www.baidu.com/search/page_feature.htm)

测试命令：

```text
node --test plugins/SearchFilter/tests/SearchFilter.test.mjs
```
