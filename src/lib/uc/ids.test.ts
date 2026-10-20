import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { UUID, isUuid } from "./ids.ts";

test("isUuid: the Postgres form, either case, nothing else", () => {
  assert.equal(isUuid("21c70e25-adc2-4bd3-aa34-b1faf737e176"), true);
  assert.equal(isUuid("21C70E25-ADC2-4BD3-AA34-B1FAF737E176"), true);
  assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), true);
  assert.equal(isUuid("21c70e25adc24bd3aa34b1faf737e176"), false, "no dashes");
  assert.equal(isUuid(" 21c70e25-adc2-4bd3-aa34-b1faf737e176"), false, "no spaces");
  assert.equal(isUuid("21c70e25-adc2-4bd3-aa34-b1faf737e17g"), false);
  assert.equal(isUuid("21c70e25-adc2-4bd3-aa34-b1faf737e176\n"), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(42), false);
  assert.equal(UUID.test("21c70e25-adc2-4bd3-aa34-b1faf737e176"), true);
});

// One UUID check for the dossier code (DESIGN §7.2): no module of the uc pages, components,
// actions or reads keeps its own copy. The files of the wave-3 test package (C13: uc-views,
// uc-shell, uc-cases, views/sql.ts, sql/*, template/*) move to ids.ts with it.
const root = new URL("../../../", import.meta.url).pathname;
const C13_FILES = new Set([
  "src/lib/db/queries/uc-views.ts",
  "src/lib/db/queries/uc-shell.ts",
  "src/lib/db/queries/uc-cases.ts",
  "src/lib/uc/views/sql.ts",
]);
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(relative(root, full));
  }
  return out;
}

test("no local copy of the UUID expression outside ids.ts", () => {
  const files = [
    ...walk(join(root, "src/lib/uc")).filter((f) => !f.startsWith("src/lib/uc/sql/") && !f.startsWith("src/lib/uc/template/")),
    ...walk(join(root, "src/components/uc")),
    ...walk(join(root, "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso")),
    ...walk(join(root, "src/lib/db/queries")).filter((f) => /\/uc-[^/]+\.ts$/.test(f)),
    ...walk(join(root, "src/lib/actions")).filter((f) => /\/uc-[^/]+\.ts$/.test(f)),
  ].filter((f) => f !== "src/lib/uc/ids.ts" && !C13_FILES.has(f));
  const copy = /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/;
  const offenders = files.filter((f) => copy.test(readFileSync(join(root, f), "utf8")));
  assert.deepEqual(offenders, []);
});
