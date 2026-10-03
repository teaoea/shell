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
PROFILE="xray-reality"
TCP_BUFFER_MIB=16
REALITY_SYSCTLS=()
ASSUME_YES=false
APPLYING=false
BBR_ENABLED=false
DNS_MODE=""
HAS_IPV4=false
HAS_IPV6=false
IPV6_SUPPORTED=false
IPV6_HAS_ADDRESS=false
IPV6_ADDRESS=""
IPV6_ADDRESSES=()
IPV6_PREFIX=""
IPV6_SUFFIXES=""
IPV6_INTERFACE=""
IPV6_GATEWAY=""
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
  restore_added_ipv6 "$backup_dir" || failed=1
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
两种模式都保留已有地址族，按可用网络设置 Cloudflare DNS；内核支持时启用 BBR + FQ。
默认应用适用于 Xray-REALITY TCP 传输的系统参数；使用 --general 保留通用优化。

  --xray-reality  应用 REALITY TCP 优化（默认；影响系统 TCP）
  --general      仅应用原有通用优化
  --tcp-buffer-mib N  REALITY TCP 自动调节目标上限，默认 16 MiB（1 到 64）
                     保留更大的现有上限，不提高每条连接的初始分配
  --ipv4       应用 IPv4 出站优先
  --ipv6       应用 IPv6 出站优先
  --ipv6-prefix PREFIX  IPv6 网络前缀，必须以 :: 结尾
  --ipv6-suffixes "S..." 后缀列表，以空格分隔；与 --ipv6-prefix 配套使用
  --ipv6-address IP[/N] 添加用户指定的 IPv6 地址；可重复传入或用空格/逗号分隔
                       兼容直接指定完整地址；省略前缀长度时使用 /128
  --ipv6-interface IF  指定网卡；默认选择 IPv6 / IPv4 默认路由网卡
  --ipv6-gateway IP    无 IPv6 默认路由时使用的网关
                       仅在无全局 IPv6 地址时添加；运行时生效，重启不保留
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
      --xray-reality) PROFILE=xray-reality ;;
      --general) PROFILE=general ;;
      --tcp-buffer-mib)
        [[ $# -ge 2 && "$2" =~ ^[0-9]{1,2}$ ]] || die "--tcp-buffer-mib 需要 1 到 64 的整数"
        TCP_BUFFER_MIB=$((10#$2))
        ((TCP_BUFFER_MIB >= 1 && TCP_BUFFER_MIB <= 64)) || die "--tcp-buffer-mib 范围为 1 到 64"
        shift
        ;;
      --ipv6-prefix | --ipv6-suffixes | --ipv6-address | --ipv6-interface | --ipv6-gateway)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 缺少参数"
        case "$1" in
          --ipv6-prefix) IPV6_PREFIX=$2 ;;
          --ipv6-suffixes) IPV6_SUFFIXES=$2 ;;
          --ipv6-address) IPV6_ADDRESS="${IPV6_ADDRESS:+$IPV6_ADDRESS }$2" ;;
          --ipv6-interface) IPV6_INTERFACE=$2 ;;
          --ipv6-gateway) IPV6_GATEWAY=$2 ;;
        esac
        shift
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
  if [[ "$ACTION" != apply &&
        -n "$IPV6_PREFIX$IPV6_SUFFIXES$IPV6_ADDRESS$IPV6_INTERFACE$IPV6_GATEWAY" ]]; then
    die "IPv6 地址参数只能用于应用配置"
  fi
}

