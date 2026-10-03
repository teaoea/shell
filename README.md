# VPS 安装与网络优化脚本

本仓库提供 Xray、Hysteria 2 + Cloudflare WARP 的安装脚本，以及 Debian 的 IPv4/IPv6 出站优先级调整脚本。运行前请阅读对应脚本，并确认 VPS 的系统、端口和防火墙配置符合要求。需要修改系统配置的操作均应以 root 身份执行；如果已经登录 root，以下命令可省略 `sudo`。

| 脚本 | 用途 | 适用系统 |
| --- | --- | --- |
| [`install_xray.sh`](install_xray.sh) | 安装 Xray，配置 VLESS + REALITY + XTLS Vision，生成 Loon 节点信息 | 使用 systemd 的 Debian、Ubuntu、CentOS、RHEL、Fedora、Rocky Linux、AlmaLinux 或 Oracle Linux |
| [`install_ hysteria2_warp.sh`](install_%20hysteria2_warp.sh) | 安装 Hysteria 2 和 Cloudflare WARP，生成服务端配置 | 脚本包含 Debian、Ubuntu、CentOS、RHEL、Fedora 的安装分支；还要求系统具备 UFW |
| [`networt_optimization.sh`](networt_optimization.sh) | 选择 IPv4 或 IPv6 出站优先，保留双栈并应用 Xray-REALITY TCP 系统优化 | IPv4 模式支持 Debian；IPv6 模式支持 Debian 13 |

## Xray

在 VPS 上用一条命令运行 GitHub `main` 分支的脚本：

```bash
xray_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install_xray.sh) && sudo bash -c "$xray_script"
```

脚本要求 root 权限，默认使用 TCP 443 和 `www.apple.com` 作为 REALITY 伪装域名。交互安装会先询问伪装域名，直接回车使用默认值；用户输入其他域名时，脚本会校验格式，并把同一域名写入 REALITY `target`、`serverNames` 和 Loon `sni`。随后会明确询问 Xray 出站使用 IPv4 优先还是 IPv6 优先，并询问是否应用 Xray-REALITY 针对性系统网络优化。Xray 使用 Happy Eyeballs 优先连接所选地址族，连接不通时回退到另一地址族；自动检测 Loon 节点公网地址时也按相同顺序尝试。

选择网络优化后，脚本从本仓库 GitHub `main` 分支下载 `networt_optimization.sh`，按所选地址族运行 `--xray-reality` 配置，并在 Xray 配置中启用 TCP Fast Open。该操作会修改系统 TCP、Cloudflare DNS 和地址优先级，仅支持网络优化脚本声明的系统范围：IPv4 模式支持 Debian，IPv6 模式支持 Debian 13。若后续 Xray 安装失败，安装脚本会尝试回滚本次网络优化。选择不优化时，不修改系统网络配置，Xray 配置仍会保留所选地址族的优先级与回退。

它随后调用 Xray 官方安装器，生成 VLESS + REALITY + XTLS Vision 服务端配置，校验后启动服务，并在终端打印可粘贴到 Loon `[Proxy]` 段的节点。已有的 Xray 服务端配置会在安装前备份，安装失败时尝试恢复。

`--yes` 跳过安装确认，但必须同时用 `--ipv4` / `--ipv6` 明确网络优先级，并用 `--optimize-network` / `--no-optimize-network` 明确是否优化。例如：

```bash
sudo bash install_xray.sh --ipv4 --optimize-network --yes
sudo bash install_xray.sh --ipv6 --no-optimize-network \
  --reality-domain www.example.com --yes
```

`--reality-domain` 主动指定伪装域名；省略时默认使用 `www.apple.com`。`--port` 修改监听端口；`--loon-address` 指定要写入 Loon 节点的 IPv4 或 IPv6 地址。也可用 `XRAY_PORT`、`LOON_SERVER_IP` 和 `REALITY_SERVER_NAME` 环境变量设置对应参数。使用本地脚本时，可运行 `sudo bash install_xray.sh --help` 查看完整用法。

脚本仅校验 Xray 服务端配置及服务状态，不测试客户端到 VPS 的公网连通性。Loon 节点配置只打印在终端，不再写入 `/root/xray-reality-client.txt`；请自行保存输出并妥善保管连接凭据。脚本不修改防火墙或云安全组。

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

也可指定 `--ipv4` 或 `--ipv6`；非交互运行时还需加 `--yes`。IPv4 模式支持 Debian，IPv6 模式仅支持 Debian 13。脚本根据全局地址和默认路由识别可用的地址族：仅 IPv6 的 VPS 使用 Cloudflare IPv6 DNS `2606:4700:4700::1111`、`2606:4700:4700::1001`；有 IPv4 的 VPS 使用 `1.1.1.1`、`1.0.0.1`，即使选择 IPv6 优先也能解析 IPv6 地址。所选优先模式缺少对应地址或默认路由时，脚本会在修改配置前停止。脚本调整 `/etc/gai.conf` 的地址选择顺序，设置 TCP Fast Open 和 MTU probing；内核支持时启用 BBR + FQ。默认使用 Xray-REALITY TCP 优化配置，`--general` 切换回原有通用优化。IPv6 模式会启用 IPv6 协议栈；脚本不修改防火墙或接口 MTU。IPv6 连接失败后的 IPv4 回退取决于应用自身是否支持多地址重试或 Happy Eyeballs。

