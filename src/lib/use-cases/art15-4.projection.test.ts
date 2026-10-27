import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import { useCases, type UseCase } from "../db/schema.ts";
import { phaseTone } from "./format.ts";
import type { UseCaseViewer } from "./permissions.ts";
import type { ValuationModel } from "./valuation.ts";
import {
  EXPORT_COLUMNS,
  HUB_PARAM_KEYS,
  REVIEWER_INTAKE_KEYS,
  exportRow,
  parseHubParams,
  projectContributorRow,
  projectHubItem,
  projectUseCaseDetail,
  type HubContext,
} from "./views.ts";

// Art. 15.4: nessuna metrica per persona, e D4 + D13 nelle proiezioni
// (docs/use-case/PIANO-LAVORI.md §5.4; docs/use-case/DESIGN.md §4.2, §4.10, §9.3, §11,
// §12.5 test 1). Le proiezioni qui sono le stesse funzioni che usano la pagina, la REST e
// l'export (src/lib/db/queries/use-case-hub.ts). Persone e codici inventati, email .test.

const TODAY = "2026-10-14";
const MODEL: ValuationModel = {
  dimensions: {
    impact: [{ id: "efficiency" }, { id: "profitability" }],
    feasibility: [{ id: "effort", direction: "lower_better" }],
    esg: [],
  },
  thresholds: { highImpact: 3.5, midImpact: 2.5 },
};
const CTX: HubContext = { model: MODEL, esgEnabled: false, today: TODAY };

const ME = "00000000-0000-4000-8000-000000000a01";
const OTHER = "00000000-0000-4000-8000-000000000b01";
const ME_EMAIL = "osservatore.prova@cliente.test";
const OTHER_EMAIL = "altra.persona@cliente.test";

const contributor: UseCaseViewer = { userId: ME, email: ME_EMAIL, emailVerified: true, role: "contributor", isLateralSpace: false };

/** Ogni grafia dei campi sul proponente (DESIGN §12.5 test 1). */
const PERSON_KEY = /proposed_?by|submitter_?email|submitted_?by_?user_?id/i;

let seq = 0;

