import test from "node:test";
import assert from "node:assert/strict";
import { findForbidden } from "../views/copy-guard.ts";
import { bellContext, bellHref, bellText, toBellItem, toBellItems, type UcBellRow } from "./bell.ts";

// The Lateral Space bell (DESIGN §3.13.4): titles and links from counts and ids of the
// queue payload, the first line from the dossier and its parent use case read now,
// relative Italian dates and same-day answers grouped in one row.

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const CASE_2 = "44444444-4444-4444-8444-444444444444";
const ITEM = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-14T10:00:00Z");

const TEMPLATES = [
  "risposta_ricevuta",
  "dato_scaduto",
  "blocco_sciolto",
  "gate_pronto",
  "gate_approvato",
  "ls_lead_da_indicare",
  "owner_da_indicare",
  "delega",
  "riepilogo_settimanale",
  "qualcosa_di_nuovo",
] as const;

function row(over: Partial<UcBellRow> = {}): UcBellRow {
  return {
    id: ITEM,
    workspaceId: WS,
    caseId: CASE,
    templateKey: "gate_pronto",
    payload: {},
    createdAt: new Date("2026-10-14T07:00:00Z"),
    caseCode: "SR-UC-01",
    caseTitle: "Smistamento richieste",
    useCaseCode: "XX-0012",
    useCaseTitle: "Smistamento delle richieste",
    ...over,
  };
}

test("each bell template has the title and detail of the spec table", () => {
  assert.deepEqual(bellText("risposta_ricevuta", { item_keys: ["q.costi.01"] }, { answers: 12 }), {
    title: "12 nuove risposte da verificare",
    description: "Da verificare prima del via allo sviluppo.",
  });
  assert.equal(bellText("risposta_ricevuta", {}, { answers: 1 }).title, "1 nuova risposta da verificare");
  assert.equal(bellText("risposta_ricevuta", {}, { answers: 1250 }).title, "1.250 nuove risposte da verificare");
  assert.equal(bellText("risposta_ricevuta", {}).title, "Nuove risposte da verificare");
  assert.deepEqual(bellText("dato_scaduto", { item_keys: ["par.prezzo"] }), { title: "Un dato è scaduto", description: "Va verificato di nuovo." });
  assert.deepEqual(bellText("blocco_sciolto", { blocker_key: "a8", items: 8 }), { title: "Sbloccate 8 domande", description: "Controllale prima di inviarle." });
  assert.equal(bellText("blocco_sciolto", { items: 1 }).title, "Sbloccata 1 domanda");
  assert.equal(bellText("blocco_sciolto", {}).title, "Domande sbloccate");
  assert.deepEqual(bellText("gate_pronto", { gate: "G1" }), { title: "Via allo sviluppo proposto", description: "Manca la firma del cliente." });
  assert.deepEqual(bellText("gate_approvato", { version: 2 }), { title: "Via allo sviluppo approvato", description: "Il catalogo è pronto per lo sviluppo." });
  assert.deepEqual(bellText("ls_lead_da_indicare", {}), { title: "Il dossier non ha un responsabile", description: "Indicane uno in Impostazioni." });
  assert.deepEqual(bellText("owner_da_indicare", {}), { title: "Manca il responsabile del cliente", description: "Una richiesta è ferma dopo due promemoria." });
  assert.deepEqual(bellText("delega", { items: 3 }), { title: "Domande girate a un collega", description: "3 domande: approva la delega in Persone." });
  assert.equal(bellText("delega", { items: 1 }).description, "1 domanda: approva la delega in Persone.");
  assert.equal(bellText("delega", {}).description, "Approva la delega in Persone.");
  assert.deepEqual(bellText("riepilogo_settimanale", { week: "2026-W41" }), { title: "Il riepilogo della settimana", description: "Settimana 41" });
  assert.deepEqual(bellText("riepilogo_settimanale", { week: "2026-W05" }).description, "Settimana 5");
  assert.deepEqual(bellText("qualcosa_di_nuovo", { case_code: "UC-1" }), { title: "Novità sul dossier", description: null });
});

test("no text has keys, gate codes, ISO dates, the case code or the old section names", () => {
  const payloads = [
    {},
    { case_code: "SR-UC-01", item_keys: ["q.costi.01", "kpi.tempo.media"], blocker_key: "a8", gate: "G1", items: 4, version: 3, week: "2026-W41", item_id: ITEM },
    { case_code: "Mario Rossi", item_keys: ["valore segreto 123 €"], valore: "segreto", email: "a@b.test" },
  ];
  for (const key of TEMPLATES) {
    for (const payload of payloads) {
      const { title, description } = bellText(key, payload as never, { answers: 3 });
      for (const text of [title, description ?? ""]) {
        assert.deepEqual(findForbidden(text, "cliente"), [], `${key}: ${text}`);
        assert.doesNotMatch(text, /Casi d'uso|caso d'uso|Opportunit/i, `${key}: ${text}`);
        assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}/, `${key}: ${text}`);
        assert.doesNotMatch(text, /SR-UC-01|UC-1|Mario|segreto|@/, `${key}: ${text}`);
        assert.ok(!text.includes("<"));
      }
    }
  }
});