build_ipv6_addresses_from_prefix() {
  local stem part suffix prefix_length
  local -a prefix_parts suffixes

  [[ -n "$IPV6_PREFIX" && -n "$IPV6_SUFFIXES" ]] ||
    die "IPv6 前缀和后缀必须同时提供"
  [[ "$IPV6_PREFIX" == *:: && "$IPV6_PREFIX" =~ ^[0-9a-fA-F:]+$ ]] ||
    die "IPv6 前缀必须由十六进制段组成并以 :: 结尾"

  stem=${IPV6_PREFIX%::}
  [[ -n "$stem" ]] || die "IPv6 前缀不能只有 ::"
  IFS=: read -r -a prefix_parts <<<"$stem"
  ((${#prefix_parts[@]} >= 1 && ${#prefix_parts[@]} <= 7)) ||
    die "IPv6 前缀包含的段数无效"
  for part in "${prefix_parts[@]}"; do
    [[ "$part" =~ ^[0-9a-fA-F]{1,4}$ ]] ||
      die "IPv6 前缀段无效: $part"
  done
  prefix_length=$((${#prefix_parts[@]} * 16))

  read -r -a suffixes <<<"$IPV6_SUFFIXES"
  ((${#suffixes[@]} > 0)) || die "至少需要一个 IPv6 后缀"
  IPV6_ADDRESS=""
  for suffix in "${suffixes[@]}"; do
    [[ "$suffix" =~ ^[0-9a-fA-F]{1,4}$ ]] ||
      die "IPv6 后缀无效: ${suffix}（只允许 1 到 4 位十六进制）"
    IPV6_ADDRESS="${IPV6_ADDRESS:+$IPV6_ADDRESS }${IPV6_PREFIX}${suffix}/${prefix_length}"
  done
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] ||
    die "请以 root 身份运行（例如 sudo bash ${SCRIPT_NAME}）"
}

require_commands() {
  local command_name
  for command_name in awk cp date grep id install ip ln mkdir mktemp readlink rm sleep sysctl; do
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
  IPV6_SUPPORTED=false
  IPV6_HAS_ADDRESS=false
  sysctl -n net.ipv6.conf.all.disable_ipv6 >/dev/null 2>&1 && IPV6_SUPPORTED=true
  command -v ip >/dev/null 2>&1 || return 0

  ipv4_address=$(ip -4 -o address show scope global 2>/dev/null |
    awk 'NR == 1 { print $4; exit }' || true)
  ipv4_route=$(ip -4 route show default 2>/dev/null |
    awk 'NR == 1 { print; exit }' || true)
  ipv6_address=$(ip -6 -o address show scope global -tentative -dadfailed 2>/dev/null |
    awk 'NR == 1 { print $4; exit }' || true)
  ipv6_route=$(ip -6 route show default 2>/dev/null |
    awk 'NR == 1 { print; exit }' || true)

  [[ -z "$(ip -6 -o address show scope global 2>/dev/null || true)" ]] || IPV6_HAS_ADDRESS=true
  [[ -z "$ipv4_address" || -z "$ipv4_route" ]] || HAS_IPV4=true
  [[ -z "$ipv6_address" || -z "$ipv6_route" ]] || HAS_IPV6=true
}

validate_ip_mode() {
  [[ "$HAS_IPV4" == true || "$HAS_IPV6" == true || -n "$IPV6_ADDRESS" ]] ||
    die "未检测到带全局地址和默认路由的 IPv4 或 IPv6 网络"
  if [[ "$MODE" == ipv4 && "$HAS_IPV4" != true ]]; then
    die "当前没有可用的 IPv4 地址和默认路由；请选择 --ipv6"
  fi
  if [[ "$MODE" == ipv6 && "$HAS_IPV6" != true && -z "$IPV6_ADDRESS" ]]; then
    die "当前没有可用的 IPv6 地址和默认路由；请选择 --ipv4"
  fi
}

prepare_ipv6_address() {
  local default_route
  if [[ "$IPV6_SUPPORTED" == true && "$IPV6_HAS_ADDRESS" == false &&
        -z "$IPV6_PREFIX$IPV6_SUFFIXES$IPV6_ADDRESS$IPV6_INTERFACE$IPV6_GATEWAY" ]]; then
    log "检测到内核支持 IPv6，但尚未配置全局 IPv6 地址。"
    if [[ -t 0 && "$ASSUME_YES" != true ]]; then
      read -r -p "第一步，输入 IPv6 前缀（例如 2a0c:9a40:8aa3:13c8::；回车默认不添加）: " IPV6_PREFIX
      if [[ -n "$IPV6_PREFIX" ]]; then
        read -r -p "第二步，输入 IPv6 后缀（多个用空格分隔，例如 1 2 a）: " IPV6_SUFFIXES
      fi
    else
      log "可通过 --ipv6-prefix 和 --ipv6-suffixes 添加多个地址。"
    fi
  fi
  [[ -n "$IPV6_PREFIX$IPV6_SUFFIXES$IPV6_ADDRESS$IPV6_INTERFACE$IPV6_GATEWAY" ]] || return 0
  [[ "$IPV6_SUPPORTED" == true ]] || die "内核未提供 IPv6 支持"
  [[ "$IPV6_HAS_ADDRESS" == false ]] || die "已有全局 IPv6 地址，不执行添加"

  if [[ -n "$IPV6_PREFIX$IPV6_SUFFIXES" ]]; then
    [[ -z "$IPV6_ADDRESS" ]] ||
      die "--ipv6-prefix/--ipv6-suffixes 不能与 --ipv6-address 同时使用"
    build_ipv6_addresses_from_prefix
  fi
  [[ -n "$IPV6_ADDRESS" ]] || die "请提供要添加的 IPv6 地址"
  local cidr prefix address previous duplicate
  IPV6_ADDRESS=${IPV6_ADDRESS//,/ }
  local -a requested_addresses
  read -r -a requested_addresses <<<"$IPV6_ADDRESS"
  IPV6_ADDRESSES=()
  for cidr in "${requested_addresses[@]}"; do
    [[ "$cidr" == */* ]] || cidr="$cidr/128"
    [[ "$cidr" =~ ^[0-9a-fA-F:]+/[0-9]{1,3}$ && "$cidr" == *:* ]] || die "IPv6 地址格式无效: $cidr"
    prefix=${cidr##*/}
    address=${cidr%/*}
    ((10#$prefix <= 128)) || die "IPv6 前缀长度必须为 0 到 128"
    [[ ! "$address" =~ ^[fF][eE][89aAbB] && "$address" != :: && "$address" != ::1 &&
       ! "$address" =~ ^[fF][fF] ]] || die "请提供全局单播 IPv6 地址"
    duplicate=false
    for previous in ${IPV6_ADDRESSES[@]+"${IPV6_ADDRESSES[@]}"}; do
      [[ "$previous" != "$cidr" ]] || duplicate=true
    done
    [[ "$duplicate" == true ]] || IPV6_ADDRESSES+=("$cidr")
  done
  [[ ${#IPV6_ADDRESSES[@]} -gt 0 ]] || die "请提供要添加的 IPv6 地址"
  IPV6_ADDRESS=${IPV6_ADDRESSES[0]}
  if [[ -z "$IPV6_INTERFACE" ]]; then
    IPV6_INTERFACE=$(ip -6 route show default | awk '{for (i=1;i<NF;i++) if ($i=="dev") {print $(i+1); exit}}')
    if [[ -z "$IPV6_INTERFACE" ]]; then
      IPV6_INTERFACE=$(ip -4 route show default | awk '{for (i=1;i<NF;i++) if ($i=="dev") {print $(i+1); exit}}')
    fi
    [[ -n "$IPV6_INTERFACE" ]] || die "无法确定默认网卡，请使用 --ipv6-interface 指定"
  fi
  [[ "$IPV6_INTERFACE" =~ ^[a-zA-Z0-9_.:-]+$ && "$IPV6_INTERFACE" != lo ]] || die "请指定有效的非 lo 网卡"
  ip link show dev "$IPV6_INTERFACE" >/dev/null 2>&1 || die "网卡不存在: $IPV6_INTERFACE"
  sysctl -n "net.ipv6.conf.$IPV6_INTERFACE.disable_ipv6" >/dev/null 2>&1 ||
    die "网卡未提供 IPv6 参数"
  default_route=$(ip -6 route show default)
  if [[ -n "$IPV6_GATEWAY" ]]; then
    [[ "$IPV6_GATEWAY" =~ ^[0-9a-fA-F:]+$ && "$IPV6_GATEWAY" == *:* ]] || die "IPv6 网关格式无效"
    [[ -z "$default_route" ]] || die "已有 IPv6 默认路由，请省略 --ipv6-gateway"
  fi
  log "将添加运行时 IPv6 地址 ${IPV6_ADDRESSES[*]} dev ${IPV6_INTERFACE}；网关: ${IPV6_GATEWAY:-不修改路由}。重启不保留。"
}

restore_added_ipv6() {
  local backup_dir=$1 interface address gateway failed=0
  [[ -f "$backup_dir/added-ipv6.tsv" ]] || return 0
  IFS=$'\t' read -r interface address gateway <"$backup_dir/added-ipv6.tsv" || return 0
  if [[ -f "$backup_dir/ipv6-route-added" ]]; then
    if ip -6 route show default dev "$interface" | grep -Fq "via $gateway "; then
      ip -6 route del default via "$gateway" dev "$interface" metric 4096 || failed=1
    fi
  fi
  while IFS=$'\t' read -r interface address gateway; do
    [[ -n "$interface" && -n "$address" ]] || continue
    local state
    if ! state=$(ip -6 -o address show dev "$interface" to "$address"); then
      failed=1
    elif [[ -n "$state" ]]; then
      ip -6 address del "$address" dev "$interface" || failed=1
    fi
  done <"$backup_dir/added-ipv6.tsv"
  return "$failed"
}

apply_ipv6_address() {
  local attempt state cidr
  [[ -n "$IPV6_ADDRESS" ]] || return 0
  : >"$CURRENT_BACKUP/added-ipv6.tsv"
  sysctl -q -w "net.ipv6.conf.$IPV6_INTERFACE.disable_ipv6=0"
  for cidr in ${IPV6_ADDRESSES[@]+"${IPV6_ADDRESSES[@]}"}; do
    ip -6 address add "$cidr" dev "$IPV6_INTERFACE" || return 1
    printf '%s\t%s\t%s\n' "$IPV6_INTERFACE" "$cidr" "$IPV6_GATEWAY" >>"$CURRENT_BACKUP/added-ipv6.tsv"
    for ((attempt=0; attempt<10; attempt++)); do
      state=$(ip -6 -o address show dev "$IPV6_INTERFACE" to "$cidr")
      if [[ "$state" == *dadfailed* ]]; then
        warn "IPv6 地址重复检测失败: $cidr"
        return 1
      fi
      [[ -n "$state" && "$state" != *tentative* ]] && break
      sleep 1
    done
    [[ -n "$state" && "$state" != *tentative* ]] || { warn "IPv6 地址尚未就绪: $cidr"; return 1; }
  done
  if [[ -n "$IPV6_GATEWAY" ]]; then
    ip -6 route add default via "$IPV6_GATEWAY" dev "$IPV6_INTERFACE" metric 4096
    : >"$CURRENT_BACKUP/ipv6-route-added"
  fi
  detect_ip_families
  if [[ "$MODE" == ipv6 && "$HAS_IPV6" != true ]]; then
    warn "添加后仍无可用 IPv6 地址和默认路由，无法应用 IPv6 优先"
    return 1
  fi
  if [[ "$HAS_IPV6" != true ]]; then
    log "IPv6 地址已添加；当前无 IPv6 默认路由，仅添加地址不会自动获得 IPv6 出站连接。"
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
        die "$RESOLV_FILE 由其他程序管理（${target}），请先配置该程序的 DNS"
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
    read -r -p "输入 1 或 2（默认 ${default_choice}）: " answer
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

  if [[ -n "$IPV6_ADDRESS" ]]; then
    keys+=("net.ipv6.conf.$IPV6_INTERFACE.disable_ipv6")
  fi
  local entry
  for entry in ${REALITY_SYSCTLS[@]+"${REALITY_SYSCTLS[@]}"}; do
    keys+=("${entry%%=*}")
  done
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

prepare_reality_sysctls() {
  local key value minimum initial maximum extra target=$((TCP_BUFFER_MIB * 1024 * 1024))
  REALITY_SYSCTLS=()
  [[ "$PROFILE" == xray-reality ]] || return 0
  # TCP 自动调节上限；保留现有 min/default 和更大的 max。
  for key in net.ipv4.tcp_rmem net.ipv4.tcp_wmem; do
    value=$(sysctl -n "$key")
    read -r minimum initial maximum extra <<<"$value"
    [[ "$minimum" =~ ^[0-9]+$ && "$initial" =~ ^[0-9]+$ &&
       "$maximum" =~ ^[0-9]+$ && -z "$extra" ]] || die "无效的 TCP 缓冲区参数: $key"
    ((maximum >= target)) || maximum=$target
    ((maximum >= initial)) || maximum=$initial
    REALITY_SYSCTLS+=("$key=$minimum $initial $maximum")
  done
  for key in net.core.somaxconn net.ipv4.tcp_max_syn_backlog; do
    value=$(sysctl -n "$key")
    [[ "$value" =~ ^[0-9]+$ ]] || die "无效的连接队列参数: $key"
    ((value >= 4096)) || value=4096
    REALITY_SYSCTLS+=("$key=$value")
  done
  REALITY_SYSCTLS+=(
    "net.ipv4.tcp_moderate_rcvbuf=1"
    "net.ipv4.tcp_window_scaling=1"
    "net.ipv4.tcp_sack=1"
  )
  # 修改前确认全部参数可读取，避免不支持的内核发生部分应用。
  for value in ${REALITY_SYSCTLS[@]+"${REALITY_SYSCTLS[@]}"}; do
    sysctl -n "${value%%=*}" >/dev/null || die "内核不支持 ${value%%=*}"
  done
}

prepare_sysctl_config() {
  local output=$1

  cat >"$output" <<'EOF'
# Managed by networt_optimization.sh
# 保留 TCP 缓冲区自动调优；REALITY 配置只提高 max，不提高 min/default。
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 1
EOF

  if [[ "$PROFILE" == xray-reality ]]; then
    printf '# Xray-REALITY TCP profile; affects all system TCP sockets\n' >>"$output"
    local entry
    for entry in ${REALITY_SYSCTLS[@]+"${REALITY_SYSCTLS[@]}"}; do
      printf '%s = %s\n' "${entry%%=*}" "${entry#*=}" >>"$output"
    done
  fi

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
  local entry actual expected
  for entry in ${REALITY_SYSCTLS[@]+"${REALITY_SYSCTLS[@]}"}; do
    actual=$(sysctl -n "${entry%%=*}" | awk '{$1=$1; print}')
    expected=${entry#*=}
    [[ "$actual" == "$expected" ]] || { warn "参数未生效: ${entry%%=*}"; return 1; }
  done
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

  confirm_action "将应用 ${MODE^^} 优先、Cloudflare DNS 和 ${PROFILE} TCP 优化（影响系统 TCP），是否继续？"
  create_backup
  APPLYING=true
  apply_ipv6_address
  select_dns_servers

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
  if [[ "$PROFILE" == xray-reality ]]; then
    log "Xray-REALITY TCP 系统参数已应用；缓冲区目标上限为 ${TCP_BUFFER_MIB} MiB，保留更大的现有值。"
    log "请在维护窗口重启 Xray，使监听队列和新 TCP 连接使用新设置；本脚本不自动重启服务。"
    log "gai.conf 不保证控制 Xray 的出站地址族；TCP Fast Open 还需 Xray sockopt 和客户端支持。"
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
  local curl_output
  local -a curl_family

  if [[ "$family" == IPv4 ]]; then
    curl_family=(-4)
  else
    curl_family=(-6)
  fi

  if curl_output=$(
    trap - ERR
    curl --disable --noproxy '*' "${curl_family[@]}" \
      --resolve "cloudflare-dns.com:443:$address" \
      --connect-timeout 3 --max-time 6 --fail --silent --show-error \
      --header 'Accept: application/dns-json' \
      --write-out 'HTTP %{http_code}' \
      --output /dev/null \
      'https://cloudflare-dns.com/dns-query?name=example.com&type=A' \
      2>&1
  ); then
    log "  $family 直连测试: 成功（$address:443）"
  else
    curl_output=${curl_output//$'\n'/'; '}
    log "  $family 直连测试: 失败（$address:443；${curl_output:-无详细错误}）"
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
  log "  IPv6 内核支持: ${IPV6_SUPPORTED}；已配置全局地址: $IPV6_HAS_ADDRESS"
  log "  IPv6 默认路由: $ipv6_route"
  log "  IPv6 all.disable_ipv6: $(read_sysctl net.ipv6.conf.all.disable_ipv6)（此值不代表实际连通性）"
  log "  REALITY TCP 配置: $(if [[ -f "$SYSCTL_FILE" ]] && grep -Fq '# Xray-REALITY TCP profile;' "$SYSCTL_FILE"; then printf '已配置'; else printf '未配置'; fi)"
  log "  TCP 接收缓冲区 min/default/max: $(read_sysctl net.ipv4.tcp_rmem)"
  log "  TCP 发送缓冲区 min/default/max: $(read_sysctl net.ipv4.tcp_wmem)"
  log "  TCP 接收自动调节: $(read_sysctl net.ipv4.tcp_moderate_rcvbuf)"
  log "  监听队列上限: $(read_sysctl net.core.somaxconn)"
  log "  SYN 队列上限: $(read_sysctl net.ipv4.tcp_max_syn_backlog)"
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
      prepare_ipv6_address
      select_mode
      check_system
      validate_ip_mode
      select_dns_servers
      detect_dns_mode
      prepare_reality_sysctls
      apply_configuration
      ;;
  esac
}

main "$@"
