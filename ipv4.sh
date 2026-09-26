#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_NAME="${0##*/}"
readonly GAI_FILE="/etc/gai.conf"
readonly SYSCTL_FILE="/etc/sysctl.d/99-ipv4-optimization.conf"
readonly MODULES_FILE="/etc/modules-load.d/ipv4-optimization.conf"
readonly STATE_DIR="/var/lib/ipv4-optimizer"
readonly BACKUP_ROOT="${STATE_DIR}/backups"
readonly LATEST_LINK="${STATE_DIR}/latest"
readonly GAI_BEGIN="# BEGIN ipv4-optimizer managed block"
readonly GAI_END="# END ipv4-optimizer managed block"

ACTION="apply"
ASSUME_YES=false
APPLYING=false
CURRENT_BACKUP=""
BBR_ENABLED=false
TEMP_FILES=()

function log {
  printf '%s\n' "$*"
}

function warn {
  printf '警告: %s\n' "$*" >&2
}

function die {
  printf '错误: %s\n' "$*" >&2
  exit 1
}

function cleanup {
  local exit_code=$1 file
  for file in "${TEMP_FILES[@]:-}"; do
    [[ -n "${file}" && -e "${file}" ]] && rm -f -- "${file}"
  done
  return "${exit_code}"
}

function restore_runtime_sysctls {
  local backup_dir=$1 key value

  [[ -f "${backup_dir}/runtime-sysctl.tsv" ]] || return 0
  while IFS=$'\t' read -r key value; do
    [[ -n "${key}" ]] || continue
    sysctl -q -w "${key}=${value}" 2>/dev/null || \
      warn "无法恢复运行时参数 ${key}=${value}"
  done <"${backup_dir}/runtime-sysctl.tsv"
}

function restore_file {
  local backup_dir=$1 backup_name=$2 target=$3

  if [[ -e "${backup_dir}/${backup_name}" ]]; then
    cp -a -- "${backup_dir}/${backup_name}" "${target}"
  elif [[ -e "${backup_dir}/${backup_name}.absent" ]]; then
    rm -f -- "${target}"
  else
    warn "备份中缺少 ${target} 的状态，已跳过"
  fi
}

function restore_backup {
  local backup_dir=$1

  [[ -d "${backup_dir}" ]] || die "备份目录不存在: ${backup_dir}"
  restore_file "${backup_dir}" "gai.conf" "${GAI_FILE}"
  restore_file "${backup_dir}" "sysctl.conf" "${SYSCTL_FILE}"
  restore_file "${backup_dir}" "modules.conf" "${MODULES_FILE}"
  restore_runtime_sysctls "${backup_dir}"
}

function on_error {
  local exit_code=$? line=${BASH_LINENO[0]:-未知}

  trap - ERR
  if [[ "${APPLYING}" == true && -n "${CURRENT_BACKUP}" ]]; then
    warn "第 ${line} 行执行失败，正在恢复本次修改前的配置……"
    restore_backup "${CURRENT_BACKUP}" || \
      warn "自动恢复不完整，请手动运行: ${SCRIPT_NAME} --rollback"
  fi
  exit "${exit_code}"
}

function usage {
  cat <<EOF
用法: ${SCRIPT_NAME} [选项]

为 Debian 配置“IPv4 出站优先”，并应用保守的 IPv4 TCP 优化。
不会禁用 IPv6，也不会修改防火墙、DNS 或网卡地址。

选项:
  --apply          应用配置（默认）
  --status         显示当前配置和 IPv4 路由状态
  --rollback       回滚最近一次 --apply 前的文件和运行时参数
  -y, --yes        跳过交互确认
  -h, --help       显示帮助

示例:
  sudo bash ${SCRIPT_NAME}
  sudo bash ${SCRIPT_NAME} --yes
  bash ${SCRIPT_NAME} --status
  sudo bash ${SCRIPT_NAME} --rollback
EOF
}

