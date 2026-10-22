# 安装脚本

[返回仓库首页](../README.md)

本目录保存 Xray 与 Hysteria 2 + Cloudflare WARP 安装脚本。运行前请阅读对应说明，确认系统与监听端口符合要求。

## Xray

在 VPS 上用一条命令下载并运行 GitHub `main` 分支的脚本：

```bash
bash -c 'set -e; xray_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install/install_xray.sh); exec bash -c "$xray_script"'
```

首次下载需要 `curl`；若镜像只有 `wget`，可将下载部分替换为 `wget -qO-` 加同一地址。获取脚本之后的系统检测、普通用户通过 `sudo` 提权、软件源更新、必要工具安装都在脚本内完成，下载失败不会继续执行。没有 `sudo` 的镜像请登录 root 后运行。

### 系统检测与安装流程

脚本在提问和安装依赖前读取 `/etc/os-release`，显示系统名称、版本、架构和包管理器，识别 Debian/Ubuntu，以及 RHEL、CentOS、Rocky Linux、AlmaLinux、Fedora、Oracle Linux；衍生系统按 `ID_LIKE` 判断家族。Debian 系使用 APT，红帽系优先使用 DNF、其次使用 YUM。不支持的系统、缺少对应包管理器或没有运行中的 systemd 时，提前停止。

交互流程依次为：

1. 选择 Xray 出口 IP 模式（IPv4、IPv6、IPv4v6、IPv6v4；无默认值，回车留空），以及是否应用系统网络优化，确认安装计划。
2. 更新软件源索引，安装 CA 证书、OpenSSL、`curl`、解压、网络查询和 DNS 文件属性等必要工具。只更新索引和依赖包，不执行整机升级。
3. 选择优化时下载本仓库的 [`optimize/networt_optimization.sh`](../optimize/networt_optimization.sh)，按所选地址族应用 REALITY TCP 参数、地址优先级和可安全修改的 Cloudflare DNS。DNS 无法写入时保留原配置并继续其他优化；后续安装失败会尝试回滚本次优化。
4. 输入 REALITY 监听端口（默认 **TCP 443**），以及 Surge 的 Shadowsocks 兼容端口（默认 **TCP/UDP 8443**）。两者必须不同；输入 REALITY 8443 时，未指定的兼容端口默认改为 8444。
5. 询问是否启用 WARP WireGuard 出站（默认不启用）。启用后选择指定域名或全部代理流量。
6. 最后输入 REALITY 伪装域名（默认 `www.apple.com`），随后通过 `wgcf` 注册或复用账户、获取 WARP 参数、安装 Xray、生成凭据并校验配置。启用 WARP 时，先做真实出口检测，通过后才替换服务端配置并启动服务。
7. 检查开机启动、服务运行和两个入口的监听状态，在用户目录的 `client_config` 中写入所有客户端配置并显示输出。

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

**Xray 安装脚本不安装、启用或修改任何防火墙。** 请自行在系统防火墙和云安全组放行所选端口：默认 REALITY 为 TCP 443，Shadowsocks 为 TCP/UDP 8443。独立的 [`security/security_hardening.sh`](../security/security_hardening.sh) 仍提供 SSH 与 UFW 配置功能。

### WARP WireGuard 出站

