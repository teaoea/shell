#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly XRAY_INSTALL_URL="https://github.com/XTLS/Xray-install/raw/main/install-release.sh"
readonly NETWORK_OPTIMIZER_URL="https://raw.githubusercontent.com/teaoea/shell/refs/heads/main/networt_optimization.sh"
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
OPTIMIZE_NETWORK=""
PREFER_IPV6=false

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
UFW_RULE_ADDED=false
UFW_RULE_RESULT="未配置"
UFW_FIREWALL_STATE="未知"

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

  if ((status != 0)) && [[ "$UFW_RULE_ADDED" == true ]]; then
    if ufw delete allow "${XRAY_PORT}/tcp" >/dev/null 2>&1; then
      printf '已删除本次新增的 UFW TCP %s 放行规则。\n' "$XRAY_PORT" >&2
    else
      printf '警告: 未能删除本次新增的 UFW TCP %s 放行规则，请手动检查。\n' "$XRAY_PORT" >&2
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
用法: bash install_xray.sh [--ipv4|--ipv6]
       [--optimize-network|--no-optimize-network]
       [--reality-domain 域名]
       [--yes] [--port 端口] [--loon-address IP]
  --ipv4              Xray 出站和 Loon 地址自动检测优先 IPv4
  --ipv6              Xray 出站和 Loon 地址自动检测优先 IPv6
  --optimize-network  应用 Xray-REALITY 系统网络优化
  --no-optimize-network
                      不修改系统网络配置
  --reality-domain 域名
                      REALITY 伪装域名，默认 www.apple.com
  --yes               跳过安装确认；须明确指定以上两项选择
  --port 端口         Xray 监听端口及 UFW 放行端口，默认 443
  --loon-address IP   Loon 节点地址，默认自动检测公网 IPv4/IPv6
  -h, --help          显示帮助

必须以 root 身份运行。可设置 XRAY_PORT、LOON_SERVER_IP 和
REALITY_SERVER_NAME（默认 www.apple.com）。
EOF
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      -y | --yes)
        ASSUME_YES=true
        ;;
      --ipv4 | --ipv6)
        [[ -z "$NETWORK_MODE" ]] || die "一次只能选择一种网络优先级"
        NETWORK_MODE=${1#--}
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
      --port | --loon-address)
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
      --loon-address=*)
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
    [[ -n "$NETWORK_MODE" ]] ||
      die "--yes 模式必须同时指定 --ipv4 或 --ipv6"
    [[ -n "$OPTIMIZE_NETWORK" ]] ||
      die "--yes 模式必须同时指定 --optimize-network 或 --no-optimize-network"
  fi
}

check_environment() {
  local command_name

  [[ "$(id -u)" -eq 0 ]] || die "请以 root 身份运行"
  command -v systemctl >/dev/null 2>&1 || die "需要使用 systemd 的 Linux 系统"
  for command_name in curl openssl awk grep install mktemp cp date; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "缺少必需命令: $command_name"
  done

  validate_xray_port

  if [[ -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]] &&
    [[ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" == 0 ]]; then
    LISTEN_ADDRESS="::"
  fi
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
    read -r -p "输入 Xray 监听端口（默认 443，UFW 将放行该 TCP 端口）: " answer
    [[ -z "$answer" ]] || XRAY_PORT=$answer
  fi
  validate_xray_port
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
  local answer default_choice=1

  if [[ -z "$NETWORK_MODE" ]]; then
    [[ -t 0 ]] || die "非交互运行请指定 --ipv4 或 --ipv6"
    while true; do
      printf '请选择 Xray 出站网络优先级：\n'
      printf '  1) IPv4 优先，IPv6 回退\n'
      printf '  2) IPv6 优先，IPv4 回退\n'
      read -r -p "输入 1 或 2（默认 ${default_choice}）: " answer
      case "${answer:-$default_choice}" in
        1) NETWORK_MODE=ipv4; break ;;
        2) NETWORK_MODE=ipv6; break ;;
        *) printf '请输入 1 或 2。\n' >&2 ;;
      esac
    done
  fi

  [[ "$NETWORK_MODE" != ipv6 ]] || PREFER_IPV6=true

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
    ipv4) printf 'IPv4' ;;
    ipv6) printf 'IPv6' ;;
    *) printf '未选择' ;;
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
    if [[ "$NETWORK_MODE" == ipv6 ]]; then
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
  printf '已选择: %s 优先；%s。\n' "$mode_label" "$optimization_text"
  read -r -p "将先处理网络设置，再选择监听端口并配置 UFW，最后询问 REALITY 伪装域名并安装 Xray，继续？(y/N): " answer
  [[ "$answer" =~ ^[Yy]$ ]] || {
    printf '操作已取消。\n'
    exit 0
  }
}