test("links go to the new dossier routes; the weekly summary to the Roadmap", () => {
  const base = `/dashboard/${WS}/casi-duso/${CASE}`;
  const href = (templateKey: string, payload: Record<string, string> = {}) => bellHref({ workspaceId: WS, caseId: CASE, templateKey, payload });
  assert.equal(href("risposta_ricevuta"), `${base}/domande?vista=da-verificare`);
  assert.equal(href("dato_scaduto", { item_id: ITEM }), `${base}/domande/${ITEM}`);
  assert.equal(href("dato_scaduto", { item_id: "../../x" }), `${base}/domande?vista=da-verificare`);
  assert.equal(href("blocco_sciolto"), `${base}/persone`);
  assert.equal(href("gate_pronto"), `${base}/via`);
  assert.equal(href("gate_approvato"), `${base}/via`);
  assert.equal(href("ls_lead_da_indicare"), `${base}/impostazioni`);
  assert.equal(href("owner_da_indicare"), `${base}/persone`);
  assert.equal(href("delega"), `${base}/persone`);
  assert.equal(href("qualcosa_di_nuovo"), base);
  assert.equal(bellHref({ workspaceId: WS, caseId: null, templateKey: "riepilogo_settimanale", payload: {} }), `/dashboard/${WS}/use-cases?vista=roadmap`);
  assert.equal(bellHref({ workspaceId: "altro", caseId: CASE, templateKey: "gate_pronto", payload: {} }), null);
  assert.equal(bellHref({ workspaceId: WS, caseId: "javascript:alert(1)", templateKey: "gate_pronto", payload: {} }), null);
  assert.equal(bellHref({ workspaceId: WS.toUpperCase(), caseId: CASE.toUpperCase(), templateKey: "gate_pronto", payload: {} }), `${base}/via`);
});

test("first line: code and title of the use case, else of the dossier; nothing for the weekly summary", () => {
  assert.equal(bellContext(row()), "XX-0012 · Smistamento delle richieste");
  // Without the parent use case: the dossier's own code and title.
  assert.equal(bellContext(row({ useCaseCode: null, useCaseTitle: null })), "SR-UC-01 · Smistamento richieste");
  // A parent without a code (branch without the column): the dossier code with the use case title.
  assert.equal(bellContext(row({ useCaseCode: null })), "SR-UC-01 · Smistamento delle richieste");
  // Nothing read (row of an old queue): the code of the payload, if valid.
  assert.equal(bellContext(row({ caseCode: null, caseTitle: null, useCaseCode: null, useCaseTitle: null, payload: { case_code: "SR-UC-01" } })), "SR-UC-01");
  assert.equal(bellContext(row({ caseCode: null, caseTitle: null, useCaseCode: null, useCaseTitle: null, payload: { case_code: "Mario Rossi" } })), null);
  assert.equal(bellContext(row({ caseId: null, templateKey: "riepilogo_settimanale" })), null);
});

test("a queue row becomes a serialisable bell item with an Italian relative date", () => {
  const item = toBellItem(row({ payload: { gate: "G1", case_code: "SR-UC-01" } }), NOW);
  assert.deepEqual(item, {
    id: ITEM,
    ids: [ITEM],
    workspaceId: WS,
    caseId: CASE,
    templateKey: "gate_pronto",
    createdAt: "2026-10-14T07:00:00.000Z",
    when: "3 ore fa",
    context: "XX-0012 · Smistamento delle richieste",
    title: "Via allo sviluppo proposto",
    description: "Manca la firma del cliente.",
    href: `/dashboard/${WS}/casi-duso/${CASE}/via`,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.equal(toBellItem(row({ createdAt: new Date("2026-10-13T07:00:00Z") }), NOW).when, "ieri");
  assert.equal(toBellItem(row({ createdAt: new Date("2026-10-02T07:00:00Z") }), NOW).when, "2 ott");
  assert.doesNotMatch(toBellItem(row(), NOW).when, /\d{4}-\d{2}-\d{2}|AM|PM/);
});

test("answers of the same dossier and the same day in Rome are one row with the count", () => {
  const answers = (id: string, at: string, over: Partial<UcBellRow> = {}): UcBellRow =>
    row({ id, templateKey: "risposta_ricevuta", payload: { item_keys: ["q.x.01"] }, createdAt: new Date(at), answers: 7, ...over });
  const items = toBellItems(
    [
      answers("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-14T09:00:00Z"),
      row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", createdAt: new Date("2026-10-14T08:30:00Z") }),
      answers("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-10-14T06:00:00Z"),
      // Another dossier, same day: its own row.
      answers("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "2026-10-14T05:00:00Z", { caseId: CASE_2, answers: 2 }),
      // 23:30 in Rome on the 13th (CEST, UTC+2): the day before, its own row.
      answers("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "2026-10-13T21:30:00Z", { answers: 1 }),
    ],
    NOW,
  );
  assert.deepEqual(
    items.map((i) => [i.id, i.ids.length, i.title]),
    [
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2, "7 nuove risposte da verificare"],
      ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1, "Via allo sviluppo proposto"],
      ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", 1, "2 nuove risposte da verificare"],
      ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", 1, "1 nuova risposta da verificare"],
    ],
  );
  assert.deepEqual(items[0].ids, ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  // Without a count read now, the number of grouped notifications.
  const fallback = toBellItems([answers("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-14T09:00:00Z", { answers: null }), answers("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-10-14T06:00:00Z", { answers: null })], NOW);
  assert.equal(fallback[0].title, "2 nuove risposte da verificare");
});
