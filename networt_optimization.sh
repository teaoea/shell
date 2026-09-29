#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly SCRIPT_NAME="networt_optimization.sh"
readonly GAI_FILE="/etc/gai.conf"
readonly SYSCTL_FILE="/etc/sysctl.d/99-network-optimization.conf"
readonly MODULES_FILE="/etc/modules-load.d/network-optimization.conf"
readonly RESOLV_FILE="/etc/resolv.conf"
readonly RESOLVED_FILE="/etc/systemd/resolved.conf.d/99-network-optimization.conf"
readonly STATE_DIR="/var/lib/network-optimizer"
readonly BACKUP_ROOT="$STATE_DIR/backups"
readonly LATEST_LINK="$STATE_DIR/latest"
readonly GAI_BEGIN="# BEGIN networt_optimization.sh managed block"
readonly GAI_END="# END networt_optimization.sh managed block"
readonly OLD_IPV4_SYSCTL="/etc/sysctl.d/99-ipv4-optimization.conf"
readonly OLD_IPV4_MODULES="/etc/modules-load.d/ipv4-optimization.conf"
readonly OLD_IPV6_SYSCTL="/etc/sysctl.d/99-ipv6-optimization.conf"
readonly OLD_IPV6_MODULES="/etc/modules-load.d/ipv6-optimization.conf"

ACTION="apply"
MODE=""
ASSUME_YES=false
APPLYING=false
BBR_ENABLED=false
DNS_MODE=""
HAS_IPV4=false
HAS_IPV6=false
DNS_SERVERS=()
CURRENT_BACKUP=""
PREVIOUS_LATEST=""
TEMP_FILES=()

log() {
  printf '%s\n' "$*"
}

warn() {
  printf '警告: %s\n' "$*" >&2
}

die() {
  trap - ERR
  printf '错误: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$1 file
  set +e
  for file in "${TEMP_FILES[@]:-}"; do
    [[ -n "$file" ]] && rm -f -- "$file"
  done
  return "$status"
}

restore_file() {
  local backup_dir=$1 backup_name=$2 target=$3

  if [[ -e "$backup_dir/$backup_name" || -L "$backup_dir/$backup_name" ]]; then
    cp -a -- "$backup_dir/$backup_name" "$target"
  elif [[ -e "$backup_dir/$backup_name.absent" ]]; then
    rm -f -- "$target"
  else
    warn "备份缺少 $target 的状态"
    return 1
  fi
}

restore_runtime_sysctls() {
  local backup_dir=$1 key value failed=0

  [[ -f "$backup_dir/runtime-sysctl.tsv" ]] || return 0
  while IFS=$'\t' read -r key value; do
    [[ -n "$key" ]] || continue
    if ! sysctl -q -w "$key=$value" 2>/dev/null; then
      warn "无法恢复运行时参数 $key"
      failed=1
    fi
  done <"$backup_dir/runtime-sysctl.tsv"
  return "$failed"
}

restore_dns_config() {
  local backup_dir=$1 saved_mode failed=0
  [[ -f "$backup_dir/dns-mode" ]] || return 0
  saved_mode=$(<"$backup_dir/dns-mode")
  case "$saved_mode" in
    static)
      restore_file "$backup_dir" resolv.conf "$RESOLV_FILE" || failed=1
      ;;
    resolved)
      restore_file "$backup_dir" resolved.conf "$RESOLVED_FILE" || failed=1
      systemctl restart systemd-resolved || failed=1
      ;;
    static_resolved)
      restore_file "$backup_dir" resolv.conf "$RESOLV_FILE" || failed=1
      restore_file "$backup_dir" resolved.conf "$RESOLVED_FILE" || failed=1
      systemctl restart systemd-resolved || failed=1
      ;;
    *)
      warn "备份中的 DNS 模式无效: $saved_mode"
      return 1
      ;;
  esac
  return "$failed"
}

