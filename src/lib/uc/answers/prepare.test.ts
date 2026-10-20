import test from "node:test";
import assert from "node:assert/strict";
import { answerContext } from "./normalize.ts";
import { findingIssue, prepareAnswer, prepareUniversalAction } from "./prepare.ts";

const NOW = new Date("2026-10-07T10:00:00Z");
const send = answerContext(NOW, true);
const draft = answerContext(NOW, false);
const codes = (list: { code: string }[]) => list.map((i) => i.code);

test("a clean answer passes with its normalized value and no findings", () => {
  const r = prepareAnswer({ type: "durata", raw: "2:30", config: {}, ctx: send });
  assert.ok(r.ok);
  assert.deepEqual(r.normalized, { minutes: 150 });
  assert.deepEqual(r.findings, { blocking: [], warnings: [], truncated: false });
});

test("send: a health term in a free text field blocks the answer", () => {
  const r = prepareAnswer({ type: "testo", raw: "Serve la visita medica", config: {}, ctx: send });
  assert.ok(!r.ok);
  assert.equal(r.reason, "testo_bloccato");
  assert.deepEqual(codes(r.errors), ["testo_sanitario"]);
  assert.equal(r.errors[0].field, "text");
  assert.ok(!JSON.stringify(r.errors).includes("visita"));
});

test("send: names, contacts and notes beside the value are checked too", () => {
  const name = prepareAnswer({ type: "testo", raw: "Chiedere a Mario Rossi", config: {}, ctx: send });
  assert.ok(!name.ok && name.reason === "testo_bloccato" && name.errors[0].code === "testo_nome_persona");
  const note = prepareAnswer({ type: "numero", raw: "7", config: {}, ctx: send, extras: { note: "il cliente vuole solo hostess giovani" } });
  assert.ok(!note.ok);
  assert.deepEqual(
    note.errors.map((e) => [e.code, e.field]),
    [["testo_discriminatorio", "note"]],
  );
  const cell = prepareAnswer({ type: "tabella", raw: "Voce\tNote\nA\tcertificato medico\n", config: {}, ctx: send });
  assert.ok(!cell.ok);
  assert.equal(cell.errors[0].field, "rows[0][1]");
});

test("draft: health and discriminatory texts are not saved at all", () => {
  const r = prepareAnswer({ type: "testo", raw: "visita medica annuale", config: {}, ctx: draft });
  assert.ok(!r.ok);
  assert.equal(r.reason, "testo_bloccato");
  const d = prepareAnswer({ type: "testo", raw: "il cliente preferisce piloti donne", config: {}, ctx: draft });
  assert.ok(!d.ok && d.errors[0].code === "testo_discriminatorio");
});

test("draft: other findings are saved but must be fixed before sending", () => {
  const r = prepareAnswer({ type: "testo", raw: "Chiedere a Mario Rossi", config: {}, ctx: draft });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { text: "Chiedere a Mario Rossi" });
  assert.deepEqual(codes(r.errors), ["testo_nome_persona"]);
  const warn = prepareAnswer({ type: "testo", raw: "Chiedere a Mario", config: {}, ctx: send });
  assert.ok(warn.ok);
  assert.deepEqual(codes(warn.warnings), ["testo_nome_persona"]);
});

test("format errors: send rejects, draft keeps them with the value", () => {
  const sent = prepareAnswer({ type: "valuta", raw: "€ 1.200", config: {}, ctx: send });
  assert.ok(!sent.ok && sent.reason === "formato");
  assert.deepEqual(codes(sent.errors), ["iva_mancante", "per_mancante"]);
  const saved = prepareAnswer({ type: "valuta", raw: "€ 1.200", config: {}, ctx: draft });
  assert.ok(saved.ok);
  assert.deepEqual(codes(saved.errors), ["iva_mancante", "per_mancante"]);
  // Un formato sbagliato con un testo sanitario: si vedono entrambi.
  const both = prepareAnswer({ type: "numero", raw: "dopo la visita medica", config: {}, ctx: send });
  assert.ok(!both.ok);
  assert.deepEqual(codes(both.errors), ["numero_non_valido", "testo_sanitario"]);
});

test("health rule questions downgrade only the terms of the question", () => {
  const scan = { healthRuleQuestion: { questionText: "Quali dati sanitari escludete?" } };
  const ok = prepareAnswer({ type: "testo", raw: "Tutti i dati sanitari restano fuori", config: {}, ctx: send, scan });
  assert.ok(ok.ok);
  assert.deepEqual(codes(ok.warnings), ["testo_sanitario"]);
  const near = prepareAnswer({ type: "testo", raw: "I dati sanitari del pilota restano fuori", config: {}, ctx: send, scan });
  assert.ok(!near.ok);
});

