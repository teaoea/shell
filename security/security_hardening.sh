#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly SSH_CONFIG=/etc/ssh/sshd_config
readonly SSH_CONFIG_D=/etc/ssh/sshd_config.d
readonly UFW_DIR=/etc/ufw
readonly UFW_DEFAULT=/etc/default/ufw
readonly STATE_DIR=/var/lib/vps-security
readonly RUNNER="$STATE_DIR/security_hardening.sh"
readonly PENDING="$STATE_DIR/pending"
readonly LATEST="$STATE_DIR/latest"
readonly TIMER=vps-security-rollback.timer
readonly SERVICE_FILE=/etc/systemd/system/vps-security-rollback.service
readonly TIMER_FILE=/etc/systemd/system/vps-security-rollback.timer
readonly SOCKET_OVERRIDE=/etc/systemd/system/ssh.socket.d/zzzz-vps-security.conf
readonly SUDOERS_DIR=/etc/sudoers.d
readonly ADMIN_HOME_ROOT=/home
readonly BEGIN_MARK='# BEGIN security_hardening.sh'
readonly END_MARK='# END security_hardening.sh'
readonly ADMIN_BEGIN='# BEGIN security_hardening.sh admin-key-only'
readonly ADMIN_END='# END security_hardening.sh admin-key-only'
ACTION=apply
SSH_PORT=""
PASSWORD_MODE=""
FIREWALL_MODE=""
LOGIN_USER="${SUDO_USER:-root}"
LOGIN_USER_SET=false
CREATE_ADMIN=""
ADMIN_SELECTION_SET=false
ROOT_LOGIN_MODE=""
ROOT_LOGIN_POLICY=""
PRESERVED_AUTH_SETTINGS=""
KEY_CONFIRMED=false
ASSUME_YES=false
SSH_SERVICE=""
SSH_SOCKET_MODE=false
SOCKET_LISTEN=()
SSHD=""
BACKUP=""
APPLYING=false
ALLOW_PORTS=()
OLD_PORTS=()
CONFIG_FILES=()
TEMP_FILES=()

log() { printf '%s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
用法: bash security_hardening.sh [选项]
      bash security_hardening.sh --confirm|--rollback|--status
适用 Debian/Ubuntu、systemd，支持常驻 OpenSSH 或 ssh.socket 激活。需要 root 权限。
  --ssh-port N          新 SSH 端口；交互默认保留当前端口
  --disable-password    关闭密码及键盘交互登录，仅允许公钥认证
  --keep-password       保留原有认证配置
  --login-user USER     检查该用户的公钥登录条件，默认 sudo 用户或 root
  --create-admin USER   交互创建管理员，安装公钥并授予免密 sudo；不支持 --yes
  --disable-root-login  关闭 root SSH 登录；须指定并验证非 root 管理员的密钥登录
  --keep-root-login     保留现有 root SSH 登录策略（交互默认）
  --key-login-confirmed 确认已实际使用公钥登录该用户；非交互关闭密码时必需
  --firewall MODE       configure：配置 UFW 并保留启用状态（交互默认）
                        enable：配置并启用 UFW；keep：不修改防火墙
  --allow PORT[/PROTO]  额外放行端口，PROTO 为 tcp/udp，默认 tcp；可重复
  --yes                 跳过交互；需显式指定端口、认证和防火墙选择
  --confirm             从新端口重新登录后确认并关闭旧 SSH 监听端口
  --rollback            恢复最近一次修改前的 SSH/UFW 配置
  --status              查看 SSH、UFW 和待确认状态
  -h, --help            显示帮助
应用后须在 10 分钟内从新端口执行 --confirm，否则自动回滚。
交互运行时，缺少公钥会提示粘贴并安装；验证登录前保留原认证配置。
默认保持原有 root 登录策略。不会生成私钥或修改云安全组。
新建管理员及安装公钥属于准备步骤，SSH/UFW 回滚不会删除该账号或公钥。
HELP
}

