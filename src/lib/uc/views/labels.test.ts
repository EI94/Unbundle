import test from "node:test";
import assert from "node:assert/strict";
import { CASE_STATUSES, CASE_ROLES, PRIORITIES } from "../vocab.ts";
import {
  CASE_PHASES,
  CASE_PHASE_LABEL,
  CASE_STATUS_TONE,
  CASE_STATUS_PHASE,
  GATE_STATES,
  PERIMETER_LABEL,
  PHASE_LABEL,
  PRIORITY_LABEL,
  ROLE_LABEL,
  SIGNERS_TEXT,
  USE_CASE_WORDS,
  WORDS,
  availabilityLabel,
  blockerLabel,
  casePhaseOf,
  dayWithArticle,
  eventLabel,
  gateStateLabel,
} from "./labels.ts";

test("roles: one label per case role, plus the referent without an account", () => {
  assert.deepEqual(Object.keys(ROLE_LABEL).sort(), [...CASE_ROLES, "referente"].sort());
  assert.equal(ROLE_LABEL.ls_lead, "Responsabile Lateral Space");
  assert.equal(ROLE_LABEL.owner_cliente, "Responsabile del cliente");
  assert.equal(ROLE_LABEL.referente, "Referente");
  assert.equal(SIGNERS_TEXT, "Firmano il responsabile Lateral Space e il responsabile del cliente.");
});

test("priorities, perimeter and serves-for in words, never must/should/could", () => {
  assert.deepEqual(PRIORITIES.map((p) => PRIORITY_LABEL[p]), ["Indispensabile", "Utile", "Facoltativa"]);
  assert.deepEqual(PERIMETER_LABEL, { in_contratto: "Nel contratto", evoluzione: "Fuori contratto" });
  assert.equal(PHASE_LABEL.baseline, "Valore di partenza");
  assert.equal(PHASE_LABEL.backtest, "Prova sul passato");
});

test("blockers and availability without articles or «A.8»", () => {
  assert.equal(blockerLabel("a8"), "Scheda privacy");
  assert.equal(blockerLabel("costi_art_8_4"), "Costi da approvare");
  assert.equal(blockerLabel("fuori_foundation"), "Fuori contratto");
  assert.equal(blockerLabel("accesso_sistema"), "Accesso al sistema");
  assert.equal(blockerLabel("nuovo_blocco"), "Nuovo blocco");
  assert.equal(availabilityLabel("dopo_a8"), "Dopo la scheda privacy");
  assert.equal(availabilityLabel("fuori_foundation"), "Fuori contratto");
  assert.equal(availabilityLabel("con_api_v2"), "Con accesso via API");
  for (const token of ["oggi_export", "dopo_a8", "da_chiedere", "da_costruire", "fuori_foundation"]) assert.doesNotMatch(availabilityLabel(token), /A\.8|Foundation/);
});

test("events use the new words for the three exceptions", () => {
  assert.equal(eventLabel("voce.creata"), "Aggiunta al catalogo");
  assert.equal(eventLabel("voce.modificata"), "Modificata");
  assert.equal(eventLabel("voce.assegnata"), "Assegnata a chi risponde");
  assert.equal(eventLabel("voce.na_proposta"), "Proposta «non si applica»");
  assert.equal(eventLabel("voce.deroga_firmata"), "Firma su «partire senza risposta»");
  assert.equal(eventLabel("voce.ripiego_firmato"), "Firma sulla soluzione provvisoria");
});

test("no event label says «voce»: the client owner and the privacy approver read them (§2.6)", () => {
  const types = [
    "voce.creata", "voce.modificata", "voce.classe_privacy_cambiata", "voce.stato_cambiato", "voce.stato_importato", "voce.assegnata",
    "voce.na_proposta", "voce.na_firmata", "voce.na_respinta", "voce.deroga_firmata", "voce.ripiego_firmato", "risposta.inviata",
    "risposta.letta_personale", "risposta.cancellata_privacy", "validazione.registrata", "commento.creato", "chiarimento.richiesto",
    "chiarimento.risolto", "file.caricato", "file.rifiutato", "file.revisionato", "file.scaricato", "file.cancellato", "blocco.attivato",
    "blocco.sciolto", "blocco.riattivato", "richiesta.inviata", "richiesta.revocata", "delega.creata", "seed.applicato", "seed.valore_omesso",
  ];
  for (const type of types) assert.doesNotMatch(eventLabel(type), /\bvoc[ei]\b/i, type);
});

