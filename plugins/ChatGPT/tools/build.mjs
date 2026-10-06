import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const domains = JSON.parse(readFileSync(root + 'domains.json', 'utf8'));
const base = 'https://raw.githubusercontent.com/teaoea/shell/main/plugins/ChatGPT/';
const script = base + 'ChatGPTLogger.js';
const author = '可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol';
const icon = base + 'assets/chatgpt.jpg';
const core = String.raw`^https://(?:[a-z0-9-]+\.)*(?:chatgpt\.com|openai\.com|oaistatic\.com|oaiusercontent\.com|oaistatsig\.com|openaimerge\.com)(?::443)?/`;
const local = String.raw`^http://chatgpt-logs\.invalid(?::80)?(?:/|$)`;
const rules = policy => domains.suffix.map(d => `DOMAIN-SUFFIX,${d},${policy}`).concat(domains.exact.map(d => `DOMAIN,${d},${policy}`));
function write(name, text) { writeFileSync(root + name, text.trim() + '\n'); }
write('ChatGPT.plugin', `#!name = ChatGPT 网络选择与本地日志
#!author = ${author}
#!icon = ${icon}
# 作者：${author}
#!desc = 网络模式由下方 PROXY 策略入口手动选择 DIRECT 或已有代理；日志工具默认关闭，本地页面支持查看与导出。默认不解密 ChatGPT，避免原生 App 证书错误；HTTPS 自定义日志仅适用于手动开启解密的浏览器调试。
#!homepage = https://github.com/teaoea/shell/blob/main/plugins/ChatGPT/README.md
[Argument]
log_enabled = switch,false,tag=日志工具,desc=开启后允许元数据采样；首次开启后在本地日志页点击开启日志，关闭后停止采样但仍可导出；默认不解密，原生 App 请使用 Loon 连接记录
[Rule]
${rules('PROXY').join('\n')}
DOMAIN,chatgpt-logs.invalid,DIRECT
[Script]
http-request ${local} script-path=${script},argument=[{log_enabled}],requires-body=false,timeout=10,tag=ChatGPT 日志页面
http-request ${core} script-path=${script},argument=[{log_enabled}],enable={log_enabled},requires-body=false,timeout=10,tag=ChatGPT 请求日志
http-response ${core} script-path=${script},argument=[{log_enabled}],enable={log_enabled},requires-body=false,timeout=10,tag=ChatGPT 响应日志`);
write('ChatGPT.surge.conf', `# ChatGPT 网络选择与本地日志：合并到主配置对应段，不是独立配置或模块。
# 作者：${author}
# 图标：${icon}
# 将 YOUR_PROXY 替换为已有代理节点或策略组；业务规则放在冲突规则与 FINAL 之前。
# 日志默认暂停，访问 http://chatgpt-logs.invalid/ 管理。默认不解密 ChatGPT；原生 App 使用软件连接记录。
[Proxy Group]
ChatGPT = select, DIRECT, YOUR_PROXY
[Rule]
${rules('ChatGPT').join('\n')}
DOMAIN,chatgpt-logs.invalid,DIRECT
[Script]
ChatGPT日志页面 = type=http-request,pattern=${local},requires-body=false,timeout=10,script-path=${script}
ChatGPT请求日志 = type=http-request,pattern=${core},requires-body=false,timeout=10,script-path=${script}
ChatGPT响应日志 = type=http-response,pattern=${core},requires-body=false,timeout=10,script-path=${script}`);
write('ChatGPT.quantumult.conf', `# ChatGPT 网络选择与本地日志：合并对应段，不替换整个主配置。
# 作者：${author}
# 图标：${icon}
# proxy 为圈 X 内置代理策略，也可换成已有节点或策略组。
# 日志默认暂停，访问 http://chatgpt-logs.invalid/ 管理。默认不解密 ChatGPT；原生 App 使用软件连接记录。
[policy]
static = ChatGPT, direct, proxy, img-url=${icon}
[filter_local]
${domains.suffix.map(d => `host-suffix,${d},ChatGPT`).concat(domains.exact.map(d => `host,${d},ChatGPT`)).join('\n')}
host,chatgpt-logs.invalid,direct
[rewrite_local]
${local} url script-echo-response ${script}
${core} url script-request-header ${script}
${core} url script-response-header ${script}`);
write('ChatGPT.stoverride', `name: ChatGPT 网络选择与本地日志
author: ${author}
icon: ${icon}
homepage: https://github.com/teaoea/shell/blob/main/plugins/ChatGPT/README.md
desc: 在 ChatGPT 策略组选择 DIRECT 或代理节点；日志默认暂停，访问 http://chatgpt-logs.invalid/ 管理。默认不解密 ChatGPT；原生 App 使用 Stash 连接记录，HTTPS 自定义日志仅用于手动解密的浏览器调试。
proxy-groups:
  - name: ChatGPT
    type: select
    proxies:
      - DIRECT
    include-all: true
rules:
${rules('ChatGPT').map(r => '  - ' + r).join('\n')}
  - DOMAIN,chatgpt-logs.invalid,DIRECT
http:
  force-http-engine:
    - 'chatgpt-logs.invalid:80'
  script:
    - name: chatgpt-network-logger
      match: '${local}'
      type: request
      require-body: false
      timeout: 10
    - name: chatgpt-network-logger
      match: '${core}'
      type: request
      require-body: false
      timeout: 10
    - name: chatgpt-network-logger
      match: '${core}'
      type: response
      require-body: false
      timeout: 10
script-providers:
  chatgpt-network-logger:
    url: ${script}
    interval: 86400`);
console.log('Generated ChatGPT routing and logging configurations for four platforms.');