restore_backup() {
  local backup_dir=$1 failed=0
  [[ -d "$backup_dir" ]] || return 1

  restore_file "$backup_dir" gai.conf "$GAI_FILE" || failed=1
  restore_file "$backup_dir" sysctl.conf "$SYSCTL_FILE" || failed=1
  restore_file "$backup_dir" modules.conf "$MODULES_FILE" || failed=1
  restore_file "$backup_dir" old-ipv4-sysctl.conf "$OLD_IPV4_SYSCTL" || failed=1
  restore_file "$backup_dir" old-ipv4-modules.conf "$OLD_IPV4_MODULES" || failed=1
  restore_file "$backup_dir" old-ipv6-sysctl.conf "$OLD_IPV6_SYSCTL" || failed=1
  restore_file "$backup_dir" old-ipv6-modules.conf "$OLD_IPV6_MODULES" || failed=1
  restore_dns_config "$backup_dir" || failed=1
  restore_runtime_sysctls "$backup_dir" || failed=1
  return "$failed"
}

on_error() {
  local status=$1 line=$2
  trap - ERR
  warn "第 ${line} 行失败（退出码 ${status}）"
  if [[ "$APPLYING" == true && -n "$CURRENT_BACKUP" ]]; then
    set +e
    if restore_backup "$CURRENT_BACKUP"; then
      if [[ -n "$PREVIOUS_LATEST" && -d "$PREVIOUS_LATEST" ]]; then
        ln -sfn -- "$PREVIOUS_LATEST" "$LATEST_LINK"
      else
        rm -f -- "$LATEST_LINK"
      fi
    else
      warn "自动恢复不完整，备份位置: $CURRENT_BACKUP"
    fi
  fi
  exit "$status"
}

trap 'cleanup $?' EXIT
trap 'on_error $? $LINENO' ERR

usage() {
  cat <<EOF
用法: $SCRIPT_NAME [--ipv4|--ipv6] [--yes]
      $SCRIPT_NAME --status
      $SCRIPT_NAME --rollback [--yes]

直接运行时会询问选择 IPv4 或 IPv6 出站优先级。
IPv4 模式支持 Debian；IPv6 模式支持 Debian 13。
两种模式都保留已有地址族，按可用网络设置 Cloudflare DNS，并应用保守的 TCP 优化；内核支持时启用 BBR + FQ。

  --ipv4       应用 IPv4 出站优先
  --ipv6       应用 IPv6 出站优先
  --status     查看当前配置和路由
  --rollback   恢复最近一次应用前的文件及运行时参数
  -y, --yes    跳过确认；应用时仍须指定 --ipv4 或 --ipv6
  -h, --help   显示帮助
EOF
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      --ipv4 | --ipv6)
        [[ -z "$MODE" ]] || die "一次只能选择一种网络优先级"
        MODE=${1#--}
        ;;
      --status | --rollback)
        [[ "$ACTION" == apply ]] || die "一次只能指定一个操作"
        ACTION=${1#--}
        ;;
      --apply)
        ;;
      -y | --yes)
        ASSUME_YES=true
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "未知参数: $1（使用 --help 查看帮助）"
        ;;
    esac
    shift
  done

  [[ "$ACTION" == apply || -z "$MODE" ]] ||
    die "--ipv4/--ipv6 只能用于应用配置"
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] ||
    die "请以 root 身份运行（例如 sudo bash ${SCRIPT_NAME}）"
}

require_commands() {
  local command_name
  for command_name in awk cp date grep id install ip ln mkdir mktemp readlink rm sysctl; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "缺少必需命令: $command_name"
  done
}

check_system() {
  local os_id version_id

  [[ -r /etc/os-release ]] || die "无法读取 /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  os_id=${ID:-}
  version_id=${VERSION_ID:-}
  [[ "$os_id" == debian ]] ||
    die "仅支持 Debian；检测到: ${PRETTY_NAME:-$os_id}"
  if [[ "$MODE" == ipv6 && "$version_id" != 13 ]]; then
    die "IPv6 模式仅支持 Debian 13；检测到: ${PRETTY_NAME:-Debian $version_id}"
  fi
}

detect_ip_families() {
  local ipv4_address ipv4_route ipv6_address ipv6_route
  HAS_IPV4=false
  HAS_IPV6=false
  command -v ip >/dev/null 2>&1 || return 0

  ipv4_address=$(ip -4 -o address show scope global 2>/dev/null |
    awk 'NR == 1 { print $4; exit }' || true)
  ipv4_route=$(ip -4 route show default 2>/dev/null |
    awk 'NR == 1 { print; exit }' || true)
  ipv6_address=$(ip -6 -o address show scope global 2>/dev/null |
    awk 'NR == 1 { print $4; exit }' || true)
  ipv6_route=$(ip -6 route show default 2>/dev/null |
    awk 'NR == 1 { print; exit }' || true)

  [[ -z "$ipv4_address" || -z "$ipv4_route" ]] || HAS_IPV4=true
  [[ -z "$ipv6_address" || -z "$ipv6_route" ]] || HAS_IPV6=true
}