默认 REALITY 配置适用于本仓库的 VLESS + REALITY + XTLS Vision TCP 传输，修改的是整个系统的 TCP 参数：

- 内核支持时启用 BBR + FQ；不支持时保留现有拥塞控制。
- 启用接收缓冲区自动调节、窗口缩放和 SACK；把 `tcp_rmem` / `tcp_wmem` 的自动调节上限提高至至少 16 MiB，保留现有最小值、初始值和更大的上限。这是允许按需增长的上限，不是为每个连接预先分配 16 MiB。
- 把 `somaxconn` 和 `tcp_max_syn_backlog` 提高至至少 4096，保留更大的现有值；实际监听队列还取决于应用请求的 backlog。
- 保留 `tcp_mtu_probing=1`，遇到 MTU 黑洞时进行 TCP 路径探测。

```bash
sudo bash networt_optimization.sh --ipv4 --xray-reality --yes
# 内存较小或连接数较多时，可选择较低的目标上限；不会降低已有上限。
sudo bash networt_optimization.sh --ipv4 --xray-reality --tcp-buffer-mib 4 --yes
```

`--tcp-buffer-mib` 接受 1 到 64；目标默认值是运维起点，并非针对每条线路测得的最优值。以上新增参数都纳入备份、应用后校验和回滚。应用后建议在维护窗口重启 Xray，使监听队列及新连接使用新参数；脚本不会自动重启服务。切换 `--general` 不会还原此前 REALITY 配置的运行时值，需要先使用 `--rollback`。

Xray 使用自己的解析/连接策略，`/etc/gai.conf` 不能保证控制 Xray 的出站地址族；若需要 Xray 明确选择 IPv4/IPv6，需配置其 `domainStrategy` / Happy Eyeballs。系统设置 `tcp_fastopen=3` 只允许 TCP Fast Open，Xray 还需要相应 `sockopt.tcpFastOpen` 配置，并且客户端及线路支持才可能受益。参考 [Xray Sockopt 文档](https://xtls.github.io/en/config/transports/sockopt.html)和 [Linux TCP 参数文档](https://kernel.org/doc/html/latest/networking/ip-sysctl.html)。

内核支持 IPv6、但没有全局 IPv6 地址时，交互输入分为两步：第一步输入以 `::` 结尾的网络前缀，直接回车默认不添加；第二步输入一个或多个后缀，用空格分隔。脚本根据前缀中完整十六进制段的数量计算前缀长度。例如 `2a0c:9a40:8aa3:13c8::` 有四段，因此生成 `/64` 地址；后缀只允许 1 到 4 位十六进制，`1 2 a` 有效，`fhwjhf` 会被拒绝。

输入后自动选择 IPv6 默认路由所在网卡，没有则选择 IPv4 默认路由网卡。`--ipv6-interface` 可覆盖自动选择，`--ipv6-gateway` 仅在用户明确指定时添加网关。仅添加地址不会创建默认路由；选择 IPv6 优先仍需 IPv6 默认路由。非交互运行示例（将示例值替换为服务商实际分配的信息）：

```bash
sudo bash networt_optimization.sh --ipv6 --yes \
  --ipv6-prefix 2a0c:9a40:8aa3:13c8:: \
  --ipv6-suffixes '1 2 a' \
  --ipv6-interface eth0 --ipv6-gateway fe80::1
```

以上示例生成 `2a0c:9a40:8aa3:13c8::1/64`、`2a0c:9a40:8aa3:13c8::2/64` 和 `2a0c:9a40:8aa3:13c8::a/64` 三个地址。仍兼容用 `--ipv6-address` 直接提供完整地址：

```bash
sudo bash networt_optimization.sh --ipv4 --yes \
  --ipv6-address '2001:db8::10/64,2001:db8::11/64'
# 也可以分别传入：--ipv6-address 2001:db8::10/64 --ipv6-address 2001:db8::11/64
```

多个地址会逐个添加并检测；中途失败时自动回滚本次已添加的地址。

新增地址和路由仅在运行时生效，重启或网络管理服务重新配置后可能丢失；持久化需写入本机使用的网络管理程序。脚本不会推算或申请服务商地址，也不会覆盖已有全局 IPv6 地址或默认路由。添加时会等待地址重复检测完成，失败会自动回滚；新增地址、默认路由和接口 IPv6 开关也纳入 `--rollback`。内核支持 IPv6 并不代表服务商提供了 IPv6 网络，实际连接结果仍以下方直连测试为准。

DNS 修改会保留普通 `/etc/resolv.conf` 中的搜索域等设置；运行中的 `systemd-resolved` 会通过配置片段设置 DNS。遇到由其他程序管理的符号链接时，脚本会停止并提示先修改对应程序的配置。部分 VPS 会在续租或重启时重新生成普通 `resolv.conf`，此时需在其网络管理程序中设置持久 DNS。

应用前会把现有配置和运行时参数备份到 `/var/lib/network-optimizer/backups/`。脚本还支持 `--status` 查看状态并用 `curl` 测试已配置地址族到 Cloudflare 固定 IP 的 HTTPS 直连，`--rollback` 恢复最近一次修改。直连测试不经过 DNS 或代理；脚本不额外验证 Cloudflare DNS 的解析可用性。已有长期运行的进程可能需要重启，才会重新读取地址选择策略。

## 许可证

[MIT](LICENSE)
