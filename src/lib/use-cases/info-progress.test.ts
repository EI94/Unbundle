import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../uc/calendar.ts";
import {
  INFO_PROGRESS_PARAM,
  INFO_PROGRESS_STATES,
  INFO_PROGRESS_TEXT,
  INFO_ROW_STATES,
  askIsLive,
  askIsSilent,
  clientSideNeeds,
  deriveInfoProgress,
  infoProgressView,
  latestAsk,
  parseInfoParam,
  silentNeedIds,
  type InfoAskFact,
  type InfoNeedFact,
} from "./info-progress.ts";
import type { NeedStatus } from "./needs.ts";

// «Raccolta informazioni»: lo stato derivato (SPEC §P2.8). Gli esempi di §P2.8.4.
const at = (d: string, h = 10) => romeLocalToUtc(d, h);
const NOW = at("2026-10-29", 12);
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";
let seq = 0;
const needs = (...statuses: NeedStatus[]): InfoNeedFact[] => statuses.map((status) => ({ id: `3f2a9c1e-0000-4000-8000-${String(++seq).padStart(12, "0")}`, status }));
function ask(needId: string, over: Partial<InfoAskFact> = {}): InfoAskFact {
  return {
    needId,
    requestId: "3f2a9c1e-0000-4000-8000-0000000000d1",
    status: "inviata",
    expiresAt: at("2026-11-26"),
    createdAt: at("2026-10-27"),
    sentAt: at("2026-10-27"),
    reminderCount: 0,
    lastReminderAt: null,
    itemState: "aperta",
    ...over,
  };
}
const view = (n: InfoNeedFact[], a: InfoAskFact[]) => infoProgressView(deriveInfoProgress(n, a, NOW));

test("nessuna esigenza del cliente: niente stato", () => {
  assert.equal(deriveInfoProgress([], [], NOW), null);
  assert.equal(infoProgressView(null), null);
});

test("6 da chiedere dopo «Prepara le domande»", () => {
  const v = view(needs("da_chiedere", "da_chiedere", "da_chiedere", "da_chiedere", "da_chiedere", "da_chiedere"), []);
  assert.equal(v?.state, "da_chiedere");
  assert.equal(v?.label, "Informazioni: da chiedere");
  assert.equal(v?.count, "0 di 6 informazioni ricevute");
  assert.equal(v?.next, "6 da chiedere");
  assert.equal(v?.line, "0 di 6 informazioni ricevute · 6 da chiedere");
});

test("6 chieste su una richiesta viva: in attesa, senza date nella testata; con un promemoria uguale", () => {
  const n = needs("chiesta", "chiesta", "chiesta", "chiesta", "chiesta", "chiesta");
  const asks = n.map((x) => ask(x.id));
  const v = view(n, asks);
  assert.equal(v?.state, "in_attesa");
  assert.equal(v?.label, "Informazioni: in attesa");
  assert.equal(v?.ariaLabel, "Informazioni: in attesa");
  assert.equal(v?.count, "0 di 6 informazioni ricevute");
  assert.equal(v?.line, "0 di 6 informazioni ricevute · 6 in attesa");
  assert.equal(v?.tone, "blu");
  // Le date si calcolano ancora (le righe delle «Richieste» le scrivono), ma la testata non le ripete.
  const derived = deriveInfoProgress(n, asks, NOW);
  assert.equal(derived?.since, "2026-10-27");
  assert.equal(derived?.until, "2026-11-26");
  assert.equal(derived?.reminded, false);
  const remindedAsks = n.map((x) => ask(x.id, { reminderCount: 1, lastReminderAt: at("2026-10-29", 10) }));
  assert.equal(deriveInfoProgress(n, remindedAsks, NOW)?.reminded, true);
  const reminded = view(n, remindedAsks);
  assert.equal(reminded?.label, "Informazioni: in attesa");
  assert.equal(reminded?.line, "0 di 6 informazioni ricevute · 6 in attesa");
});

test("4 chieste e 2 da chiedere: «4 in attesa · 2 da chiedere»", () => {
  const n = needs("chiesta", "chiesta", "chiesta", "chiesta", "da_chiedere", "da_chiedere");
  const asks = n.slice(0, 4).map((x) => ask(x.id));
  assert.equal(view(n, asks)?.next, "4 in attesa · 2 da chiedere");
  assert.equal(view(n, asks)?.line, "0 di 6 informazioni ricevute · 4 in attesa · 2 da chiedere");
  const one = needs("chiesta", "da_chiedere");
  assert.equal(view(one, [ask(one[0].id)])?.line, "0 di 2 informazioni ricevute · 1 in attesa · 1 da chiedere");
});