validate_ip_mode() {
  [[ "$HAS_IPV4" == true || "$HAS_IPV6" == true ]] ||
    die "未检测到带全局地址和默认路由的 IPv4 或 IPv6 网络"
  if [[ "$MODE" == ipv4 && "$HAS_IPV4" != true ]]; then
    die "当前没有可用的 IPv4 地址和默认路由；请选择 --ipv6"
  fi
  if [[ "$MODE" == ipv6 && "$HAS_IPV6" != true ]]; then
    die "当前没有可用的 IPv6 地址和默认路由；请选择 --ipv4"
  fi
}

select_dns_servers() {
  if [[ "$HAS_IPV4" == true ]]; then
    DNS_SERVERS=(1.1.1.1 1.0.0.1)
  else
    DNS_SERVERS=(2606:4700:4700::1111 2606:4700:4700::1001)
  fi
}

detect_dns_mode() {
  local target
  if [[ -L "$RESOLV_FILE" ]]; then
    target=$(readlink -f -- "$RESOLV_FILE") ||
      die "$RESOLV_FILE 是无法解析的符号链接，请先修复 DNS 配置"
    case "$target" in
      /run/systemd/resolve/stub-resolv.conf | /run/systemd/resolve/resolv.conf | \
        /usr/lib/systemd/resolv.conf | /lib/systemd/resolv.conf)
        DNS_MODE=resolved
        ;;
      *)
        die "$RESOLV_FILE 由其他程序管理（$target），请先配置该程序的 DNS"
        ;;
    esac
  elif [[ -f "$RESOLV_FILE" ]] &&
    grep -Eq '^[[:space:]]*nameserver[[:space:]]+127\.0\.0\.53([[:space:]]|$)' "$RESOLV_FILE" &&
    command -v systemctl >/dev/null 2>&1 &&
    systemctl is-active --quiet systemd-resolved; then
    DNS_MODE=resolved
  elif [[ -e "$RESOLV_FILE" ]]; then
    [[ -f "$RESOLV_FILE" ]] || die "$RESOLV_FILE 不是普通文件"
    DNS_MODE=static
  else
    DNS_MODE=static
  fi

  if [[ "$DNS_MODE" == static ]] &&
    command -v systemctl >/dev/null 2>&1 &&
    systemctl is-active --quiet systemd-resolved; then
    DNS_MODE=static_resolved
  fi

  if [[ "$DNS_MODE" == resolved || "$DNS_MODE" == static_resolved ]]; then
    command -v systemctl >/dev/null 2>&1 || die "缺少 systemctl，无法配置 systemd-resolved"
    systemctl is-active --quiet systemd-resolved ||
      die "systemd-resolved 未运行，无法安全修改其 DNS"
  fi
}

select_mode() {
  local answer default_choice=1
  [[ -n "$MODE" ]] && return 0
  [[ "$ASSUME_YES" != true ]] ||
    die "--yes 模式必须同时指定 --ipv4 或 --ipv6"
  [[ -t 0 ]] ||
    die "非交互运行请指定 --ipv4 或 --ipv6，并添加 --yes"

  [[ "$HAS_IPV4" == true ]] || default_choice=2
  while true; do
    log "请选择出站地址优先级："
    log "  1) IPv4 优先（需要 IPv4 地址和默认路由）"
    log "  2) IPv6 优先（需要 IPv6 地址和默认路由）"
    read -r -p "输入 1 或 2（默认 $default_choice）: " answer
    case "${answer:-$default_choice}" in
      1) MODE=ipv4; break ;;
      2) MODE=ipv6; break ;;
      *) warn "请输入 1 或 2" ;;
    esac
  done
}

confirm_action() {
  local prompt=$1 answer
  [[ "$ASSUME_YES" == true ]] && return 0
  [[ -t 0 ]] || die "非交互运行请添加 --yes"
  read -r -p "$prompt (y/N): " answer
  [[ "$answer" =~ ^[Yy]$ ]] || {
    log "操作已取消。"
    exit 0
  }
}

