import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const forbidden = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /(^|\/).*\.db(-shm|-wal)?$/,
  /(^|\/).*keypair.*\.json$/,
  /(^|\/).+\.(pem|key|secret|p12|pfx)$/i,
  /(^|\/)(id|credentials|service-account)\.json$/i
];

const skippedDirs = new Set([".git", "node_modules", ".pnpm-store", ".next", ".data", "target", "dist"]);
const failures = [];

for (const path of releaseCandidates()) {
  if (forbidden.some((pattern) => pattern.test(path))) failures.push(path);
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
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    const path = join(dir, entry);
    const rel = relative(".", path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(rel);
  }
  return files;
}

function releaseCandidates() {
  if (process.env.RELEASE_DIR) return walk(process.env.RELEASE_DIR);
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "utf8"
    }).split("\0").filter(Boolean);
  } catch {
    return walk(".");
  }
}
