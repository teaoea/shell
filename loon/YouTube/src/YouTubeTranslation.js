/**
 * 作者：可莉唯一的狗、ChatGPT + GPT-6.0 / GPT-6.1-sol
 * 文件：YouTubeTranslation.js
 * 功能：按手动选择的目标语言请求 YouTube 原生字幕翻译，不读取或保存字幕正文。
 * 更新时间：2026-10-06
 * 运行环境：Loon JavaScript
 */

/**
 * 功能：验证并规范化插件提供的目标语言；界面只允许简体中文和美式英语。
 * 更新时间：2026-10-06
 * @param {unknown} value 插件参数中的目标语言。
 * @returns {string|null} 标准 BCP 47 标签或空值。
 */
function ytTranslationTarget(value) {
  if (typeof value !== 'string') return null;
  var normalized = value.trim().toLowerCase();
  return normalized === 'zh-cn' ? 'zh-CN' : normalized === 'en-us' ? 'en-US' : null;
}

/**
 * 功能：读取查询参数而不重新编码其余签名、凭据和字幕格式参数。
 * 更新时间：2026-10-06
 * @param {string[]} pieces 原样保留的查询参数片段。
 * @param {string} name 要读取的参数名。
 * @returns {string|null} 解码后的首个参数值；无效编码视为缺失。
 */
function ytTranslationQueryValue(pieces, name) {
  for (var i = 0; i < pieces.length; i++) {
    var index = pieces[i].indexOf('=');
    var key = index < 0 ? pieces[i] : pieces[i].slice(0, index);
    if (key.toLowerCase() !== name) continue;
    try { return decodeURIComponent(index < 0 ? '' : pieces[i].slice(index + 1).replace(/\+/g, '%20')); }
    catch (_) { return null; }
  }
  return null;
}

/**
 * 功能：仅修改字幕目标语言，不修改视频标识、授权令牌或字幕原有格式。
 * 更新时间：2026-10-06
 * @param {string} url 原始字幕请求地址。
 * @param {string} target BCP 47 目标语言。
 * @returns {string|null} 需要替换的地址；无需修改时返回空值。
 */
function ytTranslationRewriteUrl(url, target) {
  if (!/^https:\/\/(?:www\.|m\.)?youtube\.com\/api\/timedtext\?[^#]+$/i.test(url)) return null;
  var question = url.indexOf('?'), prefix = url.slice(0, question), pieces = url.slice(question + 1).split('&');
  var source = ytTranslationQueryValue(pieces, 'lang');
  if (!source || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(source)) return null;
  var signed = ytTranslationQueryValue(pieces, 'sparams');
  if (signed && /(?:^|,)tlang(?:,|$)/i.test(signed)) return null;
  var sourceLower = source.toLowerCase();
  var sameLanguage = target === 'zh-CN' ? sourceLower === 'zh-cn' || sourceLower === 'zh-hans' : sourceLower === 'en' || sourceLower === 'en-us';
  // YouTube 的字幕翻译参数使用语言码；界面仍显示 BCP 47 的地区标签。
  var translated = target === 'zh-CN' ? 'zh-Hans' : 'en';
  var found = false;
  for (var i = 0; i < pieces.length; i++) {
    var equal = pieces[i].indexOf('='), key = equal < 0 ? pieces[i] : pieces[i].slice(0, equal);
    if (key.toLowerCase() !== 'tlang') continue;
    if (found) return null;
    if (sameLanguage) { pieces.splice(i, 1); i--; }
    else pieces[i] = key + '=' + encodeURIComponent(translated);
    found = true;
  }
  if (!found && !sameLanguage) pieces.push('tlang=' + encodeURIComponent(translated));
  var result = prefix + '?' + pieces.join('&');
  return result === url ? null : result;
}

/**
 * 功能：在请求头阶段为已有字幕轨道选择翻译语言，其他请求全部原样放行。
 * 更新时间：2026-10-06
 * @returns {void} 每次仅调用一次 Loon 的完成接口。
 */
function ytTranslationMain() {
  var request = typeof $request === 'object' && $request ? $request : null;
  var args = typeof $argument === 'object' && $argument ? $argument : null;
  var target = args ? ytTranslationTarget(args.translation_target) : null;
  if (typeof $response !== 'undefined' || !request || String(request.method || '').toUpperCase() !== 'GET' || !target) return $done({});
  var rewritten = ytTranslationRewriteUrl(String(request.url || ''), target);
  $done(rewritten ? {url: rewritten} : {});
}

if (typeof $done === 'function') ytTranslationMain();
