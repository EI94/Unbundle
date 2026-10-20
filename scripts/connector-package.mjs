// Packages of the connector skill and plugin (prompt WP9, package K9). Writes three zips to a
// git-ignored folder:
//   <pluginName>.zip                 phase 1 plugin: manifest + skill, no .mcp.json
//   <pluginName>-con-connettore.zip  test variant: the same plus .mcp.json with the connector URL
//                                    (only for the test organization, or for phase 2 with OAuth)
//   segnala-caso-uso.zip             the skill alone, folder segnala-caso-uso/ at the top level
//
//   node --no-warnings scripts/connector-package.mjs [--config <file.json>] [--out <dir>]
//
// --config: the package configuration (pluginName, displayName, version, slug, optional
//   description; see packageConfigSchema in src/lib/connector/package/skill-package.ts). Default:
//   the synthetic docs/connettore/pacchetto-esempio.json. The client's file holds client values
//   (plugin name, display name, connector slug), so inside a git work tree it must be ignored and
//   untracked (a *.private.json, e.g. docs/connettore/pacchetto-<cliente>.private.json): the script
//   refuses any other config file inside this or any other git work tree.
// --out: default build/connettore-pacchetti (ignored by /build in .gitignore). Inside any git work
//   tree (this repository or another one) the zips must be ignored by that repository, or the
//   script refuses; a folder outside every work tree is fine.
//
// Both checks resolve the path first (symlinks and letter case, through the nearest existing
// folder), look for a .git entry in every parent folder and then ask that repository with
// `git check-ignore` (without --no-index, so a tracked file never counts as ignored). Any git
// error refuses.
//
// The skill and the plugin template are read from the repository (skills/segnala-caso-uso/SKILL.md,
// plugins/unbundle-organizzazione/) and checked before anything is written: skill rules, identical
// skill copy, documented manifest fields, no extra files. Every zip is written to a temporary name,
// read back from disk and checked again (top-level folder, manifest, skill, .mcp.json only in the
// test variant, no bin/), then renamed. Output: one JSON report, exit code 0 or 1. No secrets are
// involved: the plugin never carries a token (the connector header is set by the organization Owner).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPackages,
  packageZipEntries,
  packageZipProblems,
  parsePackageConfig,
  PLUGIN_MANIFEST_PATH,
  PLUGIN_SKILL_PATH,
  PLUGIN_TEMPLATE_DIR,
  SKILL_SOURCE_PATH,
} from "../src/lib/connector/package/skill-package.ts";
import { createZip, readZip } from "../src/lib/connector/package/zip.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_CONFIG = "docs/connettore/pacchetto-esempio.json";
const DEFAULT_OUT = "build/connettore-pacchetti";