test("senza risposta: dopo l'ultimo promemoria, oppure oltre la scadenza", () => {
  const n = needs("chiesta", "chiesta", "chiesta", "chiesta", "da_chiedere", "da_chiedere");
  const lastAsks = n.slice(0, 4).map((x) => ask(x.id, { reminderCount: 2 }));
  const last = view(n, lastAsks);
  assert.equal(last?.state, "senza_risposta");
  assert.equal(last?.next, "4 senza risposta · 2 da chiedere");
  assert.equal(last?.tone, "rosso");
  assert.equal(last?.showInRows, true);
  assert.equal(deriveInfoProgress(n, lastAsks, NOW)?.silentReason, "ultimo_promemoria");
  const expiredAsks = n.slice(0, 4).map((x) => ask(x.id, { expiresAt: at("2026-10-29", 9) }));
  const expired = view(n, expiredAsks);
  assert.equal(expired?.state, "senza_risposta");
  assert.equal(expired?.next, "4 senza risposta · 2 da chiedere");
  assert.equal(expired?.tone, "rosso");
  assert.equal(expired?.showInRows, true);
  assert.equal(deriveInfoProgress(n, expiredAsks, NOW)?.silentReason, "scaduta");
});

test("da verificare, ricevute e chiuse", () => {
  const v = view(needs("in_verifica", "in_verifica", "chiesta", "chiesta", "chiesta", "chiesta"), []);
  assert.equal(v?.state, "da_verificare");
  assert.equal(v?.count, "2 di 6 informazioni ricevute");
  assert.equal(v?.line, "2 di 6 informazioni ricevute · 2 da verificare");
  const dontKnow = needs("mancante", "validata", "validata", "validata", "validata", "validata");
  const after = view(dontKnow, [ask(dontKnow[0].id, { status: "completata", itemState: "non_so" })]);
  assert.equal(after?.state, "da_chiedere");
  assert.equal(after?.line, "5 di 6 informazioni ricevute · 1 da chiedere");
  const partial = view(needs("validata", "validata", "validata", "validata", "validata", "parziale"), []);
  assert.equal(partial?.state, "da_chiedere");
  assert.equal(partial?.line, "5 di 6 informazioni ricevute · 1 da chiedere", "parziale non conta");
  const done = view(needs("validata", "validata", "validata", "validata", "validata", "non_applicabile"), []);
  assert.equal(done?.state, "complete");
  assert.equal(done?.line, "5 di 5 informazioni ricevute · tutte a posto");
  // Niente serve dal cliente: solo la frase, senza «tutte a posto».
  const none = view(needs("non_applicabile"), []);
  assert.equal(none?.line, "Nessuna informazione serve dal cliente.");
  assert.equal(none?.next, null);
});

test("bloccate: da chiedere, e quante sono bloccate", () => {
  const v = view(needs("bloccata", "validata", "validata"), []);
  assert.equal(v?.state, "da_chiedere");
  assert.equal(v?.count, "2 di 3 informazioni ricevute");
  assert.equal(v?.line, "2 di 3 informazioni ricevute · 1 da chiedere, bloccata");
  const two = view(needs("bloccata", "bloccata", "validata"), []);
  assert.equal(two?.line, "1 di 3 informazioni ricevute · 2 da chiedere, bloccate");
});

test("una chiesta senza richiesta: in attesa senza data; una scaduta e una nuova viva: in attesa", () => {
  const lone = view(needs("chiesta"), []);
  assert.equal(lone?.state, "in_attesa");
  assert.equal(lone?.label, "Informazioni: in attesa");
  assert.equal(lone?.count, "0 di 1 informazione ricevuta");
  assert.equal(lone?.line, "0 di 1 informazione ricevuta · 1 in attesa");
  const n = needs("chiesta");
  const asks = [
    ask(n[0].id, { requestId: "3f2a9c1e-0000-4000-8000-0000000000d1", createdAt: at("2026-09-01"), sentAt: at("2026-09-01"), expiresAt: at("2026-10-01"), status: "scaduta" }),
    ask(n[0].id, { requestId: "3f2a9c1e-0000-4000-8000-0000000000d2" }),
  ];
  assert.equal(view(n, asks)?.state, "in_attesa");
  assert.equal(latestAsk(asks, n[0].id)?.requestId, "3f2a9c1e-0000-4000-8000-0000000000d2");
});

