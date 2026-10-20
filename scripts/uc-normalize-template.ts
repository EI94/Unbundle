#!/usr/bin/env node
/**
 * Normalizza un template grezzo nel formato canonico `unbundle.uc-template/1`
 * (PIANO §4.2) e stampa il report delle trasformazioni (solo chiavi e conteggi).
 *
 *   node --no-warnings scripts/uc-normalize-template.ts --in <grezzo.json>
 *        [--out templates/uc/<key>/<version>.json] [--role-aliases <file>] [--public] [--report <file>]
 *
 * - Nessun accesso al database. Senza `--out` stampa solo il report.
 * - L'uscita è deterministica e passa sempre dalla validazione stretta: se non è
 *   valida non si scrive niente e lo script esce con 1.
 * - Default `confidential: true` (testi del cliente): l'uscita si scrive solo in
 *   un percorso ignorato da git. `--public` solo per template con testi inventati.
 * - Alias dei ruoli (area → chiave di ruolo del template): `--role-aliases`,
 *   oppure `role-aliases.json` accanto all'uscita, se c'è.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeTemplate } from "../src/lib/uc/template/normalize.ts";
import { checkTemplatePath, planSummary, planTemplateLoad } from "../src/lib/uc/template/load.ts";
import { duplicateJsonKeys } from "../src/lib/uc/template/schema.ts";

const MAX_RAW_BYTES = 16 * 1024 * 1024;

function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ status: "ERROR", code, message, ...extra }, null, 2));
  process.exit(1);
}

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith("--") || values.has(key)) fail("opzioni", `Opzione non valida o ripetuta: ${key}`);
  values.set(key, args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
}
const KNOWN = new Set(["--in", "--out", "--role-aliases", "--public", "--report"]);
for (const key of values.keys()) if (!KNOWN.has(key)) fail("opzioni", `Opzione sconosciuta: ${key}`);
const option = (key: string): string | null => {
  const v = values.get(`--${key}`);
  if (v === undefined) return null;
  if (v === "true") fail("opzioni", `Manca il valore di --${key}`);
  return v;
};

const inPath = option("in");
if (!inPath) fail("opzioni", "Indica il template grezzo con --in <file>.");
const outPath = option("out");
const reportPath = option("report");
const isPublic = values.get("--public") === "true";

function readText(path: string, limit: number): string {
  try {
    if (statSync(path).size > limit) fail("file_troppo_grande", "Il file supera il limite di dimensione.");
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error) fail("file_non_leggibile", `Non riesco a leggere ${path} (${String(error.code)}).`);
    throw error;
  }
}

const rawText = readText(inPath, MAX_RAW_BYTES);
let raw: unknown;
try {
  raw = JSON.parse(rawText);
} catch {
  fail("json_non_valido", "Il template grezzo non è un JSON valido.");
}
const duplicates = duplicateJsonKeys(rawText, 5);
if (duplicates.length) fail("json_chiavi_ripetute", "Chiavi ripetute nello stesso oggetto.", { paths: duplicates });

// Alias dei ruoli.
let aliasesPath = option("role-aliases");
if (!aliasesPath && outPath) {
  const candidate = resolve(dirname(outPath), "role-aliases.json");
  if (existsSync(candidate)) aliasesPath = candidate;
}
let roleAliases: Record<string, string> = {};
if (aliasesPath) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(aliasesPath, 64 * 1024));
  } catch {
    fail("alias_non_validi", "Il file degli alias dei ruoli non è un JSON valido.");
  }
  const valid =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.entries(parsed).every(([k, v]) => /^[a-z0-9_]{1,80}$/.test(k) && typeof v === "string" && /^[a-z0-9_]{1,80}$/.test(v));
  if (!valid) fail("alias_non_validi", "Il file degli alias dei ruoli deve essere un oggetto { area: chiave_ruolo }.");
  roleAliases = parsed as Record<string, string>;
}

/**
 * Un file con contenuti del cliente (template o report con le sue chiavi) non
 * deve finire in git: il percorso deve essere ignorato (0) oppure fuori da un
 * repository (128). 1 = tracciabile.
 */
function assertNotTrackable(path: string): void {
  const check = spawnSync("git", ["check-ignore", "-q", resolve(path)], { cwd: dirname(resolve(path)), encoding: "utf8" });
  if (check.error || (check.status !== 0 && check.status !== 128)) {
    fail("percorso_non_ignorato", `Contenuti del cliente: scrivi ${path} solo in un percorso ignorato da git (vedi templates/uc/.gitignore).`);
  }
}

const result = normalizeTemplate(raw, { roleAliases, confidential: !isPublic });
if (!result.ok) fail(result.code, result.message);
const outputText = `${JSON.stringify(result.template, null, 2)}\n`;

// Stessa validazione e stessa impronta del loader (la riserva si indica solo al caricamento).
const planned = planTemplateLoad(outputText, { purpose: "inspect" });
if (!planned.ok) {
  fail(planned.code, planned.message, { errors: planned.errors.slice(0, 50), report: result.report });
}
const summary = planSummary(planned.plan);

// Controlli dei percorsi prima di scrivere qualsiasi cosa.
if (outPath) {
  const pathError = checkTemplatePath(outPath, planned.plan.key, planned.plan.version);
  if (pathError) fail("percorso_non_valido", pathError);
}
const targets = [outPath, reportPath].filter((p): p is string => p !== null);
for (const target of targets) {
  mkdirSync(dirname(resolve(target)), { recursive: true });
  if (!isPublic) assertNotTrackable(target);
}
const mode = isPublic ? 0o644 : 0o600;
if (outPath) writeFileSync(outPath, outputText, { encoding: "utf8", mode });
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, { encoding: "utf8", mode });

const output = {
  status: outPath ? "NORMALIZED" : "REPORT_ONLY_NOTHING_WRITTEN",
  out: outPath,
  role_aliases_file: aliasesPath ? "usato" : "nessuno",
  summary,
  report: reportPath ? `scritto in ${reportPath}` : result.report,
};
console.log(JSON.stringify(output, null, 2));
