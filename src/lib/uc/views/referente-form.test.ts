import test from "node:test";
import assert from "node:assert/strict";
import { answerContext, normalizeAnswer } from "../answers/normalize.ts";
import type { ResponseConfig } from "../answers/types.ts";
import { referentCapabilities, type ReferentItemView } from "../public-view.ts";
import type { Json } from "../types.ts";
import type { ResponseType } from "../vocab.ts";
import {
  answerBody,
  answerSummary,
  batchEntry,
  chunkBatch,
  draftKind,
  intentAction,
  isReadyToSend,
  NO_EXCEPTIONS,
  prepareDelegation,
  sendsInBatch,
  SOURCE_CHIP_TYPES,
  SOURCE_CHIPS,
  toggleSource,
  valueSummary,
  approvalBody,
  checkDelegate,
  checkSubmit,
  decodeDeviceDraft,
  deviceDraftKey,
  draftBody,
  draftHardBlock,
  durationUnitChoice,
  emptyValue,
  encodeDeviceDraft,
  fieldIssues,
  formFromDraft,
  gridFromPaste,
  gridFromRows,
  initialForm,
  intervalUnitChoice,
  isBlankForm,
  isRetryableStatus,
  minutesText,
  numberUnitChoice,
  parseApiResponse,
  questionsText,
  retryDelayMs,
  tableTemplateCsv,
  toRaw,
  valueFrom,
  type ReferentForm,
} from "./referente-form.ts";

const NOW = new Date("2026-10-12T10:00:00Z");
const ITEM = "66666666-6666-4666-8666-666666666666";
const ANSWER = "88888888-8888-4888-8888-888888888888";
const FILE = "12345678-1234-4234-8234-123456789abc";
const TOKEN = "ucr_ABCDEFGHabcdefgh0123456789_-xyZ";

function item(type: ResponseType | null, config: ResponseConfig = {}, over: Partial<ReferentItemView> = {}): ReferentItemView {
  const can = referentCapabilities({
    status: over.status ?? "chiesta",
    requestItemState: over.requestItemState ?? "da_fare",
    assignedToMe: true,
    privacyClass: over.personal ? "personale" : "riservato_azienda",
    personalZoneOpen: over.personal === true,
    writable: true,
    delegationDepth: 0,
  });
  return {
    id: ITEM,
    key: "q.servizio.01",
    title: "Quante richieste arrivano al mese?",
    explanation: null,
    why: null,
    example: null,
    help: null,
    attachmentHint: null,
    responseType: type,
    config: config as Record<string, Json>,
    status: "chiesta",
    statusReason: null,
    requestItemState: "da_fare",
    label: "Da rispondere",
    tone: "da_fare",
    done: false,
    personal: false,
    requiresValidFrom: type === "valuta",
    healthRuleQuestion: false,
    currentAnswerId: null,
    toConfirm: null,
    ownAnswer: null,
    clarification: null,
    draft: null,
    files: [],
    can,
    ...over,
  };
}

function withValue(i: ReferentItemView, value: Json, over: Partial<ReferentForm> = {}): ReferentForm {
  return { ...initialForm(i), value, ...over };
}

/** L'uscita di `toRaw` passa la normalizzazione stretta del server. */
function strictOk(type: ResponseType, config: ResponseConfig, value: Json, files: string[] = []) {
  const raw = toRaw(type, config, value, files);
  assert.notEqual(raw, null, `${type}: valore vuoto`);
  const n = normalizeAnswer(type, raw, config, answerContext(NOW, true, { usableFileIds: files, proposedText: "Regola proposta" }));
  assert.equal(n.ok, true, `${type}: ${JSON.stringify(n.ok ? null : n.errors)}`);
  return n;
}