/** Uno per stato e qualche variante: le schede delle prove qui sopra. */
function fixtures(): Array<{ name: string; n: InfoNeedFact[]; a: InfoAskFact[] }> {
  const out: Array<{ name: string; n: InfoNeedFact[]; a: InfoAskFact[] }> = [];
  const add = (name: string, n: InfoNeedFact[], a: (n: InfoNeedFact[]) => InfoAskFact[] = () => []) => out.push({ name, n, a: a(n) });
  add("da chiedere", needs("da_chiedere", "da_chiedere", "da_chiedere"));
  add("bloccata", needs("bloccata", "validata", "validata"));
  add("bloccate", needs("bloccata", "bloccata", "validata"));
  add("in attesa", needs("chiesta", "chiesta", "da_chiedere"), (n) => n.slice(0, 2).map((x) => ask(x.id)));
  add("in attesa con promemoria", needs("chiesta", "chiesta"), (n) => n.map((x) => ask(x.id, { reminderCount: 1, lastReminderAt: at("2026-10-29", 10) })));
  add("in attesa senza richiesta", needs("chiesta"));
  add("da verificare", needs("in_verifica", "chiesta", "da_chiedere"), (n) => [ask(n[1].id)]);
  add("senza risposta", needs("chiesta", "chiesta", "da_chiedere"), (n) => n.slice(0, 2).map((x) => ask(x.id, { reminderCount: 2 })));
  add("scaduta", needs("chiesta", "da_chiedere"), (n) => [ask(n[0].id, { expiresAt: at("2026-10-29", 9) })]);
  add("complete", needs("validata", "validata", "non_applicabile"));
  add("una a posto", needs("validata"));
  add("niente dal cliente", needs("non_applicabile"));
  return out;
}

/** La parola dello stato nella testata: «in attesa», «da verificare»… */
const STATE_WORD: Readonly<Record<string, string>> = { da_chiedere: "da chiedere", in_attesa: "in attesa", da_verificare: "da verificare", senza_risposta: "senza risposta", complete: "a posto" };

test("la riga non ripete la testata: niente «Informazioni:», niente date né promemoria nella testata", () => {
  for (const { name, n, a } of fixtures()) {
    const v = view(n, a)!;
    assert.ok(!v.line.includes(v.label), `${name}: ${v.line}`);
    assert.ok(!v.line.includes("Informazioni:"), `${name}: ${v.line}`);
    assert.doesNotMatch(v.label, /\d/, `${name}: ${v.label}`);
    assert.ok(!v.label.includes("dal ") && !v.label.includes("promemoria"), `${name}: ${v.label}`);
    assert.equal(v.ariaLabel, v.label, name);
    if (v.next === null) continue;
    // Il primo pezzo di «che cosa resta» dice lo stato della testata con un numero.
    const [first] = v.next.split(INFO_PROGRESS_TEXT.next.separator);
    assert.ok(first.includes(STATE_WORD[v.state]), `${name}: «${first}» per ${v.state}`);
  }
});

test("conteggi di esigenze, mai di persone: due richieste sulla stessa esigenza contano una volta", () => {
  const n = needs("chiesta");
  const asks = [
    ask(n[0].id, { requestId: "3f2a9c1e-0000-4000-8000-0000000000e1", createdAt: at("2026-09-01"), sentAt: at("2026-09-01"), expiresAt: at("2026-10-01"), status: "scaduta" }),
    ask(n[0].id, { requestId: "3f2a9c1e-0000-4000-8000-0000000000e2" }),
  ];
  assert.equal(deriveInfoProgress(n, asks, NOW)?.waiting, 1);
  assert.equal(view(n, asks)?.line, "0 di 1 informazione ricevuta · 1 in attesa");
  for (const text of Object.values(INFO_PROGRESS_TEXT.next)) {
    assert.ok(!text.includes("{Nome}") && !/persona|referente/i.test(text), text);
  }
});

