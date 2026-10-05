# VPS 安装、网络优化与安全配置脚本

本仓库提供 Xray、Hysteria 2 + Cloudflare WARP 的安装脚本，以及 Debian 系和红帽系的 IPv4/IPv6 出站优先级调整和 Debian/Ubuntu 的 SSH、UFW 安全配置脚本。运行前请阅读对应脚本，并确认 VPS 的系统、端口和防火墙配置符合要求。需要修改系统配置的操作均应以 root 身份执行；如果已经登录 root，以下命令可省略 `sudo`。

| 脚本 | 用途 | 适用系统 |
| --- | --- | --- |
| [`install_xray.sh`](install_xray.sh) | 安装 Xray，配置 REALITY 与 Shadowsocks 兼容入口，生成 Loon、圈 X、Surge、Mihomo 配置 | 使用 systemd 的 Debian、Ubuntu、CentOS、RHEL、Fedora、Rocky Linux、AlmaLinux 或 Oracle Linux |
| [`install_ hysteria2_warp.sh`](install_%20hysteria2_warp.sh) | 安装 Hysteria 2 和 Cloudflare WARP，生成服务端配置 | 脚本包含 Debian、Ubuntu、CentOS、RHEL、Fedora 的安装分支；还要求系统具备 UFW |
| [`networt_optimization.sh`](networt_optimization.sh) | 选择 IPv4 或 IPv6 出站优先，保留双栈并应用 Xray-REALITY TCP 系统优化 | Debian/Ubuntu 和红帽系 Linux；IPv4、IPv6 均支持 |
| [`security_hardening.sh`](security_hardening.sh) | 修改 SSH 端口、可选关闭密码登录、配置 UFW，提供确认和自动回滚 | Debian/Ubuntu，使用 systemd 和常驻 OpenSSH 服务；不支持 SSH socket 激活模式 |

## Xray

在 VPS 上用一条命令下载并运行 GitHub `main` 分支的脚本：

```bash
bash -c 'set -e; xray_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install_xray.sh); exec bash -c "$xray_script"'
```

首次下载需要 `curl`；若镜像只有 `wget`，可将下载部分替换为 `wget -qO-` 加同一地址。获取脚本之后的系统检测、普通用户通过 `sudo` 提权、软件源更新、必要工具安装都在脚本内完成，下载失败不会继续执行。没有 `sudo` 的镜像请登录 root 后运行。

### 系统检测与安装流程

脚本在提问和安装依赖前读取 `/etc/os-release`，显示系统名称、版本、架构和包管理器，识别 Debian/Ubuntu，以及 RHEL、CentOS、Rocky Linux、AlmaLinux、Fedora、Oracle Linux；衍生系统按 `ID_LIKE` 判断家族。Debian 系使用 APT，红帽系优先使用 DNF、其次使用 YUM。不支持的系统、缺少对应包管理器或没有运行中的 systemd 时，提前停止。

交互流程依次为：

1. 选择 Xray 出口 IP 模式（IPv4、IPv6、IPv4v6、IPv6v4；无默认值，回车留空），以及是否应用系统网络优化，确认安装计划。
2. 更新软件源索引，安装 CA 证书、OpenSSL、`curl`、解压、网络查询和 DNS 文件属性等必要工具。只更新索引和依赖包，不执行整机升级。
3. 选择优化时下载本仓库的 `networt_optimization.sh`，按所选地址族应用 REALITY TCP 参数、地址优先级和可安全修改的 Cloudflare DNS。DNS 无法写入时保留原配置并继续其他优化；后续安装失败会尝试回滚本次优化。
4. 输入 REALITY 监听端口（默认 **TCP 443**），以及圈 X / Surge 的 Shadowsocks 兼容端口（默认 **TCP/UDP 8443**）。两者必须不同；输入 REALITY 8443 时，未指定的兼容端口默认改为 8444。
5. 最后输入 REALITY 伪装域名（默认 `www.apple.com`），随后安装 Xray、生成凭据、校验配置并启动服务。
6. 检查开机启动、服务运行和两个入口的监听状态，在用户目录的 `client_config` 中写入所有客户端配置并显示输出。

出口模式没有默认值，直接回车或非交互时不传模式参数，会保持留空，生成的出站只有 `protocol: freedom`，不写 `domainStrategy` 或 Happy Eyeballs 策略。四种模式如下：