test("ogni tipo: l'input compilato arriva al normalizzatore in una forma che accetta", () => {
  strictOk("numero", { unit: "metri" }, { value: "1.200", unit: "ft" });
  strictOk("numero", { unit: "richieste al mese", integer: true }, { value: "350", unit: "" });
  strictOk("valuta", { currency: "EUR", per: "ora" }, { amount: "1.200,50", currency: "EUR", vat: "esclusa", per: "ora", fx: { rate_to_eur: "", date: "", source: "" } });
  strictOk("valuta", {}, { amount: "300", currency: "CHF", vat: "inclusa", per: "notte", fx: { rate_to_eur: "1,05", date: "2026-10-01", source: "BCE" } });
  strictOk("percentuale", { base: "delle richieste" }, { value: "12,5", base: "delle richieste" });
  strictOk("durata", { unit: "ore" }, { amount: "1,5", unit: "h" });
  const compound = strictOk("durata", {}, { amount: "2:30", unit: "" });
  assert.deepEqual(compound.ok && compound.normalized, { minutes: 150 });
  strictOk("data", { max_date: "today" }, "2026-09-30");
  strictOk("data_ora", { tz: "Europe/Rome" }, { date: "2026-09-30", time: "23:30", tz: "Europe/Rome" });
  const night = strictOk("intervallo", { kind: "ora" }, { from: "22:00", to: "06:00", unit: "" });
  assert.equal(night.ok && (night.value as { crosses_midnight: boolean }).crosses_midnight, true);
  strictOk("intervallo", {}, { from: "10", to: "20", unit: "" });
  strictOk("si_no", {}, { value: false });
  strictOk("scelta", { options: ["ogni giorno", "ogni settimana"] }, { option: "ogni settimana", other_text: "" });
  strictOk("scelta_multipla", { options: ["canale", "priorità", "codice cliente"] }, { options: ["canale", "priorità"], other_text: "" });
  strictOk("testo", {}, { text: "Le richieste arrivano soprattutto la mattina." });
  strictOk("codice", { pattern: "^[A-Z]{3}$" }, { code: "abc" });
  strictOk("tabella", { columns: [{ key: "canale", label: "Canale", type: "testo" }, { key: "su_100", label: "Su 100", type: "numero" }] }, {
    columns: [{ key: "canale", label: "Canale" }, { key: "su_100", label: "Su 100" }],
    rows: [["Email", "30"], ["Telefono", "70"], ["", ""]],
  });
  strictOk("file", {}, { file_ids: [] }, [FILE]);
  strictOk("conferma_regola", { ask_exceptions: true }, { choice: "confermo", text: "", exceptions: "nessuna" });
  strictOk("conferma_regola", {}, { choice: "correggo", text: "Vale solo nei giorni feriali.", exceptions: "" });
  strictOk("conferma_formula", {}, { choice: "confermo", formula: "" });
  strictOk("collegamento_sistema", {}, { sistema: "Gestionale", oggetto: "Ordini", campo: "", accesso: "export", chi_ha_accesso: "", frequenza: "ogni giorno" });
  strictOk("caso_prova", {}, { richiesta: "Richiesta d'esempio", atteso: "Tre proposte", regole: "rule.servizio.01, rule.servizio.02", tipo: "sintetico" });
  strictOk("conferma_valore", { base_type: "numero", base_config: { unit: "kg" } }, { choice: "correggo", value: { value: "12", unit: "kg" } });
});

test("input vuoti: niente da salvare né da inviare", () => {
  const types: ResponseType[] = ["numero", "valuta", "percentuale", "durata", "data", "data_ora", "intervallo", "si_no", "scelta", "scelta_multipla", "testo", "codice", "tabella", "file", "conferma_regola", "conferma_formula", "collegamento_sistema", "caso_prova"];
  for (const type of types) assert.equal(toRaw(type, {}, emptyValue(type, {})), null, type);
  const i = item("testo");
  assert.equal(isBlankForm(i, initialForm(i)), true);
  assert.equal(isBlankForm(i, { ...initialForm(i), note: "ciao" }), false);
});

test("valori canonici e bozze tornano negli input senza perdere nulla", () => {
  const cases: [ResponseType, ResponseConfig, unknown][] = [
    ["numero", { unit: "metri" }, "1.200 ft"],
    ["valuta", {}, { amount: "2.000", currency: "EUR", vat: "esclusa", per: "volo" }],
    ["percentuale", {}, { value: "10", base: "del venduto" }],
    ["durata", {}, "90 min"],
    ["data_ora", {}, "30/09/2026 23:30"],
    ["intervallo", { kind: "ora" }, "23:30–05:30"],
    ["scelta_multipla", { options: ["a", "b", "c"] }, { options: ["a", "c"] }],
    ["tabella", {}, "Aereo\tCosto orario\nAAA\t1.200\nBBB\t2.400"],
  ];
  for (const [type, config, input] of cases) {
    const first = normalizeAnswer(type, input, config, answerContext(NOW, true));
    assert.equal(first.ok, true, type);
    if (!first.ok) continue;
    const again = normalizeAnswer(type, toRaw(type, config, valueFrom(type, config, first.value)), config, answerContext(NOW, true));
    assert.equal(again.ok, true, `${type}: ${JSON.stringify(again.ok ? null : again.errors)}`);
    assert.deepEqual(again.ok && again.normalized, first.normalized, type);
  }
  assert.deepEqual(valueFrom("data_ora", {}, { local: "2026-09-30T23:30", tz: "Europe/Rome" }), { date: "2026-09-30", time: "23:30", tz: "Europe/Rome" });
  assert.deepEqual(valueFrom("numero", { unit: "metri" }, { value: 1200.5, unit: "piedi" }), { value: "1200,5", unit: "ft" });
});

