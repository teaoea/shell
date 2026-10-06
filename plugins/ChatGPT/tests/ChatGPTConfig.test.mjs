import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const domains = JSON.parse(read('domains.json'));
test('routing domain inventory stays identical on all four platforms', () => {
  for (const name of ['ChatGPT.plugin', 'ChatGPT.surge.conf', 'ChatGPT.stoverride', 'ChatGPT.quantumult.conf']) {
    const content = read(name);
    const lines = content.split('\n').filter(l => /^(?:  - )?(?:DOMAIN(?:-SUFFIX)?|host(?:-suffix)?),/.test(l));
    const actual = lines.map(l => l.trim().replace(/^- /, '').split(',')[1]).filter(d => d !== 'chatgpt-logs.invalid');
    assert.deepEqual(actual, [...domains.suffix, ...domains.exact], name);
  }
  assert.match(read('ChatGPT.plugin'), /DOMAIN-SUFFIX,chatgpt.com,网络模式/);
  assert.match(read('ChatGPT.surge.conf'), /ChatGPT = select, DIRECT, YOUR_PROXY/);
  assert.match(read('ChatGPT.quantumult.conf'), /static = ChatGPT, direct, proxy/);
  assert.match(read('ChatGPT.stoverride'), /include-all: true/);
});
test('Loon trial uses the requested policy name and preserves both logging gates', () => {
  const content = read('ChatGPT.plugin');
  assert.match(content, /log_enabled = switch,false/);
  assert.match(content, /DOMAIN-SUFFIX,chatgpt.com,网络模式/);
  assert.doesNotMatch(content, /network_mode|policy_group|proxy_policy|ChatGPTSettings|generic script-path=/);
  for (const line of content.split('\n').filter(l => /^http-(request|response) \^https/.test(l))) {
    assert.match(line, /enable=\{log_enabled\}/);
    assert.match(line, /argument=\[\{log_enabled\}\]/);
  }
  const page = content.split('\n').find(l => /^http-request \^http:/.test(l));
  assert.doesNotMatch(page, /enable=/, 'log export must remain accessible with logging off');
});
test('logging adapters match the same hosts and use no body buffering', () => {
  for (const name of ['ChatGPT.plugin', 'ChatGPT.surge.conf', 'ChatGPT.quantumult.conf', 'ChatGPT.stoverride']) {
    const content = read(name);
    const core = content.split('\n').find(l => l.includes('^https://'));
    const pattern = core.match(/\^https:\/\/[^\s,']+/)[0];
    const regex = new RegExp(pattern);
    for (const host of domains.suffix) {
      assert.equal(regex.test('https://' + host + '/'), true, name + ': ' + host);
      assert.equal(regex.test('https://sub.' + host + '/api'), true);
      assert.equal(regex.test('https://' + host + '.evil.test/'), false);
    }
    assert.doesNotMatch(content, /requires?-body[=:] ?true|script-(?:request|response)-body/);
    assert.match(content, /ChatGPTLogger\.js/);
  }

});
test('each entry includes routing and local logs without adding TLS decryption', () => {
  for (const name of ['ChatGPT.plugin', 'ChatGPT.surge.conf', 'ChatGPT.quantumult.conf', 'ChatGPT.stoverride']) {
    const content = read(name);
    assert.match(content, /chatgpt-logs\.invalid,(?:DIRECT|direct)/);
    assert.match(content, /script-echo-response|http-request|type: request/);
    assert.match(content, /script-response-header|http-response|type: response/);
    assert.doesNotMatch(content, /^\[mitm\]|^\s*mitm:|^hostname\s*=/im, 'default configuration must not cause native-client certificate errors');
    assert.doesNotMatch(content, /ChatGPTLogs|ChatGPT\.rules|ChatGPT\.snippet|filter_remote|rewrite_remote/);
    const sections = [...content.matchAll(/^\[([^\]]+)\]/gm)].map(m => m[1].toLowerCase());
    assert.equal(new Set(sections).size, sections.length, 'no duplicate configuration sections');
  }
});
