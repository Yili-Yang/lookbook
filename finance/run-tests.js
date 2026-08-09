/* run-tests.js — run the checks in tests.js from a terminal.
 *
 *   node run-tests.js
 *
 * The app itself has no build step and no dependencies: config.js, model.js and
 * tests.js are plain scripts that share a global scope in the browser. This
 * runner reproduces that by evaluating them in one context, so the same files
 * run headlessly without needing a module system.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const here = __dirname;
for (const file of ['config.js', 'model.js', 'tests.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(here, file), 'utf8'), { filename: file });
}

const results = runAllTests();
let failed = 0;
for (const r of results) {
  if (r.pass) {
    console.log(`  ok   ${r.name}`);
  } else {
    failed++;
    console.log(`  FAIL ${r.name}\n         ${r.error}`);
  }
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