apply_network_optimization() {
  local -a optimizer_arguments=("--$NETWORK_MODE" --xray-reality)
  [[ "$OPTIMIZE_NETWORK" == true ]] || return 0

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

install_ufw() {
  printf '未检测到 UFW，正在安装...\n'
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ufw
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ufw
  elif command -v yum >/dev/null 2>&1; then
    yum install -y ufw
  else
    die "系统未安装 UFW，且没有找到 apt-get、dnf 或 yum，无法自动安装"
  fi
  command -v ufw >/dev/null 2>&1 || die "UFW 安装完成后仍无法执行"
}

ensure_ufw() {
  command -v ufw >/dev/null 2>&1 || install_ufw
}

ufw_rule_exists() {
  local added_rules
  added_rules=$(
    trap - ERR
    LC_ALL=C ufw show added 2>/dev/null || true
  )
  grep -Eq "^ufw allow ${XRAY_PORT}(/tcp)?([[:space:]]|$)" <<<"$added_rules"
}

apply_ufw_rule() {
  local status_output

  if ufw_rule_exists; then
    UFW_RULE_RESULT="TCP ${XRAY_PORT} 放行规则已存在"
  else
    ufw allow "${XRAY_PORT}/tcp"
    UFW_RULE_ADDED=true
    UFW_RULE_RESULT="TCP ${XRAY_PORT} 放行规则已添加"
  fi

  status_output=$(
    trap - ERR
    LC_ALL=C ufw status 2>&1
  ) || die "无法读取 UFW 状态: $status_output"
  if [[ "$status_output" == *"Status: active"* ]]; then
    UFW_FIREWALL_STATE="已启用，规则立即生效"
  else
    UFW_FIREWALL_STATE="未启用，规则已保存；脚本未自动启用 UFW"
  fi
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

  [[ -n "$UUID" && -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" &&
    "$SHORT_ID" =~ ^[0-9a-f]{16}$ ]] ||
    die "无法生成完整的 REALITY 连接凭据"
}

write_xray_config() {
  local tcp_fast_open_json=""
  mkdir -p "$XRAY_CONFIG_DIR"
  TEMP_CONFIG=$(mktemp /tmp/xray-config.XXXXXX.json)
  [[ "$OPTIMIZE_NETWORK" != true ]] || tcp_fast_open_json=', "tcpFastOpen": true'

  cat >"$TEMP_CONFIG" <<EOF
{
  "log": {"loglevel": "warning"},
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
        "shortIds": ["$SHORT_ID"]
      },
      "sockopt": {"v6only": false$tcp_fast_open_json}
    }
  }],
  "outbounds": [{
    "protocol": "freedom",
    "streamSettings": {
      "sockopt": {
        "domainStrategy": "UseIP",
        "happyEyeballs": {
          "tryDelayMs": 250,
          "prioritizeIPv6": $PREFER_IPV6,
          "interleave": 1,
          "maxConcurrentTry": 4
        }
      }
    }
  }]
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
  else
    XRAY_LISTENER_STATUS="TCP ${XRAY_PORT}（未检查，系统缺少 ss）"
  fi

  REPLACEMENT_PENDING=false
}

print_loon_config() {
  local mode_label
  mode_label=$(network_mode_label)
  printf '\nXray 安装状态：\n'
  printf '  程序文件: 已安装（%s）\n' "$XRAY_BIN"
  printf '  服务端配置: 校验通过（%s）\n' "$XRAY_CONFIG_FILE"
  printf '  开机启动: 已启用\n'
  printf '  运行状态: 正在运行\n'
  printf '  监听状态: %s\n' "$XRAY_LISTENER_STATUS"
  printf '  UFW 端口规则: %s\n' "$UFW_RULE_RESULT"
  printf '  UFW 防火墙状态: %s\n' "$UFW_FIREWALL_STATE"
  printf '\nLoon 节点配置（粘贴到 [Proxy] 段）：\n'
  printf 'Xray-REALITY = VLESS,%s,%s,"%s",transport=tcp,flow=xtls-rprx-vision,public-key="%s",short-id=%s,over-tls=true,sni=%s,tls-profile=chrome,udp=true,block-quic=false\n' \
    "$LOON_SERVER_IP" "$XRAY_PORT" "$UUID" "$PUBLIC_KEY" "$SHORT_ID" "$REALITY_SERVER_NAME"
  printf 'REALITY 伪装域名: %s。\n' "$REALITY_SERVER_NAME"
  printf 'Xray 出站网络: %s 优先，另一地址族回退。\n' "$mode_label"
  if [[ "$OPTIMIZE_NETWORK" == true ]]; then
    printf 'Xray-REALITY 系统网络优化: 已应用。\n'
  else
    printf 'Xray-REALITY 系统网络优化: 未应用。\n'
  fi
}

main() {
  parse_arguments "$@"
  check_environment
  select_network_preferences
  confirm_installation_plan
  apply_network_optimization
  find_loon_address
  select_xray_port
  ensure_ufw
  select_reality_server_name
  backup_existing_config
  install_xray
  generate_credentials
  apply_ufw_rule
  write_xray_config
  verify_xray_installation
  # Xray 安装状态已核验，此后即使终端输出失败也不回滚已完成的系统配置。
  NETWORK_OPTIMIZATION_APPLIED=false
  UFW_RULE_ADDED=false
  print_loon_config
}

main "$@"
