#!/usr/bin/env bash

set -Eeuo pipefail

readonly XRAY_INSTALL_URL="https://github.com/XTLS/Xray-install/raw/main/install-release.sh"
readonly XRAY_BIN="/usr/local/bin/xray"
readonly XRAY_CONFIG_DIR="/usr/local/etc/xray"
readonly XRAY_CONFIG_FILE="${XRAY_CONFIG_DIR}/config.json"
readonly CLIENT_INFO_FILE="/root/xray-reality-client.txt"
readonly NETWORK_SYSCTL_FILE="/etc/sysctl.d/99-xray-network.conf"

OS_NAME=""
UUID=""
PRIVATE_KEY=""
PUBLIC_KEY=""
SHORT_ID=""
REALITY_SERVER_NAME="${REALITY_SERVER_NAME:-www.microsoft.com}"
readonly XRAY_PORT=443
readonly XRAY_LISTEN_ADDRESS="::"
SSH_PORTS=""
ASSUME_YES=false
PUBLIC_IPV4="未检测到"
PUBLIC_IPV6="未检测到"
BBR_STATUS="未启用"
IPV6_STATUS="待检测"
TEMP_INSTALL_SCRIPT=""
TEMP_CONFIG_FILE=""
TEMP_SYSCTL_FILE=""

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
}

trap cleanup EXIT

# 命令行参数
function parse_arguments {
  while (($# > 0)); do
    case "$1" in
    -y | --yes)
      ASSUME_YES=true
      ;;
    -h | --help)
      echo "用法: $0 [--yes]"
      echo "  -y, --yes    跳过确认，执行无人值守安装"
      echo "  -h, --help   显示帮助"
      echo "固定配置: 双栈监听 [::]:443，自动生成全部连接凭据"
      echo "环境变量: REALITY_SERVER_NAME（默认: www.microsoft.com）"
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

# 安全提示
function confirm_action {
  if [[ "${ASSUME_YES}" == true ]]; then
    return
  fi

  echo -e "注意: 此脚本将安装 Xray、应用网络优化、写入服务端配置并修改防火墙规则。"
  read -r -p "是否继续执行？ (y/N): " CONFIRM
  CONFIRM=${CONFIRM:-N}
  if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
    echo "操作已取消。"
    exit 0
  fi
}

# 配置保守的 Linux 网络优化，并启用 IPv6 协议栈
function optimize_network {
  local available_congestion backup_file=""

  echo "正在配置服务器网络优化..."
  TEMP_SYSCTL_FILE=$(mktemp /tmp/xray-network.XXXXXX.conf)

  # BBR 需要 tcp_bbr，FQ 是其推荐的队列调度器。
  if command -v modprobe >/dev/null 2>&1; then
    modprobe tcp_bbr 2>/dev/null || true
    modprobe sch_fq 2>/dev/null || true
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
    backup_file="${NETWORK_SYSCTL_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -a "${NETWORK_SYSCTL_FILE}" "${backup_file}"
    echo "已备份原网络配置到: ${backup_file}"
  fi

  install -m 644 -o root -g root "${TEMP_SYSCTL_FILE}" "${NETWORK_SYSCTL_FILE}"
  rm -f -- "${TEMP_SYSCTL_FILE}"
  TEMP_SYSCTL_FILE=""

  if ! sysctl -p "${NETWORK_SYSCTL_FILE}" >/dev/null; then
    echo "警告: 当前虚拟化环境不允许完整应用网络优化，将恢复原 sysctl 配置并继续安装。" >&2
    if [[ -n "${backup_file}" && -f "${backup_file}" ]]; then
      cp -a "${backup_file}" "${NETWORK_SYSCTL_FILE}"
      sysctl -p "${NETWORK_SYSCTL_FILE}" >/dev/null 2>&1 || true
      echo "已自动恢复原网络配置: ${backup_file}" >&2
    else
      rm -f -- "${NETWORK_SYSCTL_FILE}"
    fi
  fi

  if [[ "$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || true)" == "bbr" ]]; then
    BBR_STATUS="已启用"
  else
    BBR_STATUS="未启用"
  fi

  if [[ "$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null || true)" == "0" ]]; then
    IPV6_STATUS="已启用，入站双栈监听、出站 IPv6 优先"
  else
    IPV6_STATUS="不可用"
  fi
}

# 双栈监听依赖可用的 IPv6 协议栈；不能满足时拒绝生成不可靠配置
function require_ipv6_dual_stack {
  if [[ ! -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]] || \
    [[ "$(sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null || true)" != "0" ]]; then
    echo "错误: 当前内核或虚拟化环境未启用 IPv6，无法同时监听 IPv4 和 IPv6。" >&2
    echo "请先为服务器启用 IPv6，或确认宿主机允许修改 IPv6 sysctl。" >&2
    exit 1
  fi
}

# 权限及运行环境检查
function check_environment {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "错误: 请以 root 用户运行此脚本！" >&2
    exit 1
  fi

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
  case "${OS_NAME}" in
  ubuntu | debian)
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates openssl procps kmod iproute2
    ;;
  centos | rhel | fedora | rocky | almalinux | ol)
    if command -v dnf >/dev/null 2>&1; then
      dnf install -y curl ca-certificates openssl procps-ng kmod iproute
    else
      yum install -y curl ca-certificates openssl procps-ng kmod iproute
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

  echo "安装参数: [${XRAY_LISTEN_ADDRESS}]:${XRAY_PORT}（IPv4/IPv6 双栈），REALITY 伪装域名: ${REALITY_SERVER_NAME}"
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
    done < <(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}')
  fi

  if [[ -z "${SSH_PORTS}" ]]; then
    SSH_PORTS="22"
  fi

  echo "检测到 SSH 端口: ${SSH_PORTS}"
}