backup_file() {
  local source=$1 backup_name=$2

  if [[ -e "$source" || -L "$source" ]]; then
    cp -a -- "$source" "$CURRENT_BACKUP/$backup_name"
  else
    : >"$CURRENT_BACKUP/$backup_name.absent"
  fi
}

save_runtime_sysctls() {
  local key value
  local -a keys=(
    net.ipv6.conf.all.disable_ipv6
    net.ipv6.conf.default.disable_ipv6
    net.ipv6.conf.lo.disable_ipv6
    net.ipv4.tcp_fastopen
    net.ipv4.tcp_mtu_probing
    net.core.default_qdisc
    net.ipv4.tcp_congestion_control
  )

  : >"$CURRENT_BACKUP/runtime-sysctl.tsv"
  for key in "${keys[@]}"; do
    if value=$(sysctl -n "$key" 2>/dev/null); then
      printf '%s\t%s\n' "$key" "$value" >>"$CURRENT_BACKUP/runtime-sysctl.tsv"
    fi
  done
}

create_backup() {
  local timestamp

  mkdir -p -m 700 -- "$BACKUP_ROOT"
  if [[ -L "$LATEST_LINK" ]]; then
    PREVIOUS_LATEST=$(readlink -f -- "$LATEST_LINK" || true)
  fi
  timestamp=$(date +%Y%m%d-%H%M%S)
  CURRENT_BACKUP="$BACKUP_ROOT/$timestamp-$$"
  mkdir -m 700 -- "$CURRENT_BACKUP"

  backup_file "$GAI_FILE" gai.conf
  backup_file "$SYSCTL_FILE" sysctl.conf
  backup_file "$MODULES_FILE" modules.conf
  backup_file "$OLD_IPV4_SYSCTL" old-ipv4-sysctl.conf
  backup_file "$OLD_IPV4_MODULES" old-ipv4-modules.conf
  backup_file "$OLD_IPV6_SYSCTL" old-ipv6-sysctl.conf
  backup_file "$OLD_IPV6_MODULES" old-ipv6-modules.conf
  printf '%s\n' "$DNS_MODE" >"$CURRENT_BACKUP/dns-mode"
  if [[ "$DNS_MODE" == resolved || "$DNS_MODE" == static_resolved ]]; then
    backup_file "$RESOLVED_FILE" resolved.conf
  fi
  if [[ "$DNS_MODE" == static || "$DNS_MODE" == static_resolved ]]; then
    backup_file "$RESOLV_FILE" resolv.conf
  fi
  save_runtime_sysctls
  printf '%s\n' "$(date --iso-8601=seconds)" >"$CURRENT_BACKUP/created-at"
  ln -sfn -- "$CURRENT_BACKUP" "$LATEST_LINK"
  log "配置备份: $CURRENT_BACKUP"
}

prepare_gai_config() {
  local output=$1

  if [[ -f "$GAI_FILE" ]]; then
    awk -v begin="$GAI_BEGIN" -v end="$GAI_END" '
      $0 == begin ||
      $0 == "# BEGIN ipv4-optimizer managed block" ||
      $0 == "# BEGIN ipv6-optimizer managed block" ||
      $0 == "# BEGIN install_xray.sh network priority" { managed = 1; next }
      $0 == end ||
      $0 == "# END ipv4-optimizer managed block" ||
      $0 == "# END ipv6-optimizer managed block" ||
      $0 == "# END install_xray.sh network priority" { managed = 0; next }
      managed { next }
      /^[[:space:]]*#/ { print; next }
      /^[[:space:]]*precedence[[:space:]]/ {
        print "# networt_optimization.sh disabled: " $0
        next
      }
      { print }
    ' "$GAI_FILE" >"$output"
  else
    : >"$output"
  fi

  if [[ "$MODE" == ipv4 ]]; then
    cat >>"$output" <<EOF

$GAI_BEGIN
# 完整 precedence 表；保留 IPv6，仅优先选择 IPv4。
precedence ::1/128       50
precedence ::/0          40
precedence 2002::/16     30
precedence ::/96         20
precedence ::ffff:0:0/96 100
$GAI_END
EOF
  else
    cat >>"$output" <<EOF

$GAI_BEGIN
# 完整 precedence 表；优先原生 IPv6，保留 IPv4 回退。
precedence ::1/128       100
precedence ::/0          90
precedence 2002::/16     30
precedence ::/96         20
precedence ::ffff:0:0/96 10
$GAI_END
EOF
  fi
}

