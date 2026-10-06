/**
 * 功能：从保留中文注释的源码生成 Loon 与 Quantumult X 独立运行的压缩文件；固定工具版本和参数，支持检查产物是否过期。
 * 更新时间：2026-10-06
 */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {minify} from 'terser';

const root = new URL('../', import.meta.url);
const names = ['YouTubeFeed', 'YouTubePlayback', 'YouTubeConfig', 'YouTubeLogger'];
const bundles = {request: ['YouTubeConfig', 'YouTubePlayback', 'YouTubeLogger'], response: names};
const qxRoot = new URL('../../quantumultx/YouTube/', root);
const qxBundles = {request: ['YouTubePlayback'], response: ['YouTubeFeed', 'YouTubePlayback']};
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(value => value !== '--check')) throw new Error('仅支持 --check 参数');

/**
 * 功能：将当前阶段需要的功能文件包在独立作用域内，按接口分派后压缩；日志关闭时媒体直接放行。
 * 更新时间：2026-10-06
 * @param {string} phase 请求或响应阶段。
 * @returns {Promise<Object>} 合并后的压缩文本、文件地址及前后体积。
 */
async function compileScript(phase) {
  const modules = await readModules(bundles[phase]);
  const handlers = `yt${phase === 'request' ? 'Request' : 'Response'}Handlers`;
  const route = phase === 'request'
    ? `if (/\\/youtubei\\/v1\\/(?:config|log_event)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubeConfig();
       if (/\\/youtubei\\/v1\\/(?:player|get_watch|player\\/ad_break)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubePlayback();
       return ${handlers}.YouTubeLogger();`
    : `if (/\\/youtubei\\/v1\\/(?:config|log_event)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubeConfig();
       if (/\\/youtubei\\/v1\\/(?:browse|next|search)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubeFeed();
       if (/\\/youtubei\\/v1\\/(?:player|get_watch|reel\\/reel_watch_sequence)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubePlayback();
       return ${handlers}.YouTubeLogger();`;
  const source = `var ${handlers}={${modules.join(',\n')}};
    if (typeof $done === 'function') (function(){
      if (${phase === 'request' ? "typeof $response !== 'undefined'" : "typeof $response === 'undefined'"}) return $done({});
      var url = typeof $request !== 'undefined' ? String($request.url || '') : '';
      // 日志开关是媒体采样的总开关；关闭后不读取采样选项、媒体正文或日志缓存，也不执行日志模块。
      var media = /^https:\\/\\/[\\w-]+\\.googlevideo\\.com\\/(?:videoplayback|initplayback)(?:\\?[^#]*)?$/i.test(url);
      if (media && !(typeof $argument === 'object' && $argument && ($argument.log_enabled === true || $argument.log_enabled === 'true'))) return $done({});
      ${route}
    })();`;
  return minifyBundle(phase, source, new URL(`dist/${phase}.min.js`, root));
}

/**
 * 功能：读取功能源码并包成以模块名为键的独立函数，供合并入口按接口调用。
 * 更新时间：2026-10-06
 * @param {Array<string>} list 模块名称。
 * @returns {Promise<Array<string>>} 对象字面量中的各模块成员文本。
 */
function readModules(list) {
  return Promise.all(list.map(async name => {
    const code = await fs.readFile(new URL(`src/${name}.js`, root), 'utf8');
    return `${name}:function ${name}(){\n${code}\n}`;
  }));
}

/**
 * 功能：压缩合并入口并检查语法；文件头保存合并输入的哈希，保持相同输入生成相同输出。
 * 更新时间：2026-10-06
 * @param {string} name 输出中显示的产物名称。
 * @param {string} source 合并后的未压缩入口。
 * @param {URL} target 产物地址。
 * @returns {Promise<Object>} 压缩文本、文件地址及前后体积。
 */
