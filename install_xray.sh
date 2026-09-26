#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly XRAY_INSTALL_URL="https://github.com/XTLS/Xray-install/raw/main/install-release.sh"
readonly XRAY_BIN="/usr/local/bin/xray"
readonly XRAY_CONFIG_DIR="/usr/local/etc/xray"
readonly XRAY_CONFIG_FILE="${XRAY_CONFIG_DIR}/config.json"
CLIENT_INFO_FILE="${XRAY_CLIENT_INFO_FILE:-/root/xray-reality-client.txt}"
readonly NETWORK_SYSCTL_FILE="/etc/sysctl.d/99-xray-network.conf"
readonly GAI_CONFIG_FILE="/etc/gai.conf"
readonly GAI_BEGIN="# BEGIN install_xray.sh network priority"
readonly GAI_END="# END install_xray.sh network priority"
readonly XRAY_SERVICE_USER="root"
readonly XRAY_SERVICE_GROUP="root"
readonly XRAY_SERVICE_OVERRIDE_DIR="/etc/systemd/system/xray.service.d"
readonly XRAY_SERVICE_OVERRIDE_FILE="${XRAY_SERVICE_OVERRIDE_DIR}/30-install-xray-runtime-user.conf"

OS_NAME=""
UUID=""
PRIVATE_KEY=""
PUBLIC_KEY=""
SHORT_ID=""
REALITY_SERVER_NAME="${REALITY_SERVER_NAME:-www.microsoft.com}"
XRAY_PORT="${XRAY_PORT:-}"
readonly DEFAULT_XRAY_PORT=443
XRAY_LISTEN_ADDRESS="::"
SSH_PORTS=""
ASSUME_YES=false
NETWORK_PRIORITY="${NETWORK_PRIORITY:-}"
NETWORK_PRIORITY_LABEL=""
XRAY_PRIORITIZE_IPV6=false
LOON_IP_MODE="prefer-v4"
LOON_SERVER_IP="${LOON_SERVER_IP:-}"
PUBLIC_IPV4="未检测到"
PUBLIC_IPV6="未检测到"
BBR_STATUS="未启用"
IPV6_STATUS="待检测"
TEMP_INSTALL_SCRIPT=""
TEMP_CONFIG_FILE=""
TEMP_SYSCTL_FILE=""
TEMP_GAI_FILE=""
TEMP_SERVICE_OVERRIDE=""
REMOVED_CONFIG_BACKUP=""
CONFIG_REPLACEMENT_PENDING=false

function restore_removed_xray_config {
  if [[ "${CONFIG_REPLACEMENT_PENDING}" != true || -z "${REMOVED_CONFIG_BACKUP}" || \
    ! -f "${REMOVED_CONFIG_BACKUP}" ]]; then
    return 1
  fi

  cp -a -- "${REMOVED_CONFIG_BACKUP}" "${XRAY_CONFIG_FILE}"
  systemctl restart xray >/dev/null 2>&1 || true
  CONFIG_REPLACEMENT_PENDING=false
  echo "已恢复删除前的 Xray 配置: ${REMOVED_CONFIG_BACKUP}" >&2
}

function on_error {
  local exit_code=$1 line=$2

  trap - ERR
  echo "错误: install_xray.sh 在第 ${line} 行中断（退出码 ${exit_code}）。" >&2
  if [[ "${CONFIG_REPLACEMENT_PENDING}" == true ]]; then
    restore_removed_xray_config || \
      echo "警告: 没有可恢复的旧 Xray 配置；服务将保持停止状态。" >&2
  fi
  echo "请保留本行之前的终端输出；脚本不会把失败误报为安装成功。" >&2
  exit "${exit_code}"
}

# 清理临时文件
function cleanup {
  if [[ -n "${TEMP_INSTALL_SCRIPT}" && -f "${TEMP_INSTALL_SCRIPT}" ]]; then
    rm -f -- "${TEMP_INSTALL_SCRIPT}"
  fi
  if [[ -n "${TEMP_CONFIG_FILE}" && -f "${TEMP_CONFIG_FILE}" ]]; then
    rm -f -- "${TEMP_CONFIG_FILE}"
  fi
  if [[ -n "${TEMP_SYSCTL_FILE}" && -f "${TEMP_SYSCTL_FILE}" ]]; then
    rm -f -- "${TEMP_SYSCTL_FILE}"
  fi
  if [[ -n "${TEMP_GAI_FILE}" && -f "${TEMP_GAI_FILE}" ]]; then
    rm -f -- "${TEMP_GAI_FILE}"
  fi
  if [[ -n "${TEMP_SERVICE_OVERRIDE}" && -f "${TEMP_SERVICE_OVERRIDE}" ]]; then
    rm -f -- "${TEMP_SERVICE_OVERRIDE}"
  fi
}

trap cleanup EXIT
trap 'on_error $? ${LINENO}' ERR

