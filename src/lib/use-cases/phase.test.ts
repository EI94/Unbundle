import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { connectorStatus, type ConnectorStatusCode, type UseCaseStatusInput } from "../connector/status.ts";
import { STATUS_TABLE_FUTURE, STATUS_TABLE_ROWS, STATUS_TABLE_TODAY, type StatusTableRow } from "../connector/status.fixtures.ts";
import { CASE_STATUS_LABEL } from "../uc/case-state.ts";
import { CASE_STATUSES, type CaseStatus } from "../uc/vocab.ts";
import {
  CONNECTOR_CODE_PHASE,
  PHASE_LABEL,
  PHASE_TONE,
  SUB_STATE_LABEL,
  VALUED_PILL,
  phaseOfUseCase,
  type PhaseInput,
} from "./phase.ts";
import { PHASES, SUB_STATES, type Phase, type PhaseTone, type SubState } from "./types.ts";

// docs/use-case/DESIGN.md §3.4 e §3.5 (D10, D16). Stesse righe e stesso codice cliente di
// src/lib/connector/status.test.ts: le 23 righe arrivano da status.fixtures.ts. Dati sintetici.

const PERSON = "00000000-0000-4000-8000-0000000000b1";
const NOTE = "Manca il volume mensile delle richieste: puoi indicarlo?";

function fromRow(r: StatusTableRow): PhaseInput {
  return {
    ...r.input,
    portfolioKind: r.context.portfolioKind,
    targetQuarter: r.context.targetQuarter,
    dossierStatus: r.context.dossierStatus as CaseStatus | null,
    duplicateOfCode: r.input.intake?.duplicateOfCode ?? null,
    today: r.context.today,
  };
}

function input(overrides: Partial<PhaseInput> = {}): PhaseInput {
  return {
    status: "proposed",
    portfolioReviewStatus: "needs_inputs",
    reviewedBy: null,
    publicNote: null,
    intake: null,
    reviewBy: null,
    linkedCaseCode: null,
    portfolioKind: "use_case_ai",
    targetQuarter: null,
    dossierStatus: null,
    duplicateOfCode: null,
    today: STATUS_TABLE_TODAY,
    ...overrides,
  };
}

/** «Fase · sotto-stato» di DESIGN §3.5, riga per riga. Righe 7 e 11 con la data e il trimestre della riga. */
const EXPECTED: Record<number, { phase: Phase; subState: SubState; label: string; tone?: PhaseTone }> = {
  1: { phase: "da_valutare", subState: "nuova", label: "Da valutare · Nuova" },
  2: { phase: "da_valutare", subState: "nuova", label: "Da valutare · Nuova" },
  3: { phase: "da_valutare", subState: "nuova", label: "Da valutare · Nuova" },
  4: { phase: "da_valutare", subState: "possibile_doppione", label: "Da valutare · Possibile doppione" },
  5: { phase: "da_valutare", subState: "serve_info", label: "Da valutare · Serve info" },
  6: { phase: "da_valutare", subState: "valutata", label: "Valutata, da decidere" },
  7: { phase: "da_valutare", subState: "rimandata", label: "Da valutare · Rimandata al 14 gen 2027" },
  8: { phase: "da_valutare", subState: "da_rivedere", label: "Da valutare · Da rivedere", tone: "giallo" },
  9: { phase: "approvato", subState: "trimestre", label: "Approvato · T1 2027" },
  10: { phase: "approvato", subState: "piu_avanti", label: "Approvato · Più avanti" },
  11: { phase: "approvato", subState: "trimestre", label: "Approvato · T3 2026" },
  12: { phase: "in_realizzazione", subState: "dossier", label: "In realizzazione · In preparazione" },
  13: { phase: "in_realizzazione", subState: "dossier", label: "In realizzazione · In sviluppo" },
  14: { phase: "in_realizzazione", subState: "senza_dossier", label: "In realizzazione · Senza dossier" },
  15: { phase: "realizzato", subState: "realizzato", label: "Realizzato" },
  16: { phase: "realizzato", subState: "diffusa", label: "Realizzato · Diffusa" },
  17: { phase: "chiuso", subState: "non_avviato", label: "Chiuso · Non avviato" },
  18: { phase: "da_valutare", subState: "nuova", label: "Da valutare · Nuova" },
  19: { phase: "chiuso", subState: "doppione", label: "Chiuso · Doppione di XX-0007" },
  20: { phase: "chiuso", subState: "archiviato", label: "Chiuso · Archiviato" },
  21: { phase: "chiuso", subState: "archiviato", label: "Chiuso · Archiviato" },
  22: { phase: "chiuso", subState: "archiviato", label: "Chiuso · Archiviato" },
  23: { phase: "da_valutare", subState: "nuova", label: "Da valutare · Nuova" },
};

