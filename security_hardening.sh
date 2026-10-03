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
readonly BEGIN_MARK='# BEGIN security_hardening.sh'
readonly END_MARK='# END security_hardening.sh'
ACTION=apply
SSH_PORT=""
PASSWORD_MODE=""
FIREWALL_MODE=""
LOGIN_USER="${SUDO_USER:-root}"
KEY_CONFIRMED=false
ASSUME_YES=false
SSH_SERVICE=""
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
适用 Debian/Ubuntu、systemd 和常驻 OpenSSH 服务。需要 root 权限。
  --ssh-port N          新 SSH 端口；交互默认保留当前端口
  --disable-password    关闭密码及键盘交互登录，仅允许公钥认证
  --keep-password       保留原有认证配置
  --login-user USER     检查该用户的公钥登录条件，默认 sudo 用户或 root
  --key-login-confirmed 确认已实际使用公钥登录该用户；关闭密码登录必需
  --firewall MODE       configure：配置 UFW 并保留启用状态（交互默认）
                        enable：配置并启用 UFW；keep：不修改防火墙
  --allow PORT[/PROTO]  额外放行端口，PROTO 为 tcp/udp，默认 tcp；可重复
  --yes                 跳过交互；需显式指定端口、认证和防火墙选择
  --confirm             从新端口重新登录后确认并关闭旧 SSH 监听端口
  --rollback            恢复最近一次修改前的 SSH/UFW 配置
  --status              查看 SSH、UFW 和待确认状态
  -h, --help            显示帮助
