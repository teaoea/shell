#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

readonly XRAY_INSTALL_URL="https://github.com/XTLS/Xray-install/raw/main/install-release.sh"
readonly XRAY_BIN="/usr/local/bin/xray"
readonly XRAY_CONFIG_DIR="/usr/local/etc/xray"
readonly XRAY_CONFIG_FILE="$XRAY_CONFIG_DIR/config.json"

XRAY_PORT="${XRAY_PORT:-443}"
REALITY_SERVER_NAME="${REALITY_SERVER_NAME:-apple.com}"
LOON_SERVER_IP="${LOON_SERVER_IP:-}"
ASSUME_YES=false
LISTEN_ADDRESS="0.0.0.0"

UUID=""
PRIVATE_KEY=""
PUBLIC_KEY=""
SHORT_ID=""
TEMP_INSTALLER=""
TEMP_CONFIG=""
CONFIG_BACKUP=""
REPLACEMENT_PENDING=false
PREVIOUSLY_ACTIVE=false

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

  [[ -z "$TEMP_INSTALLER" ]] || rm -f -- "$TEMP_INSTALLER"
  [[ -z "$TEMP_CONFIG" ]] || rm -f -- "$TEMP_CONFIG"
  return "$status"
}

trap cleanup EXIT
trap 'on_error $? $LINENO' ERR

usage() {
  cat <<'EOF'
用法: bash install_xray.sh [--yes] [--port 端口] [--loon-address IP]
  --yes               跳过安装确认
  --port 端口         Xray 监听端口，默认 443
  --loon-address IP   Loon 节点地址，默认自动检测公网 IPv4/IPv6
  -h, --help          显示帮助

必须以 root 身份运行。可设置 XRAY_PORT、LOON_SERVER_IP 和
REALITY_SERVER_NAME（默认 apple.com）。
EOF
}

parse_arguments() {
  while (($# > 0)); do
    case "$1" in
      -y | --yes)
        ASSUME_YES=true
        ;;
      --port | --loon-address)
        (($# >= 2)) || die "$1 缺少参数"
        if [[ "$1" == --port ]]; then
          XRAY_PORT=$2
        else
          LOON_SERVER_IP=$2
        fi
        shift
        ;;
      --port=*)
        XRAY_PORT=${1#*=}
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
}

check_environment() {
  local command_name

  [[ "$(id -u)" -eq 0 ]] || die "请以 root 身份运行"
  command -v systemctl >/dev/null 2>&1 || die "需要使用 systemd 的 Linux 系统"
  for command_name in curl openssl awk install mktemp cp date; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "缺少必需命令: $command_name"
  done

  [[ "$XRAY_PORT" =~ ^[0-9]{1,5}$ ]] ||
    die "端口必须是 1-65535 的整数"
  ((10#$XRAY_PORT >= 1 && 10#$XRAY_PORT <= 65535)) ||
    die "端口必须是 1-65535 的整数"
  XRAY_PORT=$((10#$XRAY_PORT))

  [[ "$REALITY_SERVER_NAME" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] ||
    die "REALITY_SERVER_NAME 必须是有效域名"

  if [[ -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]] &&
    [[ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" == 0 ]]; then
    LISTEN_ADDRESS="::"
  fi
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
    LOON_SERVER_IP=$(
      curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null ||
        curl -4 -fsS --max-time 8 https://4.ipw.cn 2>/dev/null ||
        curl -6 -fsS --max-time 8 https://api64.ipify.org 2>/dev/null
    ) || die "无法检测公网 IP；请用 --loon-address 指定"
  fi
  validate_loon_address "$LOON_SERVER_IP"
}

confirm_installation() {
  local answer
  [[ "$ASSUME_YES" == true ]] && return
  [[ -t 0 ]] || die "非交互运行请添加 --yes"
  read -r -p "将安装 Xray 并替换其服务端配置，继续？(y/N): " answer
  [[ "$answer" =~ ^[Yy]$ ]] || {
    printf '操作已取消。\n'
    exit 0
  }
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
  mkdir -p "$XRAY_CONFIG_DIR"
  TEMP_CONFIG=$(mktemp /tmp/xray-config.XXXXXX.json)

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
      "sockopt": {"v6only": false}
    }
  }],
  "outbounds": [{"protocol": "freedom"}]
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
  REPLACEMENT_PENDING=false
}

print_loon_config() {
  printf '\nXray 已安装并运行。Loon 节点配置（粘贴到 [Proxy] 段）：\n'
  printf 'Xray-REALITY = VLESS,%s,%s,"%s",transport=tcp,flow=xtls-rprx-vision,public-key="%s",short-id=%s,over-tls=true,sni=%s,tls-profile=chrome,udp=true,block-quic=false\n' \
    "$LOON_SERVER_IP" "$XRAY_PORT" "$UUID" "$PUBLIC_KEY" "$SHORT_ID" "$REALITY_SERVER_NAME"
}

main() {
  parse_arguments "$@"
  check_environment
  find_loon_address
  confirm_installation
  backup_existing_config
  install_xray
  generate_credentials
  write_xray_config
  print_loon_config
}

main "$@"
