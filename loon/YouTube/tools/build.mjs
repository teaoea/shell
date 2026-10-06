/**
 * 功能：从保留中文注释的源码生成三平台独立运行的压缩文件；固定工具版本和参数，支持检查产物是否过期。
 * 更新时间：2026-10-06
 */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {minify} from 'terser';

const root = new URL('../', import.meta.url);
const names = ['YouTubeFeed', 'YouTubePlayback', 'YouTubeConfig', 'YouTubeLogger'];
const bundles = {request: ['YouTubeConfig', 'YouTubePlayback', 'YouTubeTranslation', 'YouTubeLogger'], response: names};
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(value => value !== '--check')) throw new Error('仅支持 --check 参数');

/**
 * 功能：将当前阶段需要的功能文件包在独立作用域内，按接口分派后压缩；日志关闭时媒体直接放行。
 * 更新时间：2026-10-06
 * @param {string} phase 请求或响应阶段。
 * @returns {Promise<Object>} 合并后的压缩文本、文件地址及前后体积。
 */
async function compileScript(phase) {
  const modules = await Promise.all(bundles[phase].map(async name => {
    const code = await fs.readFile(new URL(`src/${name}.js`, root), 'utf8');
    return `${name}:function ${name}(){return ytRuntimeInvoke(function($request,$response,$argument,$persistentStore,$done){\n${code}\n});}`;
  }));
  const handlers = `yt${phase === 'request' ? 'Request' : 'Response'}Handlers`;
  const route = phase === 'request'
    ? `if (/\\/api\\/timedtext\\?[^#]+$/i.test(url)) return ${handlers}.YouTubeTranslation();
       if (/\\/youtubei\\/v1\\/(?:config|log_event)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubeConfig();
       if (/\\/youtubei\\/v1\\/(?:player|get_watch|player\\/ad_break)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubePlayback();
       return ${handlers}.YouTubeLogger();`
    : `if (/\\/youtubei\\/v1\\/(?:config|log_event)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubeConfig();
       if (/\\/youtubei\\/v1\\/(?:browse|next|search)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubeFeed();
       if (/\\/youtubei\\/v1\\/(?:player|get_watch|reel\\/reel_watch_sequence)(?:\\?[^#]*)?$/i.test(url)) return ${handlers}.YouTubePlayback();
       return ${handlers}.YouTubeLogger();`;
  const runtime = await fs.readFile(new URL('src/YouTubeRuntime.js', root), 'utf8');
  const source = `${runtime}\nvar ${handlers}={${modules.join(',\n')}};
    if (typeof $done === 'function') (function(){
      if (${phase === 'request' ? "typeof $response !== 'undefined'" : "typeof $response === 'undefined'"}) return $done({});
      var url = typeof $request !== 'undefined' ? String($request.url || '') : '';
      // 日志开关是媒体采样的总开关；关闭后不读取采样选项、媒体正文或日志缓存，也不执行日志模块。
      var media = /^https:\\/\\/[\\w-]+\\.googlevideo\\.com\\/(?:videoplayback|initplayback)(?:\\?[^#]*)?$/i.test(url);
      var options = ytRuntimeOptions();
      if (media && !(options.log_enabled === true || options.log_enabled === 'true')) {
        if (${phase === 'response' ? 'true' : 'false'} && ytRuntimeMediaHeaders()) return;
        return $done({});
      }
      ${route}
    })();`;
  const hash = createHash('sha256').update(source).digest('hex');
  const result = await minify({[`${phase}.js`]: source}, {
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
  if (!result.code) throw new Error(`${phase} 压缩输出为空`);
  const code = result.code + '\n';
  new vm.Script(code, {filename: `${phase}.min.js`});
  return {name: phase, code, target: new URL(`dist/${phase}.min.js`, root), before: Buffer.byteLength(source), after: Buffer.byteLength(code)};
}

// 两份文件全部成功生成并通过语法检查后才开始写入；构建过程不修改源码或主插件。
const results = await Promise.all(Object.keys(bundles).map(compileScript));
if (!check) await fs.mkdir(new URL('dist/', root), {recursive: true});
for (const result of results) {
  if (check) {
    const saved = await fs.readFile(result.target, 'utf8').catch(() => null);
    if (saved !== result.code) throw new Error(`压缩产物缺失或过期：${fileURLToPath(result.target)}；请重新构建`);
  } else {
    await fs.writeFile(result.target, result.code);
  }
  console.log(`${result.name}: ${result.before} → ${result.after} 字节，减少 ${(100 * (1 - result.after / result.before)).toFixed(1)}%${check ? '，产物一致' : ''}`);
}
