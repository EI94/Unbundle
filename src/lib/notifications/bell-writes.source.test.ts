import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// La lettura dei segnali è per persona (SPEC §P2.4): nessun file dell'applicazione mette più
// `weekly_signals.is_read = true` per una persona sola. Lo fa solo il riepilogo settimanale per le
// righe vecchie (`use-case-digest.ts`, `retireOlder`: «letto per tutti»). E nessun file di
// produzione passa `clock:` ai costruttori delle notifiche (l'orologio è quello del database).

const root = fileURLToPath(new URL("../../..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) {
      out.push(relative(root, path));
    }
  }
  return out;
}

const files = sources(join(root, "src")).sort();
const IS_READ_WRITE = /set\s+is_read\s*=\s*true|\.set\(\s*\{\s*isRead:\s*true/i;
const BUILDERS = /\b(notifyReviewersSql|notifyExpiredRequestsSql|infoCompleteSyncStatements)\s*\(\s*\{[^}]*\bclock\s*:/;

test("nessuno scrive weekly_signals.is_read = true, tranne il riepilogo settimanale", () => {
  const found = files.filter((file) => IS_READ_WRITE.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(found, ["src/lib/db/queries/use-case-digest.ts"]);
});

test("il controllo trova le scritture vietate (e non lo stato del client)", () => {
  assert.ok(IS_READ_WRITE.test("await db.update(weeklySignals).set({ isRead: true })"));
  assert.ok(IS_READ_WRITE.test("UPDATE weekly_signals SET is_read = true WHERE id = $1"));
  assert.equal(IS_READ_WRITE.test("setSignals((prev) => prev.map((s) => ({ ...s, isRead: true })))"), false);
});

test("nessun file di produzione passa clock: ai costruttori delle notifiche", () => {
  const found = files.filter((file) => BUILDERS.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(found, []);
  assert.ok(BUILDERS.test("notifyReviewersSql({ workspaceId, kind: 'risposte', actorUserId: null, clock: fixed })"));
});

test("portfolio.ts non esporta più markSignalReadAction", () => {
  const source = readFileSync(join(root, "src/lib/actions/portfolio.ts"), "utf8");
  assert.doesNotMatch(source, /markSignalReadAction|markSignalRead\b/);
  const signals = readFileSync(join(root, "src/lib/db/queries/signals.ts"), "utf8");
  assert.doesNotMatch(signals, /export async function (markSignalRead|markAllVisibleSignalsRead)\b/);
});