# 在固定使用 443 前检查是否被非 Xray 进程占用
function check_xray_port {
  local listeners non_xray_listeners

  listeners=$(ss -H -ltnp "sport = :${XRAY_PORT}" 2>/dev/null || true)
  non_xray_listeners=$(printf '%s\n' "${listeners}" | awk 'index($0, "\"xray\"") == 0')
  if [[ -n "${non_xray_listeners}" ]]; then
    echo "错误: TCP ${XRAY_PORT} 已被其他进程占用，无法监听 [${XRAY_LISTEN_ADDRESS}]:${XRAY_PORT}。" >&2
    echo "当前监听信息: ${non_xray_listeners}" >&2
    exit 1
  fi
}

# 安装 Xray
function install_xray {
  echo "正在安装 Xray..."
  TEMP_INSTALL_SCRIPT=$(mktemp /tmp/xray-install.XXXXXX.sh)
  curl -fsSL "${XRAY_INSTALL_URL}" -o "${TEMP_INSTALL_SCRIPT}"
  bash "${TEMP_INSTALL_SCRIPT}" install

  if [[ ! -x "${XRAY_BIN}" ]]; then
    echo "错误: Xray 安装失败，未找到 ${XRAY_BIN}。" >&2
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
  local backup_file service_user service_group

  mkdir -p "${XRAY_CONFIG_DIR}"
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
        "clients": [
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
          "tcpFastOpen": true,
          "tcpKeepAliveIdle": 600,
          "tcpKeepAliveInterval": 30
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
            "prioritizeIPv6": true,
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

  # 官方安装服务默认以 nobody 运行；沿用实际服务用户的主组来限制配置读取权限。
  service_user=$(systemctl show xray --property=User --value 2>/dev/null || true)
  service_user=${service_user:-root}
  service_group=$(id -gn "${service_user}" 2>/dev/null || printf 'root')

  if [[ -f "${XRAY_CONFIG_FILE}" ]]; then
    backup_file="${XRAY_CONFIG_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -a "${XRAY_CONFIG_FILE}" "${backup_file}"
    echo "已备份原配置到: ${backup_file}"
  fi

  install -m 640 -o root -g "${service_group}" "${TEMP_CONFIG_FILE}" "${XRAY_CONFIG_FILE}"
  rm -f -- "${TEMP_CONFIG_FILE}"
  TEMP_CONFIG_FILE=""

  systemctl enable xray >/dev/null
  if ! systemctl restart xray; then
    echo "错误: Xray 启动失败，最近的服务日志如下：" >&2
    journalctl -u xray --no-pager -n 30 >&2 || true
    if [[ -n "${backup_file:-}" && -f "${backup_file}" ]]; then
      cp -a "${backup_file}" "${XRAY_CONFIG_FILE}"
      systemctl restart xray >/dev/null 2>&1 || true
      echo "已自动恢复原配置: ${backup_file}" >&2
    fi
    exit 1
  fi

  if ! systemctl is-active --quiet xray; then
    echo "错误: Xray 服务未处于运行状态。" >&2
    journalctl -u xray --no-pager -n 30 >&2 || true
    if [[ -n "${backup_file:-}" && -f "${backup_file}" ]]; then
      cp -a "${backup_file}" "${XRAY_CONFIG_FILE}"
      systemctl restart xray >/dev/null 2>&1 || true
      echo "已自动恢复原配置: ${backup_file}" >&2
    fi
    exit 1
  fi
}

# 防火墙配置：放行 SSH 和 Xray 端口，不擅自启用当前未启用的防火墙
function configure_firewall {
  local ssh_port ufw_backup

  echo "正在配置防火墙规则..."

  if command -v ufw >/dev/null 2>&1; then
    if [[ -f /etc/default/ufw ]] && ! grep -Eqi '^IPV6=yes$' /etc/default/ufw; then
      ufw_backup="/etc/default/ufw.bak.$(date +%Y%m%d-%H%M%S)"
      cp -a /etc/default/ufw "${ufw_backup}"
      if grep -Eq '^IPV6=' /etc/default/ufw; then
        sed -i -E 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
      else
        echo 'IPV6=yes' >>/etc/default/ufw
      fi
      echo "已启用 UFW IPv6 支持，原配置备份到: ${ufw_backup}"
    fi

    for ssh_port in ${SSH_PORTS}; do
      ufw allow "${ssh_port}/tcp"
    done
    ufw allow "${XRAY_PORT}/tcp"
    if ! ufw status | grep -q '^Status: active'; then
      echo "提示: UFW 当前未启用，规则已添加但尚未生效。"
    else
      ufw reload
    fi
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    for ssh_port in ${SSH_PORTS}; do
      firewall-cmd --permanent --add-port="${ssh_port}/tcp"
    done
    firewall-cmd --permanent --add-port="${XRAY_PORT}/tcp"
    firewall-cmd --reload
  else
    echo "提示: 未检测到已启用的 UFW/firewalld。"
    echo "请在云安全组或其他防火墙中放行 SSH TCP 端口 ${SSH_PORTS} 和 Xray TCP 端口 ${XRAY_PORT}。"
  fi
}

# 获取公网 IP 地址
function get_public_ip {
  local ipv4 ipv6

  ipv4=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || \
    curl -4 -fsS --max-time 8 https://4.ipw.cn 2>/dev/null || true)
  ipv6=$(curl -6 -fsS --max-time 8 https://api64.ipify.org 2>/dev/null || \
    curl -6 -fsS --max-time 8 https://6.ipw.cn 2>/dev/null || true)

  if [[ -n "${ipv4}" ]]; then
    PUBLIC_IPV4=${ipv4}
  fi
  if [[ -n "${ipv6}" ]]; then
    PUBLIC_IPV6=${ipv6}
  fi
}

# 生成客户端连接信息
function write_client_info {
  local server_address share_link share_link_ipv4 share_link_ipv6 link_parameters

  link_parameters="encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER_NAME}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_ID}&type=tcp#Xray-REALITY"
  share_link_ipv4="未检测到公网 IPv4"
  share_link_ipv6="未检测到公网 IPv6"

  if [[ "${PUBLIC_IPV4}" != "未检测到" ]]; then
    share_link_ipv4="vless://${UUID}@${PUBLIC_IPV4}:${XRAY_PORT}?${link_parameters}"
  fi
  if [[ "${PUBLIC_IPV6}" != "未检测到" ]]; then
    share_link_ipv6="vless://${UUID}@[${PUBLIC_IPV6}]:${XRAY_PORT}?${link_parameters}"
  fi

  if [[ "${PUBLIC_IPV6}" != "未检测到" ]]; then
    server_address=${PUBLIC_IPV6}
    share_link=${share_link_ipv6}
  elif [[ "${PUBLIC_IPV4}" != "未检测到" ]]; then
    server_address=${PUBLIC_IPV4}
    share_link=${share_link_ipv4}
  else
    server_address="<服务器IP>"
    share_link="vless://${UUID}@<服务器IP>:${XRAY_PORT}?${link_parameters}"
  fi

  cat >"${CLIENT_INFO_FILE}" <<EOF
VLESS + REALITY + XTLS Vision 客户端参数
==========================================
服务器地址: ${server_address}
端口: ${XRAY_PORT}
UUID: ${UUID}
Flow: xtls-rprx-vision
传输方式: TCP/RAW
传输安全: reality
SNI/ServerName: ${REALITY_SERVER_NAME}
Fingerprint: chrome
Password/Public Key: ${PUBLIC_KEY}
Short ID: ${SHORT_ID}
SpiderX: /

主分享链接（IPv6 优先）:
${share_link}

IPv6 分享链接:
${share_link_ipv6}

IPv4 备用分享链接:
${share_link_ipv4}

Xray 客户端出站示例:
{
  "protocol": "vless",
  "settings": {
    "address": "${server_address}",
    "port": ${XRAY_PORT},
    "id": "${UUID}",
    "encryption": "none",
    "flow": "xtls-rprx-vision"
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
EOF

  chmod 600 "${CLIENT_INFO_FILE}"

  echo -e "\n配置完成！"
  echo "Xray 服务状态: 运行中"
  echo "公网 IPv4 地址: ${PUBLIC_IPV4}"
  echo "公网 IPv6 地址: ${PUBLIC_IPV6}"
  echo "SSH 放行端口: ${SSH_PORTS}"
  echo "BBR 状态: ${BBR_STATUS}"
  echo "IPv6 状态: ${IPV6_STATUS}"
  echo "Xray 配置文件: ${XRAY_CONFIG_FILE}"
  echo "客户端信息文件: ${CLIENT_INFO_FILE}"
  echo -e "\n主分享链接（IPv6 优先）："
  echo "${share_link}"
  echo "IPv4 备用链接: ${share_link_ipv4}"
}

# 主函数
function main {
  parse_arguments "$@"
  confirm_action
  check_environment
  get_os
  install_dependencies
  prepare_configuration
  detect_ssh_ports
  check_xray_port
  install_xray
  generate_credentials
  optimize_network
  require_ipv6_dual_stack
  setup_xray
  configure_firewall
  get_public_ip
  write_client_info
}

main "$@"