# 命令行参数
function parse_arguments {
  while (($# > 0)); do
    case "$1" in
    -y | --yes)
      ASSUME_YES=true
      ;;
    --network-priority)
      if (($# < 2)); then
        echo "错误: --network-priority 需要 ipv4 或 ipv6 参数。" >&2
        exit 1
      fi
      NETWORK_PRIORITY=$2
      shift
      ;;
    --network-priority=*)
      NETWORK_PRIORITY=${1#*=}
      ;;
    --port)
      if (($# < 2)); then
        echo "错误: --port 需要端口号参数。" >&2
        exit 1
      fi
      XRAY_PORT=$2
      shift
      ;;
    --port=*)
      XRAY_PORT=${1#*=}
      ;;
    --loon-address)
      if (($# < 2)); then
        echo "错误: --loon-address 需要 IP 地址参数。" >&2
        exit 1
      fi
      LOON_SERVER_IP=$2
      shift
      ;;
    --loon-address=*)
      LOON_SERVER_IP=${1#*=}
      ;;
    -h | --help)
      echo "用法: $0 [--yes] [--network-priority ipv4|ipv6] [--port 端口] [--loon-address IP]"
      echo "  -y, --yes                      跳过确认，执行无人值守安装"
      echo "  --network-priority ipv4|ipv6   指定出站网络优先级"
      echo "  --port 端口                    指定 Xray 监听端口（默认: 443）"
      echo "  --loon-address IP              指定或覆盖 Loon 节点 IP"
      echo "  -h, --help                     显示帮助"
      echo "必须以 root 身份运行；Xray 服务也固定使用 root:root，不创建 xray 用户。"
      echo "交互运行时会询问网络优先级和端口；--yes 未指定时默认 IPv4/443。"
      echo "环境变量:"
      echo "  NETWORK_PRIORITY=ipv4|ipv6"
      echo "  XRAY_PORT=1-65535"
      echo "  LOON_SERVER_IP=与所选网络一致的 IP 地址"
      echo "  REALITY_SERVER_NAME（默认: www.microsoft.com）"
      echo "  XRAY_CLIENT_INFO_FILE（默认: /root/xray-reality-client.txt）"
      exit 0
      ;;
    *)
      echo "错误: 未知参数 $1" >&2
      echo "请使用 $0 --help 查看帮助。" >&2
      exit 1
      ;;
    esac
    shift
  done
}

# 规范化并保存网络优先级
function set_network_priority {
  case "${1:-}" in
  4 | ipv4 | IPv4 | IPV4)
    NETWORK_PRIORITY="ipv4"
    NETWORK_PRIORITY_LABEL="IPv4 优先，IPv6 回退"
    XRAY_PRIORITIZE_IPV6=false
    LOON_IP_MODE="prefer-v4"
    ;;
  6 | ipv6 | IPv6 | IPV6)
    NETWORK_PRIORITY="ipv6"
    NETWORK_PRIORITY_LABEL="IPv6 优先，IPv4 回退"
    XRAY_PRIORITIZE_IPV6=true
    LOON_IP_MODE="prefer-v6"
    ;;
  *)
    return 1
    ;;
  esac
}

# 交互选择出站优先级；无人值守默认选择兼容性更好的 IPv4
function select_network_priority {
  local choice=""

  if [[ -n "${NETWORK_PRIORITY}" ]]; then
    set_network_priority "${NETWORK_PRIORITY}" || {
      echo "错误: NETWORK_PRIORITY/--network-priority 只能是 ipv4 或 ipv6。" >&2
      exit 1
    }
  elif [[ "${ASSUME_YES}" == true ]]; then
    set_network_priority "ipv4"
    echo "未指定网络优先级，无人值守模式默认选择 IPv4 优先。"
  else
    if [[ ! -t 0 ]]; then
      echo "错误: 非交互环境无法询问网络优先级。" >&2
      echo "请添加 --network-priority ipv4|ipv6，并使用 --yes 跳过确认。" >&2
      exit 1
    fi
    echo "请选择 Xray 出站网络优先级："
    echo "  1) IPv4 优先，IPv6 不可用时自动回退（推荐）"
    echo "  2) IPv6 优先，IPv4 不可用时自动回退"
    while true; do
      read -r -p "请输入选项 [1-2]（默认 1）: " choice
      choice=${choice:-1}
      case "${choice}" in
      1 | 4 | ipv4 | IPv4)
        set_network_priority "ipv4"
        break
        ;;
      2 | 6 | ipv6 | IPv6)
        set_network_priority "ipv6"
        break
        ;;
      *)
        echo "无效选项，请输入 1 或 2。"
        ;;
      esac
    done
  fi

  echo "已选择: ${NETWORK_PRIORITY_LABEL}"
}

