#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly XRAY_INSTALL_URL="https://github.com/XTLS/Xray-install/raw/main/install-release.sh"
readonly NETWORK_OPTIMIZER_URL="https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/optimize/networt_optimization.sh"
readonly XRAY_BIN="/usr/local/bin/xray"
readonly XRAY_CONFIG_DIR="/usr/local/etc/xray"
readonly XRAY_CONFIG_FILE="$XRAY_CONFIG_DIR/config.json"

XRAY_PORT_SET=false
[[ -z "${XRAY_PORT:-}" ]] || XRAY_PORT_SET=true
XRAY_PORT="${XRAY_PORT:-443}"
REALITY_SERVER_NAME_SET=false
[[ -z "${REALITY_SERVER_NAME:-}" ]] || REALITY_SERVER_NAME_SET=true
REALITY_SERVER_NAME="${REALITY_SERVER_NAME:-www.apple.com}"
LOON_SERVER_IP="${LOON_SERVER_IP:-}"
ASSUME_YES=false
LISTEN_ADDRESS="0.0.0.0"
NETWORK_MODE=""
NETWORK_MODE_SET=false
OPTIMIZE_NETWORK=""
PREFER_IPV6=false
OS_FAMILY=""
PACKAGE_MANAGER=""
ENABLE_SHADOWSOCKS=true
SS_PORT=8443
SS_PORT_SET=false
SS_PASSWORD=""
SS_LISTENER_STATUS="未检查"
CLIENT_BUNDLE_FILE=""

UUID=""
PRIVATE_KEY=""
PUBLIC_KEY=""
SHORT_ID=""
TEMP_INSTALLER=""
TEMP_NETWORK_OPTIMIZER=""
TEMP_CONFIG=""
CONFIG_BACKUP=""
REPLACEMENT_PENDING=false
PREVIOUSLY_ACTIVE=false
NETWORK_OPTIMIZATION_APPLIED=false
XRAY_LISTENER_STATUS="未检查"

die() {
  printf '错误: %s\n' "$*" >&2
  exit 1
}

on_error() {
  local status=$1 line=$2
  trap - ERR
  printf '错误: install_xray.sh 在第 %s 行失败（退出码 %s）。\n' "$line" "$status" >&2
  exit "$status"
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e

  if ((status != 0)) && [[ "$REPLACEMENT_PENDING" == true ]]; then
    if [[ -n "$CONFIG_BACKUP" && -f "$CONFIG_BACKUP" ]]; then
      cp -a -- "$CONFIG_BACKUP" "$XRAY_CONFIG_FILE"
      printf '已恢复原 Xray 配置: %s\n' "$CONFIG_BACKUP" >&2
    else
      rm -f -- "$XRAY_CONFIG_FILE"
    fi

    if [[ "$PREVIOUSLY_ACTIVE" == true ]]; then
      systemctl restart xray || printf '警告: 原 Xray 服务未能重新启动。\n' >&2
    else
      systemctl stop xray >/dev/null 2>&1
    fi
  fi

  if ((status != 0)) && [[ "$NETWORK_OPTIMIZATION_APPLIED" == true ]]; then
    if bash "$TEMP_NETWORK_OPTIMIZER" --rollback --yes; then
      printf '已回滚本次 Xray-REALITY 网络优化。\n' >&2
    else
      printf '警告: Xray 安装失败，网络优化未能完整回滚；请运行 networt_optimization.sh --rollback 检查。\n' >&2
    fi
  fi

  [[ -z "$TEMP_INSTALLER" ]] || rm -f -- "$TEMP_INSTALLER"
  [[ -z "$TEMP_NETWORK_OPTIMIZER" ]] || rm -f -- "$TEMP_NETWORK_OPTIMIZER"
  [[ -z "$TEMP_CONFIG" ]] || rm -f -- "$TEMP_CONFIG"
  return "$status"
}

trap cleanup EXIT
trap 'on_error $? $LINENO' ERR