detect_bbr() {
  local available
  if command -v modprobe >/dev/null 2>&1; then
    modprobe tcp_bbr 2>/dev/null || true
    modprobe sch_fq 2>/dev/null || true
  fi

  available=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || true)
  if [[ " $available " == *" bbr "* ]] &&
    sysctl -n net.core.default_qdisc >/dev/null 2>&1; then
    BBR_ENABLED=true
  fi
}

prepare_sysctl_config() {
  local output=$1

  cat >"$output" <<'EOF'
# Managed by networt_optimization.sh
# 保留内核 TCP 缓冲区自动调优，不设置固定的 rmem/wmem 上限。
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 1
EOF

  if [[ "$MODE" == ipv6 ]]; then
    cat >>"$output" <<'EOF'
# 启用 IPv6，但不修改接口地址、默认路由或 MTU。
net.ipv6.conf.all.disable_ipv6 = 0
net.ipv6.conf.default.disable_ipv6 = 0
net.ipv6.conf.lo.disable_ipv6 = 0
EOF
  fi

  if [[ "$BBR_ENABLED" == true ]]; then
    cat >>"$output" <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
  fi
}

prepare_modules_config() {
  local output=$1 wrote_module=false
  : >"$output"

  if command -v modinfo >/dev/null 2>&1 &&
    modinfo tcp_bbr >/dev/null 2>&1; then
    printf '%s\n' tcp_bbr >>"$output"
    wrote_module=true
  fi
  if command -v modinfo >/dev/null 2>&1 &&
    modinfo sch_fq >/dev/null 2>&1; then
    printf '%s\n' sch_fq >>"$output"
    wrote_module=true
  fi
  [[ "$wrote_module" == true ]]
}

prepare_static_dns_config() {
  local output=$1 server
  printf '%s\n' '# Managed by networt_optimization.sh' >"$output"
  for server in "${DNS_SERVERS[@]}"; do
    printf 'nameserver %s\n' "$server" >>"$output"
  done
  if [[ -f "$RESOLV_FILE" ]]; then
    awk '
      $0 == "# Managed by networt_optimization.sh" { next }
      /^[[:space:]]*nameserver[[:space:]]/ { next }
      { print }
    ' "$RESOLV_FILE" >>"$output"
  fi
}

apply_dns_configuration() {
  local temp_dns
  temp_dns=$(mktemp /tmp/network-dns.XXXXXX)
  TEMP_FILES+=("$temp_dns")

  if [[ "$DNS_MODE" == static || "$DNS_MODE" == static_resolved ]]; then
    prepare_static_dns_config "$temp_dns"
    install -m 644 -o root -g root "$temp_dns" "$RESOLV_FILE"
  fi
  if [[ "$DNS_MODE" == resolved || "$DNS_MODE" == static_resolved ]]; then
    printf '# Managed by networt_optimization.sh\n[Resolve]\nDNS=%s %s\nDomains=~.\n' \
      "${DNS_SERVERS[0]}" "${DNS_SERVERS[1]}" >"$temp_dns"
    mkdir -p -m 755 -- "${RESOLVED_FILE%/*}"
    install -m 644 -o root -g root "$temp_dns" "$RESOLVED_FILE"
    systemctl restart systemd-resolved
  fi
}

verify_configuration() {
  grep -Fxq "$GAI_BEGIN" "$GAI_FILE"
  [[ "$(sysctl -n net.ipv4.tcp_fastopen)" == 3 ]]
  [[ "$(sysctl -n net.ipv4.tcp_mtu_probing)" == 1 ]]
  if [[ "$MODE" == ipv6 ]]; then
    grep -Eq '^precedence[[:space:]]+::/0[[:space:]]+90$' "$GAI_FILE"
    [[ "$(sysctl -n net.ipv6.conf.all.disable_ipv6)" == 0 ]]
    [[ "$(sysctl -n net.ipv6.conf.default.disable_ipv6)" == 0 ]]
    [[ "$(sysctl -n net.ipv6.conf.lo.disable_ipv6)" == 0 ]]
  else
    grep -Eq '^precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100$' "$GAI_FILE"
  fi
  if [[ "$BBR_ENABLED" == true ]]; then
    [[ "$(sysctl -n net.core.default_qdisc)" == fq ]]
    [[ "$(sysctl -n net.ipv4.tcp_congestion_control)" == bbr ]]
  fi
}