应用后须在 10 分钟内从新端口执行 --confirm，否则自动回滚。
保持原有 root 登录策略。不会生成、上传公钥或修改云安全组。
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
      --ssh-port|--login-user|--firewall|--allow)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 缺少参数"
        case "$1" in
          --ssh-port) SSH_PORT=$2 ;;
          --login-user) LOGIN_USER=$2 ;;
          --firewall) FIREWALL_MODE=$2 ;;
          --allow) normalize_allow_port "$2" ;;
        esac
        shift ;;
      --disable-password|--keep-password)
        [[ -z "$PASSWORD_MODE" ]] || die "只能指定一种认证选择"
        PASSWORD_MODE=${1#--} ;;
      --key-login-confirmed) KEY_CONFIRMED=true ;;
      --yes) ASSUME_YES=true ;;
      --confirm|--rollback|--status) ACTION=${1#--}; choices=$((choices + 1)) ;;
      -h|--help) usage; exit 0 ;;
      *) die "未知参数: $1" ;;
    esac
    shift
  done
  ((choices <= 1)) || die "一次只能指定一个操作"
  [[ "$LOGIN_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_.-]*[$]?$ ]] || die "无效的登录用户名"
  if [[ "$ACTION" != apply ]]; then
    [[ -z "$SSH_PORT$PASSWORD_MODE$FIREWALL_MODE" && ${#ALLOW_PORTS[@]} -eq 0 && "$KEY_CONFIRMED" == false ]] ||
      die "配置选项只能用于应用修改"
  fi
}

require_environment() {
  local name
  [[ "$(id -u)" == 0 ]] || die "请以 root 身份运行"
  [[ -r /etc/os-release ]] || die "无法识别系统"
  . /etc/os-release
  [[ "${ID:-}" == debian || "${ID:-}" == ubuntu ]] || die "目前仅支持 Debian/Ubuntu"
  for name in systemctl flock awk grep cp install mktemp ss getent ssh-keygen sort sed readlink ln mkdir cat date rm; do
    command -v "$name" >/dev/null 2>&1 || die "缺少工具: $name"
  done
  SSHD=$(command -v sshd) || die "未安装 OpenSSH 服务端"
  if systemctl is-active --quiet ssh.service; then SSH_SERVICE=ssh.service
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
  printf 'user=%s,addr=%s,host=%s,laddr=%s,lport=%s' "$LOGIN_USER" "$client" "$client" "$server" "${SSH_PORT:-$server_port}"
}

read_current_ports() {
  local port config
  config=$("$SSHD" -T)
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

select_options() {
  local answer port=${OLD_PORTS[0]:-22}
  [[ -z "${SSH_CONNECTION:-}" ]] || port=${SSH_CONNECTION##* }
  if [[ "$ASSUME_YES" == true ]]; then
    [[ -n "$SSH_PORT" && -n "$PASSWORD_MODE" && -n "$FIREWALL_MODE" ]] ||
      die "--yes 需显式指定 --ssh-port、认证选择和 --firewall"
  else
    [[ -t 0 ]] || die "非交互运行请使用明确的选项和 --yes"
    if [[ -z "$SSH_PORT" ]]; then
      read -r -p "新的 SSH 端口（默认 ${port}）: " answer
      SSH_PORT=${answer:-$port}
    fi
    if [[ -z "$PASSWORD_MODE" ]]; then
      read -r -p '是否关闭密码及键盘交互登录，仅保留公钥？(y/N): ' answer
      if [[ "$answer" =~ ^[Yy]$ ]]; then PASSWORD_MODE=disable-password; else PASSWORD_MODE=keep-password; fi
    fi
    if [[ "$PASSWORD_MODE" == disable-password && "$KEY_CONFIRMED" != true ]]; then
      read -r -p "已用公钥实际登录 ${LOGIN_USER} 并验证成功？(y/N): " answer
      [[ "$answer" =~ ^[Yy]$ ]] || die "请先验证公钥登录，再关闭密码登录"
      KEY_CONFIRMED=true
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
  [[ "$PASSWORD_MODE" != disable-password || "$KEY_CONFIRMED" == true ]] || die "关闭密码登录需要 --key-login-confirmed"
}

check_public_key() {
  local entry user_uid user_gid home shell effective paths path root_policy
  entry=$(getent passwd "$LOGIN_USER") || die "登录用户不存在: $LOGIN_USER"
  IFS=: read -r _ _ user_uid user_gid _ home shell <<<"$entry"
  [[ "$shell" != */nologin && "$shell" != */false ]] || die "该用户没有可用的登录 shell"
  effective=$("$SSHD" -T -C "$(connection_context)")
  root_policy=$(config_value "$effective" permitrootlogin)
  [[ "$LOGIN_USER" != root || "$root_policy" != no ]] || die "现有策略禁止 root 登录，请指定可登录的用户"
  paths=$(config_value "$effective" authorizedkeysfile)
  local -a key_paths
  read -r -a key_paths <<<"$paths"
  for path in ${key_paths[@]+"${key_paths[@]}"}; do
    [[ "$path" != none ]] || continue
    path=${path//%h/$home}; path=${path//%u/$LOGIN_USER}; path=${path//%U/$user_uid}; path=${path//%%/%}
    [[ "$path" == /* ]] || path="$home/$path"
    if [[ -s "$path" ]] && ssh-keygen -l -f "$path" >/dev/null 2>&1; then return 0; fi
  done
  die "${LOGIN_USER} 的 AuthorizedKeysFile 中未找到可识别的公钥；不会关闭密码登录"
}

preflight() {
  local file port include basename
  [[ -f "${BASH_SOURCE[0]}" ]] || die "请从保存的脚本文件运行，以便安装自动回滚程序"
  [[ ! -e "$PENDING" && ! -L "$PENDING" ]] || die "上次修改尚未确认，请先 --confirm 或 --rollback"
  systemctl is-active --quiet ssh.socket && die "检测到 SSH socket 激活模式；本脚本仅支持常驻 SSH 服务，未修改配置"
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
    if [[ "$PASSWORD_MODE" == disable-password ]] && awk '
      /^[[:space:]]*#/ {next}
      tolower($1)=="match" {matched=1; next}
      matched && tolower($1) ~ /^(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|authenticationmethods|pubkeyauthentication)$/ {conflict=1}
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
  printf '%s\n' "$SSH_PORT" >"$BACKUP/new-port"
  printf '%s\n' "${OLD_PORTS[@]}" >"$BACKUP/old-ports"
  printf '%s\n' "$LOGIN_USER" >"$BACKUP/login-user"
  printf '%s\n' "${SSH_CONNECTION:-}" >"$BACKUP/original-connection"
  printf '%s\n' "$PASSWORD_MODE" >"$BACKUP/password-mode"
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
      fi
      printf '%s\n' "$END_MARK" >>"$temp"
    else : >"$temp"; fi
    awk -v begin="$BEGIN_MARK" -v end="$END_MARK" '
      $0==begin {block=1; next} $0==end {block=0; next} block {next}
      tolower($1)=="port" {print "# security_hardening.sh disabled: " $0; next}
      {print}
    ' "$file" >>"$temp"
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
  systemctl is-active --quiet "$SSH_SERVICE" || die "SSH 服务未运行"
  ss -H -lnt | awk -v port="$SSH_PORT" '$4 ~ (":" port "$") {found=1} END {exit !found}' || die "新 SSH 端口未监听"
}

restore_backup() {
  local backup=$1 index file failed=0 mode service
  [[ -f "$backup/ssh-files.tsv" ]] || { warn "SSH 备份不完整"; return 1; }
  while IFS=$'\t' read -r index file; do
    cp -a -- "$backup/ssh-$index" "$file" || failed=1
  done <"$backup/ssh-files.tsv"
  service=$(<"$backup/ssh-service")
  if "$SSHD" -t; then
    if systemctl is-active --quiet "$service"; then systemctl reload "$service" || failed=1
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
  [[ "$PASSWORD_MODE" != disable-password ]] || check_public_key
  log "SSH 端口: ${OLD_PORTS[*]} -> ${SSH_PORT}（确认前同时保留旧端口）"
  log "认证: ${PASSWORD_MODE}；防火墙: ${FIREWALL_MODE}；额外放行: ${ALLOW_PORTS[*]:-无}"
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
  apply_firewall
  systemctl reload "$SSH_SERVICE"
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
  systemctl reload "$SSH_SERVICE"
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