test("unità degli input: fissa con le unità della stessa grandezza, alternative, etichetta", () => {
  const meters = numberUnitChoice({ unit: "metri" });
  assert.equal(meters.mode, "fissa");
  assert.equal(meters.defaultCode, "m");
  assert.ok(meters.options.some((o) => o.code === "ft"));
  assert.equal(numberUnitChoice({ unit: "ore o giorni" }).mode, "scelta");
  assert.equal(numberUnitChoice({ unit: "passeggeri" }).mode, "etichetta");
  assert.equal(durationUnitChoice({ unit: "ore" }).defaultCode, "h");
  assert.equal(durationUnitChoice({}).defaultCode, "");
  // Intervalli: l'unità proposta è già nel valore, così quella mostrata è quella inviata.
  assert.equal(intervalUnitChoice({ kind: "ora" }), null);
  assert.deepEqual(emptyValue("intervallo", { unit: "ore" }), { from: "", to: "", unit: "h" });
  assert.deepEqual(toRaw("intervallo", { unit: "ore" }, { from: "2", to: "4", unit: "h" }), { from: "2", to: "4", unit: "h", kind: "durata" });
  assert.equal(toRaw("intervallo", { unit: "ore" }, emptyValue("intervallo", { unit: "ore" })), null);
  assert.deepEqual(valueFrom("intervallo", { unit: "ore" }, { from: "1", to: "3" }), { from: "1", to: "3", unit: "h" });
  const n = normalizeAnswer("intervallo", toRaw("intervallo", { unit: "ore" }, { from: "1,5", to: "3", unit: "h" }), { unit: "ore" }, answerContext(NOW, true));
  assert.equal(n.ok, true);
});

test("modulo iniziale: bozza, poi valore già noto da ritipizzare, poi l'ultima risposta su una voce validata", () => {
  const draft = { v: 1, kind: "correzione", payload: { value: "42" }, note: "Dal gestionale", estimate: true, source_basis: "sistema", valid_from: "2026-01-01", partial: false };
  const fromDraft = initialForm(item("numero", {}, { draft }));
  assert.equal(fromDraft.confirmMode, "correzione");
  assert.deepEqual(fromDraft.value, { value: "42", unit: "" });
  assert.equal(fromDraft.estimate, true);
  assert.equal(fromDraft.sourceBasis, "sistema");
  assert.equal(fromDraft.validFrom, "2026-01-01");
  assert.equal(formFromDraft(item("numero"), { v: 2 }), null);

  const prose = item("valuta", {}, {
    currentAnswerId: ANSWER,
    toConfirm: { answerId: ANSWER, value: null, display: "circa 2.000 €", sourceLabel: "dichiarato in call · fonte F001", declaredInCall: true, canConfirm: false, prefill: { amount: 2000, currency: "EUR", vat: null, per: null }, missing: [] },
  });
  const typed = initialForm(prose);
  assert.equal(typed.confirmMode, "conferma");
  assert.equal((typed.value as { amount: string }).amount, "2000");

  const ok = initialForm(item("testo", {}, { toConfirm: { answerId: ANSWER, value: null, display: "Sì", sourceLabel: "dichiarato in call", declaredInCall: true, canConfirm: true, prefill: null, missing: [] } }));
  assert.equal(ok.confirmMode, null);

  const validated = item("numero", {}, {
    status: "validata",
    requestItemState: "inviata",
    ownAnswer: { kind: "valore", version: 2, display: "12", value: { value: 12, unit: null }, estimate: true, encrypted: false },
  });
  assert.equal(validated.can.newVersionOnly, true);
  const again = initialForm(validated);
  assert.deepEqual(again.value, { value: "12", unit: "" });
  assert.equal(again.estimate, true);
});

test("bozza: solo i campi dello schema dell'API, senza testi vuoti", () => {
  const i = item("numero");
  const body = draftBody(i, withValue(i, { value: "12", unit: "" }, { note: "  ", validFrom: "2026-02-01", estimate: true }));
  assert.deepEqual(body, { kind: "valore", payload: { value: "12" }, estimate: true, valid_from: "2026-02-01" });
  const allowed = new Set(["kind", "payload", "note", "confidence", "estimate", "source_basis", "valid_from", "partial", "who_might_know", "reason", "decided"]);
  const full = draftBody(i, withValue(i, { value: "1" }, { note: "n", sourceBasis: "calcolo", partial: true, whoMightKnow: "il magazzino", naReason: "motivo lungo abbastanza" }));
  for (const k of Object.keys(full)) assert.ok(allowed.has(k), k);
  assert.match(String(full.valid_from ?? ""), /^[0-9./-]{0,10}$/);
});

