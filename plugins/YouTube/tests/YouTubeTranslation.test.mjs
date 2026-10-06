import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('src/YouTubeTranslation.js', root), 'utf8');
const published = fs.readFileSync(new URL('dist/request.min.js', root), 'utf8');

function run(code, url, target, method = 'GET', enabled = true) {
  let calls = 0, result;
  const request = {url, method};
  Object.defineProperty(request, 'body', {get() {throw Error('字幕翻译不应读取正文');}});
  vm.runInNewContext(code, {
    $request: request,
    $argument: {translation_target: target, translation_enabled: enabled},
    $persistentStore: {read() {throw Error('字幕翻译不应读取日志');}, write() {throw Error('字幕翻译不应保存内容');}},
    $done(value) {calls++; result = value;}
  }, {timeout: 1000});
  assert.equal(calls, 1);
  return JSON.parse(JSON.stringify(result));
}

for (const code of [source, published]) {
  const variant = code === source ? '源码' : '压缩入口';
  test(`${variant} 将其他语言字幕请求翻译为所选目标并保留原参数`, () => {
    const url = 'https://www.youtube.com/api/timedtext?v=abc&lang=ja&fmt=json3&pot=PRIVATE%2BVALUE&sig=xyz';
    assert.deepEqual(run(code, url, 'zh-CN'), {url: url + '&tlang=zh-Hans'});
    assert.deepEqual(run(code, url, 'en-US'), {url: url + '&tlang=en'});
  });
  test(`${variant} 替换已有目标语言且不重复追加`, () => {
    const url = 'https://m.youtube.com/api/timedtext?lang=fr&tlang=de&sig=xyz';
    assert.deepEqual(run(code, url, 'zh-CN'), {url: 'https://m.youtube.com/api/timedtext?lang=fr&tlang=zh-Hans&sig=xyz'});
    assert.deepEqual(run(code, 'https://www.youtube.com/api/timedtext?lang=en&tlang=fr&sig=xyz', 'en-US'), {url: 'https://www.youtube.com/api/timedtext?lang=en&sig=xyz'});
    assert.deepEqual(run(code, 'https://www.youtube.com/api/timedtext?lang=zh-Hant&sig=xyz', 'zh-CN'), {url: 'https://www.youtube.com/api/timedtext?lang=zh-Hant&sig=xyz&tlang=zh-Hans'});
  });
  test(`${variant} 同语言、无轨道、带签名目标参数和无效设置安全放行`, () => {
    for (const [url, target] of [
      ['https://www.youtube.com/api/timedtext?lang=zh-Hans&sig=xyz', 'zh-CN'],
      ['https://www.youtube.com/api/timedtext?lang=en&sig=xyz', 'en-US'],
      ['https://www.youtube.com/api/timedtext?v=abc', 'en-US'],
      ['https://www.youtube.com/api/timedtext?lang=fr&sparams=expire%2Ctlang', 'en-US'],
      ['https://www.youtube.com/api/timedtext?lang=fr', 'es-ES'],
      ['https://www.youtube.com/watch?v=abc&lang=fr', 'en-US']
    ]) assert.deepEqual(run(code, url, target), {});
  });
  test(`${variant} 字幕翻译默认关闭，明确开启才修改`, () => {
    for (const enabled of [undefined, false, 'false', '', 1]) assert.deepEqual(run(code, 'https://www.youtube.com/api/timedtext?lang=ja', 'en-US', 'GET', enabled === undefined ? null : enabled), {});
    assert.ok(run(code, 'https://www.youtube.com/api/timedtext?lang=ja', 'en-US', 'GET', 'true').url);
  });
  test(`${variant} 不处理非 GET 或其他站点`, () => {
    assert.deepEqual(run(code, 'https://www.youtube.com/api/timedtext?lang=fr', 'en-US', 'POST'), {});
    assert.deepEqual(run(code, 'https://evil.example/api/timedtext?lang=fr', 'en-US'), {});
  });
}

test('插件只提供两个目标语言并在请求头阶段调用现有请求包', () => {
  const plugin = fs.readFileSync(new URL('YouTubeNoAds.plugin', root), 'utf8');
  assert.match(plugin, /translation_target = select,"zh-CN","en-US",tag=字幕目标语言/);
  const line = plugin.split('\n').find(value => value.includes('tag=YouTube 字幕目标语言'));
  assert.ok(line?.startsWith('http-request '));
  assert.match(line, /dist\/request\.min\.js/);
  assert.match(line, /requires-body=false/);
  assert.match(line, /argument=\[\{translation_enabled\},\{translation_target\}\]/);
});

test('all native configurations default optional playback, logging and translation off',()=>{
 const loon=fs.readFileSync(new URL('YouTubeNoAds.plugin',root),'utf8');
 for(const key of ['background_playback','log_enabled','translation_enabled']) assert.ok(loon.includes(key+' = switch,false,'));
 assert.match(loon.split('\n').find(l=>l.includes('tag=YouTube 字幕目标语言')), /enable=\{translation_enabled\}/);
 for(const file of ['YouTubeNoAds.snippet','YouTubeNoAds.sgmodule','YouTubeNoAds.stoverride']) {
 const config=fs.readFileSync(new URL(file,root),'utf8');
 assert.ok(config.includes('background_playback=false'));assert.ok(config.includes('translation_enabled=false'));assert.ok(config.includes('log_enabled=false'));
 }
});
