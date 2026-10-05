# 闲鱼推送网络辅助

针对「锁屏后不提醒，打开闲鱼才看到消息」以及「通知晚几分钟」提供闲鱼业务域名与 APNs 直连规则，用于排查代理路径、规则拒绝或连接不稳定。仅当问题来自这些网络因素时才可能改善提醒。

这不是闲鱼保活插件，不能定时唤醒闲鱼、阻止 iOS 回收后台、保证买家看到卖家在线，也不能代替闲鱼服务器发送消息推送。没有定时请求或心跳脚本：访问闲鱼首页、刷新 Cookie 或获取登录令牌，不能证明消息实时送达或维持卖家在线。

## 安装与更新

- [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fteaoea%2Fshell%2Fmain%2Floon%2FXianyu%2FXianyuPushNetwork.plugin)
- [插件安装 URL](https://raw.githubusercontent.com/teaoea/shell/main/loon/Xianyu/XianyuPushNetwork.plugin)
- [返回插件总览](../README.md)

```text
https://raw.githubusercontent.com/teaoea/shell/main/loon/Xianyu/XianyuPushNetwork.plugin
```

在 iPhone／iPad 上点击一键导入，在 Loon 中确认添加并启用；如浏览器没有唤起 Loon，复制上面的安装 URL，在 Loon 插件页面添加远程插件。使用分流模式，无需开启 MitM 或提供账号凭据。

`XianyuPushNetwork.plugin` 是唯一插件入口，只有分流规则，没有额外脚本。安装 URL 指向 GitHub `main` 分支，更新时刷新插件；停用或删除该插件即可恢复原分流。若之前手动复制过本插件规则到本地配置，需要单独删除那些规则，否则停用远程插件后本地规则仍会生效。

当前没有 iPhone 实机验证结果，不能宣称修复了消息延迟。

## 规则及影响

需要支持逻辑规则的 Loon 3.1.7 或更新版本，并在分流模式下测试。

| 规则 | 范围与依据 |
| --- | --- |
| `DOMAIN-SUFFIX,goofish.com,DIRECT` | 闲鱼官网及子域名，包含 `acs.m.goofish.com`、`h5api.m.goofish.com`、`passport.goofish.com` 等接口；官网和开源接口实现可确认相关用途。 |
| `DOMAIN,wss-goofish.dingtalk.com,DIRECT` | 开源实现使用的闲鱼网页版 WebSocket 消息端点；不代表 iOS App 一定使用此主机。 |
| `DOMAIN,acs.m.taobao.com,DIRECT` | 社区闲鱼／淘宝插件中可见闲鱼接口的共享网关；精确匹配主机，也会使同一主机上其他 App 的请求直连。 |
| `DOMAIN-SUFFIX,push.apple.com,DIRECT` | Apple 推送域名及子域名。 |
| APNs IP 逻辑规则，共 18 条 | Apple 官方列出的五个 IPv4、四个 IPv6 APNs 网段，只有 TCP 5223 和 TCP 443 连接设为 `DIRECT`。IP 子规则带 `no-resolve`，不为其他域名增加 DNS 查询。 |

共 22 条直连规则。域名规则覆盖目标域名下的 URL，无需按 HTTPS 路径解密。未添加 `taobao.com`、`dingtalk.com`、`alicdn.com` 全域直连；覆盖范围不等于闲鱼所有版本的完整端点清单。

没有可靠资料确认闲鱼独占的固定 IP 网段，因此没有添加闲鱼业务的 IP-CIDR 规则，也不会把 DNS 单次解析得到的地址扩成网段。域名分流适合地址随 DNS 调度变化的服务；若 App 使用纯 IP／HTTPDNS 且 Loon 无法关联域名，本次新增的域名规则可能不命中，需要依据实机连接记录再补。

APNs 是所有 App 共用的 Apple 推送连接，不能仅针对闲鱼设置。直连是否更稳定取决于当前网络；如果原来已经直连，插件可能没有额外效果。官方网段列表也不是所有可能的 APNs 地址，未命中的连接继续按原配置处理。

规则只更改所列连接的出口策略，不修改业务 API 的请求或响应、DNS、系统通知设置或 App 的后台运行权限。插件不包含 MitM、Rewrite、JavaScript 或账号凭据。**DIRECT 分流不等于禁用其他配置中的 MitM 或 Rewrite**；如已有配置解密 Apple 推送域名，应单独将它们排除在解密范围外。其他插件仍可能通过 Rewrite／脚本拒绝闲鱼请求，新增直连规则不会自动取消这些处理。

Loon 官方规则优先级为本地规则 > 插件规则 > 订阅规则；有域名时先匹配域名规则。已有本地域名规则仍可能把闲鱼或 APNs 送去代理或拒绝，需要看实际连接记录，不能只凭插件启用状态判断已生效。系统推送流量如果没有经过 Loon，插件也不会改变它。

## 在 iPhone 上测试

优先使用上面的安装 URL 添加远程插件，便于开关对比。如果需要检查本地规则冲突，也可以先备份配置，再把插件文件 `[Rule]` 下的非注释规则复制到现有本地 `[Rule]` 段，并放在冲突的本地规则前面。不要重复粘贴插件元信息或创建第二个 `[Rule]` 段。以本地规则测试时，回滚需要删除本次添加的规则。

1. 在 iPhone「设置 → 通知 → 闲鱼」允许通知，开启锁定屏幕、横幅、声音；如存在立即推送选项，选立即推送，并从定时推送摘要中移除闲鱼。在常用专注模式中允许闲鱼通知。再检查闲鱼 App 自身的消息通知选项和对应会话是否静音。实际菜单名称以设备版本为准。
2. 打开闲鱼确认已经登录，再正常返回主屏幕并锁屏，不从多任务界面划掉 App。
3. 请另一账号在锁屏约 2、10、30 分钟后发送不同的测试消息。分别记录发送时间、通知出现时间，以及打开闲鱼后消息是否才出现。
4. 对比原 Loon 配置、本规则启用、临时关闭 Loon 三种情况，每种重复测试。Wi-Fi 和蜂窝数据分别测试，避免把不同网络的结果混在一起。
5. 改分流后，已有长连接可能仍沿用原路径；可在方便时重连一次 Loon，再开始同条件测试。查看 Loon 连接记录，确认实际出现的闲鱼域名／接口网关及可见的 APNs 连接最终策略是 `DIRECT`。不要求网页版消息域名在 iOS App 中出现，不要求 APNs 一定可见，也不能用普通 HTTP 请求成功来替代 APNs 长连接验证。

如果关闭 Loon 后也同样延迟，不能据此断言一定是闲鱼服务器问题，但说明继续添加直连规则未必有效。如果本规则改善延迟，仍应多次锁屏复测；如果变差，恢复原配置。

## 在线状态的验证边界

需用另一个账号观察锁屏后卖家的「在线／最近活跃」显示，记录其变化。消息通知及时、APNs 连接成功以及闲鱼业务请求成功，都不能证明卖家在线。当前插件没有维护闲鱼消息会话，因此没有持续在线能力。

现有开源网页版消息实现使用认证后的 WebSocket 会话、心跳和令牌刷新。Loon 公开脚本 API 列表没有 WebSocket 客户端；在只使用 iPhone 上 Loon 的限制下，目前没有已验证的实现路径。即使未来找到 HTTP 轮询接口，也要验证认证、未读状态和副作用，不能直接把它称为在线保活。

## 资料

- [闲鱼官方网站](https://www.goofish.com/)
- [开源参考：XianyuAutoAgent 的登录与业务接口](https://github.com/shaxiu/XianyuAutoAgent/blob/main/XianyuApis.py)
- [社区插件参考：闲鱼与淘宝共享接口网关](https://github.com/Thelongdarkorg/loon-plugins)（只参考端点，不引入其去广告规则）。
- [Apple：设备无法收到推送通知时的主机、端口与网段](https://support.apple.com/zh-cn/102266)
- [Apple：企业网络主机列表与 HTTPS 解密限制](https://support.apple.com/zh-cn/101555)
- [Apple：通知设置、定时摘要与专注模式](https://support.apple.com/zh-cn/guide/iphone/iph7c3d96bab/ios)
- [Apple：用户可见通知与 App 是否运行的关系](https://developer.apple.com/documentation/usernotifications)
- [Apple：iOS 后台执行限制](https://developer.apple.com/forums/thread/685525)
- [Loon：规则优先级](https://nsloon.app/docs/Rule/)
- [Loon：逻辑规则](https://nsloon.app/docs/Rule/logic_rule/)
- [Loon：IP 规则与 no-resolve](https://nsloon.app/docs/Rule/ip_rule/)
- [Loon：公开脚本 API](https://nsloon.app/docs/Script/script_api/)
- [Loon：URL Scheme 与一键导入通用链接](https://nsloon.app/docs/Scheme/)
- [开源参考：XianyuAutoAgent 的消息连接实现](https://github.com/shaxiu/XianyuAutoAgent/blob/main/main.py)（非闲鱼官方接口文档，尚未用你的账号验证）。
