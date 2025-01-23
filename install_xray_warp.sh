#!/bin/bash

# 安全提示
function confirm_action {
  echo -e "注意: 此脚本将修改系统配置并安装多个服务，可能带来潜在的安全风险！"
  read -p "是否继续执行？ (y/n): " CONFIRM
  if [[ "$CONFIRM" != "y" ]]; then
    echo "操作已取消。"
    exit 0
  fi
}

# 权限检查
function check_root {
  if [ "$(id -u)" -ne 0 ]; then
    echo -e "请以 root 用户运行此脚本！"
    exit 1
  fi
}

# 检测系统包管理器
function get_os {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME=$ID
  else
    OS_NAME=$(uname -s)
  fi
}

# 安装必要工具
function install_dependencies {
  case $OS_NAME in
  ubuntu | debian)
    apt update && apt install curl wget unzip openssl gnupg -y
    ;;
  centos | rhel | fedora)
    yum update && yum install curl wget unzip openssl epel-release -y
    ;;
  esac
}

# 安装 Cloudflare WARP
function install_warp {
  case $OS_NAME in
  ubuntu)
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
    apt update && apt install cloudflare-warp -y
    ;;
  debian)
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
    apt update && apt install cloudflare-warp -y
    ;;
  centos | rhel | fedora)
    curl -fsSl https://pkg.cloudflareclient.com/cloudflare-warp-ascii.repo | sudo tee /etc/yum.repos.d/cloudflare-warp.repo
    yum update && yum install cloudflare-warp -y
    ;;
  esac
}

# 配置 Cloudflare WARP
function setup_warp {
  warp-cli mode proxy
  warp-cli proxy port 2333
  warp-cli registration new
  warp-cli connect
  systemctl enable warp-svc
}

# uuid生成
UUID=$(cat /proc/sys/kernel/random/uuid)

# 配置 Xray
function setup_xray {
  DOMAIN=${1:-"example.com"}
  DAYS_VALID=365

  # 创建证书目录
  mkdir -p /usr/local/etc/xray

  # 使用 openssl 生成 PEM 和 KEY 文件
  openssl req -x509 -nodes -days $DAYS_VALID -newkey rsa:2048 \
    -keyout /usr/local/etc/xray/${DOMAIN}.key \
    -out /usr/local/etc/xray/${DOMAIN}.pem \
    -subj "/CN=${DOMAIN}"

  chmod 644 /usr/local/etc/xray/${DOMAIN}.pem
  chmod 644 /usr/local/etc/xray/${DOMAIN}.key
  chown root:root /usr/local/etc/xray/${DOMAIN}.pem
  chown root:root /usr/local/etc/xray/${DOMAIN}.key

  # 安装 Xray
  curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh | bash

  # 创建 Xray 配置文件
  cat >/usr/local/etc/xray/config.json <<EOF
{
  "inbounds": [
    { 
      "tag": "direct",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "${UUID}"
          }
        ],
        "decryption": "none",
        "fallbacks": []
      },
      "streamSettings": {
        "network": "tcp",
        "security": "tls",
        "tlsSettings": {
          "serverNames": [
            ""
          ],
          "alpn": [
            "h2",
            "http/1.1"
          ],
          "certificates": [
            {
              "certificateFile": "/usr/local/etc/xray/${DOMAIN}.pem",
              "keyFile": "/usr/local/etc/xray/${DOMAIN}.key"
            }
          ]
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
      "protocol": "freedom"
    },
    {
      "tag": "warp",
      "protocol": "socks",
      "settings": {
        "servers": [
          {
            "address": "127.0.0.1",
            "port": 2333
          }
        ]
      }
    }
  ],
  "routing": {
    "rules": [
      {
        "type": "field",
        "outboundTag": "warp",
        "domain": [
          "domain:openai.com",
          "domain:chatgpt.com",
          "domain:ai.com",
          "domain:chat.com",
          "domain:youtube.com",
          "domain:netflix.com"
        ]
      }
    ]
  }
}
EOF

  # 启动 Xray 服务
  systemctl enable xray
  systemctl restart xray
}

# 开启bbr
function enable_bbr{
  sysctl_config=$(/etc/sysctl.conf)
  if ! grep -q "net.core.default_qdisc=fq" $sysctl_config; then
    echo "net.core.default_qdisc=fq" >> $sysctl_config
  fi
  if ! grep -q "net.ipv4.tcp_congestion_control=bbr" $sysctl_config; then
    echo "net.ipv4.tcp_congestion_control=bbr" >> $sysctl_config
  fi
}

# 获取公网ipv4
function get_ipv4{
   ipv4=$(curl -4 -s https://ipv4.icanhazip.com)
}

# 获取公网ipv6
function get_ipv6{
   ipv6=$(curl -6 -s https://ipv6.icanhazip.com)
}

# 主函数
function main {
  confirm_action
  check_root
  get_os
  install_dependencies
  install_warp
  setup_warp
  setup_xray
  enable_bbr
  IPv4=$(get_ipv4)
  IPv6=$(get_ipv6)

  echo "Xray 配置完成, UUID: ${UUID}"
  echo "公网 IPv4: ${IPv4}"
  echo "公网 IPv6: ${IPv6}" 
  echo "Xray 配置文件路径: /usr/local/etc/xray/config.json"
}

# 执行主函数
main "$@"