validate_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] || return 1
  ((10#$1 >= 1 && 10#$1 <= 65535))
}

normalize_allow_port() {
  local value=$1 port=${1%/*} protocol=tcp
  [[ "$value" != */* ]] || protocol=${value##*/}
  [[ "$protocol" == tcp || "$protocol" == udp ]] || die "端口协议仅支持 tcp 或 udp: $value"
  validate_port "$port" || die "无效的放行端口: $value"
  ALLOW_PORTS+=("$((10#$port))/$protocol")
}

parse_arguments() {
  local choices=0
  while (($#)); do
    case "$1" in
      --ssh-port|--login-user|--create-admin|--firewall|--allow)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 缺少参数"
        case "$1" in
          --ssh-port) SSH_PORT=$2 ;;
          --login-user) LOGIN_USER=$2; LOGIN_USER_SET=true ;;
          --create-admin) CREATE_ADMIN=$2; ADMIN_SELECTION_SET=true ;;
          --firewall) FIREWALL_MODE=$2 ;;
          --allow) normalize_allow_port "$2" ;;
        esac
        shift ;;
      --disable-password|--keep-password)
        [[ -z "$PASSWORD_MODE" ]] || die "只能指定一种认证选择"
        PASSWORD_MODE=${1#--} ;;
      --key-login-confirmed) KEY_CONFIRMED=true ;;
      --disable-root-login|--keep-root-login)
        [[ -z "$ROOT_LOGIN_MODE" ]] || die "只能指定一种 root 登录选择"
        ROOT_LOGIN_MODE=${1#--} ;;
      --yes) ASSUME_YES=true ;;
      --confirm|--rollback|--status) ACTION=${1#--}; choices=$((choices + 1)) ;;
      -h|--help) usage; exit 0 ;;
      *) die "未知参数: $1" ;;
    esac
    shift
  done
  ((choices <= 1)) || die "一次只能指定一个操作"
  [[ "$LOGIN_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_.-]*[$]?$ ]] || die "无效的登录用户名"
  if [[ -n "$CREATE_ADMIN" ]]; then
    [[ "$CREATE_ADMIN" =~ ^[a-z_][a-z0-9_-]{0,31}$ && "$CREATE_ADMIN" != root ]] || die "无效的管理员用户名"
    [[ "$LOGIN_USER_SET" != true || "$LOGIN_USER" == "$CREATE_ADMIN" ]] || die "新建管理员必须是本次登录验证用户"
    LOGIN_USER=$CREATE_ADMIN
  fi
  if [[ "$ACTION" != apply ]]; then
    [[ -z "$SSH_PORT$PASSWORD_MODE$FIREWALL_MODE$CREATE_ADMIN$ROOT_LOGIN_MODE" && ${#ALLOW_PORTS[@]} -eq 0 && "$KEY_CONFIRMED" == false ]] ||
      die "配置选项只能用于应用修改"
  fi
}

require_environment() {
  local name
  [[ "$(id -u)" == 0 ]] || die "请以 root 身份运行"
  [[ -r /etc/os-release ]] || die "无法识别系统"
  . /etc/os-release
  [[ "${ID:-}" == debian || "${ID:-}" == ubuntu ]] || die "目前仅支持 Debian/Ubuntu"
  for name in systemctl flock awk grep cp install mktemp ss getent ssh-keygen sort sed readlink ln mkdir cat date rm mv chmod chown; do
    command -v "$name" >/dev/null 2>&1 || die "缺少工具: $name"
  done
  SSHD=$(command -v sshd) || die "未安装 OpenSSH 服务端"
  if systemctl is-active --quiet ssh.socket; then
    SSH_SOCKET_MODE=true
    SSH_SERVICE=ssh.service
  elif systemctl is-active --quiet ssh.service; then SSH_SERVICE=ssh.service
  elif systemctl is-active --quiet sshd.service; then SSH_SERVICE=sshd.service
  elif [[ "$ACTION" != rollback ]]; then die "未找到正在运行的 SSH 服务"; fi
  mkdir -p -m 700 "$STATE_DIR"
  exec 9>"$STATE_DIR/lock"
  flock -w 30 9 || die "其他安全配置操作正在运行"
}

config_value() { awk -v key="$2" 'tolower($1) == key {$1=""; sub(/^ /, ""); print; exit}' <<<"$1"; }

connection_context() {
  local client client_port server server_port
  read -r client client_port server server_port <<<"${SSH_CONNECTION:-127.0.0.1 0 127.0.0.1 22}"
  printf 'user=%s,addr=%s,host=%s,laddr=%s,lport=%s' "${1:-$LOGIN_USER}" "$client" "$client" "$server" "${SSH_PORT:-$server_port}"
}

read_current_ports() {
  local port config
  config=$("$SSHD" -T)
  ROOT_LOGIN_POLICY=$(config_value "$("$SSHD" -T -C "$(connection_context root)")" permitrootlogin)
  PRESERVED_AUTH_SETTINGS=$(awk 'tolower($1) ~ /^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|authenticationmethods)$/ {print}' <<<"$config")
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    read_socket_listeners
    config=$(printf 'port %s\n' "${SOCKET_LISTEN[@]##*:}")
  fi
  while read -r port; do
    validate_port "$port" || die "无法识别 SSH 端口"
    OLD_PORTS+=("$port")
  done < <(awk 'tolower($1)=="port" {print $2}' <<<"$config" | sort -un)
  ((${#OLD_PORTS[@]})) || die "没有读取到 SSH 端口"
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    port=${SSH_CONNECTION##* }
    validate_port "$port" || die "SSH_CONNECTION 中的服务端端口无效"
    if ! printf '%s\n' "${OLD_PORTS[@]}" | grep -Fxq "$port"; then OLD_PORTS+=("$port"); fi
  fi
}

read_socket_listeners() {
  local value endpoint kind port
  value=$(systemctl show ssh.socket --property=Listen --value)
  SOCKET_LISTEN=()
  # systemd 的 Listen 属性形如 “[::]:22 (Stream) 0.0.0.0:2222 (Stream)”。
  while read -r endpoint kind; do
    [[ -n "$endpoint" ]] || continue
    port=${endpoint##*:}
    [[ "$kind" == '(Stream)' && ( "$endpoint" =~ ^\[[0-9a-fA-F:%.]+\]:[0-9]+$ ||
      "$endpoint" =~ ^[0-9.]+:[0-9]+$ ) ]] && validate_port "$port" ||
      die "无法安全处理 ssh.socket 的监听地址: $endpoint $kind"
    SOCKET_LISTEN+=("$endpoint")
  done < <(printf '%s\n' "$value" | awk '{for(i=1;i<NF;i+=2) print $i, $(i+1)}')
  ((${#SOCKET_LISTEN[@]})) || die "未读取到 ssh.socket 的 TCP 监听地址"
}

write_socket_config() {
  local stage=$1 endpoint
  [[ "$SSH_SOCKET_MODE" == true ]] || return 0
  mkdir -p -m 755 "${SOCKET_OVERRIDE%/*}"
  {
    printf '[Socket]\nListenStream=\n'
    # 复用实际 socket 的地址绑定，不把仅绑定某个网卡的 SSH 扩大为全网监听。
    for endpoint in "${SOCKET_LISTEN[@]}"; do
      printf 'ListenStream=%s:%s\n' "${endpoint%:*}" "$SSH_PORT"
      [[ "$stage" != pending ]] || printf 'ListenStream=%s\n' "$endpoint"
    done | sort -u
  } >"$SOCKET_OVERRIDE"
  chmod 644 "$SOCKET_OVERRIDE"
}

reload_ssh() {
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    systemctl daemon-reload
    local actual expected
    actual=$(read_socket_listeners; printf '%s\n' "${SOCKET_LISTEN[@]}" | sort -u)
    expected=$(sed -n 's/^ListenStream=\(.\{1,\}\)$/\1/p' "$SOCKET_OVERRIDE" | sort -u)
    [[ "$actual" == "$expected" ]] || die "SSH socket 有效监听与计划不符，请检查其他 systemd 覆盖配置"
    # 必须一同重启，确保 sshd 不再持有旧的监听描述符；KillMode=process 保留已登录会话。
    systemctl restart ssh.socket "$SSH_SERVICE"
  else
    systemctl reload "$SSH_SERVICE"
  fi
}

select_options() {
  local answer port=${OLD_PORTS[0]:-22}
  [[ -z "${SSH_CONNECTION:-}" ]] || port=${SSH_CONNECTION##* }
  if [[ "$ASSUME_YES" == true ]]; then
    [[ -z "$CREATE_ADMIN" ]] || die "新建管理员需要交互输入公钥和验证登录，请去掉 --yes"
    ROOT_LOGIN_MODE=${ROOT_LOGIN_MODE:-keep-root-login}
    [[ -n "$SSH_PORT" && -n "$PASSWORD_MODE" && -n "$FIREWALL_MODE" ]] ||
      die "--yes 需显式指定 --ssh-port、认证选择和 --firewall"
  else
    [[ -t 0 ]] || die "非交互运行请使用明确的选项和 --yes"
    if [[ -z "$SSH_PORT" ]]; then
      read -r -p "新的 SSH 端口（默认 ${port}）: " answer
      SSH_PORT=${answer:-$port}
    fi
    if [[ "$ADMIN_SELECTION_SET" != true ]]; then
      read -r -p '是否新建通过 SSH 公钥登录的管理员（可免密 sudo）？(y/N): ' answer
      if [[ "$answer" =~ ^[Yy]$ ]]; then
        read -r -p '新管理员用户名（小写字母、数字、下划线或短横线）: ' CREATE_ADMIN
        [[ "$CREATE_ADMIN" =~ ^[a-z_][a-z0-9_-]{0,31}$ && "$CREATE_ADMIN" != root ]] || die "无效的管理员用户名"
        LOGIN_USER=$CREATE_ADMIN
      fi
      ADMIN_SELECTION_SET=true
    fi
    if [[ -z "$ROOT_LOGIN_MODE" ]]; then
      read -r -p '是否关闭 root 的 SSH 登录？(y/N): ' answer
      if [[ "$answer" =~ ^[Yy]$ ]]; then ROOT_LOGIN_MODE=disable-root-login; else ROOT_LOGIN_MODE=keep-root-login; fi
    fi
    if [[ "$ROOT_LOGIN_MODE" == disable-root-login && "$LOGIN_USER" == root ]]; then
      read -r -p '用于替代 root 登录的现有管理员用户名: ' LOGIN_USER
      [[ "$LOGIN_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_.-]*[$]?$ && "$LOGIN_USER" != root ]] || die "关闭 root 登录需要非 root 管理员"
    fi
    if [[ -z "$PASSWORD_MODE" ]]; then
      read -r -p '是否关闭密码及键盘交互登录，仅保留公钥？(y/N): ' answer
      if [[ "$answer" =~ ^[Yy]$ ]]; then PASSWORD_MODE=disable-password; else PASSWORD_MODE=keep-password; fi
    fi
    if [[ -z "$FIREWALL_MODE" ]]; then
      log '防火墙：1) 配置并保持启用状态  2) 配置并启用  3) 不修改'
      read -r -p '选择（默认 1）: ' answer
      case "${answer:-1}" in 1) FIREWALL_MODE=configure ;; 2) FIREWALL_MODE=enable ;; 3) FIREWALL_MODE=keep ;; *) die "无效选择" ;; esac
      if [[ "$FIREWALL_MODE" != keep ]]; then
        read -r -p '额外放行的业务端口（空格分隔，如 443/tcp 443/udp；默认不新增）: ' answer
        local -a ports
        read -r -a ports <<<"$answer"
        for port in ${ports[@]+"${ports[@]}"}; do normalize_allow_port "$port"; done
      fi
    fi
  fi
  validate_port "$SSH_PORT" || die "SSH 端口必须是 1-65535"
  SSH_PORT=$((10#$SSH_PORT))
  case "$FIREWALL_MODE" in configure|enable|keep) ;; *) die "无效的防火墙模式" ;; esac
  [[ "$ROOT_LOGIN_MODE" != disable-root-login || "$LOGIN_USER" != root ]] || die "关闭 root 登录需要非 root 管理员"
  if [[ "$ASSUME_YES" == true && ( "$PASSWORD_MODE" == disable-password || "$ROOT_LOGIN_MODE" == disable-root-login ) && "$KEY_CONFIRMED" != true ]]; then
    die "非交互关闭密码或 root 登录需要 --key-login-confirmed"
  fi
}

create_administrator() {
  local answer hash temp sudoers home="$ADMIN_HOME_ROOT/$CREATE_ADMIN"
  [[ -n "$CREATE_ADMIN" ]] || return 0
  getent passwd "$CREATE_ADMIN" >/dev/null && die "用户已存在；请改用 --login-user $CREATE_ADMIN"
  sudoers="$SUDOERS_DIR/90-vps-security-$CREATE_ADMIN"
  [[ ! -e "$sudoers" && ! -L "$sudoers" && ! -L "$SUDOERS_DIR" &&
     ( ! -e "$SUDOERS_DIR" || -d "$SUDOERS_DIR" ) ]] || die "管理员 sudo 配置路径已存在或不是普通目录"
  [[ ! -e "$home" && ! -L "$home" && -d "$ADMIN_HOME_ROOT" && ! -L "$ADMIN_HOME_ROOT" ]] || die "管理员家目录已存在或路径不可安全使用"
  log "将创建管理员 ${CREATE_ADMIN}，使用 SSH 公钥登录并可免密 sudo。账号、公钥和 sudo 授权在 SSH/UFW 回滚后保留。"
  read -r -p '创建此管理员并继续安装公钥？(y/N): ' answer
  [[ "$answer" =~ ^[Yy]$ ]] || die "已取消创建管理员，未修改 SSH 配置"
  if ! command -v sudo >/dev/null || ! command -v visudo >/dev/null || ! command -v openssl >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y sudo openssl
  fi
  command -v useradd >/dev/null && command -v usermod >/dev/null || die "缺少 useradd/usermod，请先安装 passwd 软件包"
  visudo -c >/dev/null || die "现有 sudo 配置未通过校验"
  # 使用不可获知的随机密码摘要，兼容 UsePAM=no 时拒绝锁定账号的 OpenSSH；SSH 另有公钥限定。
  hash=$(openssl rand -base64 48 | openssl passwd -6 -stdin)
  [[ "$hash" == '$6$'* ]] || die "无法初始化管理员认证信息"
  useradd --create-home --home-dir "$home" --shell /bin/bash --password "$hash" "$CREATE_ADMIN"
  chmod 700 "$home"
  if getent group sudo >/dev/null; then usermod -aG sudo "$CREATE_ADMIN"; fi
  mkdir -p -m 750 "$SUDOERS_DIR"
  temp=$(mktemp /tmp/vps-security-sudo.XXXXXX)
  TEMP_FILES+=("$temp")
  printf '%s ALL=(ALL:ALL) NOPASSWD: ALL\n' "$CREATE_ADMIN" >"$temp"
  visudo -cf "$temp" >/dev/null || die "管理员 sudo 授权未通过校验"
  install -m 440 -o root -g root "$temp" "$sudoers"
  if ! visudo -c >/dev/null; then rm -f -- "$sudoers"; die "sudo 配置验证失败，已移除本次授权"; fi
  KEY_CONFIRMED=false
  log "管理员已创建: ${CREATE_ADMIN}；接下来安装其 SSH 公钥。"
}

check_administrator() {
  [[ "$ROOT_LOGIN_MODE" == disable-root-login || -n "$CREATE_ADMIN" ]] || return 0
  [[ "$LOGIN_USER" != root ]] || die "关闭 root 登录需要非 root 管理员"
  command -v sudo >/dev/null && sudo -n -l -U "$LOGIN_USER" -- /bin/sh -c id >/dev/null 2>&1 ||
    die "未确认 ${LOGIN_USER} 具有 sudo 管理权限，保留 root 登录"
}

write_public_key() {
  local public_key=${1%$'\r'} target=$2 user_uid=$3 user_gid=$4 home=$5
  local validation temp key_type key_data backup
  [[ "$public_key" != *$'\n'* && "$public_key" != *$'\r'* &&
     "$public_key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com)[[:space:]]+[A-Za-z0-9+/]+={0,3}([[:space:]].*)?$ ]] || {
    warn "请输入公钥文件中的完整单行（如 ssh-ed25519 ...），不要输入私钥"
    return 1
  }
  validation=$(mktemp /tmp/vps-security-key.XXXXXX) || die "无法创建公钥校验文件"
  TEMP_FILES+=("$validation")
  printf '%s\n' "$public_key" >"$validation" || die "无法写入公钥校验文件"
  if ! ssh-keygen -l -f "$validation" >/dev/null 2>&1; then
    warn "公钥内容未通过 ssh-keygen 校验"
    return 1
  fi
  [[ "$target" == "$home/.ssh/authorized_keys" || "$target" == "$home/.ssh/authorized_keys2" ]] ||
    die "交互安装仅支持用户家目录中的标准 authorized_keys 文件"
  [[ -d "$home" && ! -L "$home" && ! -L "$home/.ssh" && ! -L "$target" ]] ||
    die "公钥目标路径不存在或包含符号链接，未写入"
  [[ ! -e "$target" || -f "$target" ]] || die "公钥目标不是普通文件"
  IFS=' ' read -r key_type key_data _ <<<"$public_key"
  if [[ -f "$target" ]] && awk -v type="$key_type" -v data="$key_data" '
    /^[[:space:]]*#/ {next}
    {for(i=1;i<NF;i++) if($i==type && $(i+1)==data) found=1}
    END {exit !found}
  ' "$target"; then
    log "同一公钥已存在，未重复写入: $target"
    return 0
  fi
  mkdir -p -m 700 "$home/.ssh" || die "无法创建 .ssh 目录"
  chown "$user_uid:$user_gid" "$home/.ssh" || die "无法设置 .ssh 目录归属"
  chmod 700 "$home/.ssh" || die "无法设置 .ssh 目录权限"
  if [[ -f "$target" ]]; then
    mkdir -p -m 700 "$STATE_DIR/public-key-backups" || die "无法创建公钥备份目录"
    backup="$STATE_DIR/public-key-backups/$(date +%Y%m%d-%H%M%S)-$user_uid-$$"
    cp -a -- "$target" "$backup" || die "无法备份原公钥文件"
    log "原公钥文件备份: $backup"
  fi
  temp=$(mktemp "$home/.ssh/.authorized_keys.XXXXXX") || die "无法创建公钥写入临时文件"
  TEMP_FILES+=("$temp")
  if [[ -f "$target" ]]; then
    cat "$target" >"$temp" || die "无法读取原公钥文件"
    printf '\n' >>"$temp" || die "无法写入公钥分隔行"
  fi
  printf '%s\n' "$public_key" >>"$temp" || die "无法写入新公钥"
  chown "$user_uid:$user_gid" "$temp" || die "无法设置公钥文件归属"
  chmod 600 "$temp" || die "无法设置公钥文件权限"
  mv -fT -- "$temp" "$target" || die "无法保存公钥文件，原文件已保留"
  log "公钥已写入: ${target}（目录权限 700，文件权限 600）"
  ssh-keygen -l -f "$validation" | awk '{print "公钥指纹: " $1 " " $2}'
}

check_public_key() {
  local required=${1:-true} entry user_uid user_gid home shell effective paths path root_policy target="" public_key
  entry=$(getent passwd "$LOGIN_USER") || die "登录用户不存在: $LOGIN_USER"
  IFS=: read -r _ _ user_uid user_gid _ home shell <<<"$entry"
  [[ "$shell" != */nologin && "$shell" != */false ]] || die "该用户没有可用的登录 shell"
  effective=$("$SSHD" -T -C "$(connection_context)")
  root_policy=$(config_value "$effective" permitrootlogin)
  if [[ "$LOGIN_USER" == root && "$root_policy" == no ]]; then
    [[ "$required" == true ]] || { warn "现有策略禁止 root 登录，跳过 root 公钥安装"; return 0; }
    die "现有策略禁止 root 登录，请指定可登录的用户"
  fi
  paths=$(config_value "$effective" authorizedkeysfile)
  local -a key_paths
  read -r -a key_paths <<<"$paths"
  for path in ${key_paths[@]+"${key_paths[@]}"}; do
    [[ "$path" != none ]] || continue
    path=${path//%h/$home}; path=${path//%u/$LOGIN_USER}; path=${path//%U/$user_uid}; path=${path//%%/%}
    [[ "$path" == /* ]] || path="$home/$path"
    if [[ -s "$path" ]] && ssh-keygen -l -f "$path" >/dev/null 2>&1; then return 0; fi
    if [[ -z "$target" && ( "$path" == "$home/.ssh/authorized_keys" || "$path" == "$home/.ssh/authorized_keys2" ) ]]; then
      target=$path
    fi
  done
  if [[ "$ASSUME_YES" == true || ! -t 0 ]]; then
    [[ "$required" == true ]] || return 0
    die "${LOGIN_USER} 未找到可识别的公钥；请交互运行并输入公钥，或先安装公钥后重试"
  fi
  if [[ -z "$target" ]]; then
    [[ "$required" == true ]] || { warn "当前配置使用自定义公钥来源，跳过公钥安装"; return 0; }
    die "当前 AuthorizedKeysFile 未启用标准用户公钥文件，请先调整配置"
  fi
  log "${LOGIN_USER} 尚未配置可用公钥。请从客户端的 .pub 文件复制公钥完整一行。"
  while true; do
    read -r -p '粘贴公钥完整一行（不关闭密码时可回车跳过；不要粘贴私钥）: ' public_key
    if [[ -z "$public_key" ]]; then
      [[ "$required" == true ]] || { log '已跳过公钥安装，保留原有认证配置。'; return 0; }
      die "未提供公钥，已取消关闭密码登录"
    fi
    if write_public_key "$public_key" "$target" "$user_uid" "$user_gid" "$home"; then break; fi
  done
  # 新写入的公钥尚未实测，已有命令行确认不能代替本次验证。
  KEY_CONFIRMED=false
}

confirm_key_login() {
  local answer
  [[ "$KEY_CONFIRMED" != true ]] || return 0
  log "当前 SSH 认证配置尚未修改。请保留此会话，另开终端，用公钥登录 ${LOGIN_USER} 验证；管理员还应执行 sudo -n id 确认权限。"
  read -r -p '已经实际使用公钥重新登录成功，继续应用登录限制？(y/N): ' answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    KEY_CONFIRMED=true
  else
    PASSWORD_MODE=keep-password
    ROOT_LOGIN_MODE=keep-root-login
    log '本次保留原有密码和 root 登录配置，继续其他安全配置；验证管理员公钥登录后可再次运行。'
  fi
}

preflight() {
  local file port include basename
  [[ -f "${BASH_SOURCE[0]}" ]] || die "请从保存的脚本文件运行，以便安装自动回滚程序"
  [[ ! -e "$PENDING" && ! -L "$PENDING" ]] || die "上次修改尚未确认，请先 --confirm 或 --rollback"
  [[ -z "$CREATE_ADMIN" ]] || ! getent passwd "$CREATE_ADMIN" >/dev/null || die "新管理员用户名已存在"
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    [[ "$(systemctl show ssh.socket --property=Accept --value)" == no &&
       "$(systemctl show ssh.socket --property=Triggers --value)" == ssh.service ]] ||
      die "仅支持 Accept=no 且激活 ssh.service 的 ssh.socket"
    [[ "$(systemctl show "$SSH_SERVICE" --property=KillMode --value)" == process ]] ||
      die "SSH socket 重启需要 KillMode=process 以保留当前会话，请先检查服务设置"
    [[ ! -L "${SOCKET_OVERRIDE%/*}" && ! -L "$SOCKET_OVERRIDE" &&
       ( ! -e "$SOCKET_OVERRIDE" || -f "$SOCKET_OVERRIDE" ) ]] || die "SSH socket 配置路径不是普通文件或目录"
  fi
  "$SSHD" -t
  CONFIG_FILES=("$SSH_CONFIG")
  for file in "$SSH_CONFIG_D"/*.conf; do [[ ! -f "$file" ]] || CONFIG_FILES+=("$file"); done
  for file in "${CONFIG_FILES[@]}"; do
    [[ ! -L "$file" ]] || die "SSH 配置是符号链接，请先确认其管理方式: $file"
    while read -r include; do
      include=${include//\"/}
      basename=${include#"$SSH_CONFIG_D/"}
      [[ "$include" == "$SSH_CONFIG_D/"* && "$basename" != */* && "$basename" == *.conf ]] ||
        die "暂不支持标准 sshd_config.d 目录以外的 Include，请先处理: $include"
    done < <(awk 'tolower($1)=="include" {for(i=2;i<=NF;i++) {if($i ~ /^#/) break; print $i}}' "$file")
    if awk 'tolower($1)=="listenaddress" && ($2 ~ /^\[.*\]:[0-9]+$/ || $2 ~ /^[^:]+:[0-9]+$/) {found=1} END {exit !found}' "$file"; then
      die "发现绑定指定端口的 ListenAddress，需先调整该配置: $file"
    fi
    if [[ "$PASSWORD_MODE" == disable-password || "$ROOT_LOGIN_MODE" == disable-root-login ]] && awk -v begin="$ADMIN_BEGIN" -v end="$ADMIN_END" '
      index($0,begin " ")==1 {owned=1; next} index($0,end " ")==1 {owned=0; next} owned {next}
      /^[[:space:]]*#/ {next}
      tolower($1)=="match" {matched=1; next}
      matched && tolower($1) ~ /^(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|authenticationmethods|pubkeyauthentication|permitrootlogin)$/ {conflict=1}
      END {exit !conflict}
    ' "$file"; then die "Match 块存在自定义认证策略，请先处理该配置: $file"; fi
  done
  for port in "${OLD_PORTS[@]}"; do [[ "$SSH_PORT" != "$port" ]] || return 0; done
  if ss -H -lntu | awk -v port="$SSH_PORT" '$5 ~ (":" port "$") {found=1} END {exit !found}'; then
    die "新 SSH 端口已被其他服务占用: $SSH_PORT"
  fi
}

prepare_firewall() {
  [[ "$FIREWALL_MODE" != keep ]] || return 0
  systemctl is-active --quiet firewalld.service && die "firewalld 正在运行，不能同时配置 UFW"
  if ! command -v ufw >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ufw
  fi
  command -v ufw >/dev/null 2>&1 || die "UFW 安装失败"
}

save_backup() {
  local file index=0
  BACKUP="$STATE_DIR/backups/$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p -m 700 "$BACKUP"
  : >"$BACKUP/ssh-files.tsv"
  for file in "${CONFIG_FILES[@]}"; do
    cp -a -- "$file" "$BACKUP/ssh-$index"
    printf '%s\t%s\n' "$index" "$file" >>"$BACKUP/ssh-files.tsv"
    index=$((index + 1))
  done
  printf '%s\n' "$SSH_SERVICE" >"$BACKUP/ssh-service"
  printf '%s\n' "$SSH_SOCKET_MODE" >"$BACKUP/socket-mode"
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    printf '%s\n' "${SOCKET_LISTEN[@]}" >"$BACKUP/socket-listen"
    if [[ -f "$SOCKET_OVERRIDE" ]]; then cp -a -- "$SOCKET_OVERRIDE" "$BACKUP/socket-override"; fi
  fi
  printf '%s\n' "$SSH_PORT" >"$BACKUP/new-port"
  printf '%s\n' "${OLD_PORTS[@]}" >"$BACKUP/old-ports"
  printf '%s\n' "$LOGIN_USER" >"$BACKUP/login-user"
  printf '%s\n' "${SSH_CONNECTION:-}" >"$BACKUP/original-connection"
  printf '%s\n' "$PASSWORD_MODE" >"$BACKUP/password-mode"
  printf '%s\n' "$ROOT_LOGIN_MODE" >"$BACKUP/root-login-mode"
  printf '%s\n' "$CREATE_ADMIN" >"$BACKUP/admin-user"
  printf '%s\n' "$ROOT_LOGIN_POLICY" >"$BACKUP/root-login-policy"
  printf '%s\n' "$PRESERVED_AUTH_SETTINGS" >"$BACKUP/preserved-auth"
  printf '%s\n' "$FIREWALL_MODE" >"$BACKUP/firewall-mode"
  if [[ "$FIREWALL_MODE" != keep ]]; then
    cp -a -- "$UFW_DIR" "$BACKUP/ufw"
    cp -a -- "$UFW_DEFAULT" "$BACKUP/ufw-default"
    if LC_ALL=C ufw status | grep -Fxq 'Status: active'; then echo active >"$BACKUP/ufw-status"; else echo inactive >"$BACKUP/ufw-status"; fi
  fi
  if [[ "${BASH_SOURCE[0]}" != "$RUNNER" ]]; then install -m 700 "${BASH_SOURCE[0]}" "$RUNNER"; fi
  ln -sfn "$BACKUP" "$LATEST"
  ln -sfn "$BACKUP" "$PENDING"
  log "备份: $BACKUP"
}

write_ssh_config() {
  local file temp port stage=$1
  for file in "${CONFIG_FILES[@]}"; do
    temp=$(mktemp /tmp/vps-security-ssh.XXXXXX)
    TEMP_FILES+=("$temp")
    if [[ "$file" == "$SSH_CONFIG" ]]; then
      printf '%s\n' "$BEGIN_MARK" >"$temp"
      printf 'Port %s\n' "$SSH_PORT" >>"$temp"
      if [[ "$stage" == pending ]]; then
        for port in "${OLD_PORTS[@]}"; do [[ "$port" == "$SSH_PORT" ]] || printf 'Port %s\n' "$port" >>"$temp"; done
      fi
      if [[ "$PASSWORD_MODE" == disable-password ]]; then
        printf 'PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nAuthenticationMethods publickey\n' >>"$temp"
      elif [[ -n "$PRESERVED_AUTH_SETTINGS" ]]; then
        printf '%s\n' "$PRESERVED_AUTH_SETTINGS" >>"$temp"
      fi
      if [[ "$ROOT_LOGIN_MODE" == disable-root-login ]]; then printf 'PermitRootLogin no\n' >>"$temp"
      elif [[ -n "$ROOT_LOGIN_POLICY" ]]; then printf 'PermitRootLogin %s\n' "$ROOT_LOGIN_POLICY" >>"$temp"; fi
      printf '%s\n' "$END_MARK" >>"$temp"
    else : >"$temp"; fi
    awk -v begin="$BEGIN_MARK" -v end="$END_MARK" -v admin_begin="$ADMIN_BEGIN $CREATE_ADMIN" -v admin_end="$ADMIN_END $CREATE_ADMIN" -v admin="$CREATE_ADMIN" '
      admin!="" && $0==admin_begin {admin_block=1; next} admin!="" && $0==admin_end {admin_block=0; next} admin_block {next}
      $0==begin {block=1; next} $0==end {block=0; next} block {next}
      tolower($1)=="port" {print "# security_hardening.sh disabled: " $0; next}
      {print}
    ' "$file" >>"$temp"
    if [[ "$file" == "$SSH_CONFIG" && -n "$CREATE_ADMIN" ]]; then
      printf '\n%s %s\nMatch User %s\n  PubkeyAuthentication yes\n  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n  AuthenticationMethods publickey\n%s %s\n' "$ADMIN_BEGIN" "$CREATE_ADMIN" "$CREATE_ADMIN" "$ADMIN_END" "$CREATE_ADMIN" >>"$temp"
    fi
    cat "$temp" >"$file"
  done
}

verify_ssh_config() {
  local effective port actual expected stage=$1
  "$SSHD" -t
  effective=$("$SSHD" -T -C "$(connection_context)")
  actual=$(awk 'tolower($1)=="port" {print $2}' <<<"$effective" | sort -un)
  expected=$( { echo "$SSH_PORT"; [[ "$stage" != pending ]] || printf '%s\n' "${OLD_PORTS[@]}"; } | sort -un)
  [[ "$actual" == "$expected" ]] || die "有效 SSH 端口与计划不符，可能存在其他 Include 或服务启动参数"
  if [[ "$PASSWORD_MODE" == disable-password ]]; then
    [[ "$(config_value "$effective" passwordauthentication)" == no &&
       "$(config_value "$effective" kbdinteractiveauthentication)" == no &&
       "$(config_value "$effective" pubkeyauthentication)" == yes &&
       "$(config_value "$effective" authenticationmethods)" == publickey ]] || die "公钥认证设置未按预期生效"
  fi
  if [[ "$ROOT_LOGIN_MODE" == disable-root-login ]]; then
    [[ "$(config_value "$("$SSHD" -T -C "$(connection_context root)")" permitrootlogin)" == no ]] || die "关闭 root SSH 登录的设置未生效"
  fi
  if [[ -n "$CREATE_ADMIN" ]]; then
    [[ "$(config_value "$effective" authenticationmethods)" == publickey &&
       "$(config_value "$effective" passwordauthentication)" == no &&
       "$(config_value "$effective" kbdinteractiveauthentication)" == no ]] || die "管理员 SSH 公钥登录限制未生效"
  fi
}

arm_rollback() {
  cat >"$SERVICE_FILE" <<UNIT
[Unit]
Description=Rollback unconfirmed VPS security changes
ConditionPathExists=$PENDING
[Service]
Type=oneshot
ExecStart=/bin/bash $RUNNER --rollback
Restart=on-failure
RestartSec=30s
UNIT
  cat >"$TIMER_FILE" <<UNIT
[Unit]
Description=Rollback VPS security changes after 10 minutes
[Timer]
OnActiveSec=10min
AccuracySec=1s
Unit=vps-security-rollback.service
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "$TIMER"
  systemctl is-active --quiet "$TIMER" || die "自动回滚计时器未启动"
}

apply_firewall() {
  local port
  [[ "$FIREWALL_MODE" != keep ]] || return 0
  # 同时保护 IPv4/IPv6；UFW 原有业务规则保留。
  if grep -q '^IPV6=' "$UFW_DEFAULT"; then
    sed -i 's/^IPV6=.*/IPV6=yes/' "$UFW_DEFAULT"
  else echo IPV6=yes >>"$UFW_DEFAULT"; fi
  for port in "$SSH_PORT" "${OLD_PORTS[@]}"; do ufw prepend limit "$port/tcp"; done
  for port in ${ALLOW_PORTS[@]+"${ALLOW_PORTS[@]}"}; do ufw allow "$port"; done
  ufw default deny incoming
  ufw default allow outgoing
  ufw logging low
  if [[ "$FIREWALL_MODE" == enable ]]; then ufw --force enable
  elif [[ "$(<"$BACKUP/ufw-status")" == active ]]; then ufw reload; fi
}

verify_listener() {
  local port
  systemctl is-active --quiet "$SSH_SERVICE" || die "SSH 服务未运行"
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    systemctl is-active --quiet ssh.socket || die "SSH socket 未运行"
  fi
  ss -H -lnt | awk -v port="$SSH_PORT" '$4 ~ (":" port "$") {found=1} END {exit !found}' || die "新 SSH 端口未监听"
  for port in ${OLD_PORTS[@]+"${OLD_PORTS[@]}"}; do
    ss -H -lnt | awk -v port="$port" '$4 ~ (":" port "$") {found=1} END {exit !found}' || die "待确认的旧 SSH 端口未监听: $port"
  done
}

restore_backup() {
  local backup=$1 index file failed=0 mode service
  [[ -f "$backup/ssh-files.tsv" ]] || { warn "SSH 备份不完整"; return 1; }
  while IFS=$'\t' read -r index file; do
    cp -a -- "$backup/ssh-$index" "$file" || failed=1
  done <"$backup/ssh-files.tsv"
  service=$(<"$backup/ssh-service")
  SSH_SOCKET_MODE=false
  [[ ! -f "$backup/socket-mode" ]] || SSH_SOCKET_MODE=$(<"$backup/socket-mode")
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    if [[ -f "$backup/socket-override" ]]; then cp -a -- "$backup/socket-override" "$SOCKET_OVERRIDE" || failed=1
    else rm -f -- "$SOCKET_OVERRIDE" || failed=1; fi
  fi
  if "$SSHD" -t; then
    if [[ "$SSH_SOCKET_MODE" == true ]]; then
      systemctl daemon-reload || failed=1
      systemctl restart ssh.socket "$service" || failed=1
    elif systemctl is-active --quiet "$service"; then systemctl reload "$service" || failed=1
    else systemctl start "$service" || failed=1; fi
  else failed=1; fi
  mode=$(<"$backup/firewall-mode")
  if [[ "$mode" != keep ]]; then
    cp -a -- "$backup/ufw/." "$UFW_DIR/" || failed=1
    cp -a -- "$backup/ufw-default" "$UFW_DEFAULT" || failed=1
    if [[ "$(<"$backup/ufw-status")" == active ]]; then ufw --force enable || failed=1
    else ufw --force disable || failed=1; fi
  fi
  if ((failed == 0)); then
    systemctl disable --now "$TIMER" || return 1
    rm -f -- "$PENDING"
    echo rolled-back >"$backup/result"
    log "已恢复 SSH 和本次修改的 UFW 配置: $backup"
  else warn "恢复不完整，请通过服务商控制台检查；备份: $backup"; fi
  return "$failed"
}

on_error() {
  local status=$1 line=$2
  trap - ERR
  warn "第 ${line} 行失败（退出码 ${status}）"
  exit "$status"
}

cleanup() {
  local status=$? file
  trap - EXIT
  trap - ERR
  set +e
  if ((status != 0)) && [[ "$APPLYING" == true && -n "$BACKUP" ]]; then
    restore_backup "$BACKUP" || warn "自动恢复失败，待确认状态和备份已保留"
  fi
  for file in ${TEMP_FILES[@]+"${TEMP_FILES[@]}"}; do rm -f -- "$file"; done
  return "$status"
}
trap 'on_error $? $LINENO' ERR
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

apply_changes() {
  local answer
  read_current_ports
  select_options
  preflight
  create_administrator
  if [[ "$PASSWORD_MODE" == disable-password || "$ROOT_LOGIN_MODE" == disable-root-login || -n "$CREATE_ADMIN" ]]; then
    check_public_key
    check_administrator
    confirm_key_login
  elif [[ "$ASSUME_YES" != true ]]; then
    check_public_key false
  fi
  log "SSH 端口: ${OLD_PORTS[*]} -> ${SSH_PORT}（确认前同时保留旧端口）"
  log "认证: ${PASSWORD_MODE}；防火墙: ${FIREWALL_MODE}；额外放行: ${ALLOW_PORTS[*]:-无}"
  log "root SSH 登录: ${ROOT_LOGIN_MODE}；验证登录用户: ${LOGIN_USER}"
  if [[ "$FIREWALL_MODE" != keep ]]; then
    log 'UFW 将拒绝未放行的入站连接并允许出站连接；请确认业务端口已指定。当前监听情况：'
    ss -lntu
  fi
  if [[ "$ASSUME_YES" != true ]]; then
    read -r -p '应用修改并启用 10 分钟未确认自动回滚？(y/N): ' answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log '操作已取消。'; return 0; }
  fi
  prepare_firewall
  save_backup
  APPLYING=true
  arm_rollback
  # 先校验最终单端口配置，避免确认时才发现其他 Include 中的旧端口。
  write_ssh_config confirmed
  verify_ssh_config confirmed
  write_ssh_config pending
  verify_ssh_config pending
  write_socket_config pending
  apply_firewall
  reload_ssh
  verify_listener
  APPLYING=false
  log "已应用，等待确认；请保留当前会话，从新端口重新登录 ${LOGIN_USER}；关闭密码登录时必须使用公钥。"
  log "新会话中执行：sudo --preserve-env=SSH_CONNECTION bash $RUNNER --confirm（root 可省略 sudo）"
  log '10 分钟内未确认将自动回滚；可用 --rollback 立即恢复。云安全组需要自行放行新端口。'
}

confirm_changes() {
  local session_port caller port
  [[ -L "$PENDING" ]] || die "没有待确认的修改"
  BACKUP=$(readlink -f "$PENDING")
  SSH_PORT=$(<"$BACKUP/new-port")
  LOGIN_USER=$(<"$BACKUP/login-user")
  PASSWORD_MODE=$(<"$BACKUP/password-mode")
  ROOT_LOGIN_MODE=keep-root-login
  [[ ! -f "$BACKUP/root-login-mode" ]] || ROOT_LOGIN_MODE=$(<"$BACKUP/root-login-mode")
  CREATE_ADMIN=""
  [[ ! -f "$BACKUP/admin-user" ]] || CREATE_ADMIN=$(<"$BACKUP/admin-user")
  [[ ! -f "$BACKUP/root-login-policy" ]] || ROOT_LOGIN_POLICY=$(<"$BACKUP/root-login-policy")
  [[ ! -f "$BACKUP/preserved-auth" ]] || PRESERVED_AUTH_SETTINGS=$(<"$BACKUP/preserved-auth")
  SSH_SERVICE=$(<"$BACKUP/ssh-service")
  SSH_SOCKET_MODE=false
  [[ ! -f "$BACKUP/socket-mode" ]] || SSH_SOCKET_MODE=$(<"$BACKUP/socket-mode")
  SOCKET_LISTEN=()
  if [[ "$SSH_SOCKET_MODE" == true ]]; then
    while read -r port; do SOCKET_LISTEN+=("$port"); done <"$BACKUP/socket-listen"
  fi
  [[ -n "${SSH_CONNECTION:-}" ]] || die "请在新 SSH 连接中执行确认"
  session_port=${SSH_CONNECTION##* }
  [[ "$session_port" == "$SSH_PORT" ]] || die "当前连接不是新 SSH 端口，请重新连接后确认"
  [[ "$SSH_CONNECTION" != "$(<"$BACKUP/original-connection")" ]] || die "请从新的 SSH 连接确认，不要使用应用修改时的会话"
  caller=${SUDO_USER:-$(id -un)}
  [[ "$caller" == "$LOGIN_USER" ]] || die "请使用计划中的登录用户 ${LOGIN_USER} 重新连接并确认"
  OLD_PORTS=()
  CONFIG_FILES=()
  local index file
  while IFS=$'\t' read -r index file; do CONFIG_FILES+=("$file"); done <"$BACKUP/ssh-files.tsv"
  APPLYING=true
  write_ssh_config confirmed
  verify_ssh_config confirmed
  write_socket_config confirmed
  reload_ssh
  verify_listener
  while read -r port; do
    [[ "$port" != "$SSH_PORT" ]] || continue
    if ss -H -lnt | awk -v port="$port" '$4 ~ (":" port "$") {found=1} END {exit !found}'; then
      die "旧端口仍在监听，请检查 SSH 服务启动参数或其他服务: $port"
    fi
  done <"$BACKUP/old-ports"
  systemctl disable --now "$TIMER"
  rm -f -- "$PENDING"
  echo confirmed >"$BACKUP/result"
  APPLYING=false
  log "已确认 SSH 新端口 ${SSH_PORT}，旧 SSH 监听端口已关闭。原有 UFW 规则保留。"
}

show_status() {
  "$SSHD" -T | awk 'tolower($1) ~ /^(port|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|authenticationmethods|permitrootlogin)$/ {print}'
  if command -v ufw >/dev/null 2>&1; then ufw status verbose; else log 'UFW 未安装'; fi
  if [[ -L "$PENDING" ]]; then log "待确认备份: $(readlink -f "$PENDING")"; systemctl list-timers "$TIMER" --no-pager
  else log '没有待确认的修改'; fi
}

main() {
  parse_arguments "$@"
  require_environment
  case "$ACTION" in
    apply) apply_changes ;;
    confirm) confirm_changes ;;
    rollback)
      [[ -L "$PENDING" || -L "$LATEST" ]] || die "没有可恢复的备份"
      if [[ -L "$PENDING" ]]; then BACKUP=$(readlink -f "$PENDING"); else BACKUP=$(readlink -f "$LATEST"); fi
      restore_backup "$BACKUP" ;;
    status) show_status ;;
  esac
}
main "$@"
