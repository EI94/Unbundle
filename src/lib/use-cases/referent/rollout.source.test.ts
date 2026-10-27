import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Il rilascio di «Chiedi al referente» senza la 0024 applicata a mano (revisione prima del rilascio):
// il resto dell'app non si ferma, e le scritture di «Cosa serve» non nominano tabelle che non ci sono.
// Controllo sul sorgente: il comportamento sul database lo provano le suite di integrazione.

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

test("«Cosa serve» si scrive anche senza le tabelle della 0024: la sincronizzazione si salta", () => {
  const source = read("src/lib/use-cases/needs-service.ts");
  assert.match(source, /async function infoSyncAvailable\(\): Promise<boolean> \{/);
  assert.match(source, /db\.execute\(sql\.raw\(INFO_SYNC_TABLES_PRESENT_SQL\)\)/);
  const sql = read("src/lib/use-cases/referent/sql.ts");
  const probe = /export const INFO_SYNC_TABLES_PRESENT_SQL = `([^`]*)`;/.exec(sql)?.[1] ?? "";
  for (const table of ["use_case_info_state", "use_case_notifications", "use_case_referent_requests"]) {
    assert.ok(probe.includes(`to_regclass('public.${table}') IS NOT NULL`), table);
  }
  const start = source.indexOf("async function executeWithInfoSync(");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const gate = body.indexOf("!(await infoSyncAvailable())");
  const sync = body.indexOf("infoCompleteSyncStatements(cards)");
  assert.ok(gate > 0 && sync > gate, "prima la sonda, poi la sincronizzazione");
});

test("le porte di invio vogliono anche le risposte dal link (UC_SECRET su Vercel)", () => {
  const referents = read("src/lib/db/queries/use-case-referents.ts");
  const start = referents.indexOf("async function deliveryGates(");
  const gates = referents.slice(start, referents.indexOf("\n}\n", start));
  assert.match(gates, /if \(!referentPublicWritesAvailable\(env\)\) return rfail\("risposte_non_attive"\);/);
  assert.match(referents, /gates\.push\(\{ code: "risposte_non_attive", message: T\.gates\.publicWritesOff \}\)/);
  assert.match(referents, /const deliveryBlocked = !ack \|\| !emailOk \|\| !publicWritesOn;/);
  const dispatch = read("src/lib/db/queries/use-case-referent-dispatch.ts");
  assert.match(dispatch, /publicWritesOn: referentPublicWritesAvailable\(env\),/);
});
