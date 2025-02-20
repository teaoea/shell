# /bin/bash

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

# password生成
PASSWORD = $(< /dev/urandom tr -dc 'A-Za-z0-9' | head -c 16)

# 配置hysteria2
function setup_hysteria2 {
  bash <(curl -fsSL https://get.hy2.sh/)
  rm -f /etc/hysteria/config.yml

  DOMAIN=${1:-"bing.com"}
  DAYS_VALID=365
  openssl req -x509 -nodes -days $DAYS_VALID -newkey rsa:2048 \
    -keyout /usr/local/etc/xray/${DOMAIN}.key \
    -out /usr/local/etc/xray/${DOMAIN}.pem \
    -subj "/CN=${DOMAIN}"

  chmod 644 /etc/hysteria/${DOMAIN}.pem
  chmod 644 /etc/hysteria/${DOMAIN}.key
  chown root:root /etc/hysteria/${DOMAIN}.pem
  chown root:root /etc/hysteria/${DOMAIN}.key

  touch /etc/hysteria/config.yml
  cat > /etc/hysteria/config.yml << EOF
# :443同时监听ipv4和ipv6
# 仅监听 IPv4，使用0.0.0.0:443
# 仅监听 IPv6，使用 [::]:443
listen: :443
tls:
  cert: "/etc/hysteria/bing.com.pem"
  key: "/etc/hysteria/bing.com.key"
  #sniGuard: disable
# 认证
auth:
  type: password
  password: ${PASSWORD}
# 出站设置
outbounds:
  - name: default # 默认出站规则
    type: direct
    direct:
      mode: 64 # ipv6优先
  - name: warp
    type: socks5
    socks5:
      addr: localhost:2333
# ACL配置
acl:
  inline:
    - warp(suffix:openai.com)
    - warp(suffix:chatgpt.com)
    - warp(suffix:ai.com)
    - warp(suffix:deepseek.com)
    - direct(all)
# 伪装设置
masquerade:
  type: proxy
  proxy:
    url: https://bing.com/
    rewriteHost: true
    insecure: false
  listenHTTP: :80
  listenHTTPS: :443
  forceHTTPS: true
EOF
systemctl enable hysteria-server.service
sudo hysteria server check -c /etc/hysteria/config.yaml
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
  install_warp
  setup_warp
  setup_hysteria2
  ufw allow 22
  ufw allow 80
  ufw allow 443
  ufw allow 2333
  ufw enable

  echo -e "\n配置完成！"
  echo "hysteria2设置的密码: ${PASSWORD}"
  echo -e "公网 IPv4 地址: $PUBLIC_IPV4"
  echo -e "公网 IPv6 地址: $PUBLIC_IPV6"
  echo "hysteria2配置文件路径: /etc/hysteria/config.yml"
}

# 执行主函数
main "$@"