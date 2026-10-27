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
const TODAY = "2026-10-29";
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
const view = (n: InfoNeedFact[], a: InfoAskFact[], canAsk = true) => infoProgressView(deriveInfoProgress(n, a, NOW), { today: TODAY, canAsk });

test("nessuna esigenza del cliente: niente stato", () => {
  assert.equal(deriveInfoProgress([], [], NOW), null);
  assert.equal(infoProgressView(null, { today: TODAY, canAsk: true }), null);
});

test("6 da chiedere dopo «Prepara le domande»", () => {
  const v = view(needs("da_chiedere", "da_chiedere", "da_chiedere", "da_chiedere", "da_chiedere", "da_chiedere"), []);
  assert.equal(v?.state, "da_chiedere");
  assert.equal(v?.label, "Informazioni: da chiedere");
  assert.equal(v?.hint, "Usa «Chiedi al referente» per raccoglierle.");
  assert.equal(v?.count, "0 di 6 informazioni ricevute");
  assert.equal(view(needs("da_chiedere"), [], false)?.hint, null, "chi non può chiedere non riceve l'invito");
});

test("6 chieste su una richiesta viva: in attesa dal 27/10, link fino al 26/11; con un promemoria", () => {
  const n = needs("chiesta", "chiesta", "chiesta", "chiesta", "chiesta", "chiesta");
  const v = view(n, n.map((x) => ask(x.id)));
  assert.equal(v?.state, "in_attesa");
  assert.equal(v?.label, "Informazioni: in attesa dal 27/10");
  assert.equal(v?.hint, "Il link vale fino al 26/11.");
  assert.equal(v?.count, "0 di 6 informazioni ricevute");
  assert.equal(v?.tone, "blu");
  const reminded = view(n, n.map((x) => ask(x.id, { reminderCount: 1, lastReminderAt: at("2026-10-29", 10) })));
  assert.equal(reminded?.label, "Informazioni: in attesa dal 27/10 · promemoria inviato");
  assert.equal(reminded?.hint, "Il link vale fino al 26/11.");
});

test("4 chieste e 2 da chiedere: il suggerimento «Aggiungi domande»", () => {
  const n = needs("chiesta", "chiesta", "chiesta", "chiesta", "da_chiedere", "da_chiedere");
  const asks = n.slice(0, 4).map((x) => ask(x.id));
  assert.equal(view(n, asks)?.hint, "2 domande non sono ancora state chieste: usa «Aggiungi domande».");
  assert.equal(view(n, asks, false)?.hint, "Il link vale fino al 26/11.");
  const one = needs("chiesta", "da_chiedere");
  assert.equal(view(one, [ask(one[0].id)])?.hint, "1 domanda non è ancora stata chiesta: usa «Aggiungi domande».");
});

test("senza risposta: dopo l'ultimo promemoria, oppure oltre la scadenza", () => {
  const n = needs("chiesta", "chiesta", "chiesta", "chiesta", "da_chiedere", "da_chiedere");
  const last = view(n, n.slice(0, 4).map((x) => ask(x.id, { reminderCount: 2 })));
  assert.equal(last?.state, "senza_risposta");
  assert.equal(last?.hint, "Nessuna risposta dopo l'ultimo promemoria. Puoi chiedere di nuovo o chiedere a un'altra persona.");
  assert.equal(last?.tone, "rosso");
  assert.equal(last?.showInRows, true);
  const expired = view(n, n.slice(0, 4).map((x) => ask(x.id, { expiresAt: at("2026-10-29", 9) })));
  assert.equal(expired?.state, "senza_risposta");
  assert.equal(expired?.hint, "Il link è scaduto senza risposta. Puoi chiedere di nuovo o chiedere a un'altra persona.");
});

test("da verificare, ricevute e chiuse", () => {
  const v = view(needs("in_verifica", "in_verifica", "chiesta", "chiesta", "chiesta", "chiesta"), []);
  assert.equal(v?.state, "da_verificare");
  assert.equal(v?.count, "2 di 6 informazioni ricevute");
  assert.equal(v?.hint, "Sono arrivate risposte o documenti: per ognuno scegli A posto, Risposta parziale o Manca il dato.");
  const dontKnow = needs("mancante", "validata", "validata", "validata", "validata", "validata");
  const after = view(dontKnow, [ask(dontKnow[0].id, { status: "completata", itemState: "non_so" })]);
  assert.equal(after?.state, "da_chiedere");
  assert.equal(after?.count, "5 di 6 informazioni ricevute");
  const partial = view(needs("validata", "validata", "validata", "validata", "validata", "parziale"), []);
  assert.equal(partial?.state, "da_chiedere");
  assert.equal(partial?.count, "5 di 6 informazioni ricevute", "parziale non conta");
  const done = view(needs("validata", "validata", "validata", "validata", "validata", "non_applicabile"), []);
  assert.equal(done?.state, "complete");
  assert.equal(done?.count, "5 di 5 informazioni ricevute");
  assert.equal(done?.hint, "Ci sono tutte le informazioni che servono dal cliente.");
  assert.equal(view(needs("non_applicabile"), [])?.count, "Nessuna informazione serve dal cliente.");
});

test("bloccate: da chiedere, con il suggerimento per sbloccarle", () => {
  const v = view(needs("bloccata", "validata", "validata"), []);
  assert.equal(v?.state, "da_chiedere");
  assert.equal(v?.hint, "Le informazioni che mancano sono bloccate: sbloccale in «Cosa serve» per chiederle.");
  assert.equal(v?.count, "2 di 3 informazioni ricevute");
});

test("una chiesta senza richiesta: in attesa senza data; una scaduta e una nuova viva: in attesa", () => {
  const lone = view(needs("chiesta"), []);
  assert.equal(lone?.state, "in_attesa");
  assert.equal(lone?.label, "Informazioni: in attesa");
  assert.equal(lone?.hint, null);
  assert.equal(lone?.count, "0 di 1 informazione ricevuta");
  const n = needs("chiesta");
  const asks = [
    ask(n[0].id, { requestId: "3f2a9c1e-0000-4000-8000-0000000000d1", createdAt: at("2026-09-01"), sentAt: at("2026-09-01"), expiresAt: at("2026-10-01"), status: "scaduta" }),
    ask(n[0].id, { requestId: "3f2a9c1e-0000-4000-8000-0000000000d2" }),
  ];
  assert.equal(view(n, asks)?.state, "in_attesa");
  assert.equal(latestAsk(asks, n[0].id)?.requestId, "3f2a9c1e-0000-4000-8000-0000000000d2");
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