test("invio: conferma con un clic, correzione, «Non lo so», «Non si applica», parziale", () => {
  const confirmable = item("testo", {}, {
    currentAnswerId: ANSWER,
    toConfirm: { answerId: ANSWER, value: null, display: "Sì", sourceLabel: "dichiarato in call", declaredInCall: true, canConfirm: true, prefill: null, missing: [] },
  });
  const form = initialForm(confirmable);
  assert.deepEqual(answerBody(confirmable, form, "confermo"), { kind: "conferma", supersedes_answer_id: ANSWER });
  assert.equal(checkSubmit(confirmable, form, "confermo", [], NOW).ok, true);

  // «Confermo» su una voce che chiede da quando vale: la data parte con la conferma.
  const dated = { ...confirmable, requiresValidFrom: true };
  const undated = checkSubmit(dated, form, "confermo", [], NOW);
  assert.deepEqual(fieldIssues(undated.errors, "valid_from").map((e) => e.code), ["valido_dal_mancante"]);
  assert.equal(checkSubmit(dated, { ...form, validFrom: "2026-01-01" }, "confermo", [], NOW).ok, true);
  assert.deepEqual(answerBody(dated, { ...form, validFrom: "2026-01-01" }, "confermo"), { kind: "conferma", supersedes_answer_id: ANSWER, valid_from: "2026-01-01" });

  const corrected = answerBody(confirmable, { ...form, confirmMode: "correzione", value: { text: "No, solo d'estate." } }, "invia");
  assert.deepEqual(corrected, { kind: "correzione", supersedes_answer_id: ANSWER, payload: { text: "No, solo d'estate." } });

  const i = item("numero");
  const nonSo = answerBody(i, { ...initialForm(i), whoMightKnow: "l'ufficio acquisti", value: { value: "3" } }, "non_so");
  assert.deepEqual(nonSo, { kind: "non_so", who_might_know: "l'ufficio acquisti" });
  // «Non lo so» è una risposta valida, non un errore.
  const check = checkSubmit(i, initialForm(i), "non_so", [], NOW);
  assert.equal(check.ok, true);
  assert.deepEqual(check.errors, []);

  const na = checkSubmit(i, { ...initialForm(i), naReason: "corto" }, "non_si_applica", [], NOW);
  assert.equal(na.ok, false);
  assert.equal(na.errors[0].field, "reason");
  assert.deepEqual(answerBody(i, { ...initialForm(i), naReason: "Non vendiamo questo servizio." }, "non_si_applica"), { kind: "proposta_na", reason: "Non vendiamo questo servizio." });

  const partial = answerBody(i, withValue(i, { value: "3" }, { partial: true }), "invia");
  assert.equal(partial.partial, true);
  const validated = item("numero", {}, { status: "validata", requestItemState: "inviata" });
  assert.equal(answerBody(validated, withValue(validated, { value: "3" }, { partial: true }), "invia").partial, undefined);
});

test("controllo prima dell'invio: formato, dati sanitari, valido dal, chiarimento", () => {
  const n = item("numero", { unit: "metri" });
  const wrong = checkSubmit(n, withValue(n, { value: "tanti", unit: "m" }), "invia", [], NOW);
  assert.equal(wrong.ok, false);
  assert.ok(fieldIssues(wrong.errors, "value").length > 0);

  const t = item("testo");
  const health = checkSubmit(t, withValue(t, { text: "Serve la visita medica del pilota." }), "invia", [], NOW);
  assert.equal(health.ok, false);
  assert.ok(health.errors.some((e) => e.code === "testo_sanitario"));

  const v = item("valuta", { per: "ora", currency: "EUR" });
  const money = withValue(v, { amount: "100", currency: "EUR", vat: "esclusa", per: "ora", fx: {} });
  const noDate = checkSubmit(v, money, "invia", [], NOW);
  assert.equal(noDate.ok, false);
  assert.deepEqual(fieldIssues(noDate.errors, "valid_from").map((e) => e.code), ["valido_dal_mancante"]);
  assert.equal(checkSubmit(v, { ...money, validFrom: "2026-01-01" }, "invia", [], NOW).ok, true);

  const asked = item("testo", {}, { clarification: "Vale anche nel weekend?" });
  const reply = withValue(asked, { text: "Sì." });
  assert.equal(checkSubmit(asked, reply, "invia", [], NOW).errors[0]?.code, "chiarimento_mancante");
  assert.equal(checkSubmit(asked, { ...reply, note: "Sì, anche sabato." }, "invia", [], NOW).ok, true);
  assert.equal(answerBody(asked, { ...reply, note: "Sì" }, "invia").kind, "risposta_chiarimento");

  const f = item("file");
  assert.equal(checkSubmit(f, initialForm(f), "invia", [], NOW).ok, false);
  assert.equal(checkSubmit(f, initialForm(f), "invia", [FILE], NOW).ok, true);
  assert.deepEqual(answerBody(f, initialForm(f), "invia", [FILE]), { kind: "valore", payload: { file_ids: [FILE] }, file_ids: [FILE] });
});

test("voci personali: niente nota inviata e nessuna copia sul dispositivo", () => {
  const p = item("testo", {}, { personal: true });
  assert.equal(answerBody(p, withValue(p, { text: "x" }, { note: "nota" }), "invia").note, undefined);
  assert.equal(encodeDeviceDraft(p, initialForm(p), NOW), null);
  assert.equal(decodeDeviceDraft(p, JSON.stringify({ v: 1, savedAt: NOW.toISOString(), form: {} }), NOW), null);
});

