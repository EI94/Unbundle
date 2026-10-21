// Ownership check of a hub package branch (docs/use-case/PIANO-LAVORI.md §2.6 point 6, §4).
//
//   node scripts/use-case-test/ownership.mjs <id>                 # e.g. h2a: git diff feat/use-case-hub...HEAD
//   node scripts/use-case-test/ownership.mjs <id> --base <ref>    # another integration ref
//   node scripts/use-case-test/ownership.mjs --validate           # only check ownership.json itself
//
// Every path changed on the branch since it left the integration branch must be in the
// package's list (scripts/use-case-test/ownership.json). A package may also add new test
// files in the hub's test folders (`newTestFiles`) that no package lists. Paths under
// `forbidden` are refused for everyone. Exit 0 when green, 1 with the offending paths.
// Read-only: it runs only `git diff` and `git status`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(join(repoRoot, "scripts/use-case-test/ownership.json"), "utf8"));

/** Glob to RegExp: `**` any depth, `*` and `?` within one segment, `{a,b}` alternatives; everything else literal. */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else if (char === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) throw new Error(`Unclosed { in ${glob}`);
      out += `(?:${glob.slice(i + 1, close).split(",").map((part) => part.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      i = close;
    } else out += char.replace(/[.+^$()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const compile = (globs) => globs.map((glob) => ({ glob, re: globToRegExp(glob) }));
const matchOf = (patterns, path) => patterns.find(({ re }) => re.test(path))?.glob ?? null;

const packages = Object.fromEntries(
  Object.entries(config.packages).map(([id, pkg]) => [id, { ...pkg, patterns: compile(pkg.files) }]),
);
const forbidden = compile(config.forbidden);
const newTestFiles = compile(config.newTestFiles);

/** ownership.json itself: known shape, and no file owned by two packages of the same wave. */
function validate() {
  const problems = [];
  for (const [id, pkg] of Object.entries(packages)) {
    if (!/^h\d[a-z]?\d?$/.test(id)) problems.push(`${id}: package ids look like h0, h2a, h1b2, h4i`);
    if (!/^H\d[a-z]?$/.test(pkg.wave ?? "")) problems.push(`${id}: wave must look like H2 or H4p`);
    if (!Array.isArray(pkg.files) || !pkg.files.length) problems.push(`${id}: empty file list`);
    if (pkg.note !== undefined && (typeof pkg.note !== "string" || !pkg.note.trim())) problems.push(`${id}: note must be a non-empty string`);
    for (const glob of pkg.files ?? []) {
      if (matchOf(forbidden, glob)) problems.push(`${id}: ${glob} is forbidden`);
    }
  }
  const entries = Object.entries(packages);
  for (const [i, [a, pa]] of entries.entries()) {
    for (const [b, pb] of entries.slice(i + 1)) {
      if (pa.wave !== pb.wave) continue;
      // Literal paths (braces expanded) of one package against the other's patterns, both ways.
      for (const [files, patterns] of [[pa.files, pb.patterns], [pb.files, pa.patterns]]) {
        for (const path of files.flatMap(expandBraces).filter((p) => !/[*?]/.test(p))) {
          if (matchOf(patterns, path)) problems.push(`${path}: owned by ${a} and ${b} in wave ${pa.wave}`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** `a/{b,c}.ts` → `a/b.ts`, `a/c.ts` (one level of braces per group, as in ownership.json). */
function expandBraces(glob) {
  const open = glob.indexOf("{");
  if (open === -1) return [glob];
  const close = glob.indexOf("}", open);
  return glob
    .slice(open + 1, close)
    .split(",")
    .flatMap((part) => expandBraces(`${glob.slice(0, open)}${part}${glob.slice(close + 1)}`));
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** The package's verdict on one changed path: null when allowed, otherwise the reason. */
export function verdict(id, status, path) {
  if (matchOf(forbidden, path)) return "forbidden for every package";
  if (matchOf(packages[id].patterns, path)) return null;
  const owner = Object.entries(packages).find(([other, pkg]) => other !== id && matchOf(pkg.patterns, path))?.[0];
  if (owner) return `owned by ${owner}`;
  if (status === "A" && matchOf(newTestFiles, path)) return null;
  return "not in the package's list";
}

function exitWith(code) {
  process.exitCode = code;
}

function main() {
  const args = process.argv.slice(2);
  const problems = validate();
  if (args[0] === "--validate") {
    if (problems.length) {
      console.error(`ownership.json: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join("\n")}`);
      return exitWith(1);
    }
    console.log(`ownership.json valid: ${Object.keys(packages).length} packages`);
    return exitWith(0);
  }

  const id = args[0]?.toLowerCase();
  const baseAt = args.indexOf("--base");
  const base = baseAt === -1 ? config.integrationBranch : args[baseAt + 1];
  if (!id || !packages[id] || !base) {
    console.error(`Usage: node scripts/use-case-test/ownership.mjs <${Object.keys(packages).join("|")}> [--base <ref>] | --validate`);
    return exitWith(2);
  }
  if (problems.length) {
    console.error(`ownership.json is not valid:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    return exitWith(1);
  }

  // Committed changes since the branch left the integration branch; renames count as delete + add.
  const changes = git(["diff", "--name-status", "--no-renames", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status[0], path: rest.join("\t") };
    });
  const offending = changes
    .map((change) => ({ ...change, reason: verdict(id, change.status, change.path) }))
    .filter((change) => change.reason);

  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]).split("\n").filter(Boolean);
  if (dirty.length) console.warn(`Note: ${dirty.length} uncommitted change(s) are not part of this check.`);

  if (offending.length) {
    console.error(`Ownership ${id} (${packages[id].title}): ${offending.length} path(s) outside the package\n` +
      offending.map(({ status, path, reason }) => `  ${status} ${path}  (${reason})`).join("\n"));
    return exitWith(1);
  }
  console.log(`Ownership ${id} (${packages[id].title}): green, ${changes.length} changed path(s) against ${base}`);
  if (packages[id].note) console.log(`Note for ${id}: ${packages[id].note}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
