// Runs every test/*.test.js in its own Node process (they swap global browser/DOM objects, so they must not share one).
// Quiet when everything passes; shows the failing file's output when something doesn't.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(f, dir))], { encoding: "utf8" });
  if (r.status === 0) {
    console.log(`ok    ${f}`);
  } else {
    failed++;
    console.log(`FAIL  ${f}\n${r.stdout}${r.stderr}`);
  }
}
console.log(failed ? `\n${failed} of ${files.length} test files failed` : `\nall ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