apply_configuration() {
  local temp_gai temp_sysctl temp_modules

  confirm_action "将应用 ${MODE^^} 优先、Cloudflare DNS 和保守 TCP 优化，是否继续？"
  create_backup
  APPLYING=true

  temp_gai=$(mktemp /tmp/network-gai.XXXXXX)
  temp_sysctl=$(mktemp /tmp/network-sysctl.XXXXXX)
  temp_modules=$(mktemp /tmp/network-modules.XXXXXX)
  TEMP_FILES+=("$temp_gai" "$temp_sysctl" "$temp_modules")

  detect_bbr
  prepare_gai_config "$temp_gai"
  prepare_sysctl_config "$temp_sysctl"

  install -m 644 -o root -g root "$temp_gai" "$GAI_FILE"
  install -m 644 -o root -g root "$temp_sysctl" "$SYSCTL_FILE"
  rm -f -- "$OLD_IPV4_SYSCTL" "$OLD_IPV4_MODULES" \
    "$OLD_IPV6_SYSCTL" "$OLD_IPV6_MODULES"

  if [[ "$BBR_ENABLED" == true ]] &&
    prepare_modules_config "$temp_modules"; then
    install -m 644 -o root -g root "$temp_modules" "$MODULES_FILE"
  else
    rm -f -- "$MODULES_FILE"
  fi

  sysctl -p "$SYSCTL_FILE" >/dev/null
  verify_configuration
  apply_dns_configuration
  APPLYING=false

  log "已应用 ${MODE^^} 优先和 Cloudflare DNS；实际网络连通性见下方直连测试。"
  if [[ "$BBR_ENABLED" == true ]]; then
    log "BBR + FQ 已启用。"
  else
    log "当前内核未提供 BBR，保留现有拥塞控制算法。"
  fi
  log "长期运行的进程可能需要重启才能重新读取地址选择策略。"
  show_status
}

latest_backup_path() {
  local backup_dir
  [[ -L "$LATEST_LINK" ]] || return 1
  backup_dir=$(readlink -f -- "$LATEST_LINK") || return 1
  [[ -n "$backup_dir" && -d "$backup_dir" ]] || return 1
  printf '%s\n' "$backup_dir"
}

rollback_configuration() {
  local backup_dir
  backup_dir=$(latest_backup_path) || die "没有可回滚的备份"
  confirm_action "将恢复 ${backup_dir}，是否继续？"
  restore_backup "$backup_dir"
  rm -f -- "$LATEST_LINK"
  log "已恢复最近一次修改前的配置: $backup_dir"
}

read_sysctl() {
  local value
  value=$(sysctl -n "$1" 2>/dev/null || true)
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '不可用'
  fi
}

test_ip_connectivity() {
  local family=$1 address=$2
  local -a curl_family

  if [[ "$family" == IPv4 ]]; then
    curl_family=(-4)
  else
    curl_family=(-6)
  fi

  if curl --disable --noproxy '*' "${curl_family[@]}" \
    --resolve "cloudflare-dns.com:443:$address" \
    --connect-timeout 3 --max-time 6 --fail --silent --show-error \
    --output /dev/null \
    'https://cloudflare-dns.com/dns-query?name=example.com&type=A' \
    2>/dev/null; then
    log "  $family 直连测试: 成功（$address:443）"
  else
    log "  $family 直连测试: 失败或超时（$address:443）"
  fi
}

