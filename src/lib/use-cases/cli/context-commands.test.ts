// I tre comandi del contesto nella CLI (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.5): i corpi di `nota` e `impara`, i
// testi delle risposte, gli esiti di «Contesto» tradotti in risposte della CLI. Dati inventati, nessun nome vero.
import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_ASK_TIMEOUT_MS } from "../../ai/models.ts";
import { CONTEXT_LIMITS, CONTEXT_SECTIONS } from "../../context/vocab.ts";
import { AGENT_CONTEXT_TEXT } from "../../context/work/agent-text.ts";
import type { AskSource } from "../../db/queries/context-ask.ts";
import {
  askLimitFailure,
  askResponse,
  askTimeoutMs,
  CLI_ASK_BUDGET_MS,
  CLI_NOTE_BODY_BYTES,
  cliContextFailure,
  learnLimitFailure,
  learnRecord,
  learnResponse,
  noteLinks,
  noteResponse,
  parseLearnBody,
  parseNoteBody,
  retryAfterHeader,
} from "./context-commands.ts";
import { CLI_CASE_NOT_FOUND, CLI_CONTEXT_UNAVAILABLE } from "./case-errors.ts";

const MAX = CONTEXT_LIMITS.cliNoteMaxBytes;
const TODAY = "2026-11-18";

test("nota: 600 KB di testo passano; un byte in più è 413 con la frase di §2.5; i byte, non i caratteri", () => {
  assert.equal(MAX, 600 * 1024);
  const exact = parseNoteBody({ titolo: "Call di avvio", testo: "a".repeat(MAX) }, TODAY);
  assert.ok(exact.ok);
  const over = parseNoteBody({ titolo: "Call di avvio", testo: "a".repeat(MAX + 1) }, TODAY);
  assert.deepEqual(over, { ok: false, failure: { status: 413, code: "troppo_grande", message: AGENT_CONTEXT_TEXT.note.tooBig, headers: {} } });
  // «è» pesa due byte: metà dei caratteri bastano per superare il limite.
  assert.equal(parseNoteBody({ titolo: "Call", testo: "è".repeat(MAX / 2) }, TODAY).ok, true);
  assert.equal(parseNoteBody({ titolo: "Call", testo: "è".repeat(MAX / 2 + 1) }, TODAY).ok, false);
});

test("nota: il corpo JSON può pesare più del testo (a capo, virgolette, barre si scrivono doppi): il limite del corpo lo regge", () => {
  // Il caso peggiore normale: un testo di 600 KB fatto tutto di a capo e virgolette pesa il doppio nel JSON.
  const worst = JSON.stringify({ titolo: "t".repeat(200), data: TODAY, testo: '\n"\\\t'.repeat(MAX / 4), conChi: "c".repeat(500), link: `https://esempio.test/${"l".repeat(470)}` });
  assert.ok(Buffer.byteLength(worst, "utf8") <= CLI_NOTE_BODY_BYTES, `${Buffer.byteLength(worst, "utf8")} > ${CLI_NOTE_BODY_BYTES}`);
  assert.ok(CLI_NOTE_BODY_BYTES < 4 * 1024 * 1024, "sotto il limite di una funzione Vercel");
});

test("nota: un PDF o un testo con caratteri nulli non è testo (422, la stessa frase); i campi nella forma di addContextNote", () => {
  for (const testo of ["%PDF-1.7\n…", "﻿%PDF-1.4", "Appunti\u0000con un nulla"]) {
    const r = parseNoteBody({ titolo: "Verbale", testo }, TODAY);
    assert.deepEqual(r, { ok: false, failure: { status: 422, code: "non_testo", message: AGENT_CONTEXT_TEXT.note.tooBig, headers: {} } }, JSON.stringify(testo.slice(0, 12)));
  }
  const full = parseNoteBody({ titolo: "Call di avvio", data: "2026-11-14", testo: "Il gestionale esporta in CSV.", conChi: "Responsabile amministrativo", link: "https://esempio.test/call" }, TODAY);
  assert.deepEqual(full, {
    ok: true,
    value: { title: "Call di avvio", occurredOn: "2026-11-14", body: "Il gestionale esporta in CSV.", participants: "Responsabile amministrativo", link: "https://esempio.test/call" },
  });
  // Senza data: oggi. I facoltativi mancano (mai null dalla CLI), e restano null. Un tipo sbagliato arriva vuoto: lo ferma addContextNote.
  assert.deepEqual(parseNoteBody({ titolo: "Solo il titolo", testo: "Riga sola." }, TODAY), { ok: true, value: { title: "Solo il titolo", occurredOn: TODAY, body: "Riga sola.", participants: null, link: null } });
  const wrong = parseNoteBody({ titolo: 42, data: 20261114, testo: ["x"] }, TODAY);
  assert.ok(wrong.ok);
  if (wrong.ok) assert.deepEqual([wrong.value.title, wrong.value.occurredOn, wrong.value.body], ["", "", ""]);
});