usage() {
  cat <<'EOF'
用法: bash install_xray.sh [--outbound IPv4|IPv6|IPv4v6|IPv6v4]
       [--optimize-network|--no-optimize-network]
       [--reality-domain 域名]
       [--yes] [--port 端口] [--client-address IP]
       [--ss-port 端口 | --no-shadowsocks]
  --outbound 模式     Xray 出口 IP 模式；空值或未选择时不设置
  --ipv4 / --ipv6     仅使用对应地址族（--outbound 的简写）
  --ipv4v6 / --ipv6v4 优先前一个地址族，另一地址族回退
  --optimize-network  应用 Xray-REALITY 系统网络优化
  --no-optimize-network
                      不修改系统网络配置
  --reality-domain 域名
                      REALITY 伪装域名，默认 www.apple.com
  --yes               跳过安装确认；须明确是否应用网络优化
  --port 端口         Xray REALITY 监听端口，默认 443
  --client-address IP 所有客户端的节点地址，默认自动检测公网 IPv4/IPv6
  --loon-address IP   --client-address 的兼容别名
  --ss-port 端口      Shadowsocks 兼容入口，默认 8443（TCP/UDP）
  --no-shadowsocks    只安装 REALITY，不生成 Surge 配置
  -h, --help          显示帮助

支持 Debian/Ubuntu 和红帽系 Linux；需要运行中的 systemd。
普通用户自动通过 sudo 提权。可设置 XRAY_PORT、LOON_SERVER_IP 和
REALITY_SERVER_NAME（默认 www.apple.com）。
确认安装后会更新软件源索引，并通过 apt-get、dnf 或 yum 安装必要工具。
默认生成 Loon、圈 X、Surge、Mihomo 配置，按标记汇总到用户家目录的 client_config。
脚本不安装或修改防火墙，请自行放行 REALITY TCP 和 Shadowsocks TCP/UDP 端口。
EOF
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      -y | --yes)
        ASSUME_YES=true
        ;;
      --ipv4 | --ipv6 | --ipv4v6 | --ipv6v4)
        [[ "$NETWORK_MODE_SET" == false ]] || die "一次只能选择一种出口 IP 模式"
        NETWORK_MODE=${1#--}
        NETWORK_MODE_SET=true
        ;;
      --outbound | --outbound=*)
        [[ "$NETWORK_MODE_SET" == false ]] || die "一次只能选择一种出口 IP 模式"
        if [[ "$1" == --outbound ]]; then
          (($# >= 2)) || die "--outbound 缺少参数"
          NETWORK_MODE=$2
          shift
        else
          NETWORK_MODE=${1#*=}
        fi
        case "$NETWORK_MODE" in
          IPv4 | ipv4) NETWORK_MODE=ipv4 ;;
          IPv6 | ipv6) NETWORK_MODE=ipv6 ;;
          IPv4v6 | ipv4v6) NETWORK_MODE=ipv4v6 ;;
          IPv6v4 | ipv6v4) NETWORK_MODE=ipv6v4 ;;
          "") ;;
          *) die "出口模式只允许 IPv4、IPv6、IPv4v6、IPv6v4 或空值" ;;
        esac
        NETWORK_MODE_SET=true
        ;;
      --optimize-network)
        [[ -z "$OPTIMIZE_NETWORK" ]] || die "一次只能选择一种网络优化设置"
        OPTIMIZE_NETWORK=true
        ;;
      --no-optimize-network)
        [[ -z "$OPTIMIZE_NETWORK" ]] || die "一次只能选择一种网络优化设置"
        OPTIMIZE_NETWORK=false
        ;;
      --reality-domain)
        (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] ||
          die "--reality-domain 缺少参数"
        REALITY_SERVER_NAME=$2
        REALITY_SERVER_NAME_SET=true
        shift
        ;;
      --reality-domain=*)
        REALITY_SERVER_NAME=${1#*=}
        [[ -n "$REALITY_SERVER_NAME" ]] || die "--reality-domain 缺少参数"
        REALITY_SERVER_NAME_SET=true
        ;;
      --no-shadowsocks)
        ENABLE_SHADOWSOCKS=false
        ;;
      --ss-port | --ss-port=*)
        if [[ "$1" == --ss-port ]]; then
          (($# >= 2)) || die "--ss-port 缺少参数"
          SS_PORT=$2
          shift
        else
          SS_PORT=${1#*=}
        fi
        SS_PORT_SET=true
        ;;
      --port | --loon-address | --client-address)
        (($# >= 2)) || die "$1 缺少参数"
        if [[ "$1" == --port ]]; then
          XRAY_PORT=$2
          XRAY_PORT_SET=true
        else
          LOON_SERVER_IP=$2
        fi
        shift
        ;;
      --port=*)
        XRAY_PORT=${1#*=}
        [[ -n "$XRAY_PORT" ]] || die "--port 缺少参数"
        XRAY_PORT_SET=true
        ;;
      --loon-address=* | --client-address=*)
        LOON_SERVER_IP=${1#*=}
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

  if [[ "$ASSUME_YES" == true ]]; then
    [[ -n "$OPTIMIZE_NETWORK" ]] ||
      die "--yes 模式必须同时指定 --optimize-network 或 --no-optimize-network"
  fi
  [[ "$ENABLE_SHADOWSOCKS" == true || "$SS_PORT_SET" == false ]] ||
    die "--ss-port 不能与 --no-shadowsocks 同时使用"
}

detect_system() {
  local ID="" ID_LIKE="" PRETTY_NAME="" VERSION_ID=""
  [[ "$(uname -s)" == Linux ]] || die "仅支持 Linux VPS"
  [[ -r /etc/os-release ]] || die "无法读取 /etc/os-release，无法识别 VPS 系统"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "$ID" in
    debian | ubuntu) OS_FAMILY=debian ;;
    rhel | centos | rocky | almalinux | fedora | ol) OS_FAMILY=redhat ;;
    *)
      case " $ID_LIKE " in
        *" debian "* | *" ubuntu "*) OS_FAMILY=debian ;;
        *" rhel "* | *" centos "* | *" fedora "*) OS_FAMILY=redhat ;;
        *) die "不支持的 VPS 系统: ${PRETTY_NAME:-$ID}（支持 Debian 系和红帽系）" ;;
      esac
      ;;
  esac
  if [[ "$OS_FAMILY" == debian ]]; then
    command -v apt-get >/dev/null 2>&1 || die "Debian 系系统缺少 apt-get"
    PACKAGE_MANAGER=apt-get
  elif command -v dnf >/dev/null 2>&1; then
    PACKAGE_MANAGER=dnf
  elif command -v yum >/dev/null 2>&1; then
    PACKAGE_MANAGER=yum
  else
    die "红帽系系统缺少 dnf 或 yum"
  fi
  printf 'VPS 系统: %s；架构: %s；包管理器: %s。\n' \
    "${PRETTY_NAME:-$ID $VERSION_ID}" "$(uname -m)" "$PACKAGE_MANAGER"
}

