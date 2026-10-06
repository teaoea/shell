# 网络优化脚本

[返回仓库首页](../README.md)

## IPv4 / IPv6 网络优化

在 Debian/Ubuntu 或红帽系 VPS 上用一条命令运行 GitHub `main` 分支的脚本，并选择 IPv4 或 IPv6 模式：

```bash
bash -c 'set -e; network_script=$(curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/optimize/networt_optimization.sh); exec sudo bash -c "$network_script"'
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


## 许可证

[MIT](../LICENSE)
