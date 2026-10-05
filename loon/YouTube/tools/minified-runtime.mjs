/**
 * 功能：用两份发布包中的真实功能处理器运行已有回归；包含不再绑定手机的离线协议研究，主入口另有路由测试。
 * 更新时间：2026-10-06
 */
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const replacements = new Map(['YouTubeFeed', 'YouTubePlayback', 'YouTubeConfig', 'YouTubeLogger'].map(name => [
  fs.readFileSync(new URL(`src/${name}.js`, root), 'utf8'),
  name
]));
const bundles = Object.fromEntries(['request', 'response'].map(phase => [phase, fs.readFileSync(new URL(`dist/${phase}.min.js`, root), 'utf8')]));
const originalRun = vm.runInNewContext;

/**
 * 功能：加载匹配阶段的发布包后调用对应处理器；只在装载阶段临时隐藏完成回调，页面内嵌脚本原样执行。
 * 更新时间：2026-10-06
 * @param {string} code 待执行脚本。
 * @param {...Object} args 原始沙盒与执行参数。
 * @returns {*} 原始虚拟机执行结果。
 */
vm.runInNewContext = function runMinifiedScript(code, ...args) {
  const name = replacements.get(code);
  if (!name) return Reflect.apply(originalRun, vm, [code, ...args]);
  const context = args[0];
  const phase = name === 'YouTubeFeed' || typeof context.$response !== 'undefined' || typeof context.$done === 'undefined' ? 'response' : 'request';
  const hadDone = Object.hasOwn(context, '$done'), done = context.$done;
  try {
    delete context.$done;
    Reflect.apply(originalRun, vm, [bundles[phase], ...args]);
  } finally {
    if (hadDone) context.$done = done;
  }
  return Reflect.apply(originalRun, vm, [`yt${phase === 'request' ? 'Request' : 'Response'}Handlers.${name}();`, ...args]);
};
