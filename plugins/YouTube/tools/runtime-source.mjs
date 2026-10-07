/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 功能：按固定发布路由裁剪模块的顶层分派分支；保留原始源码与离线研究入口。
 * 更新时间：2026-10-07
 */
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
// 使用锁文件中 Terser 已依赖的语法解析器，不执行源码，不增加在线构建依赖。
const {parse} = require(require.resolve('acorn', {paths: [require.resolve('terser')]}));

/** 功能：仅裁剪已核对的顶层分支，源码结构变化时停止构建以要求重新核对。更新时间：2026-10-07。 */
export function runtimeSource(code, name, phase) {
  if (name !== 'YouTubeConfig' && name !== 'YouTubePlayback') return code;
  if (phase !== 'request' && phase !== 'response') throw new Error('未知发布阶段');
  const ast = parse(code, {ecmaVersion: 'latest'});
  const outer = ast.body.at(-1)?.expression?.callee;
  if (outer?.type !== 'FunctionExpression') throw new Error(`${name} 顶层结构已改变`);
  const statements = outer.body.body.filter(node => node.type === 'IfStatement');
  const playback = name === 'YouTubePlayback';
  if (statements.length !== (playback ? 2 : 1)) throw new Error(`${name} 分派数量已改变`);
  const edits = [];
  if (playback) {
    const offline = statements[0];
    if (code.slice(offline.test.start, offline.test.end) !== 'typeof module !== "undefined" && module.exports && typeof $done === "undefined"' || offline.alternate) throw new Error('离线入口已改变');
    edits.push({start: offline.start, end: offline.end, text: ''});
  }
  const chain = statements.at(-1), branches = [];
  let node = chain;
  while (node?.type === 'IfStatement') { branches.push(node); node = node.alternate; }
  if (branches.length !== (playback ? 5 : 2) || node?.type !== 'BlockStatement' || code.slice(node.start, node.end).trim() !== '{ $done({}); }') throw new Error(`${name} 分派结构已改变`);
  const expected = playback ? ['player\\/ad_break', '(?:player|get_watch)', '(?:player|get_watch)', 'reel\\/reel_watch_sequence', 'videoplayback'] : ['(?:config|log_event)', 'initplayback'];
  branches.forEach((branch, index) => {
    const test = code.slice(branch.test.start, branch.test.end);
    const prefix = playback ? (index < 2 ? '!dispatcherResponse && ' : 'dispatcherResponse && ') : (index === 0 ? '' : '!dispatcherResponse && ');
    if (!test.startsWith(prefix + '/') || !test.endsWith('.test(dispatcherUrl)') || !test.includes(expected[index])) throw new Error(`${name} 分派路径已改变`);
  });
  // 只发布主入口真实可到达的分支；初始化由原生规则处理，媒体采样由 Logger 处理。
  const indices = playback ? (phase === 'request' ? [0, 1] : [2, 3]) : [0];
  const text = indices.map((index, position) => {
    const branch = branches[index];
    return `${position ? 'else ' : ''}if (${code.slice(branch.test.start, branch.test.end)}) ${code.slice(branch.consequent.start, branch.consequent.end)}`;
  }).join('\n') + '\nelse ' + code.slice(node.start, node.end);
  edits.push({start: chain.start, end: chain.end, text});
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code;
}