test("tabella: le 23 righe di DESIGN §3.5, le stesse di status.test.ts, riga per riga", () => {
  assert.deepEqual(
    STATUS_TABLE_ROWS.map((r) => r.n),
    Array.from({ length: 23 }, (_, i) => i + 1),
  );
  assert.deepEqual(Object.keys(EXPECTED).map(Number), STATUS_TABLE_ROWS.map((r) => r.n));
  for (const r of STATUS_TABLE_ROWS) {
    const out = phaseOfUseCase(fromRow(r));
    const want = EXPECTED[r.n];
    const where = `riga ${r.n}: ${r.label}`;
    assert.equal(out.connector.statusCode, r.statusCode, where);
    assert.deepEqual(out.connector, connectorStatus(r.input), where);
    assert.equal(out.phase, want.phase, where);
    assert.equal(out.subState, want.subState, where);
    assert.equal(out.label, want.label, where);
    assert.equal(out.tone, want.tone ?? PHASE_TONE[want.phase], where);
  }
});

test("tabella: le righe con il dossier usano uno stato vero del dossier", () => {
  for (const r of STATUS_TABLE_ROWS) {
    if (r.context.dossierStatus !== null) assert.ok((CASE_STATUSES as readonly string[]).includes(r.context.dossierStatus), `riga ${r.n}`);
  }
});

// ─── Nessuna regola di fase sua ──────────────────────────────────────

const STATUSES = ["draft", "proposed", "accepted", "in_progress", "implemented", "rejected"] as const;
const REVIEWS = ["needs_inputs", "in_review", "scored", "archived"] as const;
const EXTRAS: Array<Partial<PhaseInput>> = [
  {},
  { reviewedBy: PERSON, publicNote: NOTE },
  { reviewBy: STATUS_TABLE_FUTURE },
  { reviewBy: "2026-09-01" },
  { reviewBy: STATUS_TABLE_TODAY },
  { linkedCaseCode: "XX-CASO-01", dossierStatus: "raccolta" },
  { linkedCaseCode: "XX-CASO-02", dossierStatus: "chiuso" },
  { intake: { possibleDuplicateOf: "XX-0007" } },
  { intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } },
  { intake: { archiveReason: "superato" } },
  { targetQuarter: "2027-Q1" },
  { targetQuarter: "2026-Q3", portfolioKind: "best_practice" },
  { portfolioKind: null },
];

function* everyCombination(): Generator<PhaseInput> {
  for (const status of STATUSES) {
    for (const portfolioReviewStatus of REVIEWS) {
      for (const extra of EXTRAS) yield input({ status, portfolioReviewStatus, ...extra });
    }
  }
}

test("la fase dipende solo dal codice del connettore (nessuna regola di fase in phase.ts)", () => {
  let n = 0;
  for (const i of everyCombination()) {
    const out = phaseOfUseCase(i);
    const statusOnly: UseCaseStatusInput = {
      status: i.status,
      portfolioReviewStatus: i.portfolioReviewStatus,
      reviewedBy: i.reviewedBy,
      publicNote: i.publicNote,
      intake: i.intake,
      reviewBy: i.reviewBy,
      linkedCaseCode: i.linkedCaseCode,
    };
    const where = JSON.stringify(i);
    assert.deepEqual(out.connector, connectorStatus(statusOnly), where);
    assert.equal(out.phase, CONNECTOR_CODE_PHASE[out.connector.statusCode], where);
    assert.ok((SUB_STATES[out.phase] as readonly string[]).includes(out.subState), where);
    assert.equal(out.phaseName, PHASE_LABEL[out.phase], where);
    // «Valutata, da decidere» non ripete la fase, che si contraddirebbe («Da valutare · Valutata»).
    if (out.subState === "valutata") assert.equal(out.label, VALUED_PILL, where);
    else assert.ok(out.label === out.phaseName || out.label.startsWith(`${out.phaseName} · `), where);
    n++;
  }
  assert.equal(n, STATUSES.length * REVIEWS.length * EXTRAS.length);
});