ensure_root() {
  [[ "$(id -u)" -ne 0 ]] || return 0
  command -v sudo >/dev/null 2>&1 || die "需要 root 权限；请切换 root 后运行（未安装 sudo）"
  local -a environment=()
  [[ "$XRAY_PORT_SET" != true ]] || environment+=("XRAY_PORT=$XRAY_PORT")
  [[ "$REALITY_SERVER_NAME_SET" != true ]] || environment+=("REALITY_SERVER_NAME=$REALITY_SERVER_NAME")
  [[ -z "$LOON_SERVER_IP" ]] || environment+=("LOON_SERVER_IP=$LOON_SERVER_IP")
  [[ -z "${SSH_CONNECTION:-}" ]] || environment+=("SSH_CONNECTION=$SSH_CONNECTION")
  printf '正在通过 sudo 获取安装所需权限...\n'
  if [[ -n "${BASH_EXECUTION_STRING:-}" ]]; then
    exec sudo -- env "${environment[@]}" bash -c "$BASH_EXECUTION_STRING" "$0" "$@"
  else
    exec sudo -- env "${environment[@]}" bash "${BASH_SOURCE[0]}" "$@"
  fi
}

check_environment() {
  [[ "$(id -u)" -eq 0 ]] || die "需要 root 权限"
  command -v systemctl >/dev/null 2>&1 || die "需要使用 systemd 的 Linux 系统"
  [[ -d /run/systemd/system ]] || die "systemd 未运行，无法安装和启动 Xray 服务"

  validate_xray_port

  if [[ -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]] &&
    [[ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" == 0 ]]; then
    LISTEN_ADDRESS="::"
  fi
}

install_required_tools() {
  local command_name
  local -a packages=(ca-certificates openssl unzip kmod gawk grep e2fsprogs)

  if [[ "$PACKAGE_MANAGER" == apt-get ]]; then
    packages+=(iproute2 procps libc-bin ncurses-bin)
  else
    packages+=(iproute procps-ng glibc-common ncurses)
  fi

  # 精简镜像可能由 curl-minimal 或 coreutils-single 提供这些命令。
  command -v curl >/dev/null 2>&1 || packages+=(curl)
  for command_name in install mktemp cp date; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      packages+=(coreutils)
      break
    fi
  done

  printf '正在更新软件源索引并安装 Xray 必要工具...\n'
  case "$PACKAGE_MANAGER" in
    apt-get)
      apt-get update || die "apt-get 软件源更新失败，请检查网络和软件源配置"
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}" ||
        die "Xray 必要工具安装失败（apt-get）"
      ;;
    dnf)
      dnf makecache --refresh || die "dnf 软件源更新失败，请检查网络和软件源配置"
      dnf install -y "${packages[@]}" || die "Xray 必要工具安装失败（dnf）"
      ;;
    yum)
      yum makecache || die "yum 软件源更新失败，请检查网络和软件源配置"
      yum install -y "${packages[@]}" || die "Xray 必要工具安装失败（yum）"
      ;;
  esac
}