test("partial, valid_from and text hash are kept", () => {
  const t = prepareAnswer({ type: "tabella", raw: "A\tB\nx\t1\n", config: { min_rows: 2 }, ctx: send });
  assert.ok(t.ok && t.partial === true);
  const v = prepareAnswer({ type: "valuta", raw: { amount: "5", vat: "inclusa", per: "volo", valid_from: "01/10/2026" }, config: {}, ctx: send });
  assert.ok(v.ok && v.validFrom === "2026-10-01");
  const c = prepareAnswer({ type: "conferma_regola", raw: { choice: "confermo" }, config: { proposed_text: "R" }, ctx: send });
  assert.ok(c.ok && typeof c.textHash === "string");
});

test("delegation: the colleague's name is allowed, health terms and other names are not", () => {
  const ok = prepareUniversalAction({
    action: "delega",
    raw: { nome: "Mario Rossi", email: "mario.rossi@esempio.it", voci: ["i1"], messaggio: "Puoi rispondere tu?" },
    activeItemIds: ["i1"],
  });
  assert.ok(ok.ok, JSON.stringify(ok.ok ? null : ok.errors));
  const health = prepareUniversalAction({
    action: "delega",
    raw: { nome: "Mario Rossi", email: "m@esempio.it", voci: ["i1"], messaggio: "è in malattia" },
    activeItemIds: ["i1"],
  });
  assert.ok(!health.ok && health.errors[0].field === "messaggio");
  const bad = prepareUniversalAction({ action: "delega", raw: { nome: "", email: "x", voci: [] }, activeItemIds: ["i1"] });
  assert.ok(!bad.ok && bad.reason === "formato");
});

test("«Non lo so» and «Non si applica» texts are scanned", () => {
  const who = prepareUniversalAction({ action: "non_so", raw: { who_might_know: "Mario Rossi" }, activeItemIds: [] });
  assert.ok(!who.ok && who.errors[0].field === "who_might_know");
  const role = prepareUniversalAction({ action: "non_so", raw: { who_might_know: "l'amministrazione" }, activeItemIds: [] });
  assert.ok(role.ok);
  const na = prepareUniversalAction({ action: "proposta_na", raw: { reason: "Non trattiamo dati sanitari dei passeggeri" }, activeItemIds: [] });
  assert.ok(!na.ok && na.reason === "testo_bloccato");
});

test("a payload that cannot be read entirely is refused (fail closed)", () => {
  let deep: unknown = "visita medica";
  for (let i = 0; i < 30; i++) deep = { x: deep };
  const r = prepareAnswer({ type: "collegamento_sistema", raw: { sistema: "S", oggetto: "O", accesso: "export" }, config: {}, ctx: send, extras: { note: deep } });
  assert.ok(!r.ok);
  assert.equal(r.reason, "testo_bloccato");
  assert.deepEqual(codes(r.errors), ["risposta_troppo_complessa"]);
  const action = prepareUniversalAction({ action: "non_so", raw: { who_might_know: "ruolo" }, activeItemIds: [], scan: {} });
  assert.ok(action.ok);
});

test("findingIssue gives a stable code and a message without the text", () => {
  assert.deepEqual(findingIssue({ category: "contatto", term: "email", start: 0, end: 5, path: "" }), {
    code: "testo_contatto",
    message: "Non scrivere email o numeri di telefono: indica il ruolo della persona.",
  });
});

test("draft: health text hidden in the keys of an unreadable payload is not saved", () => {
  // The type normalizer fails, so the draft would keep the raw payload, keys included.
  const r = prepareAnswer({ type: "testo", raw: { "visita medica del pilota": 1 }, config: {}, ctx: draft });
  assert.ok(!r.ok);
  assert.equal(r.reason, "testo_bloccato");
  assert.deepEqual(codes(r.errors), ["testo_sanitario"]);
  assert.ok(!JSON.stringify(r.errors).includes("visita"));
  const nested = prepareAnswer({ type: "numero", raw: { valore: { "solo hostess giovani, il cliente preferisce": "x" } }, config: {}, ctx: draft });
  assert.ok(!nested.ok && nested.reason === "testo_bloccato");
  // Ordinary keys of a typed value do not block.
  assert.ok(prepareAnswer({ type: "durata", raw: { amount: "90", unit: "min" }, config: {}, ctx: draft }).ok);
});
