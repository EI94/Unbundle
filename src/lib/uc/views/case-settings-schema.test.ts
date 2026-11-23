import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEMA_BLOCKERS_SHOWN, SCHEMA_CHANGE_TEXT as S, schemaBlockReasons, schemaBlockersShown } from "./case-settings.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import { MAP_EMPTY } from "./map.ts";
import { RULES_EMPTY } from "./model.ts";

// R3 of docs/dossier/SCHEMA-DI-PARTENZA.md: «Cambia schema di partenza…» in Impostazioni › «La realizzazione», only in
// «Bozza» and for whoever edits the settings today; blocked questions are listed; R1: map and rules «Da disegnare».

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const SETTINGS = "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/impostazioni/";

function allTexts(): string[] {
  const out: string[] = [];
  for (const value of Object.values(S)) {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") out.push((value as (n: number) => string)(1), (value as (n: number) => string)(3), (value as (n: number) => string)(1234));
    else out.push(...Object.values(value as Record<string, string>));
  }
  return out;
}

test("the schema-change texts say «realizzazione» and «use case», never «caso», and no jargon", () => {
  const texts = allTexts();
  assert.ok(texts.length > 20);
  for (const t of texts) assert.doesNotMatch(t, /\bcaso\b/i, `«${t}»`);
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  assert.equal(S.open, "Cambia schema di partenza…");
  assert.equal(S.same, "È già lo schema di partenza.");
  assert.match(S.rebuilt, /domande, regole, mappa ed entità/);
  assert.match(S.kept, /codice, nome, persone, Progetto dell'agente, pacchetti, compiti, collegamento al repository e storico/);
});

test("the blocked line counts in Italian and every reason is plain", () => {
  assert.equal(S.blockedLine(1), "Non si può cambiare: 1 domanda ha già risposte, file, richieste o assegnazioni.");
  assert.equal(S.blockedLine(1234), "Non si può cambiare: 1.234 domande hanno già risposte, file, richieste o assegnazioni.");
  assert.equal(S.blockedMore(1), "e un'altra");
  assert.equal(S.blockedMore(5), "e altre 5");
  assert.equal(schemaBlockReasons(["risposte", "file", "risposte"]), "ha risposte, ha file");
  assert.equal(schemaBlockReasons(["richieste", "assegnazione", "commenti"]), "è in una richiesta al referente, è assegnata, ha commenti");
});

test("the dialog lists at most 20 blocking questions, then «e altre N»", () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ itemId: String(i) }));
  const { shown, more } = schemaBlockersShown(rows);
  assert.equal(SCHEMA_BLOCKERS_SHOWN, 20);
  assert.equal(shown.length, 20);
  assert.equal(more, 3);
  assert.deepEqual(schemaBlockersShown(rows.slice(0, 2)), { shown: rows.slice(0, 2), more: 0 });
});

test("the page offers the change only in «Bozza» and only when it can write; the form opens an outline button", () => {
  const page = strip(read(`${SETTINGS}page.tsx`));
  assert.match(page, /const schemaChange = editable && current === "bozza" \? await loadSchemaChange\(/);
  assert.equal(page.match(/<ChangeStartingSchema\b/g)?.length, 1);
  assert.match(page, /\{SCHEMA_CHANGE_TEXT\.label\}: <\/span>\s*\{settings\.templateName\}/, "the starting schema is always in view");
  const forms = strip(read(`${SETTINGS}settings-forms.tsx`));
  assert.match(forms, /<Button variant="outline" className="min-h-11 sm:min-h-8" onClick=\{\(\) => setOpen\(true\)\}>\s*\{S\.open\}/);
  assert.match(forms, /\{blocked && <p className="text-sm text-muted-foreground">\{S\.blockedLine\(blockers\.length\)\}<\/p>\}/, "blocked is visible without opening the dialog");
  assert.doesNotMatch(forms, /window\.(confirm|prompt|alert)/);
});

test("the action checks the same role as the other settings and goes through reschemaCase", () => {
  const action = strip(read("src/lib/actions/uc-reschema.ts"));
  const cases = strip(read("src/lib/actions/uc-cases.ts"));
  assert.match(cases, /updateCaseSettingsAction[\s\S]*?onCase\(\{ session, access \}, workspaceId, caseId, \["ls_lead"\]/);
  assert.match(action, /openUcCase\(\{ session, access, workspaceId, caseId, allow: \["ls_lead"\] \}\)/);
  assert.match(action, /await reschemaCase\(opened\.value\.executor, \{ workspaceId, caseId, actorUserId: opened\.value\.caseAccess\.user\.userId, to \}\)/);
  // Nothing changed, nothing to revalidate.
  assert.match(action, /if \(!result\.value\.changed\) return \{ ok: true, data: \{ changed: false \}, message: T\.unchanged \};\s*finishUcCommand\(/);
});

test("(R1) map and rules without content read «Da disegnare», from the text modules", () => {
  assert.equal(MAP_EMPTY.title, "Da disegnare");
  assert.equal(RULES_EMPTY.title, "Da disegnare");
  assert.match(MAP_EMPTY.hint, /Progetto dell'agente/);
  assert.match(RULES_EMPTY.hint, /Progetto dell'agente/);
  const map = strip(read("src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/mappa/page.tsx"));
  const rules = strip(read("src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/regole/page.tsx"));
  assert.match(map, /title=\{MAP_EMPTY\.title\}/);
  assert.doesNotMatch(map, /non ha ancora una mappa/);
  assert.equal(rules.match(/RULES_EMPTY\.title/g)?.length, 2);
  assert.doesNotMatch(rules, /non ha regole/);
});

test("«Cambia schema di partenza»: above 50 questions the dialog asks the wizard's question before changing", async () => {
  const { schemaChangeLargeConfirm } = await import("./case-settings.ts");
  assert.equal(schemaChangeLargeConfirm(null), null);
  assert.equal(schemaChangeLargeConfirm({ questions: 50 }), null, "50 or fewer: no extra question");
  const ask = schemaChangeLargeConfirm({ questions: 2812 });
  assert.ok(ask);
  assert.equal(ask.title, "Questo schema porta 2.812 domande: è quello giusto per questo caso?");
  assert.ok(ask.confirm.length > 0 && ask.cancel.length > 0);
  // The dialog uses it: the first click on «Cambia schema» asks, the second (the confirm label) changes.
  const source = strip(read(`${SETTINGS}settings-forms.tsx`));
  assert.match(source, /schemaChangeLargeConfirm\(chosen\)/);
  assert.match(source, /if \(large && !asking\) \{\s*setAsking\(true\);\s*return;/);
  assert.match(source, /asking && large \? large\.confirm : S\.confirm/);
});
