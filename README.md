# VPS 安装与网络优化脚本

本仓库提供 Xray、Hysteria 2 + Cloudflare WARP 的安装脚本，以及 Debian 的 IPv4/IPv6 出站优先级调整脚本。运行前请阅读对应脚本，并确认 VPS 的系统、端口和防火墙配置符合要求。需要修改系统配置的操作均应以 root 身份执行；如果已经登录 root，以下命令可省略 `sudo`。

| 脚本 | 用途 | 适用系统 |
| --- | --- | --- |
| [`install_xray.sh`](install_xray.sh) | 安装 Xray，配置 VLESS + REALITY + XTLS Vision，生成 Loon 节点信息 | 使用 systemd 的 Debian、Ubuntu、CentOS、RHEL、Fedora、Rocky Linux、AlmaLinux 或 Oracle Linux |
| [`install_ hysteria2_warp.sh`](install_%20hysteria2_warp.sh) | 安装 Hysteria 2 和 Cloudflare WARP，生成服务端配置 | 脚本包含 Debian、Ubuntu、CentOS、RHEL、Fedora 的安装分支；还要求系统具备 UFW |
| [`networt_optimization.sh`](networt_optimization.sh) | 选择 IPv4 或 IPv6 出站优先，保留双栈并应用保守的 TCP 优化 | IPv4 模式支持 Debian；IPv6 模式支持 Debian 13 |

## Xray

在 VPS 上用一条命令运行 GitHub `main` 分支的脚本：

```bash
xray_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install_xray.sh) && sudo bash -c "$xray_script"
```

脚本要求 root 权限，默认使用 TCP 443 和 `apple.com` 作为 REALITY 伪装域名。它调用 Xray 官方安装器，生成 VLESS + REALITY + XTLS Vision 服务端配置，校验后启动服务，并在终端打印可粘贴到 Loon `[Proxy]` 段的节点。已有的 Xray 服务端配置会在安装前备份，安装失败时尝试恢复。

`--yes` 跳过安装确认；`--port` 修改监听端口；`--loon-address` 指定要写入 Loon 节点的 IPv4 或 IPv6 地址。未指定地址时，脚本优先检测公网 IPv4，失败后尝试 IPv6。也可用 `XRAY_PORT`、`LOON_SERVER_IP` 和 `REALITY_SERVER_NAME` 环境变量设置对应参数。使用本地脚本时，可运行 `sudo bash install_xray.sh --help` 查看完整用法。

脚本仅校验 Xray 服务端配置及服务状态，不测试客户端到 VPS 的公网连通性。Loon 节点配置只打印在终端，不再写入 `/root/xray-reality-client.txt`；请自行保存输出并妥善保管连接凭据。防火墙、云安全组及网络优先级需按实际环境单独配置；脚本不修改这些设置。

安装后可用 `systemctl status xray` 查看服务状态。

如需重跑脚本，新的 UUID、密钥和 Short ID 会替换旧配置，Loon 中也要更新为最新输出。

## Hysteria 2 + Cloudflare WARP

```bash
hysteria_script=$(curl -fsSL --retry 3 'https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install_%20hysteria2_warp.sh') && sudo bash -c "$hysteria_script"
```

脚本会询问是否继续，只有输入小写 `y` 才会安装。它安装 Cloudflare WARP 和 Hysteria 2，配置 WARP SOCKS 代理端口 2333，将部分域名导向 WARP、其他流量直连，生成 `/etc/hysteria/config.yaml`，并在终端输出 Hysteria 2 密码。当前脚本使用自签名证书、默认域名 `bing.com`，监听 443，并为伪装站使用 80/443 端口。

**运行前检查：**脚本会执行 `ufw enable`，添加 22、80、443、2333 端口规则；若 SSH 并非使用 22 端口，须先确认防火墙放行实际 SSH 端口。它还会把证书私钥设为 `644`，请先评估是否符合服务器的权限要求。该脚本没有提供回滚功能，也未生成 Loon 客户端配置。Xray 默认占用 TCP 443；若同机运行两个安装脚本，需先规划端口，避免冲突。

## IPv4 / IPv6 网络优化

在 Debian VPS 上用一条命令运行 GitHub `main` 分支的脚本，并选择 IPv4 或 IPv6 模式：

```bash
network_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/networt_optimization.sh) && sudo bash -c "$network_script"
```

也可指定 `--ipv4` 或 `--ipv6`；非交互运行时还需加 `--yes`。IPv4 模式支持 Debian，IPv6 模式仅支持 Debian 13。脚本调整 `/etc/gai.conf` 的双栈地址选择顺序，设置 TCP Fast Open 和 MTU probing；内核支持时启用 BBR + FQ。IPv6 模式会启用 IPv6 协议栈，但不会配置 IPv6 地址、默认路由、DNS、防火墙或接口 MTU。IPv6 连接失败后的 IPv4 回退取决于应用自身是否支持多地址重试或 Happy Eyeballs。

应用前会把现有配置和运行时参数备份到 `/var/lib/network-optimizer/backups/`。脚本还支持 `--status` 查看状态并用 `curl` 分别测试 IPv4、IPv6 到 Cloudflare 固定 IP 的 HTTPS 直连，`--rollback` 恢复最近一次修改。直连测试不经过 DNS 或代理，失败也可能是测试目标不可达，不能单凭结果判断整个网络。已有长期运行的进程可能需要重启，才会重新读取地址选择策略。

## 许可证

[MIT](LICENSE)
