import test from "node:test";
import assert from "node:assert/strict";
import { CASE_STATUS_LABEL } from "../case-state.ts";
import { STATUS_LABEL } from "../semaforo.ts";
import { ITEM_STATUSES, type CaseRole } from "../vocab.ts";
import { FORBIDDEN_RULES, findForbidden, findForbiddenIn } from "./copy-guard.ts";
import { stripFactCodes, stripLegalRefs } from "./format.ts";
import * as labels from "./labels.ts";
import { caseNextSteps, whoseTurn, type NextStepInput } from "./next-step.ts";
import { STATUS_GROUP_LABEL, groupCountText, groupCounts, statusView } from "./status-groups.ts";

test("every pattern of DESIGN §6.2 is caught for the client", () => {
  const cases: [string, string][] = [
    ["chiave", "Rispondi alla domanda q.servizio.12 entro venerdì"],
    ["chiave", "Collegata a kpi.costi.medio"],
    ["chiave", "Vedi ent.richiesta"],
    ["chiave", "Regola rule.servizio.urgenti"],
    ["chiave", "Fonte src.crm.ordini"],
    ["chiave", "Vincolo hc.turni"],
    ["chiave", "Codice var.prezzo e frm.margine"],
    ["chiave", "Formula f.margine"],
    ["chiave", "Documento doc.contratto_quadro"],
    ["chiave", "Uscita out.piano_turni"],
    ["chiave", "Domanda q.x.01"],
    ["articolo", "Approvata (art. 8.4)"],
    ["articolo", "ai sensi dell'Art.15"],
    ["codice_via", "Gate G1 approvato"],
    ["codice_via", "Prima del G3"],
    ["priorita", "Priorità: must"],
    ["priorita", "Should have"],
    ["codice_fatto", "Dichiarato in call (F010)"],
    ["codice_fatto", "dichiarato in call · fonte F012"],
    ["scheda_a8", "Dopo la scheda A.8"],
    ["versione", "Schema v1.2.0"],
    ["hash", "Impronta 9f86d081884c7d659a2feaa0c55ad015"],
    ["gergo", "Il template d'esempio"],
    ["gergo", "Apri il gate"],
    ["gergo", "0% verde su 477 voci"],
    ["gergo", "servono verdi le 245 voci"],
  ];
  for (const [rule, text] of cases) {
    const found = findForbidden(text, "cliente");
    assert.ok(found.some((m) => m.rule === rule), `${rule}: «${text}» → ${JSON.stringify(found)}`);
  }
  assert.equal(new Set(FORBIDDEN_RULES.map((r) => r.id)).size, FORBIDDEN_RULES.length);
});

test("ordinary client texts pass", () => {
  const ok = [
    "Use case › XX-0012 › Realizzazione",
    "0 di 245 indispensabili a posto",
    "Catalogo v1, congelato il 3 ott.",
    "Fase 1.2 entro il 23 ott",
    "Carica verbale.doc.pdf oppure il file vendite.src.csv",
    "Scrivi a referente@cliente.test",
    "Identificativo 0f8e2a64-1b7c-4d3e-9a5f-6c2b1d0e9f8a",
    "La scheda privacy è firmata. Approvata dal cliente.",
    "Valore di partenza e prova sul passato",
    "Partire senza risposta, soluzione provvisoria, non si applica",
    "Gli articoli del contratto restano nei documenti.",
    "Da rispondere · In verifica · In attesa · A posto",
    "Firma il doc.pdf e manda out.xlsx, poi doc.docx e src.csv",
    "Mario Rossi, f.to in originale",
    "Vedi par.2 e par.10 del regolamento",
  ];
  for (const text of ok) assert.deepEqual(findForbidden(text, "cliente"), [], text);
});

test("matches carry position and reason, in text order", () => {
  const found = findForbidden("Il template q.x.01 vale (art. 5)", "cliente");
  assert.deepEqual(
    found.map((m) => [m.rule, m.match]),
    [
      ["gergo", "template"],
      ["chiave", "q.x.01"],
      ["articolo", "art. 5"],
    ],
  );
  assert.equal(found[1].index, 12);
  assert.equal(found[1].reason, "chiave di una voce");
});

test("Lateral Space has no check: codes live in «Dettagli tecnici»", () => {
  assert.deepEqual(findForbidden("q.servizio.12 · G1 · must · art. 8.4", "ls"), []);
  assert.deepEqual(findForbidden("", "cliente"), []);
});

