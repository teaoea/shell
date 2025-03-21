#!/bin/bash

# 安全提示
function confirm_action {
  echo -e "注意: 此脚本将修改系统配置并安装多个服务，可能带来潜在的安全风险！"
  read -p "是否继续执行？ (y/N): " CONFIRM
  CONFIRM=${CONFIRM:-N}  # 如果用户未输入内容，则默认为 "N"
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

# uuid生成
UUID=$(cat /proc/sys/kernel/random/uuid)

# 配置 Xray
function setup_xray {
  read -p "请输入域名（默认: bing.com): " DOMAIN
  DOMAIN=${DOMAIN:-"bing.com"}
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
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install-geodata

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
          "serverNames": [""],
          "alpn": [ "h2", "http/1.1" ],
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
        "destOverride": [ "http", "tls", "quic" ],
        "routeOnly": true
      }
    }
  ],
  "outbounds": [
    {
      "tag": "direct",
      "protocol": "freedom"
    }
  ]
}
EOF

  # 启动 Xray 服务
  systemctl enable xray
  systemctl restart xray
}

# 防火墙配置
function configure_firewall {
  echo "配置防火墙规则..."
  ufw allow 22
  ufw allow 80
  ufw allow 443
  ufw enable -y
}

# 获取公网 IP 地址
function get_public_ip {
  IPV4=$(curl 4.ipw.cn)
  IPV6=$(curl 6.ipw.cn)

  # 设置全局变量，供后续展示
  PUBLIC_IPV4=${IPV4:-"未检测到"}
  PUBLIC_IPV6=${IPV6:-"未检测到"}
}

# 主函数
function main {
  confirm_action
  check_root
  get_os
  install_dependencies
  get_public_ip
  setup_xray
  configure_firewall

  echo -e "\n配置完成！"
  echo "Xray使用的UUID: ${UUID}"
  echo -e "公网 IPv4 地址: $PUBLIC_IPV4"
  echo -e "公网 IPv6 地址: $PUBLIC_IPV6"
  echo "Xray配置文件路径: /usr/local/etc/xray/config.json"
}

# 执行主函数
main "$@"