# 校验并保存 Xray 监听端口
function set_xray_port {
  local port=${1:-}

  if [[ ! "${port}" =~ ^[0-9]+$ || ${#port} -gt 5 ]] || \
    ((10#${port} < 1 || 10#${port} > 65535)); then
    return 1
  fi
  XRAY_PORT=$((10#${port}))
}

# 交互选择端口；无人值守模式默认使用 443
function select_xray_port {
  local port=""

  if [[ -n "${XRAY_PORT}" ]]; then
    set_xray_port "${XRAY_PORT}" || {
      echo "错误: XRAY_PORT/--port 必须是 1-65535 的整数。" >&2
      exit 1
    }
  elif [[ "${ASSUME_YES}" == true ]]; then
    set_xray_port "${DEFAULT_XRAY_PORT}"
    echo "未指定 Xray 端口，无人值守模式默认使用 ${XRAY_PORT}。"
  else
    if [[ ! -t 0 ]]; then
      echo "错误: 非交互环境无法询问 Xray 端口。" >&2
      echo "请添加 --port 端口号，并使用 --yes 跳过确认。" >&2
      exit 1
    fi
    while true; do
      read -r -p "请输入 Xray 监听端口 [1-65535]（默认 ${DEFAULT_XRAY_PORT}）: " port
      port=${port:-${DEFAULT_XRAY_PORT}}
      if set_xray_port "${port}"; then
        break
      fi
      echo "无效端口，请输入 1-65535 的整数。"
    done
  fi

  echo "Xray 监听端口: ${XRAY_PORT}"
}

# 安全提示
function confirm_action {
  if [[ "${ASSUME_YES}" == true ]]; then
    return
  fi

  if [[ ! -t 0 ]]; then
    echo "错误: 非交互环境请添加 --yes。" >&2
    exit 1
  fi

  echo -e "注意: 此脚本将以 root 身份安装并运行 Xray、应用网络优化并修改防火墙规则；不会创建 xray 用户。"
  read -r -p "是否继续执行？ (y/N): " CONFIRM
  CONFIRM=${CONFIRM:-N}
  if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
    echo "操作已取消。"
    exit 0
  fi
}

# 生成 glibc 地址选择表：保留双栈，只改变首选协议
function prepare_gai_config {
  local source_file=$1 output_file=$2

  if [[ -f "${source_file}" ]]; then
    awk -v begin="${GAI_BEGIN}" -v end="${GAI_END}" '
      $0 == begin { in_managed = 1; next }
      $0 == end   { in_managed = 0; next }
      in_managed  { next }
      /^[[:space:]]*#/ { print; next }
      /^[[:space:]]*precedence[[:space:]]/ {
        print "# install_xray.sh disabled: " $0
        next
      }
      { print }
    ' "${source_file}" >"${output_file}"
  else
    : >"${output_file}"
  fi

  cat >>"${output_file}" <<EOF

${GAI_BEGIN}
# 定义任意 precedence 都会替换 glibc 默认表，因此必须保留完整规则。
EOF

  if [[ "${NETWORK_PRIORITY}" == "ipv4" ]]; then
    cat >>"${output_file}" <<'EOF'
precedence ::1/128       50
precedence ::/0          40
precedence 2002::/16     30
precedence ::/96         20
precedence ::ffff:0:0/96 100
EOF
  else
    cat >>"${output_file}" <<'EOF'
precedence ::1/128       110
precedence ::/0          100
precedence 2002::/16     30
precedence ::/96         20
precedence ::ffff:0:0/96 40
EOF
  fi

  printf '%s\n' "${GAI_END}" >>"${output_file}"
}

# 配置保守的 Linux 网络优化，并按选择设置系统地址优先级
function optimize_network {
  local available_congestion sysctl_backup="" gai_backup=""
  local sysctl_existed=false

  echo "正在配置服务器网络优化（${NETWORK_PRIORITY_LABEL}）..."
  TEMP_SYSCTL_FILE=$(mktemp /tmp/xray-network.XXXXXX.conf)
  TEMP_GAI_FILE=$(mktemp /tmp/xray-gai.XXXXXX.conf)

  # BBR 需要 tcp_bbr，FQ 是其推荐的队列调度器。
  if command -v modprobe >/dev/null 2>&1; then
    run_as_root modprobe tcp_bbr 2>/dev/null || true
    run_as_root modprobe sch_fq 2>/dev/null || true
  fi

  available_congestion=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || true)

  cat >"${TEMP_SYSCTL_FILE}" <<'EOF'
# Managed by install_xray.sh
# Keep the tuning conservative and let the kernel retain buffer autotuning.
net.core.default_qdisc = fq
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 1
EOF

  if [[ " ${available_congestion} " == *" bbr "* ]]; then
    echo "net.ipv4.tcp_congestion_control = bbr" >>"${TEMP_SYSCTL_FILE}"
    BBR_STATUS="已启用"
  else
    echo "提示: 当前内核未提供 BBR，将保留现有拥塞控制算法。"
  fi

  if [[ -e /proc/sys/net/ipv6/conf/all/disable_ipv6 && -e /proc/sys/net/ipv6/conf/default/disable_ipv6 ]]; then
    cat >>"${TEMP_SYSCTL_FILE}" <<'EOF'
net.ipv6.conf.all.disable_ipv6 = 0
net.ipv6.conf.default.disable_ipv6 = 0
EOF
  else
    echo "提示: 当前内核未提供 IPv6 协议栈，Xray 将仅监听 IPv4。"
  fi

  if [[ -f "${NETWORK_SYSCTL_FILE}" ]]; then
    sysctl_existed=true
    sysctl_backup="${NETWORK_SYSCTL_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    run_as_root cp -a "${NETWORK_SYSCTL_FILE}" "${sysctl_backup}"
    echo "已备份原 sysctl 配置到: ${sysctl_backup}"
  fi

  if [[ -f "${GAI_CONFIG_FILE}" ]]; then
    gai_backup="${GAI_CONFIG_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    run_as_root cp -a "${GAI_CONFIG_FILE}" "${gai_backup}"
    echo "已备份原地址选择配置到: ${gai_backup}"
  fi

  prepare_gai_config "${GAI_CONFIG_FILE}" "${TEMP_GAI_FILE}"
  run_as_root install -m 644 -o root -g root "${TEMP_SYSCTL_FILE}" "${NETWORK_SYSCTL_FILE}"
  run_as_root install -m 644 -o root -g root "${TEMP_GAI_FILE}" "${GAI_CONFIG_FILE}"
  rm -f -- "${TEMP_SYSCTL_FILE}"
  TEMP_SYSCTL_FILE=""
  rm -f -- "${TEMP_GAI_FILE}"
  TEMP_GAI_FILE=""

  if ! run_as_root sysctl -p "${NETWORK_SYSCTL_FILE}" >/dev/null; then
    echo "警告: 当前虚拟化环境不允许完整应用 sysctl 优化，将恢复原 sysctl 配置并继续安装。" >&2
    if [[ "${sysctl_existed}" == true ]] && run_as_root test -f "${sysctl_backup}"; then
      run_as_root cp -a "${sysctl_backup}" "${NETWORK_SYSCTL_FILE}"
      run_as_root sysctl -p "${NETWORK_SYSCTL_FILE}" >/dev/null 2>&1 || true
      echo "已自动恢复原 sysctl 配置: ${sysctl_backup}" >&2
    else
      run_as_root rm -f -- "${NETWORK_SYSCTL_FILE}"
    fi
  fi

  if [[ "$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || true)" == "bbr" ]]; then
    BBR_STATUS="已启用"
  else
    BBR_STATUS="未启用"
  fi

  echo "系统地址选择策略已设置为: ${NETWORK_PRIORITY_LABEL}"
}

# 在修改系统配置前，确认首选协议至少具备基本出站条件
function validate_selected_network {
  local default_route=""

  if [[ "${NETWORK_PRIORITY}" == "ipv6" ]]; then
    if [[ ! -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]] || \
      [[ "$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null || true)" != "0" ]]; then
      echo "错误: 已选择 IPv6 优先，但当前内核或虚拟化环境没有启用 IPv6 协议栈。" >&2
      exit 1
    fi
    if command -v ip >/dev/null 2>&1; then
      default_route=$(ip -6 route show default 2>/dev/null || true)
      if [[ -z "${default_route}" ]]; then
        echo "错误: 已选择 IPv6 优先，但未检测到 IPv6 默认路由。" >&2
        echo "请先配置可用的 IPv6 网络，或重新运行并选择 IPv4 优先。" >&2
        exit 1
      fi
    fi
  elif command -v ip >/dev/null 2>&1; then
    default_route=$(ip -4 route show default 2>/dev/null || true)
    if [[ -z "${default_route}" ]]; then
      echo "警告: 已选择 IPv4 优先，但未检测到 IPv4 默认路由；Xray 将在失败时尝试 IPv6。" >&2
    fi
  fi
}

# 根据实际协议栈决定使用双栈或仅 IPv4 监听
function configure_network_mode {
  local ipv6_enabled=false

  if [[ -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]] && \
    [[ "$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null || true)" == "0" ]]; then
    ipv6_enabled=true
  fi

  if [[ "${ipv6_enabled}" == true ]]; then
    XRAY_LISTEN_ADDRESS="::"
    IPV6_STATUS="已启用，入站监听 IPv4/IPv6 双栈"
  else
    XRAY_LISTEN_ADDRESS="0.0.0.0"
    IPV6_STATUS="不可用，入站仅监听 IPv4"
  fi

  echo "监听模式: ${XRAY_LISTEN_ADDRESS}:${XRAY_PORT}（${IPV6_STATUS}）"
}

# 安装脚本已经要求由 root 启动；保留此包装函数以明确标记系统级操作
function run_as_root {
  "$@"
}

# 安装阶段必须以 root 身份运行，过程中不再请求或刷新 sudo 凭据
function initialize_runtime_environment {
  local output_dir

  if [[ "$(id -u)" -ne 0 ]]; then
    echo "错误: 此安装脚本必须以 root 身份运行。" >&2
    echo "请先切换到 root，再运行此脚本；也可由普通管理员执行: sudo bash install_xray.sh" >&2
    exit 1
  fi

  [[ "${CLIENT_INFO_FILE}" == /* ]] || {
    echo "错误: XRAY_CLIENT_INFO_FILE 必须是绝对路径。" >&2
    exit 1
  }
  output_dir=${CLIENT_INFO_FILE%/*}
  [[ -d "${output_dir}" && -w "${output_dir}" ]] || {
    echo "错误: root 无法写入客户端信息目录: ${output_dir}" >&2
    exit 1
  }
}

# 使用 systemd drop-in 固定 Xray 以 root 身份运行
function configure_xray_root_service {
  local effective_group effective_user verify=${1:-true}

  TEMP_SERVICE_OVERRIDE=$(mktemp /tmp/xray-service-user.XXXXXX.conf)
  cat >"${TEMP_SERVICE_OVERRIDE}" <<EOF
[Service]
User=${XRAY_SERVICE_USER}
Group=${XRAY_SERVICE_GROUP}
UMask=0027
NoNewPrivileges=true
EOF

  cat >>"${TEMP_SERVICE_OVERRIDE}" <<'EOF'
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
PrivateDevices=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
EOF

  run_as_root mkdir -p "${XRAY_SERVICE_OVERRIDE_DIR}"
  run_as_root install -m 644 -o root -g root "${TEMP_SERVICE_OVERRIDE}" "${XRAY_SERVICE_OVERRIDE_FILE}"
  rm -f -- "${TEMP_SERVICE_OVERRIDE}"
  TEMP_SERVICE_OVERRIDE=""
  run_as_root systemctl daemon-reload

  if [[ "${verify}" != true ]]; then
    return
  fi

  effective_user=$(systemctl show xray --property=User --value 2>/dev/null || true)
  effective_group=$(systemctl show xray --property=Group --value 2>/dev/null || true)
  [[ "${effective_user}" == "${XRAY_SERVICE_USER}" && "${effective_group}" == "${XRAY_SERVICE_GROUP}" ]] || {
    echo "错误: systemd 未应用 root 运行配置（User=${effective_user:-空}, Group=${effective_group:-空}）。" >&2
    exit 1
  }
}

# 权限及运行环境检查
function check_environment {
  initialize_runtime_environment

  if ! command -v systemctl >/dev/null 2>&1; then
    echo "错误: 此脚本仅支持使用 systemd 的 Linux 系统。" >&2
    exit 1
  fi

}

# 检测系统包管理器
function get_os {
  if [[ ! -r /etc/os-release ]]; then
    echo "错误: 无法识别当前 Linux 发行版。" >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  OS_NAME=${ID:-unknown}
}

# 安装必要工具
function install_dependencies {
  local command_name dependencies_ready=true

  for command_name in curl openssl sysctl modprobe ip ss awk sed install; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      dependencies_ready=false
      break
    fi
  done
  if [[ "${dependencies_ready}" == true ]]; then
    echo "所需系统工具已存在，跳过软件包更新。"
    return
  fi

  case "${OS_NAME}" in
  ubuntu | debian)
    run_as_root apt-get update
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
      curl ca-certificates openssl procps kmod iproute2
    ;;
  centos | rhel | fedora | rocky | almalinux | ol)
    if command -v dnf >/dev/null 2>&1; then
      run_as_root dnf install -y curl ca-certificates openssl procps-ng kmod iproute
    else
      run_as_root yum install -y curl ca-certificates openssl procps-ng kmod iproute
    fi
    ;;
  *)
    echo "错误: 暂不支持当前发行版 (${OS_NAME})。" >&2
    exit 1
    ;;
  esac
}

# 初始化并校验固定安装参数
function prepare_configuration {
  if [[ ! "${REALITY_SERVER_NAME}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]; then
    echo "错误: REALITY_SERVER_NAME 必须是不带协议和端口的有效域名。" >&2
    exit 1
  fi

  echo "安装参数: TCP ${XRAY_PORT}，${NETWORK_PRIORITY_LABEL}，运行用户: ${XRAY_SERVICE_USER}，REALITY 伪装域名: ${REALITY_SERVER_NAME}"
}

# 将合法端口加入 SSH 端口列表并自动去重
function add_ssh_port {
  local port=${1:-}

  if [[ ! "${port}" =~ ^[0-9]+$ ]] || ((10#${port} < 1 || 10#${port} > 65535)); then
    return
  fi
  port=$((10#${port}))

  if [[ " ${SSH_PORTS} " != *" ${port} "* ]]; then
    SSH_PORTS="${SSH_PORTS:+${SSH_PORTS} }${port}"
  fi
}

# 自动识别当前会话和 sshd 实际使用的端口
function detect_ssh_ports {
  local client_ip client_port server_ip server_port port

  SSH_PORTS=""

  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    read -r client_ip client_port server_ip server_port <<<"${SSH_CONNECTION}"
    add_ssh_port "${server_port:-}"
  fi

  if command -v sshd >/dev/null 2>&1; then
    while read -r port; do
      add_ssh_port "${port}"
    done < <(run_as_root sshd -T 2>/dev/null | awk '$1 == "port" {print $2}')
  fi

  if [[ -z "${SSH_PORTS}" ]]; then
    SSH_PORTS="22"
  fi

  echo "检测到 SSH 端口: ${SSH_PORTS}"
}

# 在安装前检查用户选择的端口是否被非 Xray 进程占用
function check_xray_port {
  local listeners non_xray_listeners

  listeners=$(run_as_root ss -H -ltnp "sport = :${XRAY_PORT}" 2>/dev/null || true)
  non_xray_listeners=$(printf '%s\n' "${listeners}" | awk 'index($0, "\"xray\"") == 0')
  if [[ -n "${non_xray_listeners}" ]]; then
    echo "错误: TCP ${XRAY_PORT} 已被其他进程占用，无法启动 Xray。" >&2
    echo "当前监听信息: ${non_xray_listeners}" >&2
    exit 1
  fi
}

# 安装 Xray
function install_xray {
  echo "正在安装 Xray..."
  TEMP_INSTALL_SCRIPT=$(mktemp /tmp/xray-install.XXXXXX.sh)
  curl -fsSL "${XRAY_INSTALL_URL}" -o "${TEMP_INSTALL_SCRIPT}"
  run_as_root bash "${TEMP_INSTALL_SCRIPT}" install -u "${XRAY_SERVICE_USER}"

  if [[ ! -x "${XRAY_BIN}" ]]; then
    echo "错误: Xray 安装失败，未找到 ${XRAY_BIN}。" >&2
    exit 1
  fi
}

# 官方安装完成后停止服务，备份并删除安装器生成或遗留的配置，再创建本脚本配置
function remove_installer_generated_config {
  local timestamp

  echo "正在停止 Xray，并删除安装器生成或遗留的配置文件..."
  run_as_root systemctl stop xray

  if run_as_root test -f "${XRAY_CONFIG_FILE}"; then
    timestamp=$(date +%Y%m%d-%H%M%S)
    REMOVED_CONFIG_BACKUP="${XRAY_CONFIG_FILE}.before-reality.${timestamp}"
    run_as_root cp -a -- "${XRAY_CONFIG_FILE}" "${REMOVED_CONFIG_BACKUP}"
    CONFIG_REPLACEMENT_PENDING=true
    run_as_root rm -f -- "${XRAY_CONFIG_FILE}"
    echo "已删除原配置；安全备份保存在: ${REMOVED_CONFIG_BACKUP}"
  else
    REMOVED_CONFIG_BACKUP=""
    CONFIG_REPLACEMENT_PENDING=false
    echo "安装器未生成 ${XRAY_CONFIG_FILE}，继续创建新配置。"
  fi

  if run_as_root test -e "${XRAY_CONFIG_FILE}"; then
    echo "错误: 无法删除 ${XRAY_CONFIG_FILE}。" >&2
    exit 1
  fi
}

# 生成 UUID、X25519 密钥对和 Short ID
function generate_credentials {
  local key_output

  if [[ ! -x "${XRAY_BIN}" ]]; then
    echo "错误: 必须先安装 Xray，才能生成连接凭据。" >&2
    exit 1
  fi

  echo "正在通过 Xray 命令生成 UUID 和 X25519 密钥..."
  UUID=$("${XRAY_BIN}" uuid)
  key_output=$("${XRAY_BIN}" x25519)

  # 同时兼容新版本的 PrivateKey/Password 和旧版本的 Private key/Public key 输出。
  PRIVATE_KEY=$(printf '%s\n' "${key_output}" | awk -F': ' '/^(PrivateKey|Private key):/ {print $2; exit}')
  PUBLIC_KEY=$(printf '%s\n' "${key_output}" | awk -F': ' '/^(Password( \(PublicKey\))?|Public key):/ {print $2; exit}')
  # Xray CLI 没有 Short ID 生成命令；官方要求使用不超过 16 位的偶数长度十六进制值。
  SHORT_ID=$(openssl rand -hex 8)

  if [[ -z "${UUID}" || -z "${PRIVATE_KEY}" || -z "${PUBLIC_KEY}" || ! "${SHORT_ID}" =~ ^[0-9a-f]{16}$ ]]; then
    echo "错误: 无法生成完整的 REALITY 连接凭据。" >&2
    exit 1
  fi
}

# 配置 VLESS + REALITY + XTLS Vision
function setup_xray {
  run_as_root mkdir -p "${XRAY_CONFIG_DIR}"
  run_as_root chown root:"${XRAY_SERVICE_GROUP}" "${XRAY_CONFIG_DIR}"
  run_as_root chmod 750 "${XRAY_CONFIG_DIR}"
  TEMP_CONFIG_FILE=$(mktemp /tmp/xray-config.XXXXXX.json)

  cat >"${TEMP_CONFIG_FILE}" <<EOF
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "tag": "vless-reality-vision",
      "listen": "${XRAY_LISTEN_ADDRESS}",
      "port": ${XRAY_PORT},
      "protocol": "vless",
      "settings": {
        "users": [
          {
            "id": "${UUID}",
            "flow": "xtls-rprx-vision"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "raw",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "target": "${REALITY_SERVER_NAME}:443",
          "serverNames": [
            "${REALITY_SERVER_NAME}"
          ],
          "privateKey": "${PRIVATE_KEY}",
          "shortIds": [
            "${SHORT_ID}"
          ]
        },
        "sockopt": {
          "V6Only": false,
          "domainStrategy": "UseIP",
          "tcpFastOpen": true,
          "tcpKeepAliveIdle": 300,
          "tcpKeepAliveInterval": 30,
          "happyEyeballs": {
            "tryDelayMs": 250,
            "prioritizeIPv6": ${XRAY_PRIORITIZE_IPV6},
            "interleave": 1,
            "maxConcurrentTry": 4
          }
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": [
          "http",
          "tls",
          "quic"
        ],
        "routeOnly": true
      }
    }
  ],
  "outbounds": [
    {
      "tag": "direct",
      "protocol": "freedom",
      "streamSettings": {
        "sockopt": {
          "domainStrategy": "UseIP",
          "tcpFastOpen": true,
          "happyEyeballs": {
            "tryDelayMs": 250,
            "prioritizeIPv6": ${XRAY_PRIORITIZE_IPV6},
            "interleave": 1,
            "maxConcurrentTry": 4
          }
        }
      }
    },
    {
      "tag": "blocked",
      "protocol": "blackhole"
    }
  ]
}
EOF

  echo "正在校验 Xray 配置..."
  "${XRAY_BIN}" run -test -config "${TEMP_CONFIG_FILE}"

  run_as_root install -m 600 -o root -g root "${TEMP_CONFIG_FILE}" "${XRAY_CONFIG_FILE}"
  rm -f -- "${TEMP_CONFIG_FILE}"
  TEMP_CONFIG_FILE=""

  run_as_root systemctl enable xray >/dev/null
  if ! run_as_root systemctl restart xray; then
    echo "错误: Xray 启动失败，最近的服务日志如下：" >&2
    run_as_root journalctl -u xray --no-pager -n 30 >&2 || true
    restore_removed_xray_config || true
    exit 1
  fi

  if ! systemctl is-active --quiet xray; then
    echo "错误: Xray 服务未处于运行状态。" >&2
    run_as_root journalctl -u xray --no-pager -n 30 >&2 || true
    restore_removed_xray_config || true
    exit 1
  fi

  CONFIG_REPLACEMENT_PENDING=false
}

# 防火墙配置：放行 SSH 和 Xray 端口，不擅自启用当前未启用的防火墙
function configure_firewall {
  local ssh_port ufw_backup

  echo "正在配置防火墙规则..."

  if command -v ufw >/dev/null 2>&1; then
    if [[ "${XRAY_LISTEN_ADDRESS}" == "::" && -f /etc/default/ufw ]] && \
      ! grep -Eqi '^IPV6=yes$' /etc/default/ufw; then
      ufw_backup="/etc/default/ufw.bak.$(date +%Y%m%d-%H%M%S)"
      run_as_root cp -a /etc/default/ufw "${ufw_backup}"
      if grep -Eq '^IPV6=' /etc/default/ufw; then
        run_as_root sed -i -E 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
      else
        printf '%s\n' 'IPV6=yes' | run_as_root tee -a /etc/default/ufw >/dev/null
      fi
      echo "已启用 UFW IPv6 支持，原配置备份到: ${ufw_backup}"
    fi

    for ssh_port in ${SSH_PORTS}; do
      run_as_root ufw allow "${ssh_port}/tcp"
    done
    run_as_root ufw allow "${XRAY_PORT}/tcp"
    if ! run_as_root ufw status | grep -q '^Status: active'; then
      echo "提示: UFW 当前未启用，规则已添加但尚未生效。"
    else
      run_as_root ufw reload
    fi
  elif command -v firewall-cmd >/dev/null 2>&1 && run_as_root firewall-cmd --state >/dev/null 2>&1; then
    for ssh_port in ${SSH_PORTS}; do
      run_as_root firewall-cmd --permanent --add-port="${ssh_port}/tcp"
    done
    run_as_root firewall-cmd --permanent --add-port="${XRAY_PORT}/tcp"
    run_as_root firewall-cmd --reload
  else
    echo "提示: 未检测到已启用的 UFW/firewalld。"
    echo "请在云安全组或其他防火墙中放行 SSH TCP 端口 ${SSH_PORTS} 和 Xray TCP 端口 ${XRAY_PORT}。"
  fi
}

# 去除用户可能附带的 IPv6 方括号
function normalize_ip_literal {
  local address=${1:-}

  address=$(printf '%s' "${address}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [[ "${address}" == \[*\] ]]; then
    address=${address#[}
    address=${address%]}
  fi
  printf '%s' "${address}"
}

# 使用 iproute2 校验字面 IP，并确保地址族与用户选择一致
function is_valid_ip_address {
  local address=$1 family=$2

  [[ -n "${address}" ]] || return 1
  case "${family}" in
  ipv4)
    [[ "${address}" != *:* ]] || return 1
    ip -4 route get "${address}" >/dev/null 2>&1
    ;;
  ipv6)
    [[ "${address}" == *:* ]] || return 1
    ip -6 route get "${address}" >/dev/null 2>&1
    ;;
  *)
    return 1
    ;;
  esac
}

# 获取公网 IP 地址
function get_public_ip {
  local ipv4 ipv6

  ipv4=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || \
    curl -4 -fsS --max-time 8 https://4.ipw.cn 2>/dev/null || true)
  ipv6=$(curl -6 -fsS --max-time 8 https://api64.ipify.org 2>/dev/null || \
    curl -6 -fsS --max-time 8 https://6.ipw.cn 2>/dev/null || true)

  ipv4=$(normalize_ip_literal "${ipv4}")
  ipv6=$(normalize_ip_literal "${ipv6}")

  if is_valid_ip_address "${ipv4}" "ipv4"; then
    PUBLIC_IPV4=${ipv4}
  fi
  if is_valid_ip_address "${ipv6}" "ipv6"; then
    PUBLIC_IPV6=${ipv6}
  fi
}

# 选择写入 Loon 和 Xray 客户端示例的服务器 IP
function select_loon_server_ip {
  local candidate="" family_label=""

  if [[ "${NETWORK_PRIORITY}" == "ipv4" ]]; then
    family_label="IPv4"
  else
    family_label="IPv6"
  fi

  if [[ -n "${LOON_SERVER_IP}" ]]; then
    candidate=$(normalize_ip_literal "${LOON_SERVER_IP}")
    if ! is_valid_ip_address "${candidate}" "${NETWORK_PRIORITY}"; then
      echo "错误: LOON_SERVER_IP/--loon-address 不是有效的 ${family_label} 地址。" >&2
      exit 1
    fi
    LOON_SERVER_IP=${candidate}
    echo "使用指定的 Loon 节点 IP: ${LOON_SERVER_IP}"
    return
  fi

  if [[ "${NETWORK_PRIORITY}" == "ipv4" ]]; then
    candidate=${PUBLIC_IPV4}
  else
    candidate=${PUBLIC_IPV6}
  fi

  if [[ "${candidate}" != "未检测到" ]]; then
    LOON_SERVER_IP=${candidate}
    echo "已自动选择 Loon 节点 ${family_label}: ${LOON_SERVER_IP}"
    return
  fi

  echo "警告: 未能自动检测公网 ${family_label} 地址。" >&2
  echo "当前检测结果: IPv4=${PUBLIC_IPV4}，IPv6=${PUBLIC_IPV6}" >&2
  if [[ "${ASSUME_YES}" == true || ! -t 0 ]]; then
    echo "错误: 无人值守模式无法询问 Loon 节点 IP。" >&2
    echo "请重新运行并添加 --loon-address ${family_label}地址。" >&2
    exit 1
  fi

  while true; do
    read -r -p "请输入 Loon 节点使用的 ${family_label} 地址: " candidate
    candidate=$(normalize_ip_literal "${candidate}")
    if is_valid_ip_address "${candidate}" "${NETWORK_PRIORITY}"; then
      LOON_SERVER_IP=${candidate}
      break
    fi
    echo "无效地址，请输入有效的 ${family_label} 字面地址，不要输入域名。"
  done

  echo "Loon 节点 IP: ${LOON_SERVER_IP}"
}

# 生成客户端连接信息
function write_client_info {
  local loon_config server_address=${LOON_SERVER_IP}

  loon_config="Xray-REALITY = VLESS,${server_address},${XRAY_PORT},\"${UUID}\",transport=tcp,flow=xtls-rprx-vision,public-key=\"${PUBLIC_KEY}\",short-id=${SHORT_ID},over-tls=true,sni=${REALITY_SERVER_NAME},tls-profile=chrome,udp=true,block-quic=false,ip-mode=${LOON_IP_MODE}"

  cat >"${CLIENT_INFO_FILE}" <<EOF
VLESS + REALITY + XTLS Vision 客户端参数
==========================================
Xray 运行用户: ${XRAY_SERVICE_USER}:${XRAY_SERVICE_GROUP}
网络策略: ${NETWORK_PRIORITY_LABEL}
BBR 状态: ${BBR_STATUS}
推荐服务器地址: ${server_address}
公网 IPv4 地址: ${PUBLIC_IPV4}
公网 IPv6 地址: ${PUBLIC_IPV6}
端口: ${XRAY_PORT}
UUID: ${UUID}
Encryption: none
Flow: xtls-rprx-vision
传输方式: TCP/RAW
传输安全: reality
SNI/ServerName: ${REALITY_SERVER_NAME}
Fingerprint: chrome
Password/Public Key: ${PUBLIC_KEY}
Short ID: ${SHORT_ID}
SpiderX: /

Xray 客户端出站示例:
{
  "tag": "proxy",
  "protocol": "vless",
  "settings": {
    "vnext": [
      {
        "address": "${server_address}",
        "port": ${XRAY_PORT},
        "users": [
          {
            "id": "${UUID}",
            "encryption": "none",
            "flow": "xtls-rprx-vision"
          }
        ]
      }
    ]
  },
  "streamSettings": {
    "network": "raw",
    "security": "reality",
    "realitySettings": {
      "serverName": "${REALITY_SERVER_NAME}",
      "fingerprint": "chrome",
      "password": "${PUBLIC_KEY}",
      "shortId": "${SHORT_ID}",
      "spiderX": "/"
    }
  }
}

Loon 节点配置（粘贴到 [Proxy] 段）:
${loon_config}
EOF

  chmod 600 "${CLIENT_INFO_FILE}"

  echo -e "\n配置完成！"
  echo "Xray 服务状态: 运行中"
  echo "Xray 运行用户: ${XRAY_SERVICE_USER}:${XRAY_SERVICE_GROUP}"
  echo "Xray 配置文件: ${XRAY_CONFIG_FILE}"
  echo "客户端信息文件: ${CLIENT_INFO_FILE}"
  echo "网络策略: ${NETWORK_PRIORITY_LABEL}"
  echo "监听状态: ${IPV6_STATUS}"
  echo "BBR 状态: ${BBR_STATUS}"
  echo -e "\n客户端手动配置参数："
  echo "推荐服务器地址: ${server_address}"
  echo "公网 IPv4 地址: ${PUBLIC_IPV4}"
  echo "公网 IPv6 地址: ${PUBLIC_IPV6}"
  echo "端口: ${XRAY_PORT}"
  echo "UUID: ${UUID}"
  echo "Encryption: none"
  echo "Flow: xtls-rprx-vision"
  echo "传输方式: TCP/RAW"
  echo "传输安全: reality"
  echo "SNI/ServerName: ${REALITY_SERVER_NAME}"
  echo "Fingerprint: chrome"
  echo "Password/Public Key: ${PUBLIC_KEY}"
  echo "Short ID: ${SHORT_ID}"
  echo "SpiderX: /"
  echo -e "\nLoon 节点配置（粘贴到 [Proxy] 段）："
  echo "${loon_config}"
}

# 主函数
function main {
  parse_arguments "$@"
  check_environment
  get_os
  select_network_priority
  select_xray_port
  confirm_action
  install_dependencies
  prepare_configuration
  detect_ssh_ports
  check_xray_port
  validate_selected_network
  optimize_network
  configure_network_mode
  install_xray
  remove_installer_generated_config
  configure_xray_root_service true
  generate_credentials
  setup_xray
  configure_firewall
  get_public_ip
  select_loon_server_ip
  write_client_info
}

main "$@"