function parse_arguments {
  local action_seen=false

  while (($# > 0)); do
    case "$1" in
    --apply | --status | --rollback)
      if [[ "${action_seen}" == true ]]; then
        die "一次只能指定一个操作"
      fi
      ACTION=${1#--}
      action_seen=true
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
}

function check_debian {
  local os_id=""

  [[ -r /etc/os-release ]] || die "无法读取 /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  os_id=${ID:-}
  [[ "${os_id}" == "debian" ]] || \
    die "此脚本仅支持 Debian；检测到: ${PRETTY_NAME:-${os_id:-未知系统}}"
}

function require_root {
  [[ "$(id -u)" -eq 0 ]] || die "请使用 root 权限运行（例如 sudo bash ${SCRIPT_NAME}）"
}

function require_commands {
  local command_name
  for command_name in awk cp date grep id install ln mkdir mktemp readlink rm sysctl; do
    command -v "${command_name}" >/dev/null 2>&1 || \
      die "缺少必需命令: ${command_name}"
  done
}

function confirm_action {
  local prompt=$1 answer=""

  [[ "${ASSUME_YES}" == true ]] && return 0
  [[ -t 0 ]] || die "非交互环境请添加 --yes"
  read -r -p "${prompt} (y/N): " answer
  [[ "${answer}" =~ ^[Yy]$ ]] || {
    log "操作已取消。"
    exit 0
  }
}

function backup_file {
  local source=$1 backup_name=$2

  if [[ -e "${source}" ]]; then
    cp -a -- "${source}" "${CURRENT_BACKUP}/${backup_name}"
  else
    : >"${CURRENT_BACKUP}/${backup_name}.absent"
  fi
}

function save_runtime_sysctls {
  local key value
  local -a keys=(
    net.ipv4.tcp_fastopen
    net.ipv4.tcp_mtu_probing
    net.core.default_qdisc
    net.ipv4.tcp_congestion_control
  )

  : >"${CURRENT_BACKUP}/runtime-sysctl.tsv"
  for key in "${keys[@]}"; do
    if value=$(sysctl -n "${key}" 2>/dev/null); then
      printf '%s\t%s\n' "${key}" "${value}" >>"${CURRENT_BACKUP}/runtime-sysctl.tsv"
    fi
  done
}

function create_backup {
  local timestamp

  timestamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p -m 700 -- "${BACKUP_ROOT}"
  CURRENT_BACKUP="${BACKUP_ROOT}/${timestamp}-$$"
  mkdir -m 700 -- "${CURRENT_BACKUP}"

  backup_file "${GAI_FILE}" "gai.conf"
  backup_file "${SYSCTL_FILE}" "sysctl.conf"
  backup_file "${MODULES_FILE}" "modules.conf"
  save_runtime_sysctls
  printf '%s\n' "$(date --iso-8601=seconds)" >"${CURRENT_BACKUP}/created-at"
  ln -sfn -- "${CURRENT_BACKUP}" "${LATEST_LINK}"
  log "配置备份: ${CURRENT_BACKUP}"
}

function prepare_gai_config {
  local temp_file=$1

  # gai.conf 中一旦出现 precedence，glibc 的默认 precedence 表就不再使用。
  # 因此写入完整默认表，只提高 IPv4-mapped 地址的优先级。
  if [[ -f "${GAI_FILE}" ]]; then
    awk -v begin="${GAI_BEGIN}" -v end="${GAI_END}" '
      $0 == begin { in_managed = 1; next }
      $0 == end   { in_managed = 0; next }
      in_managed  { next }
      /^[[:space:]]*#/ { print; next }
      /^[[:space:]]*precedence[[:space:]]/ {
        print "# ipv4-optimizer disabled: " $0
        next
      }
      { print }
    ' "${GAI_FILE}" >"${temp_file}"
  else
    : >"${temp_file}"
  fi

  cat >>"${temp_file}" <<EOF

${GAI_BEGIN}
# 保留 IPv6；仅让 getaddrinfo(3) 在双栈结果中优先返回 IPv4。
# 必须保留完整 precedence 表，否则定义一条规则就会替换 glibc 默认表。
precedence ::1/128       50
precedence ::/0          40
precedence 2002::/16     30
precedence ::/96         20
precedence ::ffff:0:0/96 100
${GAI_END}
EOF
}

function detect_bbr {
  local available=""

  if command -v modprobe >/dev/null 2>&1; then
    modprobe tcp_bbr 2>/dev/null || true
    modprobe sch_fq 2>/dev/null || true
  fi

  available=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || true)
  if [[ " ${available} " == *" bbr "* ]] && \
    sysctl -n net.core.default_qdisc >/dev/null 2>&1; then
    BBR_ENABLED=true
  fi
}

function prepare_sysctl_config {
  local temp_file=$1

  cat >"${temp_file}" <<'EOF'
# Managed by ipv4.sh
# 保留内核 TCP 缓冲区自动调优；不设置固定的 rmem/wmem 上限。

# 客户端及服务端基础 TCP Fast Open 支持（应用仍需主动使用该能力）。
net.ipv4.tcp_fastopen = 3

# 仅在探测到 PMTU 黑洞时启用 TCP MTU probing。
net.ipv4.tcp_mtu_probing = 1
EOF

  if [[ "${BBR_ENABLED}" == true ]]; then
    cat >>"${temp_file}" <<'EOF'

# 当前内核支持 BBR；FQ 为其提供合适的数据包调度。
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
  fi
}

function prepare_modules_config {
  local temp_file=$1 wrote_module=false

  : >"${temp_file}"
  if command -v modinfo >/dev/null 2>&1 && modinfo tcp_bbr >/dev/null 2>&1; then
    printf '%s\n' 'tcp_bbr' >>"${temp_file}"
    wrote_module=true
  fi
  if command -v modinfo >/dev/null 2>&1 && modinfo sch_fq >/dev/null 2>&1; then
    printf '%s\n' 'sch_fq' >>"${temp_file}"
    wrote_module=true
  fi

  [[ "${wrote_module}" == true ]]
}

function apply_configuration {
  local temp_gai temp_sysctl temp_modules

  confirm_action "将配置 IPv4 出站优先并应用保守的 TCP 优化，是否继续？"
  create_backup
  APPLYING=true

  temp_gai=$(mktemp /tmp/ipv4-gai.XXXXXX)
  temp_sysctl=$(mktemp /tmp/ipv4-sysctl.XXXXXX)
  temp_modules=$(mktemp /tmp/ipv4-modules.XXXXXX)
  TEMP_FILES+=("${temp_gai}" "${temp_sysctl}" "${temp_modules}")

  detect_bbr
  prepare_gai_config "${temp_gai}"
  prepare_sysctl_config "${temp_sysctl}"

  install -m 644 -o root -g root "${temp_gai}" "${GAI_FILE}"
  install -m 644 -o root -g root "${temp_sysctl}" "${SYSCTL_FILE}"

  if [[ "${BBR_ENABLED}" == true ]] && prepare_modules_config "${temp_modules}"; then
    install -m 644 -o root -g root "${temp_modules}" "${MODULES_FILE}"
  else
    rm -f -- "${MODULES_FILE}"
  fi

  # 只加载本脚本管理的参数，避免被其他 sysctl 文件中的错误干扰。
  sysctl -p "${SYSCTL_FILE}" >/dev/null

  grep -Fxq "${GAI_BEGIN}" "${GAI_FILE}"
  [[ "$(sysctl -n net.ipv4.tcp_fastopen)" == "3" ]]
  [[ "$(sysctl -n net.ipv4.tcp_mtu_probing)" == "1" ]]
  if [[ "${BBR_ENABLED}" == true ]]; then
    [[ "$(sysctl -n net.core.default_qdisc)" == "fq" ]]
    [[ "$(sysctl -n net.ipv4.tcp_congestion_control)" == "bbr" ]]
  fi

  APPLYING=false
  log ""
  log "配置完成。IPv6 仍然可用，新启动的双栈程序将优先选择 IPv4 出站。"
  if [[ "${BBR_ENABLED}" == true ]]; then
    log "BBR 状态: 已启用（队列调度器: fq）"
  else
    log "BBR 状态: 当前内核未提供，已保留现有拥塞控制算法。"
  fi
  log "提示: 已经运行的长期进程可能需要重启，才会重新读取地址选择策略。"
  show_status
}

function latest_backup_path {
  local backup_dir=""

  [[ -L "${LATEST_LINK}" ]] || return 1
  backup_dir=$(readlink -f -- "${LATEST_LINK}") || return 1
  [[ -n "${backup_dir}" && -d "${backup_dir}" ]] || return 1
  printf '%s\n' "${backup_dir}"
}

function rollback_configuration {
  local backup_dir

  backup_dir=$(latest_backup_path) || die "没有可回滚的备份"
  confirm_action "将从 ${backup_dir} 恢复最近一次修改，是否继续？"
  restore_backup "${backup_dir}"
  rm -f -- "${LATEST_LINK}"
  log "已恢复备份: ${backup_dir}"
  log "备份目录仍被保留；已经运行的长期进程可能需要重启。"
}

function read_sysctl {
  local key=$1 value
  if value=$(sysctl -n "${key}" 2>/dev/null); then
    printf '%s' "${value}"
  else
    printf '%s' "不可用"
  fi
}

function show_status {
  local ipv4_policy="未配置" backup_dir="无" route="无法检测"

  if [[ -f "${GAI_FILE}" ]] && grep -Fxq "${GAI_BEGIN}" "${GAI_FILE}"; then
    ipv4_policy="已配置（IPv4 precedence=100，未禁用 IPv6）"
  fi
  if latest_backup_path >/dev/null 2>&1; then
    backup_dir=$(latest_backup_path)
  fi
  if command -v ip >/dev/null 2>&1; then
    route=$(ip -4 route get 1.1.1.1 2>/dev/null | awk 'NR == 1 { print; exit }')
    route=${route:-无可用的 IPv4 默认路由}
  fi

  log ""
  log "当前状态:"
  log "  IPv4 地址选择: ${ipv4_policy}"
  log "  TCP Fast Open:  $(read_sysctl net.ipv4.tcp_fastopen)"
  log "  MTU probing:    $(read_sysctl net.ipv4.tcp_mtu_probing)"
  log "  拥塞控制:       $(read_sysctl net.ipv4.tcp_congestion_control)"
  log "  默认队列算法:   $(read_sysctl net.core.default_qdisc)"
  log "  IPv4 路由:      ${route}"
  log "  最近备份:       ${backup_dir}"
}

function main {
  trap 'cleanup $?' EXIT
  trap on_error ERR
  parse_arguments "$@"

  case "${ACTION}" in
  status)
    show_status
    ;;
  apply)
    require_root
    check_debian
    require_commands
    apply_configuration
    ;;
  rollback)
    require_root
    check_debian
    require_commands
    rollback_configuration
    ;;
  esac
}

main "$@"