test("copia sul dispositivo: chiave col solo prefisso del link, versione e scadenza", () => {
  assert.equal(deviceDraftKey(TOKEN, ITEM), `uc-draft:${TOKEN.slice(0, 12)}:${ITEM}`);
  assert.ok(!deviceDraftKey(TOKEN, ITEM).includes(TOKEN));
  const i = item("numero");
  const form = withValue(i, { value: "7", unit: "" }, { note: "da verificare", confirmMode: "correzione" });
  const text = encodeDeviceDraft(i, form, NOW);
  const back = decodeDeviceDraft(i, text, new Date(NOW.getTime() + 60_000));
  assert.deepEqual(back, form);
  assert.equal(decodeDeviceDraft(i, text, new Date(NOW.getTime() + 31 * 24 * 3600_000)), null);
  assert.equal(decodeDeviceDraft(i, JSON.stringify({ v: 9, savedAt: NOW.toISOString(), form }), NOW), null);
  assert.equal(decodeDeviceDraft(i, "{non json", NOW), null);
});

test("salvataggio automatico: attese tra i tentativi", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelayMs), [2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(isRetryableStatus(0), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(409), false);
  assert.equal(isRetryableStatus(422), false);
});

test("risposte delle API: dati, errore uniforme con i campi, rete assente", () => {
  assert.deepEqual(parseApiResponse(200, { ok: true, data: { saved: true } }), { ok: true, data: { saved: true } });
  const err = parseApiResponse(422, { ok: false, error: "risposta_non_valida", message: "Controlla la risposta.", issues: [{ code: "x", message: "Scrivi un numero.", field: "value" }, { bad: 1 }] });
  assert.equal(err.ok, false);
  if (!err.ok) {
    assert.equal(err.code, "risposta_non_valida");
    assert.deepEqual(err.issues, [{ code: "x", message: "Scrivi un numero.", field: "value" }]);
  }
  const net = parseApiResponse(0, null);
  assert.equal(!net.ok && net.code, "rete");
  const odd = parseApiResponse(500, "<html>");
  assert.equal(!odd.ok && odd.message.length > 0, true);
});

test("tabella incollata da Excel: TAB, celle tra virgolette, modello CSV", () => {
  const config: ResponseConfig = { columns: [{ key: "canale", label: "Canale", type: "testo" }, { key: "su_100", label: "Su 100", type: "numero" }] };
  const pasted = gridFromPaste('Canale\tSu 100\r\n"Email\tsito"\t30\r\nTelefono\t70\r\n', config);
  assert.deepEqual(pasted.errors, []);
  assert.deepEqual(pasted.grid?.columns.map((c) => c.label), ["Canale", "Su 100"]);
  assert.deepEqual(pasted.grid?.rows, [["Email\tsito", "30"], ["Telefono", "70"]]);
  const doubled = gridFromPaste("Canale\tSu 100\nEmail\t30\nEmail\t70", config);
  assert.ok(doubled.errors.length > 0);
  assert.equal(tableTemplateCsv(config), '﻿"Canale";"Su 100"\r\n');
  assert.equal(tableTemplateCsv({}), null);
  // Una colonna dello schema che comincia come una formula resta testo nel foglio.
  assert.equal(tableTemplateCsv({ columns: [{ key: "f", label: "=SOMMA(A1)", type: "testo" }] }), "﻿\"'=SOMMA(A1)\"\r\n");
});

test("«Carica un Excel»: le righe del file diventano la tabella, una risposta pronta dopo «Avanti»", () => {
  const config: ResponseConfig = { columns: [{ key: "canale", label: "Canale", type: "testo" }, { key: "su_100", label: "Su 100", type: "numero" }], min_rows: 3 };
  // Righe come le legge il server da un .xlsx: intestazione, celle vuote in coda, una riga vuota in mezzo.
  const read = gridFromRows([["Canale", "Su 100", ""], ["posta", "60", ""], ["", "", ""], ["sportello", "30"], ["altro", "10"]], config);
  assert.deepEqual(read.errors, []);
  assert.deepEqual(read.grid?.columns.map((c) => c.key), ["canale", "su_100"]);
  assert.deepEqual(read.grid?.rows, [["posta", "60"], ["sportello", "30"], ["altro", "10"]]);
  const i = item("tabella", config);
  const form = { ...initialForm(i), value: read.grid as unknown as Json };
  assert.equal(isReadyToSend(i, form, [FILE], NOW), false, "riempita dal file, aspetta la decisione");
  assert.equal(isReadyToSend(i, { ...form, intent: "risposta" }, [FILE], NOW), true, "dopo «Avanti» è pronta");
  assert.equal(answerSummary(i, { ...form, intent: "risposta" }, [FILE]), "3 righe");
  assert.equal(gridFromRows([], config).grid, null);
  assert.ok(gridFromRows([["Canale", "Su 100"]], config).errors.length > 0, "solo i titoli: niente righe");
});