| 模式 | 出口行为 |
| --- | --- |
| IPv4 | `ForceIP + happyEyeballs`，DNS `UseIPv4`；阻止 IPv6 字面量目标，不回退到 IPv6 |
| IPv6 | `ForceIP + happyEyeballs`，DNS `UseIPv6`；阻止 IPv4 字面量目标，不回退到 IPv4 |
| IPv4v6 | `UseIP + happyEyeballs`，`prioritizeIPv6: false`；优先 IPv4，IPv6 回退 |
| IPv6v4 | `UseIP + happyEyeballs`，`prioritizeIPv6: true`；优先 IPv6，IPv4 回退 |
| 留空 | 不设置出口模式，遵循 Xray 自身默认行为 |

四种已选择模式的 Happy Eyeballs 都设置 `tryDelayMs: 250`、`interleave: 1`、`maxConcurrentTry: 4`。Happy Eyeballs 用于 TCP 域名连接；直接传入的 IP 不会自动变成双栈目标，UDP 发送失败也不保证自动切换地址族。

出口策略作用于代理目标，不限制 VPS 监听地址，也不固定某一个公网出口 IP；实际出站源地址由路由决定。客户端入口公网地址独立检测，IPv6 / IPv6v4 模式优先探测 IPv6，其他模式先探测 IPv4，必要时回退。

网络优化支持的系统范围与安装脚本一致，具体优化能力以本机内核和命令检查为准。有明确出口模式时，优化脚本使用其首选地址族；IPv4v6 / IPv6v4 会传入 `--allow-family-fallback`，首选地址族没有可用地址和路由时改用另一可用地址族优化，Xray 的双栈回退模式保持原选择；出口留空时使用 `--keep-priority`，只应用 TCP 和可安全修改的 DNS，保留 `/etc/gai.conf` 和系统地址优先级。IPv4 模式不再因为缺少全局 IPv6 地址而询问添加 IPv6 前缀。

**Xray 安装脚本不安装、启用或修改任何防火墙。** 请自行在系统防火墙和云安全组放行所选端口：默认 REALITY 为 TCP 443，Shadowsocks 为 TCP/UDP 8443。独立的 `security_hardening.sh` 仍提供 SSH 与 UFW 配置功能。

### 客户端配置

所有配置保存到同一个无后缀文件 `client_config`，用以下标记区分；复制时不包含这些分段标记：

| 标记 | 客户端 / 格式 | 入口 | 使用方式 |
| --- | --- | --- | --- |
| `[loon]` | Loon | VLESS + REALITY + XTLS Vision | 将节点行粘贴到已有配置的 `[Proxy]` 段 |
| `[quantumult-x]` | 圈 X（Quantumult X） | Shadowsocks AES-128-GCM | 将节点行粘贴到 `[server_local]` 段 |
| `[surge]` | Surge | Shadowsocks AES-128-GCM | 将节点行粘贴到 `[Proxy]` 段 |
| `[mihomo]` | Mihomo（如 Clash Verge Rev、FlClash） | VLESS + REALITY + XTLS Vision | 复制该段 YAML 导入，或合并节点、策略组和规则到现有配置 |

