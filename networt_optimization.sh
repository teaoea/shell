#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly SCRIPT_NAME="networt_optimization.sh"
readonly GAI_FILE="/etc/gai.conf"
readonly SYSCTL_FILE="/etc/sysctl.d/99-network-optimization.conf"
readonly MODULES_FILE="/etc/modules-load.d/network-optimization.conf"
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

  if [[ -e "$backup_dir/$backup_name" ]]; then
    cp -a -- "$backup_dir/$backup_name" "$target"
  elif [[ -e "$backup_dir/$backup_name.absent" ]]; then
    rm -f -- "$target"
  else
    warn "备份缺少 $target 的状态"
    return 1
  fi
}

restore_runtime_sysctls() {
  local backup_dir=$1 key value

  [[ -f "$backup_dir/runtime-sysctl.tsv" ]] || return 0
  while IFS=$'\t' read -r key value; do
    [[ -n "$key" ]] || continue
    sysctl -q -w "$key=$value" 2>/dev/null ||
      warn "无法恢复运行时参数 $key"
  done <"$backup_dir/runtime-sysctl.tsv"
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
  restore_runtime_sysctls "$backup_dir" || failed=1
  return "$failed"
}

on_error() {
  local status=$1 line=$2
  trap - ERR
  warn "第 ${line} 行失败（退出码 ${status}）"
  if [[ "$APPLYING" == true && -n "$CURRENT_BACKUP" ]]; then
    set +e
    restore_backup "$CURRENT_BACKUP" ||
      warn "自动恢复不完整，备份位置: $CURRENT_BACKUP"
    if [[ -n "$PREVIOUS_LATEST" && -d "$PREVIOUS_LATEST" ]]; then
      ln -sfn -- "$PREVIOUS_LATEST" "$LATEST_LINK"
    else
      rm -f -- "$LATEST_LINK"
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
两种模式都保留双栈，并应用保守的 TCP 优化；内核支持时启用 BBR + FQ。

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

select_mode() {
  local answer
  [[ -n "$MODE" ]] && return 0
  [[ "$ASSUME_YES" != true ]] ||
    die "--yes 模式必须同时指定 --ipv4 或 --ipv6"
  [[ -t 0 ]] ||
    die "非交互运行请指定 --ipv4 或 --ipv6，并添加 --yes"

  while true; do
    log "请选择出站地址优先级："
    log "  1) IPv4 优先，保留 IPv6"
    log "  2) IPv6 优先，保留 IPv4"
    read -r -p "输入 1 或 2（默认 1）: " answer
    case "${answer:-1}" in
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

  if [[ -e "$source" ]]; then
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
# 启用 IPv6，但不修改接口地址、默认路由、DNS 或 MTU。
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

inspect_ipv6_prerequisites() {
  local address route
  address=$(ip -6 -o address show scope global 2>/dev/null |
    awk 'NR == 1 { print $4; exit }')
  route=$(ip -6 route show default 2>/dev/null |
    awk 'NR == 1 { print; exit }')
  [[ -n "$address" ]] ||
    warn "没有全局 IPv6 地址；设置优先级后仍将使用 IPv4"
  [[ -n "$route" ]] ||
    warn "没有 IPv6 默认路由；请先在 VPS 网络配置中启用 IPv6"
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

  [[ "$MODE" != ipv6 ]] || inspect_ipv6_prerequisites
  confirm_action "将应用 ${MODE^^} 优先和保守 TCP 优化，是否继续？"
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
  APPLYING=false

  log "已应用 ${MODE^^} 优先；IPv4 和 IPv6 均保留可用。"
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

show_status() {
  local mode="未由本脚本配置" backup="无" ipv4_route="无" ipv6_route="无"

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
      awk 'NR == 1 { print; exit }')
    ipv6_route=$(ip -6 route show default 2>/dev/null |
      awk 'NR == 1 { print; exit }')
    ipv4_route=${ipv4_route:-无}
    ipv6_route=${ipv6_route:-无}
  fi

  log "当前状态:"
  log "  地址选择: $mode"
  log "  IPv4 默认路由: $ipv4_route"
  log "  IPv6 默认路由: $ipv6_route"
  log "  IPv6 禁用状态: $(read_sysctl net.ipv6.conf.all.disable_ipv6)（0 表示启用）"
  log "  TCP Fast Open: $(read_sysctl net.ipv4.tcp_fastopen)"
  log "  MTU probing: $(read_sysctl net.ipv4.tcp_mtu_probing)"
  log "  拥塞控制: $(read_sysctl net.ipv4.tcp_congestion_control)"
  log "  默认队列算法: $(read_sysctl net.core.default_qdisc)"
  log "  最近备份: $backup"
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
      select_mode
      check_system
      require_commands
      apply_configuration
      ;;
  esac
}

main "$@"
