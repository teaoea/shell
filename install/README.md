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

**Xray 安装脚本不安装、启用或修改任何防火墙。** 请自行在系统防火墙和云安全组放行所选端口：默认 REALITY 为 TCP 443，Shadowsocks 为 TCP/UDP 8443。独立的 [`security/security_hardening.sh`](../security/security_hardening.sh) 仍提供 SSH 与 UFW 配置功能。

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