test("delega e firme: corpi delle chiamate e controlli", () => {
  assert.equal(checkDelegate({ nome: "Collega", email: "collega@cliente.test", messaggio: "", voci: [ITEM] }, [ITEM]).ok, true);
  const bad = checkDelegate({ nome: "", email: "non-email", messaggio: "", voci: [] }, [ITEM]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.field === "email"));
  const hash = "a".repeat(64);
  assert.deepEqual(approvalBody({ kind: "na", targetId: ITEM, textHash: hash }, "approvo", "ignorato"), { kind: "na", target_id: ITEM, decision: "approvo", read: true, text_hash: hash });
  assert.equal(approvalBody({ kind: "gate", targetId: ITEM, textHash: hash }, "non_approvo", " Manca la prova scritta. ").reason, "Manca la prova scritta.");
});

test("testi dell'intestazione: domande e tempo", () => {
  assert.equal(questionsText(1), "1 domanda");
  assert.equal(questionsText(8), "8 domande");
  assert.equal(questionsText(1_200), "1.200 domande");
  assert.equal(minutesText(25), "circa 25 minuti");
  assert.equal(minutesText(90), "circa 1 ora e 30 minuti");
  assert.equal(minutesText(0), "");
});

test("bozza con dati sanitari o preferenze discriminatorie: non si salva, il messaggio non ripete il testo", () => {
  const t = item("testo");
  const health = draftHardBlock(t, draftBody(t, withValue(t, { text: "Allegato il certificato medico" })));
  assert.equal(health?.code, "testo_sanitario");
  assert.ok(!health?.message.includes("certificato"));
  assert.equal(health?.field, "text");
  const note = draftHardBlock(t, draftBody(t, withValue(t, { text: "ok" }, { note: "Preferiscono solo piloti giovani" })));
  assert.equal(note?.code, "testo_discriminatorio");
  assert.equal(draftHardBlock(t, draftBody(t, withValue(t, { text: "Le richieste arrivano la mattina." }))), null);
  // Un nome di persona non ferma la bozza: si segnala all'invio.
  assert.equal(draftHardBlock(t, draftBody(t, withValue(t, { text: "Chiedere a Mario Rossi" }))), null);
});

const CONFIRMABLE: Partial<ReferentItemView> = {
  currentAnswerId: ANSWER,
  toConfirm: { answerId: ANSWER, value: { value: 1200 }, display: "1.200 richieste al mese", sourceLabel: "In una call con Lateral Space", declaredInCall: true, canConfirm: true, prefill: null, missing: [] },
};

test("intento: ogni decisione si salva in bozza e torna uguale dalla bozza (DESIGN §4.2)", () => {
  const i = item("numero", {}, CONFIRMABLE);
  const base = initialForm(i);
  assert.equal(base.intent, null, "nessuna decisione finché il referente non risponde");
  // «È così» con un tocco: conferma senza valore.
  const yes = draftBody(i, { ...base, intent: "conferma", value: { value: "3", unit: "" } });
  assert.deepEqual(yes, { kind: "conferma", decided: true });
  assert.equal(formFromDraft(i, { v: 1, ...yes })?.intent, "conferma");
  // «Non lo so» e «Non si applica»: il tipo della bozza dice la decisione.
  const nonSo = draftBody(i, { ...base, intent: "non_so", whoMightKnow: "il magazzino" });
  assert.deepEqual([nonSo.kind, nonSo.who_might_know], ["non_so", "il magazzino"]);
  assert.equal(formFromDraft(i, { v: 1, ...nonSo })?.intent, "non_so");
  const na = draftBody(i, { ...base, intent: "non_si_applica", naReason: "Non vendiamo questo servizio." });
  assert.equal(na.kind, "proposta_na");
  assert.equal(formFromDraft(i, { v: 1, ...na })?.intent, "non_si_applica");
  // La risposta scritta (anche la correzione del valore già noto).
  const fix = draftBody(i, { ...base, intent: "risposta", confirmMode: "correzione", value: { value: "1300", unit: "" } });
  assert.equal(fix.kind, "correzione");
  const restored = formFromDraft(i, { v: 1, ...fix });
  assert.deepEqual([restored?.intent, restored?.confirmMode], ["risposta", "correzione"]);
  assert.equal(formFromDraft(item("numero"), { v: 1, kind: "valore" })?.intent, null, "una bozza senza valore non è una decisione");
  // Un valore scritto e salvato da solo, senza «Avanti»: resta una bozza, non una risposta pronta.
  const typed = draftBody(i, { ...base, value: { value: "3", unit: "" } });
  assert.deepEqual(typed, { kind: "valore", payload: { value: "3" } });
  const reloaded = formFromDraft(i, { v: 1, ...typed });
  assert.deepEqual([reloaded?.intent, reloaded?.value], [null, { value: "3", unit: "" }]);
  assert.equal(isReadyToSend(i, reloaded!, [], NOW), false, "dopo il ricaricamento non è pronta");
  // Lo stesso per «Correggi» e per il valore riscritto nel formato giusto, finché non si decide.
  const fixing = formFromDraft(i, { v: 1, ...draftBody(i, { ...base, confirmMode: "correzione", value: { value: "1300", unit: "" } }) });
  assert.deepEqual([fixing?.intent, fixing?.confirmMode], [null, "correzione"]);
  assert.equal(formFromDraft(i, { v: 1, kind: "conferma", payload: { value: "3" } })?.intent, null);
  assert.equal(formFromDraft(i, { v: 1, kind: "conferma", payload: { value: "3" }, decided: true })?.intent, "risposta");
  assert.equal(intentAction("risposta"), "invia");
  assert.equal(intentAction("conferma"), "confermo");
  assert.equal(draftKind(item("testo", {}, { clarification: "Anche il sabato?" }), { intent: "risposta", confirmMode: null }), "risposta_chiarimento");
  // Sul telefono la copia della bozza tiene anche l'intento.
  const device = encodeDeviceDraft(i, { ...base, intent: "non_so" }, NOW);
  assert.equal(decodeDeviceDraft(i, device, NOW)?.intent, "non_so");
});

