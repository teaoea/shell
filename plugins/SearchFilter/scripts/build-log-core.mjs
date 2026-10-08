import fs from 'node:fs';
const core = fs.readFileSync(new URL('../src/SearchFilterLogCore.js', import.meta.url), 'utf8').trim();
const start = '// BEGIN GENERATED SEARCH LOG CORE';
const end = '// END GENERATED SEARCH LOG CORE';
for (const name of ['SearchFilter.js', 'SearchFilterResponse.js', 'SearchFilterSubscription.js', 'SearchFilterLogger.js', 'SearchFilterLogWatch.js', 'SearchFilterEditor.js']) {
  const path = new URL('../' + name, import.meta.url);
  const original = fs.readFileSync(path, 'utf8');
  const cleaned = original.replace(/\/\/ BEGIN GENERATED SEARCH LOG CORE[\s\S]*?\/\/ END GENERATED SEARCH LOG CORE\n\n?/, '');
  let body = cleaned.replace(/\/\/ BEGIN GENERATED SEARCH HTML CORE[\s\S]*?\/\/ END GENERATED SEARCH HTML CORE\n\n?/, '');
  body = body.replace(/\/\/ BEGIN GENERATED SEARCH LOG UI[\s\S]*?\/\/ END GENERATED SEARCH LOG UI\n\n?/, '');
  body = body.replace(/\/\/ BEGIN GENERATED SEARCH BROWSER CORE[\s\S]*?\/\/ END GENERATED SEARCH BROWSER CORE\n\n?/, '');
  body = body.replace(/\/\/ BEGIN GENERATED SEARCH RULES CORE[\s\S]*?\/\/ END GENERATED SEARCH RULES CORE\n\n?/, '');
  body = body.replace(/\/\/ BEGIN GENERATED SEARCH SUBSCRIPTION CORE[\s\S]*?\/\/ END GENERATED SEARCH SUBSCRIPTION CORE\n\n?/, '');
  if (['SearchFilterSubscription.js', 'SearchFilterEditor.js'].includes(name)) {
    const subscriptionCore = fs.readFileSync(new URL('../src/SearchFilterSubscriptionCore.js', import.meta.url), 'utf8').trim();
    body = `// BEGIN GENERATED SEARCH SUBSCRIPTION CORE\n${subscriptionCore}\n// END GENERATED SEARCH SUBSCRIPTION CORE\n\n${body}`;
  }
  if (['SearchFilter.js', 'SearchFilterResponse.js', 'SearchFilterSubscription.js', 'SearchFilterEditor.js'].includes(name)) {
    const rulesCore = fs.readFileSync(new URL('../src/SearchFilterRulesCore.js', import.meta.url), 'utf8').trim();
    body = `// BEGIN GENERATED SEARCH RULES CORE\n${rulesCore}\n// END GENERATED SEARCH RULES CORE\n\n${body}`;
  }
  if (name === 'SearchFilterResponse.js') {
    const htmlCore = fs.readFileSync(new URL('../src/SearchFilterHTMLCore.js', import.meta.url), 'utf8').trim();
    body = `// BEGIN GENERATED SEARCH HTML CORE\n${htmlCore}\n// END GENERATED SEARCH HTML CORE\n\n${body}`;
    const browserCore = fs.readFileSync(new URL('../src/SearchFilterBrowserCore.js', import.meta.url), 'utf8').trim();
    body = `// BEGIN GENERATED SEARCH BROWSER CORE\n${browserCore}\n// END GENERATED SEARCH BROWSER CORE\n\n${body}`;
  }
  if (name === 'SearchFilterLogger.js') {
    const ui = fs.readFileSync(new URL('../src/SearchFilterLogUI.js', import.meta.url), 'utf8').trim();
    body = `// BEGIN GENERATED SEARCH LOG UI\n${ui}\n// END GENERATED SEARCH LOG UI\n\n${body}`;
  }
  body = body.replace(/\/\/ BEGIN GENERATED SEARCH EDITOR UI[\s\S]*?\/\/ END GENERATED SEARCH EDITOR UI\n\n?/, '');
  if (name === 'SearchFilterEditor.js') {
    const ui = fs.readFileSync(new URL('../src/SearchFilterEditorUI.js', import.meta.url), 'utf8').trim();
    body = `// BEGIN GENERATED SEARCH EDITOR UI\n${ui}\n// END GENERATED SEARCH EDITOR UI\n\n${body}`;
  }
  fs.writeFileSync(path, `${start}\n${core}\n${end}\n\n${body}`);
}
