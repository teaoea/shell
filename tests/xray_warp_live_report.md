# Xray WARP 出站验证记录

记录日期：2026-10-23（任务环境日期）。服务器测试时钟显示 2026-10-22；不使用服务器日志时间证明持续运行时长。

## 版本与环境

- 被测代码：`2692ed7`，`install/install_xray.sh`。
- 安装脚本 SHA-256：`e917f3408136f975ea8622668debbf43fd9addaebe3ac29a069c0b16d4ec37ab`。本地提交内容与 VPS 从 GitHub Raw 获取的内容一致。
- 测试 VPS：用户指定的 `ssh dmit`，重建后的 Debian 13.7、x86_64、systemd。
- 正式服务：官方安装器安装的 Xray 26.10.21，提交 `1b1647c`，Linux amd64；以 `xray:xray` 运行。
- 公网测试端：本机 macOS arm64，官方 Xray 26.10.21 客户端；下载包 SHA-256 与官方 `.dgst` 文件一致。
- wgcf：2.3.1，校验下载包后实际注册账户，后续三次重跑复用账户。
- 测试选项：IPv4v6、关闭系统网络优化、REALITY TCP 443、Shadowsocks TCP/UDP 8443。
- 所有安装都从 GitHub Raw 下载执行，未向 VPS 直接上传本地安装脚本。

## 本地检查

| 检查 | 结果 | 退出码 |
| --- | --- | --- |
| `python3 tests/xray_installer_test.py` | 30 项通过 | 0 |
| `bash -n install/install_xray.sh` | 通过 | 0 |
| `git diff --check` | 通过 | 0 |
| 真实 Xray 26.10.21 配置解析 | 5 种出口选择（含留空）× 3 种 WARP 范围，共 15 个组合通过 | 0 |

本地检查使用隔离目录和模拟服务；配置解析使用测试密钥。它们不代表真实网络连通性。新增检查覆盖正式入口检测、域名匹配、关闭 WARP 时跳过检测，以及检测失败后恢复原配置。

## 真实安装与公网链路

依次进行了全流量、指定域名、空域名列表、再次全流量四次 GitHub 安装。四次安装均退出 0；每次均经过临时 WireGuard 实例检测，以及正式 REALITY、Shadowsocks 入口检测。

公网检查读取最新 `/root/client_config`，在本机启动仅监听回环地址的临时 Xray 客户端。HTTP 请求经本机 SOCKS、VPS 公网代理入口到达目标站点，没有直连回退。客户端配置及日志保存在临时私有目录，结束后删除；未将凭据写入本记录。

| WARP 范围 | 公网入口 | `www.cloudflare.com/cdn-cgi/trace` | `1.1.1.1/cdn-cgi/trace` | 退出码 |
| --- | --- | --- | --- | --- |
| 全流量，服务重启后 | REALITY / Vision | `warp=on` | `warp=on` | 0 |
| 全流量，服务重启后 | Shadowsocks | `warp=on` | `warp=on` | 0 |
| 仅 `www.cloudflare.com` | REALITY / Vision | `warp=on` | `warp=off` | 0 |
| 仅 `www.cloudflare.com` | Shadowsocks | `warp=on` | `warp=off` | 0 |
| 域名列表留空 | REALITY / Vision | `warp=off` | `warp=off` | 0 |
| 域名列表留空 | Shadowsocks | `warp=off` | `warp=off` | 0 |
| 最终全流量，再次重启后 | REALITY / Vision | `warp=on` | `warp=on` | 0 |
| 最终全流量，再次重启后 | Shadowsocks | `warp=on` | `warp=on` | 0 |

共 16 次公网 HTTPS 检查符合预期。最终全流量模式还通过两个公网入口分别转发 UDP DNS 请求至 `1.1.1.1:53`，查询 `example.com` 的 A 记录；均收到 ID 匹配、响应码为 0、含 2 条答案的 DNS 响应，检查退出 0。

## 最终状态

- `systemctl is-active xray`：`active`，退出 0。
- `systemctl is-enabled xray`：`enabled`，退出 0。
- 重启后只发现一个正式 Xray 进程；临时检查实例已退出。
- 账户文件哈希与首次注册后的哈希一致，`sha256sum -c` 返回 `OK`、退出 0。
- WARP Endpoint：实测通过的 `162.159.192.1:2408`；使用账户 API 返回的实际 Reserved 字节。
- 留在全流量 WARP 模式，出口选择 IPv4v6。
- `/root/client_config`：`600 root:root`，包含 `[loon]`、`[quantumult-x]`、`[surge]`、`[mihomo]`。
- `/var/lib/xray-warp`：`700 root:root`；账户文件：`600 root:root`。
- `/usr/local/etc/xray/config.json`：`640 root:xray`。
- 未安装系统 WireGuard 服务、未调整系统路由、未修改防火墙。

## 验证边界

本次真实验证覆盖 Debian 13.7 与 Xray 26.10.21。红帽系只有现有模拟检查，本次未在红帽系 VPS 上部署；未用 Loon、圈 X、Surge、Mihomo 应用实机验收，也未进行长期稳定性或吞吐测试。

此前 Xray 26.3.27 测试中的偶发超时没有确认根因。本次新版和重建环境的成功不能单独证明历史超时由哪一个因素导致。安装器新增的正式入口检测用于防止仅凭独立 WireGuard 检测成功就宣布完整安装可用。
