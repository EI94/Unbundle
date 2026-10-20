import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A Server Component that calls a function exported by a "use client" module
 * throws at render time: in the server layer every export of a client module
 * is a stub ("Attempted to call … from the server"). Components can cross the
 * boundary, plain functions cannot: the rules belong in a pure module
 * (`src/lib/uc/views/*`). This test reads the dossier's server files and fails
 * on a value import (lowercase name, not `type`) from a client module.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCANNED = ["src/app/(dashboard)/dashboard/[workspaceId]/casi-duso", "src/components/uc"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function isClientModule(source: string): boolean {
  return /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/.test(source);
}

function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = join(ROOT, "src", spec.slice(2));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** `{ a, b as c, type T }` → the imported value names (`a`, `b`). */
function valueNames(list: string): string[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !s.startsWith("type "))
    .map((s) => s.split(/\s+as\s+/)[0]);
}

function clientFunctionImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  if (isClientModule(source)) return [];
  const found: string[] = [];
  for (const m of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const target = resolveAlias(m[3]);
    if (!target || !isClientModule(readFileSync(target, "utf8"))) continue;
    for (const name of valueNames(m[2])) if (/^[a-z]/.test(name)) found.push(`${m[3]} › ${name}`);
  }
  return found;
}

test("server files of the dossier call no function exported by a client module", () => {
  const problems: string[] = [];
  let scanned = 0;
  for (const dir of SCANNED) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      scanned += 1;
      for (const hit of clientFunctionImports(file)) problems.push(`${relative(ROOT, file)}: ${hit}`);
    }
  }
  assert.ok(scanned > 50, `only ${scanned} files scanned: wrong root?`);
  assert.deepEqual(problems, []);
});