async function minifyBundle(name, source, target) {
  const hash = createHash('sha256').update(source).digest('hex');
  const result = await minify({[`${name}.js`]: source}, {
    compress: false,
    mangle: {toplevel: false, properties: false},
    keep_fnames: true,
    keep_classnames: true,
    module: false,
    toplevel: false,
    sourceMap: false,
    format: {
      comments: false,
      preamble: `/* 自动生成，功能源码保存在 src/。合并源码 SHA-256: ${hash} */`
    }
  });
  if (!result.code) throw new Error(`${name} 压缩输出为空`);
  const code = result.code + '\n';
  new vm.Script(code, {filename: `${name}.min.js`});
  return {name, code, target, before: Buffer.byteLength(source), after: Buffer.byteLength(code)};
}

/**
 * 功能：生成 Quantumult X 发布包；只含去广告功能模块，由适配层转换运行时接口并注入固定开关。
 * 更新时间：2026-10-06
 * @param {string} phase 请求或响应阶段。
 * @returns {Promise<Object>} 压缩文本、文件地址及前后体积。
 */
async function compileQXScript(phase) {
  const modules = await readModules(qxBundles[phase]);
  const runtime = await fs.readFile(new URL('tools/qx-runtime.js', root), 'utf8');
  const saved = JSON.parse(await fs.readFile(new URL('options.json', qxRoot), 'utf8'));
  const regions = ['original', 'CN', 'HK', 'TW', 'US', 'JP', 'KR', 'SG', 'GB', 'DE', 'RU'];
  for (const key of ['background_playback', 'hide_home_shorts']) if (typeof saved[key] !== 'boolean') throw new Error(`options.json 的 ${key} 必须为 true 或 false`);
  if (!regions.includes(saved.playback_region)) throw new Error(`options.json 的 playback_region 必须为 ${regions.join('、')} 之一`);
  const options = {background_playback: saved.background_playback, hide_home_shorts: saved.hide_home_shorts, playback_region: saved.playback_region};
  const route = phase === 'request'
    ? `if (/^https:\\/\\/[a-z0-9-]+\\.googlevideo\\.com\\/initplayback(?:\\?[^#]*)?$/i.test(url)) return ytQXEmptyVideo($request, $done);
       if (/\\/youtubei\\/v1\\/(?:player|get_watch|player\\/ad_break)(?:\\?[^#]*)?$/i.test(url)) return handlers.YouTubePlayback();`
    : `if (/\\/youtubei\\/v1\\/(?:browse|next|search)(?:\\?[^#]*)?$/i.test(url)) return handlers.YouTubeFeed();
       if (/\\/youtubei\\/v1\\/(?:player|get_watch|reel\\/reel_watch_sequence)(?:\\?[^#]*)?$/i.test(url)) return handlers.YouTubePlayback();`;
  // 功能源码通过形参取得适配后的接口，无需感知 Quantumult X；请求阶段的 $response 保持未定义。
  const source = `if (typeof $done === 'function') (function(){
      ${runtime}
      var qx = ytQXRuntime(${JSON.stringify(phase)}, ${JSON.stringify(options)});
      if (!qx) return;
      (function($request, $response, $done, $argument, $persistentStore){
        var handlers={${modules.join(',\n')}};
        var url = String($request.url || '');
        ${route}
        return $done({});
      })(qx.request, qx.response, qx.done, qx.argument, qx.store);
    })();`;
  return minifyBundle(`quantumultx ${phase}`, source, new URL(`dist/${phase}.min.js`, qxRoot));
}

// 全部文件成功生成并通过语法检查后才开始写入；构建过程不修改源码、主插件或 Quantumult X 片段。
const results = (await Promise.all(Object.keys(bundles).map(compileScript))).concat(await Promise.all(Object.keys(qxBundles).map(compileQXScript)));
if (!check) for (const base of [root, qxRoot]) await fs.mkdir(new URL('dist/', base), {recursive: true});
for (const result of results) {
  if (check) {
    const saved = await fs.readFile(result.target, 'utf8').catch(() => null);
    if (saved !== result.code) throw new Error(`压缩产物缺失或过期：${fileURLToPath(result.target)}；请重新构建`);
  } else {
    await fs.writeFile(result.target, result.code);
  }
  console.log(`${result.name}: ${result.before} → ${result.after} 字节，减少 ${(100 * (1 - result.after / result.before)).toFixed(1)}%${check ? '，产物一致' : ''}`);
}
