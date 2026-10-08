import fs from 'node:fs';
const core = fs.readFileSync(new URL('../src/SearchFilterLogCore.js', import.meta.url), 'utf8').trim();
const start = '// BEGIN GENERATED SEARCH LOG CORE';
const end = '// END GENERATED SEARCH LOG CORE';
for (const name of ['SearchFilter.js', 'SearchFilterResponse.js', 'SearchFilterSubscription.js', 'SearchFilterLogger.js']) {
  const path = new URL('../' + name, import.meta.url);
  const original = fs.readFileSync(path, 'utf8');
  const cleaned = original.replace(/\/\/ BEGIN GENERATED SEARCH LOG CORE[\s\S]*?\/\/ END GENERATED SEARCH LOG CORE\n\n?/, '');
  fs.writeFileSync(path, `${start}\n${core}\n${end}\n\n${cleaned}`);
}
