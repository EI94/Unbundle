// Zip of the «registra-ai-lab» skill for the team MCP «Unbundle Use case» (docs/use-case/DESIGN.md
// §8.2, §9.4; PIANO-LAVORI H5b, H7). Writes one zip to a git-ignored folder:
//   build/skill-registra-ai-lab/registra-ai-lab.zip   folder registra-ai-lab/ with SKILL.md
//
//   node --no-warnings scripts/use-case-skill-package.mjs
//
// The person uploads it in Claude (Settings › Capabilities › Skills). The skill is read from
// skills/registra-ai-lab/SKILL.md as it is: its rules are checked by
// src/lib/use-cases/skill-registra.test.ts. The output folder must be ignored by git (build/ is in
// .gitignore): the script refuses otherwise. The zip is written to a temporary name, read back and
// checked (one folder, one SKILL.md, same bytes), then renamed. No secrets: the skill never carries
// a token. Output: one JSON report, exit code 0 or 1.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TOKEN_PREFIXES } from "../src/lib/connector/http-hygiene.ts";
import { createZip, readZip } from "../src/lib/connector/package/zip.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAME = "registra-ai-lab";
const SKILL_SOURCE = join(repoRoot, "skills", SKILL_NAME, "SKILL.md");
const OUT_DIR = join(repoRoot, "build", `skill-${SKILL_NAME}`);
const OUT_FILE = join(OUT_DIR, `${SKILL_NAME}.zip`);

function report(body, code) {
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exit(code);
}

if (process.argv.length > 2) report({ ok: false, problems: ["Nessuna opzione: node --no-warnings scripts/use-case-skill-package.mjs"] }, 1);

// The zip must never end up in git: ask this repository (without the GIT_* variables a hook may set).
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
const ignored = spawnSync("git", ["-C", repoRoot, "check-ignore", "-q", relative(repoRoot, OUT_FILE)], { env: gitEnv });
if (ignored.status !== 0) report({ ok: false, problems: [`${relative(repoRoot, OUT_FILE)} non è ignorato da git: aggiungi la cartella a .gitignore.`] }, 1);

const skill = readFileSync(SKILL_SOURCE);
const text = skill.toString("utf8");
const problems = [];
if (!text.startsWith("---\n")) problems.push("SKILL.md senza frontmatter.");
if (!new RegExp(`^name: ${SKILL_NAME}$`, "m").test(text)) problems.push(`Il frontmatter non ha «name: ${SKILL_NAME}».`);
if (DEFAULT_TOKEN_PREFIXES.some((prefix) => text.toLowerCase().includes(prefix))) problems.push("SKILL.md contiene un prefisso di token.");
if (problems.length) report({ ok: false, problems }, 1);

const zip = createZip([
  { path: `${SKILL_NAME}/` },
  { path: `${SKILL_NAME}/SKILL.md`, data: skill },
]);
mkdirSync(OUT_DIR, { recursive: true });
const temporary = `${OUT_FILE}.tmp`;
writeFileSync(temporary, zip);
const entries = readZip(readFileSync(temporary));
const files = entries.filter((entry) => !entry.isDirectory);
if (files.length !== 1 || files[0].path !== `${SKILL_NAME}/SKILL.md` || !files[0].data.equals(skill)) {
  rmSync(temporary, { force: true });
  report({ ok: false, problems: ["Lo zip riletto non contiene esattamente la skill."] }, 1);
}
renameSync(temporary, OUT_FILE);
report(
  {
    ok: true,
    zip: relative(repoRoot, OUT_FILE),
    entries: entries.map((entry) => entry.path),
    sha256: createHash("sha256").update(zip).digest("hex"),
  },
  0,
);