test("nota: le risposte di §2.5 con il link giusto; senza l'ok niente «li leggo adesso»", () => {
  const origin = "https://app.esempio.test/";
  const links = noteLinks(origin, "ws-1", "fonte-1");
  assert.deepEqual(links, { proposals: "https://app.esempio.test/dashboard/ws-1/contesto/conferma?fonte=fonte-1", source: "https://app.esempio.test/dashboard/ws-1/contesto?vista=appunti&fonte=fonte-1" });
  assert.deepEqual(noteResponse({ fonte: "fonte-1", nuova: true }, { consent: true, origin, workspaceId: "ws-1" }), {
    testo: `Appunti salvati: li leggo adesso. Le proposte arrivano in «Da confermare»: ${links.proposals}`,
    dati: { fonte: "fonte-1", nuova: true, link: links.proposals },
  });
  assert.deepEqual(noteResponse({ fonte: "fonte-1", nuova: true }, { consent: false, origin, workspaceId: "ws-1" }), {
    testo: "Appunti salvati. Per leggerli con l'AI serve l'ok del cliente ai fornitori: si registra da Unbundle.",
    dati: { fonte: "fonte-1", nuova: true, link: links.source },
  });
  for (const consent of [true, false]) {
    assert.deepEqual(noteResponse({ fonte: "fonte-1", nuova: false }, { consent, origin, workspaceId: "ws-1" }), {
      testo: `Questi appunti ci sono già: ${links.source}`,
      dati: { fonte: "fonte-1", nuova: false, link: links.source },
    });
  }
});

test("impara: senza `confermato: true` 400 `conferma` con la frase del sì; una sezione sconosciuta 400 con l'elenco", () => {
  for (const confermato of [undefined, false, "true", 1, null]) {
    assert.deepEqual(parseLearnBody({ caso: "XX-0012", testo: "Il gestionale esporta in CSV.", confermato }), {
      ok: false,
      failure: { status: 400, code: "conferma", message: "Serve il sì della persona: chiedilo, poi ripeti con --si.", headers: {} },
    });
  }
  for (const sezione of ["colori", "", 3, "sistemi; DROP"]) {
    const r = parseLearnBody({ caso: "XX-0012", testo: "Il gestionale esporta in CSV.", sezione, confermato: true });
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.failure.status, 400);
      assert.equal(r.failure.code, "sezione");
      assert.equal(r.failure.message, `Sezione sconosciuta: una tra ${CONTEXT_SECTIONS.join(", ")}.`);
      for (const section of CONTEXT_SECTIONS) assert.ok(r.failure.message.includes(section), section);
    }
  }
  assert.deepEqual(parseLearnBody({ caso: "XX-0012", testo: "Il gestionale esporta in CSV.", sezione: " Regole ", confermato: true }), { ok: true, value: { text: "Il gestionale esporta in CSV.", section: "regole" } });
  assert.deepEqual(parseLearnBody({ caso: "XX-0012", testo: "Il gestionale esporta in CSV.", confermato: true }), { ok: true, value: { text: "Il gestionale esporta in CSV.", section: undefined } });
  assert.deepEqual(parseLearnBody({ caso: "XX-0012", testo: "Il gestionale esporta in CSV.", sezione: null, confermato: true }), { ok: true, value: { text: "Il gestionale esporta in CSV.", section: undefined } });
});

test("impara: gli esiti di §2.5 e quello che resta nel registro (solo esito e id); il tetto del giorno è un 429 con Retry-After", () => {
  assert.deepEqual(learnRecord({ esito: "proposta", proposalId: "p-1" }), { esito: "proposta", proposta: "p-1" });
  assert.deepEqual(learnRecord({ esito: "riconferma", proposalId: "p-2" }), { esito: "riconferma", proposta: "p-2" });
  assert.deepEqual(learnRecord({ esito: "gia_proposta" }), { esito: "gia_proposta", proposta: null });
  assert.equal(learnResponse({ esito: "proposta", proposta: "p-1" }).testo, "Salvato come proposta: Lateral Space la controlla prima che entri nella memoria del cliente.");
  assert.equal(learnResponse({ esito: "riconferma", proposta: "p-2" }).testo, "Lo sappiamo già: ho chiesto di riconfermarlo.");
  assert.deepEqual(learnResponse({ esito: "gia_proposta", proposta: null }), { testo: "È già tra le proposte da confermare.", dati: { esito: "gia_proposta", proposta: null } });
  assert.deepEqual(learnLimitFailure(3600), { status: 429, code: "limite", message: "Per oggi le cose imparate sono tante: riprova domani o scrivile sul web.", headers: { "Retry-After": "3600" } });
});

