import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const forbidden = [
  /^\.env$/,
  /^\.env\.(?!example$).+/,
  /(^|\/).*\.db(-shm|-wal)?$/,
  /(^|\/).*keypair.*\.json$/,
  /(^|\/).+\.(pem|key|secret|p12|pfx)$/i,
  /(^|\/)(id|credentials|service-account)\.json$/i
];

const skippedDirs = new Set([".git", "node_modules", ".next", ".data", "target", "dist"]);
const roots = [process.env.RELEASE_DIR ?? "."];
const failures = [];

for (const root of roots) {
  walk(root);
}

for (const path of failures) {
  console.error(`Forbidden release artifact: ${path}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log("Release artifact check passed.");
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    const path = join(dir, entry);
    const rel = relative(".", path);
    if (forbidden.some((pattern) => pattern.test(rel))) {
      failures.push(rel);
      continue;
    }
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
  }
}