function fail(problems) {
  process.stdout.write(`${JSON.stringify({ ok: false, problems }, null, 2)}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { config: EXAMPLE_CONFIG, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--config" || flag === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail([`${flag} vuole un valore.`]);
      args[flag.slice(2)] = value;
      i += 1;
    } else if (flag === "--help" || flag === "-h") {
      process.stdout.write("node --no-warnings scripts/connector-package.mjs [--config <file.json>] [--out <dir>]\n");
      process.exit(0);
    } else {
      fail([`Opzione sconosciuta: ${flag}`]);
    }
  }
  return args;
}

// git sees only these variables from us: a GIT_DIR or GIT_WORK_TREE inherited from a hook would
// point every check at another repository.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

/**
 * The nearest existing folder at or above `path`, with symlinks and letter case resolved, and
 * the rest of the path below it (for an existing file: its folder and its name).
 */
function existingBase(path) {
  let dir = path;
  const rest = [];
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    rest.unshift(basename(dir));
    dir = parent;
  }
  let real = realpathSync.native(dir);
  if (!statSync(real).isDirectory()) {
    rest.unshift(basename(real));
    real = dirname(real);
  }
  return { dir: real, rest: rest.join("/") };
}

/** True if `dir` is inside a git work tree or a .git folder (a .git entry in it or above it). */
function insideGitTree(dir) {
  for (let current = dir; ; current = dirname(current)) {
    if (basename(current) === ".git" || existsSync(join(current, ".git"))) return true;
    if (dirname(current) === current) return false;
  }
}

/**
 * True if git could pick up `path`: it is inside a git work tree (this repository or any other)
 * and that repository does not ignore it. A tracked file is never ignored (no --no-index), and
 * any git error counts as exposed.
 */
function exposedToGit(path) {
  const { dir, rest } = existingBase(path);
  if (!insideGitTree(dir)) return false;
  const result = spawnSync("git", ["-C", dir, "check-ignore", "-q", "--", rest || "."], { env: GIT_ENV, encoding: "utf8" });
  if (result.error) fail(["git non disponibile: non posso verificare che il percorso sia ignorato."]);
  return result.status !== 0;
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    return [relative(base, full).split(sep).join("/")];
  });
}

const args = parseArgs(process.argv.slice(2));

// Configuration: the example, or a file that no git work tree can pick up (ignored and untracked
// inside one, or outside every work tree).
const configPath = resolve(repoRoot, args.config);
if (!existsSync(configPath)) fail(["Non riesco a leggere il file di configurazione come JSON."]);
const isExample = realpathSync.native(configPath) === realpathSync.native(resolve(repoRoot, EXAMPLE_CONFIG));
if (!isExample && exposedToGit(configPath)) {
  fail(["Il file di configurazione del cliente deve essere ignorato da git e non tracciato (per esempio un *.private.json)."]);
}
let rawConfig;
try {
  rawConfig = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  fail(["Non riesco a leggere il file di configurazione come JSON."]);
}
const parsedConfig = parsePackageConfig(rawConfig);
if (!parsedConfig.ok) fail(parsedConfig.problems);

// Sources from the repository.
const templateDir = join(repoRoot, PLUGIN_TEMPLATE_DIR);
let templateManifest;
try {
  templateManifest = JSON.parse(readFileSync(join(templateDir, PLUGIN_MANIFEST_PATH), "utf8"));
} catch {
  fail([`Manifest del plugin modello non leggibile: ${PLUGIN_TEMPLATE_DIR}/${PLUGIN_MANIFEST_PATH}.`]);
}
const sources = {
  skill: readFileSync(join(repoRoot, SKILL_SOURCE_PATH), "utf8"),
  pluginSkill: readFileSync(join(templateDir, PLUGIN_SKILL_PATH), "utf8"),
  templateManifest,
  templateFiles: listFiles(templateDir),
};
const build = buildPackages(sources, parsedConfig.config);
if (!build.ok) fail(build.problems);

// Output folder: the zips must be ignored by any git work tree they would land in.
const outDir = resolve(repoRoot, args.out);
if (build.packages.some((plan) => exposedToGit(join(outDir, plan.fileName)))) {
  fail(["La cartella di uscita è dentro un repository git che non la ignora: scegline una ignorata (predefinita build/connettore-pacchetti) o una fuori da ogni repository."]);
}
mkdirSync(outDir, { recursive: true });

const report = [];
for (const plan of build.packages) {
  const zip = createZip(packageZipEntries(plan));
  const target = join(outDir, plan.fileName);
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, zip);
  const written = readFileSync(temporary);
  let entries;
  try {
    entries = readZip(written);
  } catch (error) {
    rmSync(temporary, { force: true });
    fail([`${plan.fileName}: ${error instanceof Error ? error.message : "zip non leggibile"}`]);
  }
  const problems = packageZipProblems(plan.kind, plan.root, entries);
  if (problems.length) {
    rmSync(temporary, { force: true });
    fail(problems.map((p) => `${plan.fileName}: ${p}`));
  }
  renameSync(temporary, target);
  report.push({
    kind: plan.kind,
    file: relative(repoRoot, target).startsWith("..") ? target : relative(repoRoot, target),
    bytes: statSync(target).size,
    sha256: createHash("sha256").update(written).digest("hex"),
    entries: entries.map((e) => e.path),
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      config: isExample ? "esempio sintetico (non da distribuire)" : "file indicato con --config",
      plugin: { name: build.manifest.name, version: build.manifest.version },
      packages: report,
      notes: [
        "Fase 1: carica il primo zip (plugin senza .mcp.json); il connettore lo aggiunge l'Owner con il suo header.",
        "La variante con .mcp.json serve solo alla prova nell'organizzazione di prova o alla fase 2 con OAuth.",
      ],
    },
    null,
    2
  )}\n`
);