test("i conteggi per stato delle esigenze: da verificare, in attesa, senza risposta, bloccate, da chiedere", () => {
  const n = needs("in_verifica", "chiesta", "chiesta", "bloccata", "da_chiedere");
  const asks = [ask(n[1].id, { reminderCount: 2 }), ask(n[2].id)];
  const p = deriveInfoProgress(n, asks, NOW)!;
  assert.deepEqual({ toVerify: p.toVerify, waiting: p.waiting, unanswered: p.unanswered, blockedCount: p.blockedCount, toAsk: p.toAsk }, { toVerify: 1, waiting: 1, unanswered: 1, blockedCount: 1, toAsk: 1 });
  assert.equal(p.state, "da_verificare");
  assert.equal(infoProgressView(p)?.line, "1 di 5 informazioni ricevute · 1 da verificare · 1 da chiedere");
});

test("che cosa resta: al massimo due pezzi; «complete» non dice mai «da chiedere»", () => {
  for (const { name, n, a } of fixtures()) {
    const v = view(n, a)!;
    if (v.next === null) continue;
    assert.ok(v.next.split(INFO_PROGRESS_TEXT.next.separator).length <= 2, `${name}: ${v.next}`);
    if (v.state === "complete") assert.ok(!v.next.includes("da chiedere"), `${name}: ${v.next}`);
  }
});

test("una sola informazione, a posto: «1 di 1 informazione ricevuta · a posto»", () => {
  assert.equal(view(needs("validata"), [])?.line, "1 di 1 informazione ricevuta · a posto");
});

test("le funzioni sulle domande: vive, senza risposta, le più recenti, le esigenze da chiedere di nuovo", () => {
  const live = ask("x");
  assert.equal(askIsLive(live, NOW), true);
  assert.equal(askIsLive({ ...live, expiresAt: NOW }, NOW), false, "alla scadenza non è più viva");
  assert.equal(askIsSilent({ ...live, expiresAt: NOW }, NOW), true);
  assert.equal(askIsSilent({ ...live, reminderCount: 2 }, NOW), true);
  assert.equal(askIsSilent({ ...live, itemState: "risposta", reminderCount: 2 }, NOW), false);
  assert.equal(askIsSilent({ ...live, status: "revocata" }, NOW), false);
  assert.equal(latestAsk([{ ...live, status: "revocata" }], "x"), null, "le revocate non contano");
  const n = needs("chiesta", "chiesta", "da_chiedere");
  const ids = silentNeedIds(n, [ask(n[0].id, { reminderCount: 2 }), ask(n[1].id), ask(n[2].id, { reminderCount: 2 })], NOW);
  assert.deepEqual([...ids], [n[0].id]);
});

test("clientSideNeeds: requisiti del cliente o di entrambi, non archiviati, di questa scheda", () => {
  const base = { type: "requisito" as const, status: "da_chiedere" as NeedStatus, archivedAt: null, useCaseIds: [UC] };
  const out = clientSideNeeds(
    [
      { ...base, id: "a", ownerSide: "cliente" },
      { ...base, id: "b", ownerSide: "insieme" },
      { ...base, id: "c", ownerSide: null },
      { ...base, id: "d", ownerSide: "lateral_space" },
      { ...base, id: "e", ownerSide: "fornitore" },
      { ...base, id: "f", ownerSide: "cliente", type: "passo" },
      { ...base, id: "g", ownerSide: "cliente", archivedAt: "2026-10-27T10:00:00.000Z" },
      { ...base, id: "h", ownerSide: "cliente", useCaseIds: ["altro"] },
    ],
    UC.toUpperCase(),
  );
  assert.deepEqual(out.map((x) => x.id), ["a", "b", "c"]);
});

test("filtro: ?info= andata e ritorno, «bloccate» non è un valore", () => {
  for (const state of INFO_PROGRESS_STATES) assert.equal(parseInfoParam(INFO_PROGRESS_PARAM[state]), state);
  assert.equal(parseInfoParam("bloccate"), null);
  assert.equal(parseInfoParam("da_verificare"), null);
  assert.equal(parseInfoParam(null), null);
  assert.deepEqual([...INFO_ROW_STATES], ["da_verificare", "senza_risposta"]);
});

test("i testi non usano le parole di altre viste", () => {
  const all = JSON.stringify(INFO_PROGRESS_TEXT);
  for (const word of ["Serve info", "Da valutare", "Validata", "validata", "Parziale", "Mancante"]) assert.ok(!all.includes(word), word);
});