test("pronte da inviare: decisione presa e valida; mai dati personali, chiarimenti o nuove versioni", () => {
  const i = item("numero", {}, CONFIRMABLE);
  assert.equal(isReadyToSend(i, initialForm(i), [], NOW), false, "senza decisione");
  assert.equal(isReadyToSend(i, { ...initialForm(i), intent: "conferma" }, [], NOW), true);
  assert.equal(isReadyToSend(i, { ...initialForm(i), intent: "non_so" }, [], NOW), true);
  assert.equal(isReadyToSend(i, { ...initialForm(i), intent: "non_si_applica", naReason: "corto" }, [], NOW), false, "il motivo è troppo corto");
  assert.equal(isReadyToSend(i, { ...initialForm(i), intent: "risposta", value: { value: "tanti", unit: "" } }, [], NOW), false);
  assert.equal(isReadyToSend(i, { ...initialForm(i), intent: "risposta", confirmMode: "correzione", value: { value: "1300", unit: "" } }, [], NOW), true);
  const plain = item("numero");
  assert.equal(isReadyToSend(plain, { ...initialForm(plain), intent: "conferma" }, [], NOW), false, "niente da confermare");
  const personal = item("testo", {}, { personal: true });
  assert.equal(sendsInBatch(personal), false);
  assert.equal(isReadyToSend(personal, withValue(personal, { text: "turno A" }, { intent: "risposta" }), [], NOW), false, "i dati personali partono subito, mai a gruppi");
  const asked = item("testo", {}, { clarification: "Anche il sabato?" });
  assert.equal(sendsInBatch(asked), false);
  const validated = item("numero", {}, { status: "validata", requestItemState: "inviata" });
  assert.equal(sendsInBatch(validated), false);
  assert.equal(sendsInBatch(plain), true);
});

test("invio a gruppi: corpo con l'id della domanda, 50 per chiamata, sotto il limite di byte", () => {
  const i = item("numero", {}, CONFIRMABLE);
  assert.deepEqual(batchEntry(i, { ...initialForm(i), intent: "conferma" }), { item_id: ITEM, kind: "conferma", supersedes_answer_id: ANSWER });
  assert.deepEqual(batchEntry(i, { ...initialForm(i), intent: "non_so" }), { item_id: ITEM, kind: "non_so", supersedes_answer_id: ANSWER });
  const sixty = Array.from({ length: 60 }, (_, n) => ({ item_id: String(n) }));
  assert.deepEqual(chunkBatch(sixty).map((c) => c.length), [50, 10]);
  assert.deepEqual(chunkBatch([]), []);
  const big = Array.from({ length: 5 }, () => ({ text: "x".repeat(500) }));
  assert.deepEqual(chunkBatch(big, 50, 1200).map((c) => c.length), [2, 2, 1], "anche a byte");
  assert.deepEqual(chunkBatch([{ text: "x".repeat(5000) }], 50, 1200).map((c) => c.length), [1], "una risposta sola passa comunque");
  // Byte UTF-8 come li conta il server: 300 «è» sono 600 byte, non 300 caratteri.
  const accented = Array.from({ length: 4 }, () => ({ text: "è".repeat(300) }));
  assert.deepEqual(chunkBatch(accented, 50, 1300).map((c) => c.length), [2, 2]);
  const emoji = Array.from({ length: 3 }, () => ({ text: "📦".repeat(200) }));
  assert.deepEqual(chunkBatch(emoji, 50, 1600).map((c) => c.length), [1, 1, 1], "un'emoji sono 4 byte");
  // Nessun invio supera il limite in byte.
  const mixed = Array.from({ length: 40 }, (_, n) => ({ item_id: String(n), text: "àèìòù€".repeat(20 + n) }));
  for (const chunk of chunkBatch(mixed, 50, 5000)) assert.ok(new TextEncoder().encode(JSON.stringify({ answers: chunk })).length <= 5000);
});

