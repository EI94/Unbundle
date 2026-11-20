import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CASE_STATUSES } from "../vocab.ts";
import { SETTINGS_TEXT, statusActionLabel, statusConfirmLabel, statusDialogTitle, statusDoneText, statusHint } from "./case-settings.ts";
import { findForbiddenIn } from "./copy-guard.ts";

// Rilascio 10, §3.5 (Impostazioni): tre sezioni, «La realizzazione» · «Pausa» · «Zona pericolosa» (Revoca i link ·
// Chiudi la realizzazione, una volta sola); il titolo è un H2; a schermo «realizzazione», mai «caso».

const PAGE = new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/impostazioni/page.tsx", import.meta.url);
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("tre sezioni nell'ordine, il titolo è un H2, la vecchia ancora #stato porta a «Pausa»", () => {
  const page = strip(readFileSync(PAGE, "utf8"));
  assert.doesNotMatch(page, /<h1\b|PAGE_TITLE_CLASS/, "un solo H1, quello della testata");
  assert.match(page, /<h2 className="text-base font-semibold">\{T\.title\}<\/h2>/);
  const order = ['id="realizzazione"', 'id="pausa"', 'id="stato"', 'id="zona-pericolosa"'];
  let last = -1;
  for (const needle of order) {
    const at = page.indexOf(needle);
    assert.ok(at > last, `${needle} manca o è fuori ordine`);
    last = at;
  }
  // Gli account sono in Persone, le leve in Valore: qui non ci sono più.
  assert.doesNotMatch(page, /MembersPanel|ScopeLeversForm|LeverIcons|SettingsSection/);
  // La chiusura una volta sola, nella zona pericolosa (Ondata 0).
  assert.equal(page.match(/<CaseStatusControl /g)?.length, 2, "uno per «Pausa», uno per la chiusura");
  assert.match(page, /const closeOption = transitions\.danger\.map\(option\);/);
  // Codice e schema in «Dettagli tecnici».
  assert.match(page, /<TechDetails[^>]*>\s*<p>\{T\.code\(settings\.displayCode\)\}<\/p>\s*<p>\{T\.template\(/);
});

test("i pulsanti, i dialoghi e gli avvisi dicono «realizzazione», mai «caso»", () => {
  const texts: string[] = [...Object.values(SETTINGS_TEXT).flatMap((v) => (typeof v === "string" ? [v] : [(v as (...a: string[]) => string)("XX-0012", "1.0")]))];
  for (const from of CASE_STATUSES) {
    for (const to of CASE_STATUSES) texts.push(statusActionLabel(from, to), statusDialogTitle(from, to), statusConfirmLabel(from, to), statusHint(from, to));
  }
  texts.push(statusDoneText("In pausa"));
  for (const t of texts) assert.doesNotMatch(t, /\bcaso\b/i, `«${t}»`);
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  assert.equal(statusActionLabel("raccolta", "chiuso"), "Chiudi la realizzazione…");
  assert.equal(statusActionLabel("sospeso", "raccolta"), "Riprendi");
  assert.equal(SETTINGS_TEXT.revoke, "Revoca i link…");
  const words = [SETTINGS_TEXT.title, SETTINGS_TEXT.realization, SETTINGS_TEXT.pause, SETTINGS_TEXT.danger, SETTINGS_TEXT.dangerNote].join(" ").split(/\s+/).length;
  assert.ok(words <= 20, `le intestazioni restano corte: ${words} parole`);
});

test("il controllo dello stato prende i testi dal modulo, con la conferma in una finestra dell'app", () => {
  const control = readFileSync(new URL("../../../components/uc/shell/case-status-control.tsx", import.meta.url), "utf8");
  assert.match(control, /from "@\/lib\/uc\/views\/case-settings"/);
  assert.doesNotMatch(control, /window\.(confirm|prompt|alert)/);
  assert.doesNotMatch(strip(control), /il caso|Il caso/);
});