test("case phases: five phases, pause and closure are states, «Preparazione ✓» when ready", () => {
  assert.deepEqual(CASE_PHASES.map((p) => CASE_PHASE_LABEL[p]), ["Preparazione", "Sviluppo", "Prova", "Rodaggio", "In uso"]);
  assert.deepEqual(Object.keys(CASE_STATUS_PHASE).sort(), [...CASE_STATUSES].sort());
  assert.deepEqual(casePhaseOf("raccolta"), { phase: "preparazione", complete: false });
  assert.deepEqual(casePhaseOf("pronto_sviluppo"), { phase: "preparazione", complete: true });
  assert.deepEqual(casePhaseOf("collaudo"), { phase: "prova", complete: false });
  assert.deepEqual(casePhaseOf("stabilizzazione"), { phase: "rodaggio", complete: false });
  assert.deepEqual(casePhaseOf("misura_roi"), { phase: "in_uso", complete: false });
  assert.deepEqual(casePhaseOf("sospeso", "in_sviluppo"), { phase: "sviluppo", complete: false }, "a paused case shows the phase it was in");
  assert.equal(casePhaseOf("sospeso", null), null);
  assert.equal(casePhaseOf("chiuso"), null);
});

test("case status dot: a pause is grey, not red", () => {
  assert.deepEqual(Object.keys(CASE_STATUS_TONE).sort(), [...CASE_STATUSES].sort());
  assert.equal(CASE_STATUS_TONE.sospeso, "grigio");
  assert.equal(CASE_STATUS_TONE.raccolta, "giallo");
  assert.equal(CASE_STATUS_TONE.pronto_sviluppo, "verde");
  assert.equal(CASE_STATUS_TONE.in_esercizio, "verde");
  assert.equal(CASE_STATUS_TONE.chiuso, "grigio");
  assert.ok(!Object.values(CASE_STATUS_TONE).includes("rosso"));
});

test("state of the go-ahead to development", () => {
  assert.deepEqual(GATE_STATES.map((s) => gateStateLabel(s)), ["Non ancora", "Si può proporre", "In attesa delle firme", "Approvato", "Da riconfermare"]);
  assert.equal(gateStateLabel("approvato", "3 ott"), "Approvato il 3 ott");
  assert.equal(gateStateLabel("approvato", "8 ott"), "Approvato l'8 ott");
  assert.equal(gateStateLabel("approvato", "1 ott 2025"), "Approvato l'1 ott 2025");
  assert.equal(gateStateLabel("non_ancora", "3 ott"), "Non ancora");
});

test("use case words for the Realization chapter", () => {
  assert.equal(USE_CASE_WORDS.realizzazione, "Realizzazione");
  assert.equal(USE_CASE_WORDS.avviaRealizzazione, "Avvia la realizzazione");
  assert.equal(USE_CASE_WORDS.apriDossier, "Apri il dossier");
  assert.equal(USE_CASE_WORDS.dossier, "dossier");
  assert.equal(WORDS.via, "Via allo sviluppo");
  for (const word of [...Object.values(WORDS), ...Object.values(USE_CASE_WORDS)]) assert.doesNotMatch(word, /caso d'uso|Casi d'uso|Opportunità/i);
});

test("days 1, 8 and 11 take the elided article; 18 and the others do not", () => {
  assert.equal(dayWithArticle("il", "1 ott"), "l'1 ott");
  assert.equal(dayWithArticle("il", "8 ott"), "l'8 ott");
  assert.equal(dayWithArticle("il", "11 ott"), "l'11 ott");
  assert.equal(dayWithArticle("del", "1 ott"), "dell'1 ott");
  assert.equal(dayWithArticle("dal", "11 ott"), "dall'11 ott");
  assert.equal(dayWithArticle("al", "8 nov"), "all'8 nov");
  assert.equal(dayWithArticle("il", "18 ott"), "il 18 ott");
  assert.equal(dayWithArticle("del", "3 ott"), "del 3 ott");
  assert.equal(dayWithArticle("dal", "10 ott"), "dal 10 ott");
  assert.equal(dayWithArticle("il", "31 dic 2025"), "il 31 dic 2025");
});