const SOURCES: AskSource[] = [
  { n: 1, kind: "fatto", label: "Call 14 nov", date: "2026-11-15", excerpt: "Il gestionale esporta le fatture solo in CSV, ogni notte.", fact: { source: "call", on: "2026-11-14" } },
  { n: 2, kind: "documento", label: "Procedura di Rossi.pdf", date: "2026-11-10", excerpt: "Le fatture le controlla Mario Rossi ogni mattina." },
  { n: 3, kind: "discovery", label: "Intervista iniziale", date: null, excerpt: "Organico: 42 persone" },
];
const hide = (text: string) => text.replace(/Mario Rossi|Rossi/g, "una persona");

test("contesto: «Risposta:», il testo, «Fonti:» con una riga per fonte; i nomi coperti anche nelle fonti", () => {
  const r = askResponse({ status: "risposta", answer: "Le esporta Mario Rossi in CSV [1] [2].", sources: SOURCES.slice(0, 2) }, hide);
  assert.equal(
    r.testo,
    [
      "Risposta:",
      "Le esporta una persona in CSV [1] [2].",
      "Fonti:",
      "[1] Fatto · call del 14/11/2026 · Il gestionale esporta le fatture solo in CSV, ogni notte.",
      "[2] Documento · Procedura di una persona.pdf del 10/11/2026 · Le fatture le controlla una persona ogni mattina.",
    ].join("\n"),
  );
  assert.deepEqual(r.dati.fonti[1], { n: 2, tipo: "documento", etichetta: "Procedura di una persona.pdf", data: "2026-11-10", brano: "Le fatture le controlla una persona ogni mattina." });
  assert.equal(r.dati.stato, "risposta");
  assert.equal(r.dati.risposta, "Le esporta una persona in CSV [1] [2].");
  assert.doesNotMatch(JSON.stringify(r), /Rossi|Mario/);
});

test("contesto: un fatto con la frase degli agenti, come in CONTESTO.md: il giorno della fonte con l'anno, il referente, la costruzione, a mano", () => {
  const line = (fact: AskSource["fact"]) => askResponse({ status: "solo_ricerca", sources: [{ n: 1, kind: "fatto", label: "Call 14 nov", date: "2026-11-18", excerpt: "Il gestionale è SAP Business One.", fact }] }, hide).testo.split("\n")[1];
  assert.equal(line({ source: "call", on: "2026-11-14" }), "[1] Fatto · call del 14/11/2026 · Il gestionale è SAP Business One.");
  assert.equal(line({ source: "documento", on: "2026-11-10" }), "[1] Fatto · documento del 10/11/2026 · Il gestionale è SAP Business One.");
  assert.equal(line({ source: "referente", on: "2026-11-12" }), "[1] Fatto · risposta del referente del 12/11/2026 · Il gestionale è SAP Business One.");
  assert.equal(line({ source: "costruzione", on: "2026-11-18" }), "[1] Fatto · imparato costruendo il 18/11/2026 · Il gestionale è SAP Business One.");
  assert.equal(line({ source: "manuale", on: "" }), "[1] Fatto · scritto a mano · Il gestionale è SAP Business One.");
  assert.equal(line({ source: "senza_fonte", on: "" }), "[1] Fatto · senza fonte · Il gestionale è SAP Business One.");
  assert.equal(line(undefined), "[1] Fatto · Call 14 nov · Il gestionale è SAP Business One.", "un brano senza la fonte del fatto: l'etichetta");
});

test("contesto: «Non lo sappiamo ancora.»; senza l'ok la frase dell'ok e i brani; niente trovato", () => {
  assert.deepEqual(askResponse({ status: "non_so", sources: SOURCES }, hide).testo, "Non lo sappiamo ancora.");
  const search = askResponse({ status: "solo_ricerca", sources: SOURCES }, hide);
  assert.equal(search.testo.split("\n")[0], "Per una risposta scritta serve l'ok del cliente ai fornitori di AI. Ecco che cosa ho trovato:");
  assert.equal(search.testo.split("\n").length, 4);
  // (Rilascio 10, §4) La Discovery si chiama «Intervista iniziale».
  assert.match(search.testo, /\n\[3\] Intervista iniziale · Organico: 42 persone$/);
  assert.deepEqual([search.dati.stato, search.dati.risposta, search.dati.fonti.length], ["solo_ricerca", null, 3]);
  assert.deepEqual(askResponse({ status: "niente" }, hide), { testo: "Non ho trovato niente su questo.", dati: { stato: "niente", risposta: null, fonti: [] } });
});