check_required_tools() {
  local command_name
  for command_name in curl openssl unzip awk grep install mktemp cp date \
    ip ss sysctl getent tput lsattr chattr mkdir chmod chown mv; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "安装依赖后仍缺少必需命令: $command_name"
  done
}

validate_xray_port() {
  [[ "$XRAY_PORT" =~ ^[0-9]{1,5}$ ]] ||
    die "端口必须是 1-65535 的整数"
  ((10#$XRAY_PORT >= 1 && 10#$XRAY_PORT <= 65535)) ||
    die "端口必须是 1-65535 的整数"
  XRAY_PORT=$((10#$XRAY_PORT))
}

select_xray_port() {
  local answer

  if [[ "$XRAY_PORT_SET" != true && "$ASSUME_YES" != true ]]; then
    [[ -t 0 ]] || die "非交互运行请添加 --yes 或使用 --port 指定端口"
    read -r -p "输入 Xray REALITY 监听端口（默认 443）: " answer
    [[ -z "$answer" ]] || XRAY_PORT=$answer
  fi
  validate_xray_port
  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    if [[ "$SS_PORT_SET" != true ]]; then
      [[ "$XRAY_PORT" != "$SS_PORT" ]] || SS_PORT=8444
      if [[ "$ASSUME_YES" != true ]]; then
        read -r -p "输入 Surge 的 Shadowsocks 端口（默认 $SS_PORT，TCP/UDP）: " answer
        [[ -z "$answer" ]] || SS_PORT=$answer
      fi
    fi
    [[ "$SS_PORT" =~ ^[0-9]{1,5}$ ]] &&
      ((10#$SS_PORT >= 1 && 10#$SS_PORT <= 65535)) || die "Shadowsocks 端口必须是 1-65535 的整数"
    SS_PORT=$((10#$SS_PORT))
    [[ "$SS_PORT" != "$XRAY_PORT" ]] || die "Shadowsocks 与 REALITY 必须使用不同端口"
  fi
}

select_reality_server_name() {
  local answer

  if [[ "$REALITY_SERVER_NAME_SET" != true && "$ASSUME_YES" != true ]]; then
    [[ -t 0 ]] || die "非交互运行请添加 --yes 或指定 --reality-domain"
    read -r -p "输入 REALITY 伪装域名（默认 www.apple.com，直接回车使用默认值）: " answer
    [[ -z "$answer" ]] || REALITY_SERVER_NAME=$answer
  fi

  ((${#REALITY_SERVER_NAME} <= 253)) &&
    [[ "$REALITY_SERVER_NAME" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] ||
    die "REALITY 伪装域名无效: $REALITY_SERVER_NAME"
}

select_network_preferences() {
  local answer

  if [[ "$NETWORK_MODE_SET" == false && "$ASSUME_YES" != true ]]; then
    [[ -t 0 ]] || die "非交互运行请添加 --yes 或指定 --outbound"
    while true; do
      printf '请选择 Xray 出口 IP 模式（无默认值）：\n'
      printf '  1) IPv4：仅 IPv4\n'
      printf '  2) IPv6：仅 IPv6\n'
      printf '  3) IPv4v6：IPv4 优先，IPv6 回退\n'
      printf '  4) IPv6v4：IPv6 优先，IPv4 回退\n'
      read -r -p "输入模式名称或 1-4；直接回车留空、不设置: " answer
      case "$answer" in
        "") NETWORK_MODE=""; break ;;
        1) NETWORK_MODE=ipv4; break ;;
        2) NETWORK_MODE=ipv6; break ;;
        3) NETWORK_MODE=ipv4v6; break ;;
        4) NETWORK_MODE=ipv6v4; break ;;
        IPv4 | ipv4) NETWORK_MODE=ipv4; break ;;
        IPv6 | ipv6) NETWORK_MODE=ipv6; break ;;
        IPv4v6 | ipv4v6) NETWORK_MODE=ipv4v6; break ;;
        IPv6v4 | ipv6v4) NETWORK_MODE=ipv6v4; break ;;
        *) printf '请输入 1-4、模式名称，或直接回车。\n' >&2 ;;
      esac
    done
    NETWORK_MODE_SET=true
  fi

  case "$NETWORK_MODE" in
    ipv6 | ipv6v4) PREFER_IPV6=true ;;
    *) PREFER_IPV6=false ;;
  esac

  if [[ -z "$OPTIMIZE_NETWORK" ]]; then
    [[ -t 0 ]] ||
      die "非交互运行请指定 --optimize-network 或 --no-optimize-network"
    read -r -p "是否应用 Xray-REALITY 针对性系统网络优化？会修改系统 TCP、DNS 和地址优先级。(y/N): " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
      OPTIMIZE_NETWORK=true
    else
      OPTIMIZE_NETWORK=false
    fi
  fi
}