function labelTexts(): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) add(x);
  };
  for (const [name, value] of Object.entries(labels)) {
    if (typeof value === "function") continue;
    if (name === "CASE_PHASES" || name === "GATE_STATES") continue; // codes, not texts
    if (name === "CASE_STATUS_PHASE" || name === "CASE_STATUS_TONE") continue; // values are codes and tones
    add(value);
  }
  add(STATUS_LABEL);
  add(CASE_STATUS_LABEL);
  add(STATUS_GROUP_LABEL);
  for (const s of ITEM_STATUSES) {
    const v = statusView(s, "cliente");
    out.push(v.label, ...(v.sublabel ? [v.sublabel] : []));
  }
  out.push(...groupCounts([], "cliente").map((g) => g.label));
  for (const g of groupCounts([], "cliente")) out.push(groupCountText(g.group, 1, "cliente"), groupCountText(g.group, 3, "cliente"));
  for (const token of ["oggi_export", "dopo_a8", "da_chiedere", "da_costruire", "fuori_foundation", "con_api_rest"]) out.push(labels.availabilityLabel(token));
  for (const key of ["a8", "decisione_board", "fuori_foundation", "accesso_sistema", "costi_art_8_4", "sanitario"]) out.push(labels.blockerLabel(key));
  for (const state of labels.GATE_STATES) out.push(labels.gateStateLabel(state, "3 ott"));
  const events = [
    "voce.creata", "voce.modificata", "voce.classe_privacy_cambiata", "voce.stato_cambiato", "voce.stato_importato", "voce.assegnata",
    "voce.na_proposta", "voce.na_firmata", "voce.na_respinta", "voce.deroga_firmata", "voce.ripiego_firmato", "risposta.inviata",
    "risposta.letta_personale", "risposta.cancellata_privacy", "validazione.registrata", "commento.creato", "chiarimento.richiesto",
    "chiarimento.risolto", "file.caricato", "file.rifiutato", "file.revisionato", "file.scaricato", "file.cancellato", "blocco.attivato",
    "blocco.sciolto", "blocco.riattivato", "richiesta.inviata", "richiesta.revocata", "delega.creata", "seed.applicato", "seed.valore_omesso",
  ];
  for (const type of events) out.push(labels.eventLabel(type));
  for (const actor of ["utente", "referente", "sistema", "mcp"]) out.push(labels.eventActorLabel(actor));
  for (const phase of labels.CASE_PHASES) out.push(labels.CASE_PHASE_LABEL[phase]);
  return out;
}

test("copy-guard is green on the labels", () => {
  const texts = labelTexts();
  assert.ok(texts.length > 150, `${texts.length} label texts checked`);
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

test("copy-guard is green on the next steps and «Tocca a …» lines the client reads", () => {
  const busy: NextStepInput = {
    now: new Date("2026-10-14T10:00:00Z"),
    status: "raccolta",
    statusBeforeSuspension: null,
    statusChangedAt: "2026-10-03",
    gateReconfirm: true,
    g1: { required: 245, ok: 240, ready: false, byGroup: { da_fare: 140 } },
    pendingGateReview: { lsSigned: true, clientSigned: false, lsSignedAt: "2026-10-03" },
    referents: 0,
    unassignedMust: 4,
    unsentMust: 137,
    toVerifyForMe: 160,
    toVerifyMust: 95,
    oldestToVerifyAt: "2026-10-11",
    toVerifyTotal: 160,
    waitingOnReferents: 40,
    blockersActive: 2,
    blockedMust: 10,
    privacyBlockerActive: true,
    mySignaturesPending: [
      { kind: "via", otherSideSigned: true },
      { kind: "scheda_privacy", otherSideSigned: false },
    ],
    privacySignerMissing: true,
    forwardTransition: "collaudo",
    nextMilestone: { title: "Mappatura dei dati", date: "2026-10-23" },
    catalog: { version: 1, frozenAt: "2026-10-03" },
  };
  const texts: string[] = [];
  const roleSets: CaseRole[][] = [["owner_cliente"], ["approvatore_privacy"], ["osservatore"], ["ai_board"], ["ls_lead"], ["ls_analista"], ["ls_sviluppatore"]];
  for (const status of ["bozza", "raccolta", "pronto_sviluppo", "in_sviluppo", "backtest", "sospeso", "chiuso"] as const) {
    const input = { ...busy, status, statusBeforeSuspension: status === "sospeso" ? ("raccolta" as const) : null };
    for (const roles of roleSets) {
      const steps = caseNextSteps(input, { roles });
      for (const s of steps) texts.push(s.label, ...(s.detail ? [s.detail] : []));
      const line = whoseTurn(steps, input);
      if (line) texts.push(line);
    }
  }
  assert.ok(texts.length > 50);
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

test("the strip helpers leave nothing the guard would catch", () => {
  const texts = ["Costi da autorizzare (art. 8.4)", "Dichiarato in call (F010, F011)", "Scheda A.8 firmata ai sensi dell'art. 15.2", "valore · fonte F012"];
  for (const t of texts) assert.deepEqual(findForbidden(stripLegalRefs(stripFactCodes(t)), "cliente"), [], t);
});
