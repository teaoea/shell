# VPS 安全配置脚本

[返回仓库首页](../README.md)

## VPS 安全配置

`security_hardening.sh` 是独立脚本。在 Debian/Ubuntu VPS 上用一条命令下载 GitHub `main` 分支脚本并进入交互配置：

```bash
bash -c 'set -e; runner=(); if [ "$(id -u)" -ne 0 ]; then runner=(sudo --preserve-env=SSH_CONNECTION); fi; if ! command -v curl >/dev/null 2>&1; then "${runner[@]}" apt-get update; "${runner[@]}" apt-get install -y ca-certificates curl; fi; security_script=$(mktemp); trap "rm -f -- \"$security_script\"" EXIT; curl -fsSL --retry 3 https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/security/security_hardening.sh -o "$security_script"; "${runner[@]}" bash "$security_script"'
```

该命令在缺少 `curl` 时先安装首次下载所需工具，自动处理 root / `sudo`，保留 `SSH_CONNECTION`，并在退出时删除下载的临时文件。本地文件可用 `sudo --preserve-env=SSH_CONNECTION bash security_hardening.sh` 运行；已登录 root 时省略 `sudo --preserve-env=SSH_CONNECTION`。脚本会询问新 SSH 端口（默认保留当前端口）、是否关闭密码登录、防火墙模式和额外放行的业务端口；最后展示计划和当前监听端口，确认后应用。支持 Debian/Ubuntu 的常驻 `ssh.service`、`sshd.service`，以及 `Accept=no` 且激活 `ssh.service` 的 `ssh.socket`。socket 模式要求服务使用 `KillMode=process`，避免重启监听主进程时终止已登录会话；不支持的自定义单元会在备份和修改前停止。标准 `sshd_config.d` 目录以外的自定义 `Include`、带端口的 `ListenAddress` 或冲突的 `Match` 认证策略需要先处理，避免修改后实际配置与计划不一致。

### SSH 端口和认证

- 修改端口时暂时同时监听新旧端口，先放行 SSH 端口，再重载 SSH 服务；应用前检查配置语法和实际生效选项，应用后检查新端口监听状态。
- 可选关闭 `PasswordAuthentication` 和 `KbdInteractiveAuthentication`，启用公钥并将 `AuthenticationMethods` 设置为 `publickey`。保持已有 root 登录策略；不会生成或索取客户端私钥。
- 交互模式会检查目标用户是否已有可识别公钥；没有时提示粘贴 `.pub` 文件中的完整一行，如 `ssh-ed25519 AAAA... user@device`。输入空行可跳过安装并保留认证配置；如果选择关闭密码登录，则空输入会取消该操作。私钥、无效格式或无法解析的密钥会被拒绝，可以重新输入。
- 公钥写入当前 `AuthorizedKeysFile` 已启用的用户家目录标准 `.ssh/authorized_keys` 或 `.ssh/authorized_keys2`，原有内容保留，相同密钥不重复追加。目录权限设为 `700`、文件权限设为 `600`，归属目标用户；存在旧文件时先备份到 `/var/lib/vps-security/public-key-backups/`，再通过临时文件替换。符号链接路径不会写入。
- 关闭密码登录必须明确确认已实际用公钥登录。新公钥写入后，先保留当前 SSH 认证配置，提示在另一个终端用该密钥验证；确认成功才继续关闭密码登录。未确认时，本次改为保留原认证配置，继续其余安全设置，之后可以重跑脚本关闭密码登录。非交互模式不会索取或自动安装公钥，需要事先准备密钥并明确传入 `--key-login-confirmed`。
- 只配置 SSH 证书、`AuthorizedKeysCommand` 或自定义公钥路径、未启用标准用户公钥文件的环境需要单独处理。公钥文件检查不能替代真实登录测试；公钥安装属于独立准备步骤，SSH/UFW 回滚不会删除本次新安装的公钥。

### Ubuntu 的 SSH socket 激活

新版 Ubuntu 默认可能由 systemd 的 `ssh.socket` 持有监听端口；仅重载 `sshd_config` 不足以更新这些端口。脚本保留 socket 激活模式，不切换为常驻启动，也不改变 SSH 单元原有的开机启用状态。参见 [Ubuntu 官方说明](https://discourse.ubuntu.com/t/sshd-now-uses-socket-based-activation-ubuntu-22-10-and-later/30189)。

- 从 socket 的实际监听地址读取原端口，在 `/etc/systemd/system/ssh.socket.d/zzzz-vps-security.conf` 写入本次覆盖配置，沿用原有地址绑定；待确认阶段保留原来的完整监听地址，再在相同地址增加新端口。
- 先放行端口，再重载 systemd，核对有效 socket 监听与计划一致，一同重启 socket 和 SSH 主进程并检查监听；已有登录会话保留。
- 新连接确认后，将 socket 和 SSH 配置同时改为新端口。失败或超时回滚时，同时恢复 SSH 配置和本次覆盖文件；原来没有该文件则删除本次创建的文件。其他 socket 覆盖文件保持原状。

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

[MIT](../LICENSE)