network_mode_label() {
  case "$NETWORK_MODE" in
    ipv4) printf 'IPv4（仅 IPv4）' ;;
    ipv6) printf 'IPv6（仅 IPv6）' ;;
    ipv4v6) printf 'IPv4v6（IPv4 优先，IPv6 回退）' ;;
    ipv6v4) printf 'IPv6v4（IPv6 优先，IPv4 回退）' ;;
    *) printf '未设置（遵循 Xray 默认行为）' ;;
  esac
}

validate_loon_address() {
  local address=$1 octet
  local -a octets

  if [[ "$address" == *:* ]]; then
    [[ "$address" =~ ^[0-9A-Fa-f:]+$ ]] &&
      command -v getent >/dev/null 2>&1 &&
      getent ahostsv6 "$address" >/dev/null 2>&1 ||
      die "Loon 节点地址不是有效的 IPv6"
    LOON_SERVER_IP="[$address]"
  else
    [[ "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] ||
      die "Loon 节点地址必须是 IPv4 或 IPv6"
    IFS=. read -r -a octets <<<"$address"
    for octet in "${octets[@]}"; do
      ((10#$octet <= 255)) || die "Loon 节点 IPv4 地址无效"
    done
    LOON_SERVER_IP=$address
  fi
}

find_loon_address() {
  if [[ -z "$LOON_SERVER_IP" ]]; then
    if [[ "$NETWORK_MODE" == ipv6 || "$NETWORK_MODE" == ipv6v4 ]]; then
      LOON_SERVER_IP=$(
        curl -6 -fsS --max-time 8 https://api64.ipify.org 2>/dev/null ||
          curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null ||
          curl -4 -fsS --max-time 8 https://4.ipw.cn 2>/dev/null
      ) || die "无法检测公网 IP；请用 --loon-address 指定"
    else
      LOON_SERVER_IP=$(
        curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null ||
          curl -4 -fsS --max-time 8 https://4.ipw.cn 2>/dev/null ||
          curl -6 -fsS --max-time 8 https://api64.ipify.org 2>/dev/null
      ) || die "无法检测公网 IP；请用 --loon-address 指定"
    fi
  fi
  validate_loon_address "$LOON_SERVER_IP"
}

confirm_installation_plan() {
  local answer mode_label optimization_text="不修改系统网络配置"
  [[ "$ASSUME_YES" == true ]] && return
  [[ -t 0 ]] || die "非交互运行请添加 --yes"
  [[ "$OPTIMIZE_NETWORK" != true ]] || optimization_text="应用 Xray-REALITY 系统网络优化"
  mode_label=$(network_mode_label)
  printf '出口 IP 模式: %s；%s。\n' "$mode_label" "$optimization_text"
  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    printf '同时安装 Shadowsocks AES-128-GCM 兼容入口，供 Surge 使用；默认端口 8443，稍后可修改。\n'
  fi
  printf '脚本不修改防火墙；需要自行放行所选端口。\n'
  read -r -p "将先更新软件源并安装必要工具，再处理网络设置、选择监听端口，最后询问 REALITY 伪装域名并安装 Xray，继续？(y/N): " answer
  [[ "$answer" =~ ^[Yy]$ ]] || {
    printf '操作已取消。\n'
    exit 0
  }
}

apply_network_optimization() {
  local -a optimizer_arguments=(--xray-reality)
  [[ "$OPTIMIZE_NETWORK" == true ]] || return 0
  case "$NETWORK_MODE" in
    ipv4) optimizer_arguments+=(--ipv4) ;;
    ipv6) optimizer_arguments+=(--ipv6) ;;
    ipv4v6) optimizer_arguments+=(--ipv4 --allow-family-fallback) ;;
    ipv6v4) optimizer_arguments+=(--ipv6 --allow-family-fallback) ;;
    "") optimizer_arguments+=(--keep-priority) ;;
  esac

  printf '正在下载并应用 Xray-REALITY 网络优化...\n'
  TEMP_NETWORK_OPTIMIZER=$(mktemp /tmp/network-optimizer.XXXXXX.sh)
  curl -fL --retry 3 "$NETWORK_OPTIMIZER_URL" -o "$TEMP_NETWORK_OPTIMIZER"
  bash -n "$TEMP_NETWORK_OPTIMIZER"
  if [[ "$ASSUME_YES" == true ]]; then
    optimizer_arguments+=(--yes)
  fi
  bash "$TEMP_NETWORK_OPTIMIZER" "${optimizer_arguments[@]}"
  NETWORK_OPTIMIZATION_APPLIED=true
}

