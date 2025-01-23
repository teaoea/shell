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

# 获取公网 IP 地址
function get_public_ip {
  echo "正在检测公网 IP 地址..."
  IPV4=$(curl -4 -s https://ifconfig.co)
  IPV6=$(curl -6 -s https://ifconfig.co)

  # 设置全局变量，供后续展示
  PUBLIC_IPV4=${IPV4:-"未检测到"}
  PUBLIC_IPV6=${IPV6:-"未检测到"}

  echo "Public IPv4: $PUBLIC_IPV4"
  echo "Public IPv6: $PUBLIC_IPV6"
}

# 启用 BBR 加速
function enable_bbr {
  echo "正在启用 BBR 加速..."
  # 检查内核版本是否支持 BBR
  kernel_version=$(uname -r)
  if [[ "$kernel_version" < "4.9" ]]; then
    echo "当前内核版本过低，不支持 BBR，请升级内核到 4.9 或更高版本。"
    exit 1
  fi

  # 启用BBR加速
function enable_bbr {
  echo "正在启用 BBR 加速..."
  # 检查内核版本是否支持 BBR
  kernel_version=$(uname -r)
  if [[ "$kernel_version" < "4.9" ]]; then
    echo "当前内核版本过低，不支持 BBR，请升级内核到 4.9 或更高版本。"
    exit 1
  fi

  # 启用 BBR
  modprobe tcp_bbr
  echo "tcp_bbr" >> /etc/modules-load.d/modules.conf

  # 配置 sysctl 参数
  cat <<EOF > /etc/sysctl.d/99-bbr.conf
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF

  # 应用 sysctl 配置
  sysctl --system

  # 验证 BBR 是否启用
  if sysctl net.ipv4.tcp_available_congestion_control | grep -q bbr && sysctl net.ipv4.tcp_congestion_control | grep -q bbr; then
    echo "BBR 已成功启用并将在重启后保持生效！"
  else
    echo "BBR 启用失败，请检查配置。"
  fi
}

# 主函数
function main {
  confirm_action
  check_root
  get_os
  install_dependencies
  get_public_ip
  install_warp
  setup_warp
  setup_xray
  enable_bbr
  ufw allow 22
  ufw allow 80
  ufw allow 443
  ufw allow 2333
  ufw enable

  echo -e "\n配置完成！"
  echo "Xray使用的UUID: ${UUID}"
  echo -e "公网 IPv4 地址: $PUBLIC_IPV4"
  echo -e "公网 IPv6 地址: $PUBLIC_IPV6"
  echo "Xray配置文件路径: /usr/local/etc/xray/config.json"
}

# 执行主函数
main "$@"