/** Una riga intera di `use_cases`, con tutti i campi sul proponente valorizzati. */
function fullRow(o: Partial<UseCase> = {}): UseCase {
  seq += 1;
  const base: Record<string, unknown> = {};
  for (const key of Object.keys(getTableColumns(useCases))) base[key] = null;
  return {
    ...(base as UseCase),
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    workspaceId: "00000000-0000-4000-8000-00000000ffff",
    title: `Use case di prova ${seq}`,
    description: "Problema di prova",
    businessCase: "Impatto atteso",
    portfolioKind: "use_case_ai",
    status: "proposed",
    portfolioReviewStatus: "in_review",
    source: "claude_connector",
    proposedBy: OTHER_EMAIL,
    submittedByUserId: "00000000-0000-4000-8000-00000000eeee",
    intake: { submitterEmail: OTHER_EMAIL, area: "Finanza", frequency: "giornaliera", beneficiaries: 3, timeSavedMinutesPerRun: 15 },
    code: `XX-${String(seq).padStart(4, "0")}`,
    publicNote: "Nota pubblica di prova",
    reviewNotes: "Nota interna di prova",
    customScores: { impact: { efficiency: 4, profitability: 4 } },
    overallImpactScore: 4,
    overallScore: 3.8,
    costEurOnce: 40_000,
    valueEurYear: 60_000,
    origin: "adoption",
    version: 3,
    submittedAt: new Date("2026-10-01T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-02T10:00:00Z"),
    statusChangedAt: new Date("2026-10-02T10:00:00Z"),
    // «Benefici e costi»: solo i revisori lo ricevono.
    valueModel: {
      v: 1,
      primary: "tempo",
      components: [
        { key: "tempo", lever: "tempo", label: "Voce riservata ai revisori", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
      ],
      costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
      confirmBy: "Responsabile riservato",
    },
    ...o,
  };
}

/** Tutte le chiavi di un valore, a ogni profondità. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, out);
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      keysDeep(inner, out);
    }
  }
  return out;
}

test("parseHubParams scarta proponente, proposedBy, autore, persona e ogni parametro fuori elenco, per ogni ruolo", () => {
  const raw = {
    proponente: OTHER_EMAIL,
    proposedBy: OTHER_EMAIL,
    proposed_by: OTHER_EMAIL,
    submitterEmail: OTHER_EMAIL,
    autore: OTHER,
    persona: OTHER,
    ordina: "proponente",
    raggruppa: "persona",
    q: "prezzi",
  };
  for (const role of ["transformation_lead", "exec_sponsor", "function_lead", "analyst", "contributor", "learner", null]) {
    const params = parseHubParams(raw, { ...contributor, role });
    assert.deepEqual(Object.keys(params), [...HUB_PARAM_KEYS], String(role));
    for (const value of Object.values(params)) {
      assert.ok(value !== OTHER_EMAIL && value !== OTHER && value !== "proponente" && value !== "persona", String(role));
    }
  }
  assert.equal(HUB_PARAM_KEYS.some((key) => PERSON_KEY.test(key) || /propon|autor|person/i.test(key)), false);
});

test("contributore, proposta altrui: esattamente {id, title, phase, subState, phaseLabel, quando, own: false}", () => {
  const row = fullRow({ status: "accepted", targetQuarter: "2027-Q1" });
  const item = projectContributorRow(contributor, row, null, TODAY);
  assert.deepEqual(item, {
    id: row.id,
    title: row.title,
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T1 2027",
    quando: "T1 2027",
    own: false,
  });
});

test("contributore, proprie proposte (per email e per id): in più solo code e publicNote, anche se nascoste", () => {
  const byEmail = fullRow({ proposedBy: ME_EMAIL.toUpperCase(), portfolioReviewStatus: "needs_inputs", reviewedBy: OTHER, publicNote: "Quante richieste a settimana?" });
  const byId = fullRow({ proposedBy: ME, intake: { hiddenFromSearch: true }, origin: "transformation", publicNote: "   " });
  const email = projectContributorRow(contributor, byEmail, null, TODAY);
  const id = projectContributorRow(contributor, byId, null, TODAY);
  assert.deepEqual(email, {
    id: byEmail.id,
    title: byEmail.title,
    phase: "da_valutare",
    subState: "serve_info",
    phaseLabel: "Da valutare · Serve info",
    quando: null,
    own: true,
    code: byEmail.code,
    publicNote: "Quante richieste a settimana?",
  });
  assert.deepEqual(id, {
    id: byId.id,
    title: byId.title,
    phase: "da_valutare",
    subState: "nuova",
    phaseLabel: "Da valutare · Nuova",
    quando: null,
    own: true,
    code: byId.code,
    publicNote: null,
  });
});

test("contributore, proprie proposte rimandate: «Valutata», mai il parcheggio del team (né la data né il giallo)", () => {
  // Rimandata al 14 gen e «Da rivedere» (data passata): per chi ha proposto è valutata, da decidere.
  for (const reviewBy of ["2027-01-14", "2026-10-01"]) {
    const row = fullRow({ proposedBy: ME, portfolioReviewStatus: "scored", reviewBy });
    const item = projectContributorRow(contributor, row, null, TODAY);
    assert.equal(item?.own, true, reviewBy);
    assert.equal(item?.subState, "valutata", reviewBy);
    assert.equal(item?.phaseLabel, "Valutata, da decidere", reviewBy);
    assert.equal(phaseTone(item!.phase, item!.subState), "grigio", reviewBy);
    assert.equal(/rimandat|rivedere|gen/i.test(JSON.stringify(item)), false, reviewBy);
  }
});

test("contributore: scheda nascosta altrui = null; doppione senza il codice dell'altro, anche sulle proprie", () => {
  assert.equal(projectContributorRow(contributor, fullRow({ intake: { hiddenFromSearch: true } }), null, TODAY), null);
  const duplicate = { portfolioReviewStatus: "archived" as const, intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } };
  for (const row of [fullRow(duplicate), fullRow({ ...duplicate, proposedBy: ME })]) {
    const item = projectContributorRow(contributor, row, null, TODAY);
    assert.equal(item?.phaseLabel, "Chiuso · Doppione");
    assert.equal(JSON.stringify(item).includes("XX-0007"), false);
  }
  // Un id Slack o un'etichetta non rendono propria una proposta.
  for (const label of ["U0123ABCD", "AI Readiness respondent", null]) {
    assert.equal(projectContributorRow(contributor, fullRow({ proposedBy: label }), null, TODAY)?.own, false);
  }
});

test("revisori: lista e scheda senza proposedBy, submittedByUserId né submitterEmail, a nessuna profondità", () => {
  const row = { ...fullRow(), reopenedOn: null, realizedOn: null };
  const item = projectHubItem(row, CTX, null);
  const detail = projectUseCaseDetail(row, CTX, null);
  for (const projected of [item, detail]) {
    const keys = keysDeep(projected);
    assert.deepEqual(keys.filter((key) => PERSON_KEY.test(key)), []);
    assert.equal(JSON.stringify(projected).includes(OTHER_EMAIL), false, "nessun recapito di chi ha proposto");
  }
  assert.equal(detail.intake?.area, "Finanza", "i dati raccolti da Claude restano");
});

test("intake dei revisori: solo le chiavi ammesse, nessun recapito", () => {
  // La REST dei revisori usa `toUseCaseApiRow` (src/lib/portfolio/use-case-client-rows.ts),
  // provata in `use-case-client-rows.test.ts`; qui resta l'elenco delle chiavi di intake.
  assert.equal(REVIEWER_INTAKE_KEYS.some((key) => PERSON_KEY.test(key)), false);
  const row = { ...fullRow({ intake: { submitterEmail: OTHER_EMAIL, area: "Finanza", chiaveNuova: OTHER_EMAIL } }), reopenedOn: null, realizedOn: null };
  const detail = projectUseCaseDetail(row, CTX, null);
  assert.deepEqual(detail.intake, { area: "Finanza" });
  assert.equal(JSON.stringify(detail).includes(OTHER_EMAIL), false);
});

test("export: colonne di §4.1, nessuna sul proponente né sulle wave; nessun recapito nelle righe", () => {
  assert.equal(EXPORT_COLUMNS.length, 29);
  for (const column of EXPORT_COLUMNS) {
    assert.doesNotMatch(column, /propost|propon|autor|person|email|wave|budget|impact|feasibility|effort/i, column);
  }
  const row = { ...fullRow(), reopenedOn: null, realizedOn: null };
  const out = exportRow(projectHubItem(row, CTX, null), row);
  assert.deepEqual(Object.keys(out), [...EXPORT_COLUMNS]);
  assert.equal(JSON.stringify(out).includes(OTHER_EMAIL), false);
});

test("«Benefici e costi»: ai revisori il modello e le sue cifre, al contributore niente, sulle proprie e sulle altrui", () => {
  const others = fullRow({ status: "accepted", targetQuarter: "2027-Q1" });
  const own = fullRow({ proposedBy: ME_EMAIL, status: "accepted", targetQuarter: "2027-Q1" });
  for (const row of [others, own]) {
    const item = projectContributorRow(contributor, row, null, TODAY);
    assert.ok(item);
    const keys = keysDeep(item);
    assert.ok(!keys.includes("valueModel") && !keys.includes("components") && !keys.includes("value") && !keys.includes("cost"), keys.join(","));
    const text = JSON.stringify(item);
    assert.ok(!text.includes("Voce riservata ai revisori") && !text.includes("Responsabile riservato"), text);
  }
  const reviewer = projectHubItem(others, CTX, null);
  assert.equal(reviewer.valueModel?.components[0].label, "Voce riservata ai revisori");
  assert.equal(reviewer.cost?.source, "stima");
  assert.equal(projectUseCaseDetail(others, CTX, null).valueModel?.confirmBy, "Responsabile riservato");
});

test("«Raccolta informazioni» e le notifiche restano fuori dalle proiezioni della pagina, della REST e dell'export (SPEC §P2.11)", () => {
  const row = { ...fullRow(), reopenedOn: null, realizedOn: null };
  const contributorRow = { ...row, proposedBy: ME_EMAIL };
  const projected = [projectHubItem(row, CTX, null), projectUseCaseDetail(row, CTX, null), exportRow(projectHubItem(row, CTX, null), row), projectContributorRow(contributor, contributorRow, null, TODAY)];
  for (const value of projected) {
    const keys = keysDeep(value);
    assert.deepEqual(keys.filter((key) => /^(info|infoProgress|notifications)$/.test(key)), []);
  }
  assert.ok(!(EXPORT_COLUMNS as readonly string[]).some((column) => /info|notific/i.test(column)));
});