backup_existing_config() {
  if systemctl is-active --quiet xray; then
    PREVIOUSLY_ACTIVE=true
  fi

  if [[ -f "$XRAY_CONFIG_FILE" ]]; then
    CONFIG_BACKUP="$XRAY_CONFIG_FILE.before-install-xray.$(date +%Y%m%d-%H%M%S).$$"
    cp -a -- "$XRAY_CONFIG_FILE" "$CONFIG_BACKUP"
    printf '原配置已备份到: %s\n' "$CONFIG_BACKUP"
  fi
  REPLACEMENT_PENDING=true
}

install_xray() {
  printf '正在安装 Xray...\n'
  TEMP_INSTALLER=$(mktemp /tmp/xray-install.XXXXXX.sh)
  curl -fL --retry 3 "$XRAY_INSTALL_URL" -o "$TEMP_INSTALLER"
  bash "$TEMP_INSTALLER" install -u root
  [[ -x "$XRAY_BIN" ]] || die "安装失败：未找到 $XRAY_BIN"
}

generate_credentials() {
  local key_output

  UUID=$("$XRAY_BIN" uuid)
  key_output=$("$XRAY_BIN" x25519)
  PRIVATE_KEY=$(printf '%s\n' "$key_output" |
    awk -F': ' '/^(PrivateKey|Private key):/ {print $2; exit}')
  PUBLIC_KEY=$(printf '%s\n' "$key_output" |
    awk -F': ' '/^(Password( \(PublicKey\))?|Public key):/ {print $2; exit}')
  SHORT_ID=$(openssl rand -hex 8)
  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    SS_PASSWORD=$(openssl rand -hex 32)
    [[ "$SS_PASSWORD" =~ ^[0-9a-f]{64}$ ]] || die "无法生成 Shadowsocks 密码"
  fi

  [[ -n "$UUID" && -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" &&
    "$SHORT_ID" =~ ^[0-9a-f]{16}$ ]] ||
    die "无法生成完整的 REALITY 连接凭据"
}

write_xray_config() {
  local tcp_fast_open_json="" shadowsocks_json="" outbound_json='"protocol": "freedom"' routing_json="" block_json="" dns_json=""
  mkdir -p "$XRAY_CONFIG_DIR"
  TEMP_CONFIG=$(mktemp /tmp/xray-config.XXXXXX.json)
  [[ "$OPTIMIZE_NETWORK" != true ]] || tcp_fast_open_json=', "tcpFastOpen": true'
  case "$NETWORK_MODE" in
    ipv4 | ipv6)
      local query_strategy=UseIPv4 blocked_family='::/0'
      if [[ "$NETWORK_MODE" == ipv6 ]]; then
        query_strategy=UseIPv6
        blocked_family='0.0.0.0/0'
      fi
      dns_json="\"dns\": {\"servers\": [\"localhost\"], \"queryStrategy\": \"$query_strategy\"},"
      outbound_json="\"protocol\": \"freedom\", \"streamSettings\": {\"sockopt\": {\"domainStrategy\": \"ForceIP\", \"happyEyeballs\": {\"tryDelayMs\": 250, \"prioritizeIPv6\": $PREFER_IPV6, \"interleave\": 1, \"maxConcurrentTry\": 4}}}"
      # domainStrategy 只约束域名解析；显式阻止另一地址族的 IP 字面量目标。
      routing_json="\"routing\": {\"rules\": [{\"type\": \"field\", \"ip\": [\"$blocked_family\"], \"outboundTag\": \"block-other-family\"}]},"
      block_json=', {"tag": "block-other-family", "protocol": "blackhole"}'
      ;;
    ipv4v6 | ipv6v4)
      outbound_json="\"protocol\": \"freedom\", \"streamSettings\": {\"sockopt\": {\"domainStrategy\": \"UseIP\", \"happyEyeballs\": {\"tryDelayMs\": 250, \"prioritizeIPv6\": $PREFER_IPV6, \"interleave\": 1, \"maxConcurrentTry\": 4}}}"
      ;;
  esac
  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    shadowsocks_json=$(cat <<EOF
  ,{
    "tag": "shadowsocks-compatible",
    "listen": "$LISTEN_ADDRESS",
    "port": $SS_PORT,
    "protocol": "shadowsocks",
    "settings": {
      "method": "aes-128-gcm",
      "password": "$SS_PASSWORD",
      "network": "tcp,udp"
    },
    "streamSettings": {"sockopt": {"v6only": false$tcp_fast_open_json}}
  }
EOF
)
  fi

  cat >"$TEMP_CONFIG" <<EOF
{
  "log": {"loglevel": "warning"},
  $dns_json
  "inbounds": [{
    "listen": "$LISTEN_ADDRESS",
    "port": $XRAY_PORT,
    "protocol": "vless",
    "settings": {
      "clients": [{"id": "$UUID", "flow": "xtls-rprx-vision"}],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "raw",
      "security": "reality",
      "realitySettings": {
        "target": "$REALITY_SERVER_NAME:443",
        "serverNames": ["$REALITY_SERVER_NAME"],
        "privateKey": "$PRIVATE_KEY",
        "minClientVer": "1.8.2",
        "shortIds": ["$SHORT_ID"]
      },
      "sockopt": {"v6only": false$tcp_fast_open_json}
    }
  }$shadowsocks_json],
  $routing_json
  "outbounds": [{$outbound_json}$block_json]
}
EOF

  "$XRAY_BIN" run -test -config "$TEMP_CONFIG"
  systemctl stop xray
  install -m 600 -o root -g root "$TEMP_CONFIG" "$XRAY_CONFIG_FILE"
  systemctl enable xray >/dev/null
  if ! systemctl restart xray || ! systemctl is-active --quiet xray; then
    journalctl -u xray --no-pager -n 30 >&2 || true
    die "Xray 服务未能启动"
  fi
}