`[mihomo]` 段直接使用 `type: vless`、`flow: xtls-rprx-vision`、`reality-opts` 和 `client-fingerprint: chrome`。为兼容 Mihomo 上报的 REALITY 版本，服务端显式设置 `minClientVer: "1.8.2"`，客户端设置 `support-x25519mlkem768: true`。参考 [Mihomo REALITY 参数](https://wiki.metacubex.one/config/proxies/tls/)及 [Xray 官方仓库中的版本兼容说明](https://github.com/XTLS/Xray-core/issues/6477)。这些设置处理已知握手差异，实际互通仍需在所用客户端版本上验证。

圈 X 和 Surge 使用 Xray 内置的 Shadowsocks 入口，不额外部署 WireGuard。该入口使用随机生成的密码，与 REALITY 共用同一 Xray 服务和出站策略。协议加密与 REALITY 的 TLS 伪装不同；节点格式参见 [圈 X 官方示例](https://github.com/crossutility/Quantumult-X/blob/master/server-complete.snippet)和 [Surge Shadowsocks 文档](https://manual.nssurge.com/policies/shadowsocks.html)。

**唯一的客户端输出文件是执行用户家目录中的 `client_config`，没有后缀**：root 执行时是 `/root/client_config`，普通用户通过 sudo 执行时是该用户家目录中的 `client_config`，归属该用户、权限 `600`。安装结束同时在终端打印各段内容。文件汇总不同客户端的格式，按标记选择内容使用，不应整体导入某一个客户端。不会另外生成 `mihomo.yaml` 等单独文件。文件包含连接凭据，请妥善保管。

重跑时会生成新的 UUID、密钥、Short ID 和 Shadowsocks 密码，替换服务端及 `client_config`；原有服务端配置和 `client_config` 会先备份。所有客户端都应更新到新输出。配置校验与本机监听检查不等于客户端到 VPS 的公网连通性测试。

### 参数

`--yes` 跳过交互确认，须明确是否优化；出口模式省略时留空，端口等参数省略时使用默认值。例如：

```bash
bash install_xray.sh --outbound IPv4v6 --optimize-network --port 443 --ss-port 8443 --yes
```

- `--outbound IPv4|IPv6|IPv4v6|IPv6v4`：出口模式；支持传空值。简写分别是 `--ipv4`、`--ipv6`、`--ipv4v6`、`--ipv6v4`，前两项表示仅使用对应地址族。
- `--optimize-network` / `--no-optimize-network`：是否应用系统网络优化。
- `--port`：REALITY 端口，供 Loon 与 Mihomo 使用。
- `--ss-port`：圈 X 与 Surge 的 Shadowsocks 端口。
- `--no-shadowsocks`：仅保留 REALITY，只写入 Loon 和 Mihomo 段落；不能与 `--ss-port` 同用。
- `--reality-domain`：伪装域名，同时写入服务端 `target`、`serverNames` 和客户端 SNI。
- `--client-address`：所有客户端使用的公网 IPv4 / IPv6 地址；保留 `--loon-address` 作为兼容别名。

仍兼容 `XRAY_PORT`、`LOON_SERVER_IP`、`REALITY_SERVER_NAME` 环境变量，自动提权时也会保留相应设置。完整用法可通过 `bash install_xray.sh --help` 查看。

## Hysteria 2 + Cloudflare WARP

```bash
bash -c 'set -e; hysteria_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install_%20hysteria2_warp.sh); exec sudo bash -c "$hysteria_script"'
```

脚本会询问是否继续，只有输入小写 `y` 才会安装。它安装 Cloudflare WARP 和 Hysteria 2，配置 WARP SOCKS 代理端口 2333，将部分域名导向 WARP、其他流量直连，生成 `/etc/hysteria/config.yaml`，并在终端输出 Hysteria 2 密码。当前脚本使用自签名证书、默认域名 `bing.com`，监听 443，并为伪装站使用 80/443 端口。

**运行前检查：**脚本会执行 `ufw enable`，添加 22、80、443、2333 端口规则；若 SSH 并非使用 22 端口，须先确认防火墙放行实际 SSH 端口。它还会把证书私钥设为 `644`，请先评估是否符合服务器的权限要求。该脚本没有提供回滚功能，也未生成 Loon 客户端配置。Xray 默认占用 TCP 443；若同机运行两个安装脚本，需先规划端口，避免冲突。

## IPv4 / IPv6 网络优化

在 Debian/Ubuntu 或红帽系 VPS 上用一条命令运行 GitHub `main` 分支的脚本，并选择 IPv4 或 IPv6 模式：

```bash
bash -c 'set -e; network_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/networt_optimization.sh); exec sudo bash -c "$network_script"'
```

也可指定 `--ipv4` 或 `--ipv6`；非交互运行时还需加 `--yes`。`--keep-priority` 保留系统地址优先级，仅调整 TCP 与可安全修改的 DNS。两种模式均支持 Debian/Ubuntu 和红帽系 Linux；系统检查先于模式选择和 IPv6 地址输入。脚本根据全局地址和默认路由识别可用的地址族：仅 IPv6 的 VPS 使用 Cloudflare IPv6 DNS `2606:4700:4700::1111`、`2606:4700:4700::1001`；有 IPv4 的 VPS 使用 `1.1.1.1`、`1.0.0.1`，即使选择 IPv6 优先也能解析 IPv6 地址。所选优先模式缺少对应地址或默认路由时，脚本会在修改配置前停止。脚本调整 `/etc/gai.conf` 的地址选择顺序，设置 TCP Fast Open 和 MTU probing；内核支持时启用 BBR + FQ。默认使用 Xray-REALITY TCP 优化配置，`--general` 切换回原有通用优化。IPv6 模式会启用 IPv6 协议栈；脚本不修改防火墙或接口 MTU。IPv6 连接失败后的 IPv4 回退取决于应用自身是否支持多地址重试或 Happy Eyeballs。

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

选择 IPv6 模式且内核支持 IPv6、但没有全局 IPv6 地址时，交互输入分为两步：第一步输入以 `::` 结尾的网络前缀，直接回车默认不添加；第二步输入一个或多个后缀，用空格分隔。脚本根据前缀中完整十六进制段的数量计算前缀长度。例如 `2a0c:9a40:8aa3:13c8::` 有四段，因此生成 `/64` 地址；后缀只允许 1 到 4 位十六进制，`1 2 a` 有效，`fhwjhf` 会被拒绝。

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

DNS 修改会保留普通 `/etc/resolv.conf` 中的搜索域等设置，并原位写入已有文件，兼容可写的单文件挂载。若文件设置了 immutable（`i`）或 append-only（`a`）属性，脚本会临时解除锁定，并在成功或失败后尝试恢复保护状态；恢复失败会明确报错。锁定属性也纳入备份与回滚。修改其他网络配置前会先检查 DNS 文件能否写入；只读挂载、宿主机不允许解锁或缺少锁定检查工具时，会警告并跳过本次 DNS 修改，保留原有 DNS，继续应用地址优先级、TCP 和 BBR 等其他网络优化，Xray 安装也会继续。跳过状态会写入备份记录，回滚时不覆盖 DNS，也不重启 DNS 服务；完成提示会明确说明 DNS 已跳过。解锁需要 `e2fsprogs` 提供的工具及相应系统权限；运行中的 `systemd-resolved` 会通过配置片段设置 DNS。遇到由其他程序管理的符号链接时，保留 DNS 并继续其他优化。NetworkManager、DHCP 或 cloud-init 等可能在续租或重启时重新生成普通 `resolv.conf`，此时需在其网络管理程序中设置持久 DNS。

应用前会把现有配置和运行时参数备份到 `/var/lib/network-optimizer/backups/`。脚本还支持 `--status` 查看状态并用 `curl` 向 Cloudflare 固定 IP 发出带正确响应格式的 HTTPS DoH 请求，测试已配置地址族的直连；失败时会保留 HTTP 或 curl 错误，`--rollback` 恢复最近一次修改。直连测试不经过 DNS 或代理；脚本不额外验证 Cloudflare DNS 的解析可用性。已有长期运行的进程可能需要重启，才会重新读取地址选择策略。

## VPS 安全配置

`security_hardening.sh` 是独立脚本。在 Debian/Ubuntu VPS 上用一条命令下载 GitHub `main` 分支脚本并进入交互配置：

```bash
bash -c 'set -e; runner=(); if [ "$(id -u)" -ne 0 ]; then runner=(sudo --preserve-env=SSH_CONNECTION); fi; if ! command -v curl >/dev/null 2>&1; then "${runner[@]}" apt-get update; "${runner[@]}" apt-get install -y ca-certificates curl; fi; security_script=$(mktemp); trap "rm -f -- \"$security_script\"" EXIT; curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/security_hardening.sh -o "$security_script"; "${runner[@]}" bash "$security_script"'
```

该命令在缺少 `curl` 时先安装首次下载所需工具，自动处理 root / `sudo`，保留 `SSH_CONNECTION`，并在退出时删除下载的临时文件。本地文件可用 `sudo --preserve-env=SSH_CONNECTION bash security_hardening.sh` 运行；已登录 root 时省略 `sudo --preserve-env=SSH_CONNECTION`。脚本会询问新 SSH 端口（默认保留当前端口）、是否关闭密码登录、防火墙模式和额外放行的业务端口；最后展示计划和当前监听端口，确认后应用。支持 Debian/Ubuntu 的常驻 `ssh.service` 或 `sshd.service`；检测到 `ssh.socket` 正在运行时会停止。标准 `sshd_config.d` 目录以外的自定义 `Include`、带端口的 `ListenAddress` 或冲突的 `Match` 认证策略需要先处理，避免修改后实际配置与计划不一致。

### SSH 端口和认证

- 修改端口时暂时同时监听新旧端口，先放行 SSH 端口，再重载 SSH 服务；应用前检查配置语法和实际生效选项，应用后检查新端口监听状态。
- 可选关闭 `PasswordAuthentication` 和 `KbdInteractiveAuthentication`，启用公钥并将 `AuthenticationMethods` 设置为 `publickey`。保持已有 root 登录策略；不会生成或索取客户端私钥。
- 交互模式会检查目标用户是否已有可识别公钥；没有时提示粘贴 `.pub` 文件中的完整一行，如 `ssh-ed25519 AAAA... user@device`。输入空行可跳过安装并保留认证配置；如果选择关闭密码登录，则空输入会取消该操作。私钥、无效格式或无法解析的密钥会被拒绝，可以重新输入。
- 公钥写入当前 `AuthorizedKeysFile` 已启用的用户家目录标准 `.ssh/authorized_keys` 或 `.ssh/authorized_keys2`，原有内容保留，相同密钥不重复追加。目录权限设为 `700`、文件权限设为 `600`，归属目标用户；存在旧文件时先备份到 `/var/lib/vps-security/public-key-backups/`，再通过临时文件替换。符号链接路径不会写入。
- 关闭密码登录必须明确确认已实际用公钥登录。新公钥写入后，先保留当前 SSH 认证配置，提示在另一个终端用该密钥验证；确认成功才继续关闭密码登录。未确认时，本次改为保留原认证配置，继续其余安全设置，之后可以重跑脚本关闭密码登录。非交互模式不会索取或自动安装公钥，需要事先准备密钥并明确传入 `--key-login-confirmed`。
- 只配置 SSH 证书、`AuthorizedKeysCommand` 或自定义公钥路径、未启用标准用户公钥文件的环境需要单独处理。公钥文件检查不能替代真实登录测试；公钥安装属于独立准备步骤，SSH/UFW 回滚不会删除本次新安装的公钥。

### UFW 防火墙

`--firewall configure` 设置默认拒绝入站、允许出站，开启低级日志、IPv4/IPv6 和 SSH 连接频率限制，保留防火墙原有的启用状态。`--firewall enable` 额外启用 UFW；`--firewall keep` 不修改防火墙，也不安装 UFW。需要配置但未安装 UFW 时，使用 APT 更新索引并安装。

原有 UFW 规则会保留；`--allow` 可重复添加业务端口。比如 Xray 使用 TCP 443、Hysteria 2 使用 UDP 443 时，应明确放行相应端口。启用 UFW 会阻止未放行的业务访问；脚本不自动开放所有监听服务，不修改云安全组，也不管理容器自行添加的防火墙规则。检测到 firewalld 正在运行时停止 UFW 配置。

明确指定全部选择的非交互示例（端口和用户名按实际情况修改）：

```bash
sudo --preserve-env=SSH_CONNECTION bash security_hardening.sh --ssh-port 22222 --disable-password --login-user root --key-login-confirmed --firewall enable --allow 443/tcp --allow 443/udp --yes
```

### 确认与回滚

SSH 和本次修改的 UFW 配置备份到 `/var/lib/vps-security/backups/`，脚本保存为 `/var/lib/vps-security/security_hardening.sh`。应用前启用 systemd 自动回滚计时器；**10 分钟内未确认将触发自动回滚**。计时器随系统启动启用，重启后重新开始 10 分钟计时。执行失败或收到可处理的中断信号时，也会尝试立即恢复；恢复失败会保留备份和待确认状态。

保留当前 SSH 会话，在云安全组放行新端口后，另开连接，用计划中的用户从新端口登录。关闭密码登录时，该新连接必须使用公钥。然后在新连接中确认：

```bash
sudo --preserve-env=SSH_CONNECTION bash /var/lib/vps-security/security_hardening.sh --confirm
```

确认会检查登录用户、新端口以及连接是否不同于应用时的会话，再取消自动回滚并关闭旧 SSH 监听端口。旧端口的 UFW 规则保留，管理员可按实际用途清理。不要在应用修改的原会话中确认。

查看状态或手动恢复最近一次修改，各用一条命令：

```bash
sudo bash /var/lib/vps-security/security_hardening.sh --status
```

```bash
sudo bash /var/lib/vps-security/security_hardening.sh --rollback
```

回滚恢复的是备份时的 SSH/UFW 配置，应用后的其他手动修改可能被覆盖。主机内监听检查不能证明云安全组或外部线路已放行；新连接登录是确认步骤的一部分。

## 许可证

[MIT](LICENSE)