test("la fase non legge le colonne che decidono lo stato del connettore", () => {
  // Il sorgente di phase.ts non nomina i campi che solo connectorStatus può interpretare.
  const file = fileURLToPath(new URL("./phase.ts", import.meta.url));
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const forbidden = new Set(["status", "portfolioReviewStatus", "reviewedBy", "publicNote", "linkedCaseCode", "archiveReason", "possibleDuplicateOf"]);
  const seen: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && forbidden.has(node.name.text)) seen.push(node.getText(sf));
    if (ts.isBindingElement(node) && forbidden.has((node.propertyName ?? node.name).getText(sf))) seen.push(node.getText(sf));
    node.forEachChild(visit);
  };
  visit(sf);
  assert.deepEqual(seen, []);
});

test("ogni codice del connettore ha una fase; ogni fase ha nome e tono", () => {
  const codes: ConnectorStatusCode[] = [
    "RICEVUTA",
    "IN_VALUTAZIONE",
    "POSSIBILE_DOPPIONE",
    "SERVONO_INFORMAZIONI",
    "VALUTATA",
    "APPROVATA",
    "AVVIATA_COME_CASO",
    "IN_SVILUPPO",
    "REALIZZATA",
    "NON_AVVIATA",
    "DOPPIONE",
    "ARCHIVIATA",
  ];
  assert.deepEqual(Object.keys(CONNECTOR_CODE_PHASE).sort(), [...codes].sort());
  assert.deepEqual(Object.keys(PHASE_LABEL), [...PHASES]);
  assert.deepEqual(Object.keys(PHASE_TONE), [...PHASES]);
  const fixed = Object.values(SUB_STATES).flat().filter((s) => s !== "trimestre" && s !== "dossier");
  assert.deepEqual(Object.keys(SUB_STATE_LABEL).sort(), [...fixed].sort());
  assert.deepEqual(PHASE_TONE, { da_valutare: "grigio", approvato: "blu", in_realizzazione: "blu", realizzato: "verde", chiuso: "grigio" });
});

// ─── Sotto-stati ─────────────────────────────────────────────────────

test("Valutata, Rimandata, Da rivedere: la data di revisione contro oggi (Europe/Rome, dall'esterno)", () => {
  const at = (reviewBy: string | null | undefined, today = STATUS_TABLE_TODAY) =>
    phaseOfUseCase(input({ portfolioReviewStatus: "scored", reviewBy, today }));
  assert.equal(at(null).subState, "valutata");
  assert.equal(at(undefined).subState, "valutata", "prima della 0020");
  assert.equal(at("   ").subState, "valutata", "data vuota = assente, come per il connettore");
  // Stessa data di oggi: la data è arrivata.
  assert.equal(at(STATUS_TABLE_TODAY).subState, "da_rivedere");
  assert.equal(at(STATUS_TABLE_TODAY).tone, "giallo");
  assert.equal(at("2026-10-15").subState, "rimandata");
  assert.equal(at("2026-10-15").tone, "grigio");
  // Nello stesso anno senza l'anno; in un altro anno con l'anno.
  assert.equal(at("2026-12-20").label, "Da valutare · Rimandata al 20 dic");
  assert.equal(at("2027-01-14").label, "Da valutare · Rimandata al 14 gen 2027");
  assert.equal(at("2027-01-14", "2027-01-13").label, "Da valutare · Rimandata al 14 gen");
  // Un timestamp letto dal driver vale per il suo giorno.
  assert.equal(at("2027-01-14T00:00:00.000Z").subState, "rimandata");
  // Una data illeggibile: il connettore dice VALUTATA, la scheda torna davanti al team.
  assert.equal(at("domani").subState, "da_rivedere");
  assert.equal(at("domani").connector.statusCode, "VALUTATA");
  // Rimandata da draft (Activity mapping) o da proposed: stessa lettura.
  assert.equal(phaseOfUseCase(input({ status: "draft", reviewBy: "2027-02-01" })).subState, "rimandata");
});

test("Approvato: il trimestre in «T1 2027», «Più avanti» senza trimestre", () => {
  const at = (targetQuarter: string | null) => phaseOfUseCase(input({ status: "accepted", portfolioReviewStatus: "scored", targetQuarter }));
  assert.equal(at("2027-Q1").label, "Approvato · T1 2027");
  assert.equal(at("2027-Q1").subStateLabel, "T1 2027");
  assert.equal(at(null).label, "Approvato · Più avanti");
  assert.equal(at(null).subState, "piu_avanti");
  // Un valore rovinato non diventa un trimestre.
  assert.equal(at("2027-Q5").subState, "piu_avanti");
  assert.equal(at("").subState, "piu_avanti");
});