交互安装会询问是否启用 WARP，**直接回车默认关闭**。`--yes` 非交互安装也保持关闭，不注册账户或下载 `wgcf`。启用提示会列出 Cloudflare 服务条款；确认启用后，使用 [wgcf](https://github.com/ViRb3/wgcf) 注册免费 WARP 账户并生成 WireGuard 参数，无须手工填写私钥或隧道地址。

支持两种范围：

| 选择 | 行为 |
| --- | --- |
| 指定域名（默认） | 询问哪些域名走 WARP，列表默认没有。匹配的域名走 WARP，其余代理流量使用 VPS 原有直连出站 |
| 全部代理流量走 WARP | REALITY 与 Shadowsocks 入口收到的 TCP/UDP 代理流量均路由到 WARP |

指定域名可用空格或英文逗号分隔。`example.com` 会写成 `domain:example.com`，匹配该域名及子域；`full:api.example.com` 仅匹配完整域名；`*.example.com` 按 `domain:example.com` 处理。不要填写 URL、路径或端口。**列表留空时仍会注册并检测 WARP，但不添加 WARP 分流规则，不会自动变成全流量模式**；之后可直接编辑 `/usr/local/etc/xray/config.json` 的 `routing.rules`，将需要的规则指向 `outboundTag: "warp"`，校验后重启 Xray。

实现使用 [Xray 内置 WireGuard 出站](https://xtls.github.io/en/config/outbounds/wireguard.html)：

- 从 wgcf 官方发布下载固定版本 **2.3.1**，核对发布的 SHA-256 校验值后执行；支持 x86_64、ARM64、x86、ARMv6/ARMv7。二进制仅临时使用。
- 账户保存在 `/var/lib/xray-warp/wgcf-account.toml`，目录权限 `700`、账户文件权限 `600`；重跑复用账户，不重复注册。生成的 WireGuard profile 只作临时转换，结束时删除。
- `wgcf-profile.conf` 没有导出 WireGuard Reserved 字节，因此用同一账户的设备 API 读取 `client_id` 并解码为实际三个字节；缺失或读取失败会停止，不固定写成 `0,0,0`。访问令牌存放于 root 私有临时目录，不放入进程参数。
- 将注册所得的私钥、隧道地址、对端公钥和 Endpoint 写入服务端 `config.json`，添加 `warp` 出站以及所选域名/全流量规则；不把 WARP 私钥写入 `client_config`。
- 设置 `noKernelTun: true`，由 Xray 在进程内处理隧道；不安装或启动 `warp-cli`、`wg-quick`，不创建系统 WireGuard 接口，不修改系统默认路由。服务端 JSON 以 `root:xray`、`640` 保存，供 Xray 服务读取。
- 指定非空域名列表时，对代理入口启用 HTTP/TLS/QUIC 嗅探和 `routeOnly: true`，辅助识别域名。没有可识别域名的纯 IP、加密 ClientHello 等请求可能无法匹配域名规则。

**实际可用性检查：**在替换现有 Xray 配置前，按正式服务的用户身份启动一个仅监听 `127.0.0.1`、仅含 WARP 出站的临时 Xray SOCKS 实例。把 Endpoint 域名解析为 IPv4/IPv6 候选地址，按所选网络优先级依次检测；通过该代理请求 Cloudflare trace，必须返回 `warp=on` 或 `warp=plus` 才继续。正式 JSON 固定使用测通的 Endpoint IP，避免正式服务重新解析到另一个不通的地址族；不会退回直连后将检测算作成功。注册、参数生成、配置校验或出口检测失败都会停止，临时实例会退出。重跑已有 WireGuard 配置时，检测前暂时停止旧服务，避免同一账户的两个实例互相干扰；失败时恢复原配置与原运行状态。已注册账户保留供重试；旧服务端配置沿用脚本原有备份与失败恢复流程。

“全部”指通过 Xray 代理入口的流量，不接管 VPS 自身的 SSH、软件更新等系统流量。已选择的仅 IPv4/仅 IPv6 目标地址族拦截规则仍优先执行，直接连接 WARP Endpoint 的地址族由 VPS 网络决定；原有 Freedom 出口模式不等于 WireGuard 隧道内的地址族策略。需要 VPS 可达 Cloudflare 注册 API、下载站和 WireGuard UDP Endpoint。真实检测反映安装时的状态，后续仍需保持账户与网络可用。

### 客户端配置

所有配置保存到同一个无后缀文件 `client_config`，用以下标记区分；复制时不包含这些分段标记：

| 标记 | 客户端 / 格式 | 入口 | 使用方式 |
| --- | --- | --- | --- |
| `[loon]` | Loon | VLESS + REALITY + XTLS Vision | 将节点行粘贴到已有配置的 `[Proxy]` 段 |
| `[quantumult-x]` | 圈 X（Quantumult X） | VLESS + REALITY + XTLS Vision | 将节点行粘贴到 `[server_local]` 段 |
| `[surge]` | Surge | Shadowsocks AES-128-GCM | 将节点行粘贴到 `[Proxy]` 段 |
| `[mihomo]` | Mihomo（如 Clash Verge Rev、FlClash） | VLESS + REALITY + XTLS Vision | 复制该段 YAML 导入，或合并节点、策略组和规则到现有配置 |

`[mihomo]` 段直接使用 `type: vless`、`flow: xtls-rprx-vision`、`reality-opts` 和 `client-fingerprint: chrome`。为兼容 Mihomo 上报的 REALITY 版本，服务端显式设置 `minClientVer: "1.8.2"`，客户端设置 `support-x25519mlkem768: true`。参考 [Mihomo REALITY 参数](https://wiki.metacubex.one/config/proxies/tls/)及 [Xray 官方仓库中的版本兼容说明](https://github.com/XTLS/Xray-core/issues/6477)。这些设置处理已知握手差异，实际互通仍需在所用客户端版本上验证。

圈 X 使用与 Loon、Mihomo 相同的 REALITY 入口、端口和凭据，节点按 [圈 X 官方示例](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)生成：`method=none`、`obfs=over-tls`、`obfs-host`、`reality-base64-pubkey`、`reality-hex-shortid` 和 `vless-flow=xtls-rprx-vision`。请使用支持 REALITY 与 Vision 的圈 X 版本。

Surge 使用 Xray 内置的 Shadowsocks 入口，不额外部署 WireGuard。该入口使用随机生成的密码，与 REALITY 共用同一 Xray 服务和出站策略；格式参见 [Surge Shadowsocks 文档](https://manual.nssurge.com/policies/shadowsocks.html)。

**唯一的客户端输出文件是执行用户家目录中的 `client_config`，没有后缀**：root 执行时是 `/root/client_config`，普通用户通过 sudo 执行时是该用户家目录中的 `client_config`，归属该用户、权限 `600`。安装结束同时在终端打印各段内容。文件汇总不同客户端的格式，按标记选择内容使用，不应整体导入某一个客户端。不会另外生成 `mihomo.yaml` 等单独文件。文件包含连接凭据，请妥善保管。

重跑时会生成新的 UUID、密钥、Short ID 和 Shadowsocks 密码，替换服务端及 `client_config`；原有服务端配置和 `client_config` 会先备份。所有客户端都应更新到新输出。配置校验与本机监听检查不等于客户端到 VPS 的公网连通性测试。

### 参数

`--yes` 跳过交互确认，须明确是否优化；出口模式省略时留空，端口等参数省略时使用默认值。例如：

```bash
bash install_xray.sh --outbound IPv4v6 --optimize-network --port 443 --ss-port 8443 --yes
```

- `--outbound IPv4|IPv6|IPv4v6|IPv6v4`：出口模式；支持传空值。简写分别是 `--ipv4`、`--ipv6`、`--ipv4v6`、`--ipv6v4`，前两项表示仅使用对应地址族。
- `--optimize-network` / `--no-optimize-network`：是否应用系统网络优化。
- `--port`：REALITY 端口，供 Loon、圈 X 与 Mihomo 使用。
- `--ss-port`：Surge 的 Shadowsocks 端口。
- `--no-shadowsocks`：仅保留 REALITY，写入 Loon、圈 X 和 Mihomo 段落，不生成 Surge 段落；不能与 `--ss-port` 同用。
- `--reality-domain`：伪装域名，同时写入服务端 `target`、`serverNames` 和客户端 SNI。
- `--client-address`：所有客户端使用的公网 IPv4 / IPv6 地址；保留 `--loon-address` 作为兼容别名。

仍兼容 `XRAY_PORT`、`LOON_SERVER_IP`、`REALITY_SERVER_NAME` 环境变量，自动提权时也会保留相应设置。完整用法可通过 `bash install_xray.sh --help` 查看。

## Hysteria 2 + Cloudflare WARP

```bash
bash -c 'set -e; hysteria_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/install/install_%20hysteria2_warp.sh); exec sudo bash -c "$hysteria_script"'
```

脚本会询问是否继续，只有输入小写 `y` 才会安装。它安装 Cloudflare WARP 和 Hysteria 2，配置 WARP SOCKS 代理端口 2333，将部分域名导向 WARP、其他流量直连，生成 `/etc/hysteria/config.yaml`，并在终端输出 Hysteria 2 密码。当前脚本使用自签名证书、默认域名 `bing.com`，监听 443，并为伪装站使用 80/443 端口。

**运行前检查：**脚本会执行 `ufw enable`，添加 22、80、443、2333 端口规则；若 SSH 并非使用 22 端口，须先确认防火墙放行实际 SSH 端口。它还会把证书私钥设为 `644`，请先评估是否符合服务器的权限要求。该脚本没有提供回滚功能，也未生成 Loon 客户端配置。Xray 默认占用 TCP 443；若同机运行两个安装脚本，需先规划端口，避免冲突。


## 许可证

[MIT](../LICENSE)
