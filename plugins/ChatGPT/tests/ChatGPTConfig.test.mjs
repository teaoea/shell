import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const domains = JSON.parse(read('domains.json'));
test('routing domain inventory stays identical on all four platforms', () => {
  for (const name of ['ChatGPT.plugin', 'ChatGPT.rules', 'ChatGPT.stoverride', 'ChatGPT.snippet']) {
    const content = read(name);
    const lines = content.split('\n').filter(l => /^(?:  - )?(?:DOMAIN|host)/.test(l));
    const actual = lines.map(l => l.trim().replace(/^- /, '').split(',')[1]);
    assert.deepEqual(actual, [...domains.suffix, ...domains.exact], name);
  }
  assert.match(read('ChatGPT.plugin'), /DOMAIN-SUFFIX,chatgpt.com,PROXY/);
  assert.match(read('ChatGPT.surge.conf'), /ChatGPT = select, DIRECT, YOUR_PROXY/);
  assert.match(read('ChatGPT.quantumult.conf'), /static = ChatGPT, direct, proxy/);
  assert.match(read('ChatGPT.stoverride'), /include-all: true/);
});
test('logging adapters match the same hosts and use no body buffering', () => {
  for (const name of ['ChatGPTLogs.plugin', 'ChatGPTLogs.sgmodule', 'ChatGPTLogs.qxrewrite', 'ChatGPTLogs.stoverride']) {
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
  assert.doesNotMatch(read('ChatGPTLogs.sgmodule'), /\[Proxy Group\]|,ChatGPT$/m, 'Surge module cannot reference custom policies');
});