verify_xray_installation() {
  local attempt

  [[ -x "$XRAY_BIN" ]] || die "安装状态检查失败：未找到可执行文件 $XRAY_BIN"
  [[ -s "$XRAY_CONFIG_FILE" ]] || die "安装状态检查失败：未找到有效配置 $XRAY_CONFIG_FILE"
  "$XRAY_BIN" run -test -config "$XRAY_CONFIG_FILE" >/dev/null ||
    die "安装状态检查失败：Xray 配置校验未通过"
  systemctl is-enabled --quiet xray ||
    die "安装状态检查失败：Xray 服务未设置为开机启动"
  systemctl is-active --quiet xray ||
    die "安装状态检查失败：Xray 服务未运行"

  if command -v ss >/dev/null 2>&1; then
    for attempt in {1..10}; do
      if ss -H -ltn 2>/dev/null |
        awk -v port="$XRAY_PORT" '$4 ~ (":" port "$") {found=1} END {exit !found}'; then
        XRAY_LISTENER_STATUS="TCP ${XRAY_PORT}（已监听）"
        break
      fi
      sleep 0.2
    done
    [[ "$XRAY_LISTENER_STATUS" != "未检查" ]] ||
      die "安装状态检查失败：未发现 TCP $XRAY_PORT 监听端口"
    if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
      for attempt in {1..10}; do
        if ss -H -ltn 2>/dev/null |
          awk -v port="$SS_PORT" '$4 ~ (":" port "$") {found=1} END {exit !found}' &&
          ss -H -lun 2>/dev/null |
          awk -v port="$SS_PORT" '$4 ~ (":" port "$") {found=1} END {exit !found}'; then
          SS_LISTENER_STATUS="TCP/UDP ${SS_PORT}（已监听）"
          break
        fi
        sleep 0.2
      done
      [[ "$SS_LISTENER_STATUS" != "未检查" ]] ||
        die "安装状态检查失败：未发现 Shadowsocks TCP/UDP $SS_PORT 监听端口"
    fi
  else
    XRAY_LISTENER_STATUS="TCP ${XRAY_PORT}（未检查，系统缺少 ss）"
  fi

  REPLACEMENT_PENDING=false
}