test("In realizzazione: l'etichetta del dossier per ogni stato; senza stato solo la fase", () => {
  for (const dossierStatus of CASE_STATUSES) {
    const out = phaseOfUseCase(input({ status: "accepted", linkedCaseCode: "XX-CASO-01", dossierStatus }));
    assert.equal(out.phase, "in_realizzazione", dossierStatus);
    assert.equal(out.subState, "dossier", dossierStatus);
    assert.equal(out.label, `In realizzazione · ${CASE_STATUS_LABEL[dossierStatus]}`, dossierStatus);
    assert.equal(out.tone, "blu");
  }
  const noStatus = phaseOfUseCase(input({ status: "accepted", linkedCaseCode: "XX-CASO-01" }));
  assert.equal(noStatus.label, "In realizzazione");
  assert.equal(noStatus.subStateLabel, null);
});

test("Realizzato: «Realizzato» per i da costruire (anche portfolio_kind NULL), «Diffusa» per le best practice", () => {
  const at = (portfolioKind: string | null) => phaseOfUseCase(input({ status: "implemented", portfolioReviewStatus: "scored", portfolioKind }));
  for (const kind of ["use_case_ai", null, "altro"]) {
    assert.equal(at(kind).label, "Realizzato", String(kind));
    assert.equal(at(kind).subState, "realizzato");
    assert.equal(at(kind).tone, "verde");
  }
  assert.equal(at("best_practice").label, "Realizzato · Diffusa");
  assert.equal(at("best_practice").subStateLabel, "Diffusa");
});

test("Doppione: il codice dell'altra scheda solo se valido, mai nell'etichetta per i contributori", () => {
  const dup = (overrides: Partial<PhaseInput>) => phaseOfUseCase(input({ portfolioReviewStatus: "archived", ...overrides }));
  const withIntake = dup({ intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } });
  assert.equal(withIntake.label, "Chiuso · Doppione di XX-0007");
  assert.equal(withIntake.contributorLabel, "Chiuso · Doppione");
  // Il campo esplicito vale come quello di intake.
  const explicit = dup({ intake: { archiveReason: "duplicato" }, duplicateOfCode: "AB-12345" });
  assert.equal(explicit.label, "Chiuso · Doppione di AB-12345");
  assert.equal(explicit.contributorLabel, "Chiuso · Doppione");
  for (const other of ["Mario Rossi", "xx-0007", "XX-7", "<b>", ""]) {
    const out = dup({ intake: { archiveReason: "duplicato", duplicateOfCode: other } });
    assert.equal(out.label, "Chiuso · Doppione", other);
  }
  // Possibile doppione: la pillola non porta il codice.
  const possible = phaseOfUseCase(input({ portfolioReviewStatus: "in_review", intake: { possibleDuplicateOf: "XX-0007" } }));
  assert.equal(possible.label, "Da valutare · Possibile doppione");
  assert.ok(!possible.contributorLabel.includes("XX-0007"));
});

test("per i contributori la pillola è quella dei revisori, salvo il codice dell'altra scheda e il parcheggio del team", () => {
  for (const i of everyCombination()) {
    const out = phaseOfUseCase(i);
    assert.ok(!/[A-Z]{2,4}-[0-9]{4,5}/.test(out.contributorLabel), JSON.stringify(i));
    // «Rimandata» e «Da rivedere» sono del team: chi ha proposto legge «Valutata, da decidere» (H7).
    if (out.subState === "rimandata" || out.subState === "da_rivedere") assert.equal(out.contributorLabel, VALUED_PILL, JSON.stringify(i));
    else if (out.subState !== "doppione") assert.equal(out.contributorLabel, out.label, JSON.stringify(i));
  }
});

test("today è obbligatorio e nel formato AAAA-MM-GG: niente orologio dentro il modulo", () => {
  for (const today of ["", "14/10/2026", "2026-02-30", "oggi"]) {
    assert.throws(() => phaseOfUseCase(input({ today })), RangeError, today);
  }
});

test("D16: la funzione si chiama phaseOfUseCase, non useCasePhase", async () => {
  const mod: Record<string, unknown> = await import("./phase.ts");
  assert.equal(typeof mod.phaseOfUseCase, "function");
  assert.equal(mod.useCasePhase, undefined);
});