test("riepilogo: ogni riga in parole («Confermato: …», «Non si applica: …», «(stima)», «Non lo so · forse …»)", () => {
  const i = item("numero", { unit: "richieste al mese" }, CONFIRMABLE);
  assert.equal(answerSummary(i, { ...initialForm(i), intent: "conferma" }), "Confermato: 1.200 richieste al mese");
  assert.equal(answerSummary(i, { ...initialForm(i), intent: "non_so", whoMightKnow: "l'amministrazione" }), "Non lo so · forse l'amministrazione");
  assert.equal(answerSummary(i, { ...initialForm(i), intent: "non_so" }), "Non lo so");
  assert.equal(answerSummary(i, { ...initialForm(i), intent: "non_si_applica", naReason: "Non vendiamo questo servizio." }), "Non si applica: Non vendiamo questo servizio.");
  assert.equal(answerSummary(i, { ...initialForm(i), intent: "risposta", value: { value: "1.300", unit: "" }, estimate: true }), "1.300 richieste al mese (stima)");
  const t = item("tabella", { columns: [{ key: "a", label: "A" }] });
  assert.equal(answerSummary(t, withValue(t, { columns: [{ key: "a", label: "A" }], rows: [["x"], ["y"], [""], ["z"], ["w"]] }, { intent: "risposta" })), "4 righe");
  assert.equal(valueSummary("si_no", {}, { value: true }), "Sì");
  assert.equal(valueSummary("scelta", { options: ["ogni giorno", "ogni mese"] }, { option: "ogni mese", other_text: "" }), "ogni mese");
  assert.equal(valueSummary("data", {}, "2026-11-12"), "12 novembre 2026");
  assert.equal(valueSummary("valuta", {}, { amount: "32,50", currency: "EUR", vat: "esclusa", per: "ora", fx: {} }), "32,50 EUR a ora");
  assert.equal(valueSummary("conferma_regola", { ask_exceptions: true }, { choice: "confermo", text: "", exceptions: "" }), "È così");
  assert.equal(valueSummary("testo", {}, { text: "" }), null);
});

test("regola confermata con «È così»: le eccezioni si registrano come «nessuna segnalata»", () => {
  assert.deepEqual(toRaw("conferma_regola", { ask_exceptions: true }, { choice: "confermo", text: "", exceptions: "" }), { choice: "confermo", exceptions: NO_EXCEPTIONS });
  assert.deepEqual(toRaw("conferma_regola", { ask_exceptions: true }, { choice: "confermo", text: "", exceptions: "solo festivi" }), { choice: "confermo", exceptions: "solo festivi" });
  assert.deepEqual(toRaw("conferma_regola", {}, { choice: "confermo", text: "", exceptions: "" }), { choice: "confermo" });
  strictOk("conferma_regola", { ask_exceptions: true }, { choice: "confermo", text: "", exceptions: "" });
});

test("delega di cento e più domande: un id che somiglia a un telefono non la ferma (P0-13)", () => {
  // Un UUID con «333 123456789» in fondo: la scansione dei testi lo scambierebbe per un numero di cellulare.
  const phoneLike = "00000000-0000-4000-8000-333123456789";
  const many = [phoneLike, ...Array.from({ length: 120 }, (_, n) => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`)];
  const raw = { nome: "Anna Bianchi", email: "anna@cliente.test", voci: many };
  const r = prepareDelegation(raw, many);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.errors));
  assert.deepEqual(r.ok && (r.value as { voci: string[] }).voci, many, "the real ids come back, in order");
  assert.equal(checkDelegate({ nome: "Anna Bianchi", email: "anna@cliente.test", messaggio: "", voci: many }, many).ok, true);
  // The other rules still hold: names, emails and messages are scanned, unknown ids are refused.
  const unknown = prepareDelegation({ ...raw, voci: [phoneLike, "99999999-0000-4000-8000-000000000000"] }, [phoneLike]);
  assert.ok(!unknown.ok && unknown.errors.some((e) => e.code === "voce_non_delegabile" && e.field === "voci[1]"));
  const health = prepareDelegation({ ...raw, messaggio: "Chiedi dopo la visita medica" }, many);
  assert.equal(health.ok, false);
});

test("«Da dove viene?»: solo sui numeri e sulle date; «A memoria» vale come stima", () => {
  assert.ok(SOURCE_CHIP_TYPES.includes("numero") && SOURCE_CHIP_TYPES.includes("data_ora"));
  assert.ok(!SOURCE_CHIP_TYPES.includes("testo") && !SOURCE_CHIP_TYPES.includes("tabella"));
  assert.deepEqual(SOURCE_CHIPS.map((c) => c.label), ["Sistema", "Documento", "Calcolo", "A memoria"]);
  const i = item("numero");
  const memory = toggleSource(initialForm(i), "stima_a_memoria");
  assert.deepEqual([memory.sourceBasis, memory.estimate], ["stima_a_memoria", true]);
  const off = toggleSource(memory, "stima_a_memoria");
  assert.deepEqual([off.sourceBasis, off.estimate], [null, false]);
  const system = toggleSource(memory, "sistema");
  assert.deepEqual([system.sourceBasis, system.estimate], ["sistema", true], "la stima scelta resta finché il referente non la toglie");
});