write_client_configs() {
  local endpoint=$LOON_SERVER_IP owner entry user_home bundle_temp backup
  [[ "$endpoint" != *:* ]] || endpoint="[$endpoint]"
  # 写入调用者的家目录；sudo 的调用者仍能读取自己的配置副本。
  owner=${SUDO_USER:-$(id -un)}
  entry=$(getent passwd "$owner") || die "无法获取用户 $owner 的家目录"
  IFS=: read -r _ _ _ _ _ user_home _ <<<"$entry"
  [[ "$user_home" == /* && -d "$user_home" ]] || die "用户家目录无效: $user_home"
  CLIENT_BUNDLE_FILE="$user_home/client_config"
  [[ ! -L "$CLIENT_BUNDLE_FILE" ]] || die "$CLIENT_BUNDLE_FILE 是符号链接，拒绝覆盖"
  [[ ! -e "$CLIENT_BUNDLE_FILE" || -f "$CLIENT_BUNDLE_FILE" ]] || die "$CLIENT_BUNDLE_FILE 不是普通文件"
  bundle_temp=$(mktemp "$user_home/.client_config.XXXXXX")
  [[ -z "$TEMP_CONFIG" ]] || rm -f -- "$TEMP_CONFIG"
  TEMP_CONFIG=$bundle_temp

  cat >"$bundle_temp" <<EOF
[loon]
Xray-REALITY = VLESS,$LOON_SERVER_IP,$XRAY_PORT,"$UUID",transport=tcp,flow=xtls-rprx-vision,public-key="$PUBLIC_KEY",short-id=$SHORT_ID,over-tls=true,sni=$REALITY_SERVER_NAME,tls-profile=chrome,udp=true,block-quic=false

[quantumult-x]
vless=$endpoint:$XRAY_PORT, method=none, password=$UUID, obfs=over-tls, obfs-host=$REALITY_SERVER_NAME, reality-base64-pubkey=$PUBLIC_KEY, reality-hex-shortid=$SHORT_ID, vless-flow=xtls-rprx-vision, udp-relay=true, tag=Xray-REALITY
EOF

  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    cat >>"$bundle_temp" <<EOF

[surge]
Xray-SS = ss, $endpoint, $SS_PORT, encrypt-method=aes-128-gcm, password=$SS_PASSWORD, udp-relay=true
EOF
  fi

  # Mihomo 使用 REALITY；新 Xray 的版本门槛已在服务端显式兼容。
  cat >>"$bundle_temp" <<EOF

[mihomo]
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: true
proxies:
  - name: "Xray-REALITY"
    type: vless
    server: "$LOON_SERVER_IP"
    port: $XRAY_PORT
    uuid: "$UUID"
    network: tcp
    tls: true
    udp: true
    flow: xtls-rprx-vision
    servername: "$REALITY_SERVER_NAME"
    client-fingerprint: chrome
    reality-opts:
      public-key: "$PUBLIC_KEY"
      short-id: "$SHORT_ID"
      support-x25519mlkem768: true
proxy-groups:
  - name: "PROXY"
    type: select
    proxies: ["Xray-REALITY", "DIRECT"]
rules:
  - MATCH,PROXY

EOF
  chmod 600 "$bundle_temp"
  chown "$(id -u "$owner"):$(id -g "$owner")" "$bundle_temp"
  if [[ -f "$CLIENT_BUNDLE_FILE" ]]; then
    backup="$CLIENT_BUNDLE_FILE.before-install.$(date +%Y%m%d-%H%M%S).$$"
    cp -p -- "$CLIENT_BUNDLE_FILE" "$backup"
    chmod 600 "$backup"
    chown "$(id -u "$owner"):$(id -g "$owner")" "$backup"
    printf '原 client_config 已备份到: %s\n' "$backup"
  fi
  mv -f -- "$bundle_temp" "$CLIENT_BUNDLE_FILE"
  TEMP_CONFIG=""
}

print_client_configs() {
  local mode_label
  mode_label=$(network_mode_label)
  printf '\nXray 安装状态：\n'
  printf '  程序文件: 已安装（%s）\n' "$XRAY_BIN"
  printf '  服务端配置: 校验通过（%s）\n' "$XRAY_CONFIG_FILE"
  printf '  开机启动: 已启用\n'
  printf '  运行状态: 正在运行\n'
  printf '  REALITY 监听: %s\n' "$XRAY_LISTENER_STATUS"
  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    printf '  Shadowsocks 监听: %s\n' "$SS_LISTENER_STATUS"
  fi
  printf 'REALITY 伪装域名: %s。\n' "$REALITY_SERVER_NAME"
  printf 'Xray 出口 IP 模式: %s。\n' "$mode_label"
  if [[ "$OPTIMIZE_NETWORK" == true ]]; then
    printf 'Xray-REALITY 系统网络优化: 已应用。\n'
  else
    printf 'Xray-REALITY 系统网络优化: 未应用。\n'
  fi
  printf '请自行在系统防火墙和云安全组放行 TCP %s；脚本未配置防火墙。\n' "$XRAY_PORT"
  if [[ "$ENABLE_SHADOWSOCKS" == true ]]; then
    printf '同时放行 Shadowsocks TCP/UDP %s。\n' "$SS_PORT"
  fi
  printf '\n客户端配置已保存到: %s（权限 600）\n\n' "$CLIENT_BUNDLE_FILE"
  cat "$CLIENT_BUNDLE_FILE"
}

main() {
  parse_arguments "$@"
  detect_system
  ensure_root "$@"
  check_environment
  select_network_preferences
  confirm_installation_plan
  install_required_tools
  check_required_tools
  apply_network_optimization
  find_loon_address
  select_xray_port
  select_reality_server_name
  backup_existing_config
  install_xray
  generate_credentials
  write_xray_config
  verify_xray_installation
  # Xray 安装状态已核验，此后即使终端输出失败也不回滚已完成的系统配置。
  NETWORK_OPTIMIZATION_APPLIED=false
  write_client_configs
  print_client_configs
}

main "$@"