show_status() {
  local mode="未由本脚本配置" backup="无" ipv4_route="无" ipv6_route="无"
  local dns_status="未由本脚本配置" resolv_target="" static_dns="" resolved_dns=""
  local resolved_stub=false

  detect_ip_families

  if [[ -f "$GAI_FILE" ]] && grep -Fxq "$GAI_BEGIN" "$GAI_FILE"; then
    if grep -Eq '^precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100$' "$GAI_FILE"; then
      mode="IPv4 优先"
    elif grep -Eq '^precedence[[:space:]]+::/0[[:space:]]+90$' "$GAI_FILE"; then
      mode="IPv6 优先"
    fi
  fi
  if latest_backup_path >/dev/null 2>&1; then
    backup=$(latest_backup_path)
  fi
  if command -v ip >/dev/null 2>&1; then
    ipv4_route=$(ip -4 route show default 2>/dev/null |
      awk 'NR == 1 { print; exit }' || true)
    ipv6_route=$(ip -6 route show default 2>/dev/null |
      awk 'NR == 1 { print; exit }' || true)
    ipv4_route=${ipv4_route:-无}
    ipv6_route=${ipv6_route:-无}
  fi
  if [[ -L "$RESOLV_FILE" ]]; then
    resolv_target=$(readlink -f -- "$RESOLV_FILE" 2>/dev/null || true)
  fi
  if [[ -f "$RESOLVED_FILE" ]]; then
    if grep -Fxq 'DNS=1.1.1.1 1.0.0.1' "$RESOLVED_FILE"; then
      resolved_dns="Cloudflare IPv4"
    elif grep -Fxq 'DNS=2606:4700:4700::1111 2606:4700:4700::1001' "$RESOLVED_FILE"; then
      resolved_dns="Cloudflare IPv6"
    fi
  fi
  if [[ ! -L "$RESOLV_FILE" && -f "$RESOLV_FILE" ]]; then
    if grep -Eq '^[[:space:]]*nameserver[[:space:]]+127\.0\.0\.53([[:space:]]|$)' "$RESOLV_FILE"; then
      resolved_stub=true
    fi
    if grep -Fxq 'nameserver 1.1.1.1' "$RESOLV_FILE" &&
      grep -Fxq 'nameserver 1.0.0.1' "$RESOLV_FILE"; then
      static_dns="Cloudflare IPv4"
    elif grep -Fxq 'nameserver 2606:4700:4700::1111' "$RESOLV_FILE" &&
      grep -Fxq 'nameserver 2606:4700:4700::1001' "$RESOLV_FILE"; then
      static_dns="Cloudflare IPv6"
    fi
  fi
  if [[ "$resolv_target" == /run/systemd/resolve/* ||
    "$resolv_target" == /usr/lib/systemd/resolv.conf ||
    "$resolv_target" == /lib/systemd/resolv.conf ||
    "$resolved_stub" == true ]] &&
    [[ -n "$resolved_dns" ]]; then
    dns_status="${resolved_dns}（systemd-resolved 配置）"
  elif [[ -n "$static_dns" ]]; then
    if [[ "$resolved_dns" == "$static_dns" ]] &&
      command -v systemctl >/dev/null 2>&1 &&
      systemctl is-active --quiet systemd-resolved; then
      dns_status="${static_dns}（/etc/resolv.conf 和 systemd-resolved）"
    else
      dns_status="${static_dns}（/etc/resolv.conf）"
    fi
  fi

  log "当前状态:"
  log "  地址选择: $mode"
  log "  DNS 设置: $dns_status"
  log "  IPv4 默认路由: $ipv4_route"
  log "  IPv6 默认路由: $ipv6_route"
  log "  IPv6 all.disable_ipv6: $(read_sysctl net.ipv6.conf.all.disable_ipv6)（此值不代表实际连通性）"
  log "  TCP Fast Open: $(read_sysctl net.ipv4.tcp_fastopen)"
  log "  MTU probing: $(read_sysctl net.ipv4.tcp_mtu_probing)"
  log "  拥塞控制: $(read_sysctl net.ipv4.tcp_congestion_control)"
  log "  默认队列算法: $(read_sysctl net.core.default_qdisc)"
  log "  最近备份: $backup"
  if command -v curl >/dev/null 2>&1; then
    if [[ "$HAS_IPV4" == true ]]; then
      test_ip_connectivity IPv4 1.1.1.1
    else
      log "  IPv4 直连测试: 未执行（无全局地址或默认路由）"
    fi
    if [[ "$HAS_IPV6" == true ]]; then
      test_ip_connectivity IPv6 '[2606:4700:4700::1111]'
    else
      log "  IPv6 直连测试: 未执行（无全局地址或默认路由）"
    fi
  else
    log "  IP 直连测试: 未执行（缺少 curl）"
  fi
}

main() {
  parse_arguments "$@"
  case "$ACTION" in
    status)
      show_status
      ;;
    rollback)
      require_root
      require_commands
      rollback_configuration
      ;;
    apply)
      require_root
      require_commands
      detect_ip_families
      select_mode
      check_system
      validate_ip_mode
      select_dns_servers
      detect_dns_mode
      apply_configuration
      ;;
  esac
}

main "$@"