test("contesto: troppe domande è 429 `limite` con la frase di §2.5 e Retry-After in secondi interi", () => {
  assert.deepEqual(askLimitFailure(125), { status: 429, code: "limite", message: "Troppe domande in poco tempo: riprova tra qualche minuto.", headers: { "Retry-After": "125" } });
  assert.deepEqual([retryAfterHeader(0.2), retryAfterHeader(Number.NaN), retryAfterHeader(-5), retryAfterHeader(59.1)], ["1", "60", "1", "60"]);
});

test("contesto: il modello ha al più i 40 secondi di «Chiedi al contesto» e mai oltre i 50 dall'arrivo: la risposta parte prima dei 60 della CLI", () => {
  assert.equal(CONTEXT_ASK_TIMEOUT_MS, 40_000);
  assert.equal(askTimeoutMs(0), 40_000);
  assert.equal(askTimeoutMs(2_000), 40_000);
  assert.equal(askTimeoutMs(15_000), CLI_ASK_BUDGET_MS - 15_000);
  assert.equal(askTimeoutMs(48_000), 5_000, "almeno 5 secondi");
  assert.equal(askTimeoutMs(Number.NaN), 40_000);
  for (const elapsed of [0, 5_000, 10_000, 20_000, 44_000]) assert.ok(elapsed + askTimeoutMs(elapsed) <= CLI_ASK_BUDGET_MS, String(elapsed));
  assert.ok(CLI_ASK_BUDGET_MS <= 50_000);
});

test("gli esiti di «Contesto» nella CLI: 403, 404 del caso, 422 con i messaggi dei campi, 503 da riprovare, 409", () => {
  assert.deepEqual(cliContextFailure({ error: "permesso_mancante", message: "Non hai i permessi per farlo." }), { status: 403, code: "permesso_negato", message: "Non hai i permessi per farlo.", headers: {} });
  assert.deepEqual(cliContextFailure({ error: "non_trovato", message: "Non trovato." }), { status: 404, code: "non_trovato", message: CLI_CASE_NOT_FOUND, headers: {} });
  assert.deepEqual(cliContextFailure({ error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { title: "Scrivi un titolo.", link: "Il link deve cominciare con https://." } }), {
    status: 422,
    code: "dati_non_validi",
    message: "Scrivi un titolo. Il link deve cominciare con https://.",
    headers: {},
  });
  assert.equal(cliContextFailure({ error: "dati_non_validi", message: "Al massimo 200 caratteri: una cosa per volta.", fieldErrors: { testo: "Al massimo 200 caratteri: una cosa per volta." } }).message, "Al massimo 200 caratteri: una cosa per volta.");
  assert.equal(cliContextFailure({ error: "dati_non_validi", message: "Controlla i campi indicati." }).message, "Controlla i campi indicati.");
  assert.deepEqual(cliContextFailure({ error: "area_spenta", message: "Il contesto si sta preparando." }), CLI_CONTEXT_UNAVAILABLE);
  assert.deepEqual(CLI_CONTEXT_UNAVAILABLE, { status: 503, code: "non_disponibile", message: "Unbundle non risponde: riprova tra qualche minuto.", headers: { "Retry-After": "60" } });
  assert.deepEqual(cliContextFailure({ error: "riprova", message: "Non è riuscito. Riprova tra poco." }, { retryMessage: "Non riesco a rispondere adesso. Riprova tra poco." }), {
    status: 503,
    code: "riprova",
    message: "Non riesco a rispondere adesso. Riprova tra poco.",
    headers: { "Retry-After": "30" },
  });
  assert.equal(cliContextFailure({ error: "versione_superata", message: "Qualcuno l'ha appena cambiato." }).status, 409);
});

test("i testi della CLI dicono «caso», mai «use case» né «caso d'uso»", () => {
  const texts = [
    parseLearnBody({ confermato: true, sezione: "x" }),
    parseNoteBody({ testo: "a".repeat(MAX + 1) }, TODAY),
    { ok: false, failure: cliContextFailure({ error: "non_trovato", message: "" }) },
  ].map((r) => (r.ok ? "" : r.failure.message));
  for (const text of texts) assert.doesNotMatch(text, /use case|caso d['’]uso/i, text);
});
