import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { STATUS_TABLE_TODAY } from "../connector/status.fixtures.ts";
import { applyDecision, applyWhen, checkStartRealization, type DecisionCard, type DecisionContext } from "./decisions.ts";
import { phaseOfUseCase, type PhaseInput } from "./phase.ts";
import {
  RECEIPT_SOURCES,
  abilitiesForUseCase,
  canSeeUseCase,
  contributorUseCases,
  decisionActorFor,
  isHiddenFromSearch,
  isOwnProposal,
  isOwnReceipt,
  projectForContributor,
  type ContributorSourceRow,
  type ContributorUseCase,
  type UseCaseAbilities,
  type UseCaseViewer,
} from "./permissions.ts";
import type { Decision } from "./types.ts";

// docs/use-case/DESIGN.md §4.10, §5.1, §5.5, §6.7, §6.9, §11 (D3, D4, D13). Persone e
// codici inventati, email solo in domini .test.

const LS_ID = "00000000-0000-4000-8000-0000000000a1";
const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000d1";

const viewer = (role: string | null, isLateralSpace = false, userId = CLIENT_ID, email: string | null = "ada.rossi@cliente.test"): UseCaseViewer => ({
  userId,
  email,
  emailVerified: true,
  role,
  isLateralSpace,
});

/** Le persone di DESIGN §4.10 e degli account delle schermate (PIANO §3.1 c). */
const PEOPLE = {
  /** ls-lead: Lateral Space, gestisce il workspace. */
  lsLead: viewer("transformation_lead", true, LS_ID, "luca@lateral.test"),
  /** Lateral Space con ruolo da revisore, senza gestire il workspace. */
  lsAnalyst: viewer("analyst", true, LS_ID, "luca@lateral.test"),
  /** function-lead: AI Builder del cliente. */
  aiBuilder: viewer("function_lead"),
  clientAnalyst: viewer("analyst"),
  /** sponsor-cliente: gestisce il workspace, del cliente. */
  clientSponsor: viewer("exec_sponsor"),
  clientTransformationLead: viewer("transformation_lead"),
  /** osservatore: contributore. */
  contributor: viewer("contributor"),
  /** Una persona di Lateral Space con ruolo da contributore resta un contributore. */
  lsContributor: viewer("contributor", true, LS_ID, "luca@lateral.test"),
  learner: viewer("learner"),
  lsLearner: viewer("learner", true, LS_ID, "luca@lateral.test"),
  noRole: viewer(null),
  unknownRole: viewer("owner"),
};

const NOTHING: UseCaseAbilities = {
  kind: "escluso",
  isReviewer: false,
  isLateralSpace: false,
  managesWorkspace: false,
  projection: null,
  canOpenArea: false,
  canSeePriority: false,
  canSeeFigures: false,
  canSeeAllCodes: false,
  canSeeHidden: false,
  canUseAllFilters: false,
  canExport: false,
  canProposeFromActivityMapping: false,
  newUseCase: null,
  canDecide: false,
  canStartRealization: false,
  canMarkInProgress: false,
  canEditWhat: false,
  canEditValuation: false,
  canSetHiddenFromSearch: false,
  canSeeHistory: false,
  canSeeProposer: false,
  canRedact: false,
  canOpenAnyDossier: false,
  canEditSettings: false,
  canUseTeamMcp: false,
};

const REVIEWER: UseCaseAbilities = {
  ...NOTHING,
  kind: "ai_builder",
  isReviewer: true,
  projection: "revisore",
  canOpenArea: true,
  canSeePriority: true,
  canSeeFigures: true,
  canSeeAllCodes: true,
  canSeeHidden: true,
  canUseAllFilters: true,
  canExport: true,
  canProposeFromActivityMapping: true,
  newUseCase: "modulo_completo",
  canDecide: true,
  canEditWhat: true,
  canEditValuation: true,
  canSetHiddenFromSearch: true,
  canSeeHistory: true,
  canUseTeamMcp: true,
};

const MANAGER_EXTRAS = { managesWorkspace: true, projection: "gestore", canSeeProposer: true, canRedact: true, canOpenAnyDossier: true, canEditSettings: true } as const;
const LS_EXTRAS = { kind: "lateral_space", isLateralSpace: true, newUseCase: "pannello_rapido", canStartRealization: true, canMarkInProgress: true, canRedact: true } as const;

const CONTRIBUTOR: UseCaseAbilities = { ...NOTHING, kind: "contributore", projection: "contributore", canOpenArea: true, newUseCase: "modulo_completo" };

test("abilità: Lateral Space che gestisce il workspace", () => {
  assert.deepEqual(abilitiesForUseCase(PEOPLE.lsLead), { ...REVIEWER, ...MANAGER_EXTRAS, ...LS_EXTRAS });
});

test("abilità: Lateral Space con ruolo da revisore, senza gestire il workspace", () => {
  assert.deepEqual(abilitiesForUseCase(PEOPLE.lsAnalyst), { ...REVIEWER, ...LS_EXTRAS });
});

test("abilità: AI Builder del cliente (D3: decide, non avvia; modulo completo)", () => {
  for (const person of [PEOPLE.aiBuilder, PEOPLE.clientAnalyst]) {
    assert.deepEqual(abilitiesForUseCase(person), REVIEWER, person.role ?? "");
  }
});

test("abilità: chi gestisce il workspace, del cliente: in più «Proposto da», «Oscura testo», Impostazioni", () => {
  for (const person of [PEOPLE.clientSponsor, PEOPLE.clientTransformationLead]) {
    assert.deepEqual(abilitiesForUseCase(person), { ...REVIEWER, ...MANAGER_EXTRAS }, person.role ?? "");
  }
});

test("abilità: contributore, anche se di Lateral Space (D4)", () => {
  assert.deepEqual(abilitiesForUseCase(PEOPLE.contributor), CONTRIBUTOR);
  assert.deepEqual(abilitiesForUseCase(PEOPLE.lsContributor), { ...CONTRIBUTOR, isLateralSpace: true });
});

test("abilità: chi segue solo un corso, chi non ha ruolo e un ruolo sconosciuto non entrano", () => {
  assert.deepEqual(abilitiesForUseCase(PEOPLE.learner), NOTHING);
  assert.deepEqual(abilitiesForUseCase(PEOPLE.lsLearner), { ...NOTHING, isLateralSpace: true });
  assert.deepEqual(abilitiesForUseCase(PEOPLE.noRole), NOTHING);
  assert.deepEqual(abilitiesForUseCase(PEOPLE.unknownRole), NOTHING);
});

test("abilità: le regole di DESIGN §4.10 e §6.7, una per una", () => {
  for (const [name, person] of Object.entries(PEOPLE)) {
    const a = abilitiesForUseCase(person);
    const reviewer = ["exec_sponsor", "transformation_lead", "function_lead", "analyst"].includes(person.role ?? "");
    const manages = ["exec_sponsor", "transformation_lead"].includes(person.role ?? "");
    assert.equal(a.canDecide, reviewer, `${name}: decidono tutti i revisori (D3)`);
    assert.equal(a.canStartRealization, reviewer && person.isLateralSpace, `${name}: «Avvia» solo Lateral Space`);
    assert.equal(a.canMarkInProgress, a.canStartRealization, name);
    assert.equal(a.canSeeFigures, reviewer, `${name}: i contributori non vedono numeri (D4)`);
    assert.equal(a.canSeeProposer, manages, `${name}: «Proposto da» solo a chi gestisce`);
    assert.equal(a.canRedact, manages || (reviewer && person.isLateralSpace), name);
    assert.equal(a.canOpenArea, reviewer || person.role === "contributor", `${name}: il learner non entra`);
    assert.equal(a.newUseCase === "pannello_rapido", reviewer && person.isLateralSpace, name);
    if (a.canOpenArea && a.newUseCase !== "pannello_rapido") assert.equal(a.newUseCase, "modulo_completo", name);
    assert.equal(a.canUseTeamMcp, reviewer, name);
  }
});

// ─── D3: gli stessi permessi in decisions.ts ─────────────────────────

const NOW = new Date(`${STATUS_TABLE_TODAY}T10:00:00Z`);

function card(overrides: Partial<PhaseInput> = {}): DecisionCard {
  const i: PhaseInput = {
    status: "proposed",
    portfolioReviewStatus: "in_review",
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
  return {
    id: "00000000-0000-4000-8000-000000000e01",
    code: "XX-0012",
    phase: phaseOfUseCase(i).phase,
    portfolioKind: i.portfolioKind,
    dossierStatus: i.dossierStatus,
    status: i.status,
    portfolioReviewStatus: i.portfolioReviewStatus,
    targetQuarter: i.targetQuarter,
    reviewBy: i.reviewBy ?? null,
    reviewedBy: i.reviewedBy,
    publicNote: i.publicNote,
    intake: i.intake,
  };
}

/** Ogni decisione su una scheda in una fase che la ammette: l'unico motivo di rifiuto resta chi decide. */
const DECISIONS: Array<[Decision, DecisionCard]> = [
  [{ type: "approva", quando: "piu_avanti" }, card()],
  [{ type: "rimanda", reviewBy: "2027-02-01" }, card()],
  [{ type: "serve_info", publicNote: "Quante richieste arrivano a settimana?" }, card()],
  [{ type: "non_avviare", publicNote: "Per ora no." }, card()],
  [{ type: "doppione", ofCode: "XX-0007" }, card()],
  [{ type: "archivia", reason: "superato" }, card()],
  [{ type: "riapri" }, card({ status: "rejected" })],
  [{ type: "segna_diffusa" }, card({ status: "accepted", portfolioKind: "best_practice" })],
  [{ type: "segna_realizzato" }, card({ status: "in_progress" })],
  [{ type: "segna_in_realizzazione" }, card({ status: "accepted" })],
];

function ctxFor(person: UseCaseViewer, ucSectionEnabled = false): DecisionContext {
  return {
    now: NOW,
    actor: decisionActorFor(person),
    ucSectionEnabled,
    duplicateTarget: { id: "00000000-0000-4000-8000-000000000e07", code: "XX-0007" },
  };
}

test("D3: applyDecision dice sì e no come abilitiesForUseCase, persona per persona", () => {
  for (const [name, person] of Object.entries(PEOPLE)) {
    const a = abilitiesForUseCase(person);
    for (const [decision, c] of DECISIONS) {
      const out = applyDecision(c, decision, ctxFor(person));
      const allowed = decision.type === "segna_in_realizzazione" ? a.canMarkInProgress : a.canDecide;
      if (allowed) assert.equal(out.ok, true, `${name} · ${decision.type}: ${out.ok ? "" : out.message}`);
      else assert.equal(out.ok ? "ok" : out.error, "permesso_mancante", `${name} · ${decision.type}`);
    }
    const when = applyWhen(card({ status: "accepted" }), "prossimo_trimestre", ctxFor(person));
    assert.equal(when.ok ? "ok" : when.error, a.canDecide ? "ok" : "permesso_mancante", `${name} · quando`);
    const start = checkStartRealization(card({ status: "accepted" }), ctxFor(person, true));
    assert.equal(start.ok ? "ok" : start.error, a.canStartRealization ? "ok" : "permesso_mancante", `${name} · avvia`);
  }
});

test("decisionActorFor: l'id di chi decide, revisore e Lateral Space dalle abilità", () => {
  assert.deepEqual(decisionActorFor(PEOPLE.lsLead), { userId: LS_ID, isReviewer: true, isLateralSpace: true });
  assert.deepEqual(decisionActorFor(PEOPLE.aiBuilder), { userId: CLIENT_ID, isReviewer: true, isLateralSpace: false });
  assert.deepEqual(decisionActorFor(PEOPLE.contributor), { userId: CLIENT_ID, isReviewer: false, isLateralSpace: false });
});

// ─── D13: proposte proprie ───────────────────────────────────────────

test("isOwnProposal: id utente oppure email, l'email senza distinguere maiuscole", () => {
  const me = { userId: CLIENT_ID, email: "Ada.Rossi@cliente.test", emailVerified: true };
  assert.equal(isOwnProposal(me, { proposedBy: CLIENT_ID }), true);
  assert.equal(isOwnProposal(me, { proposedBy: "ada.rossi@cliente.test" }), true);
  assert.equal(isOwnProposal(me, { proposedBy: "ADA.ROSSI@CLIENTE.TEST" }), true);
  assert.equal(isOwnProposal(me, { proposedBy: "  ada.rossi@cliente.test " }), true);
  assert.equal(isOwnProposal({ userId: CLIENT_ID, email: null, emailVerified: false }, { proposedBy: CLIENT_ID }), true);
  assert.equal(isOwnProposal({ userId: null, email: "ada.rossi@cliente.test", emailVerified: true }, { proposedBy: "ada.rossi@cliente.test" }), true);
});

test("isOwnProposal: l'email conta solo se verificata; l'id utente sempre", () => {
  // Un account nuovo con un'email altrui non verificata: le proposte salvate con quell'email
  // (modulo v1, connettore senza nome) non diventano sue.
  const unverified = { userId: OTHER_ID, email: "ada.rossi@cliente.test", emailVerified: false };
  assert.equal(isOwnProposal(unverified, { proposedBy: "ada.rossi@cliente.test" }), false);
  assert.equal(isOwnProposal(unverified, { proposedBy: "ADA.ROSSI@CLIENTE.TEST" }), false);
  assert.equal(isOwnProposal(unverified, { proposedBy: OTHER_ID }), true, "l'id non dipende dall'email");
  // Solo `true` vale come verificata (dati che arrivano da fuori il tipo).
  for (const emailVerified of [undefined, null, "true", 1]) {
    const v = { userId: null, email: "ada.rossi@cliente.test", emailVerified } as unknown as UseCaseViewer;
    assert.equal(isOwnProposal(v, { proposedBy: "ada.rossi@cliente.test" }), false, String(emailVerified));
  }
  assert.equal(isOwnReceipt(unverified, { source: "web_proposed", proposedBy: "ada.rossi@cliente.test" }), false);
  assert.equal(isOwnReceipt(unverified, { source: "learning", proposedBy: OTHER_ID }), true);

  // Contributore non verificato: né codice né nota, e niente schede nascoste per l'email.
  const contributorUnverified: UseCaseViewer = { ...viewer("contributor", false, OTHER_ID), emailVerified: false };
  const theirs = row({ proposedBy: "ada.rossi@cliente.test" });
  const theirsHidden = row({ proposedBy: "ada.rossi@cliente.test", intake: { hiddenFromSearch: true } as Record<string, unknown> });
  assert.equal(projectForContributor(contributorUnverified, theirs)?.own, false);
  assert.equal(projectForContributor(contributorUnverified, theirsHidden), null);
  assert.equal(canSeeUseCase(contributorUnverified, theirsHidden), false);
  assert.equal(projectForContributor({ ...contributorUnverified, emailVerified: true }, theirs)?.own, true);
});

test("isOwnProposal: falso con proposto da nullo, id Slack, etichetta o un'altra persona", () => {
  const me = { userId: CLIENT_ID, email: "ada.rossi@cliente.test", emailVerified: true };
  for (const proposedBy of [null, undefined, "", "   ", "U024BE7LH", "AI Readiness respondent", "Corso AI per il team", OTHER_ID, "bruno@cliente.test", "ada.rossi@cliente2.test", "x.ada.rossi@cliente.test"]) {
    assert.equal(isOwnProposal(me, { proposedBy }), false, String(proposedBy));
  }
  // Chi non ha id né email non possiede nulla, nemmeno le schede senza proponente.
  assert.equal(isOwnProposal({ userId: null, email: null, emailVerified: true }, { proposedBy: null }), false);
  assert.equal(isOwnProposal({ userId: "", email: "", emailVerified: true }, { proposedBy: "" }), false);
  // L'id si confronta con l'id, mai con un'email; un'etichetta non vale come email.
  assert.equal(isOwnProposal({ userId: null, email: "AI Readiness respondent", emailVerified: true }, { proposedBy: "AI Readiness respondent" }), false);
});

test("isOwnReceipt: modulo web o corsi, e proposta propria per id e per email (§5.5)", () => {
  const me = { userId: CLIENT_ID, email: "ada.rossi@cliente.test", emailVerified: true };
  assert.deepEqual(RECEIPT_SOURCES, ["web_proposed", "learning"]);
  assert.equal(isOwnReceipt(me, { source: "web_proposed", proposedBy: "Ada.Rossi@cliente.test" }), true, "modulo web: email");
  assert.equal(isOwnReceipt(me, { source: "web_proposed", proposedBy: CLIENT_ID }), true, "modulo web senza email: id");
  assert.equal(isOwnReceipt(me, { source: "learning", proposedBy: CLIENT_ID }), true, "corsi: id");
  assert.equal(isOwnReceipt(me, { source: "learning", proposedBy: "ada.rossi@cliente.test" }), true, "corsi: email");
  assert.equal(isOwnReceipt(me, { source: "web_proposed", proposedBy: OTHER_ID }), false, "di un altro");
  for (const source of ["slack_proposed", "claude_connector", "team_mcp", "manual", null, undefined]) {
    assert.equal(isOwnReceipt(me, { source, proposedBy: CLIENT_ID }), false, String(source));
  }
});

// ─── D4 e D13: visibilità e proiezione del contributore ─────────────

function row(overrides: Partial<ContributorSourceRow> = {}): ContributorSourceRow {
  return {
    id: "00000000-0000-4000-8000-000000000e01",
    title: "Smistamento richieste",
    code: "XX-0012",
    proposedBy: OTHER_ID,
    status: "proposed",
    portfolioReviewStatus: "in_review",
    reviewedBy: null,
    publicNote: "Quante richieste arrivano a settimana?",
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

const me = PEOPLE.contributor;
const mine = (overrides: Partial<ContributorSourceRow> = {}) => row({ proposedBy: "ada.rossi@cliente.test", ...overrides });

test("ContributorUseCase: di una proposta altrui esattamente id, title, phase, subState, phaseLabel, quando, own", () => {
  const out = projectForContributor(me, row({ status: "accepted", targetQuarter: "2027-Q1" }))!;
  assert.deepEqual(Object.keys(out).sort(), ["id", "own", "phase", "phaseLabel", "quando", "subState", "title"]);
  assert.deepEqual(out, {
    id: "00000000-0000-4000-8000-000000000e01",
    title: "Smistamento richieste",
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T1 2027",
    quando: "T1 2027",
    own: false,
  });
  if (!out.own) {
    // @ts-expect-error una proposta altrui non ha il codice
    assert.equal(out.code, undefined);
    // @ts-expect-error né la nota pubblica
    assert.equal(out.publicNote, undefined);
  }
});

test("ContributorUseCase: di una propria in più solo code e publicNote", () => {
  const out = projectForContributor(me, mine({ reviewedBy: LS_ID, portfolioReviewStatus: "needs_inputs" }))!;
  assert.deepEqual(Object.keys(out).sort(), ["code", "id", "own", "phase", "phaseLabel", "publicNote", "quando", "subState", "title"]);
  assert.deepEqual(out, {
    id: "00000000-0000-4000-8000-000000000e01",
    title: "Smistamento richieste",
    phase: "da_valutare",
    subState: "serve_info",
    phaseLabel: "Da valutare · Serve info",
    quando: null,
    own: true,
    code: "XX-0012",
    publicNote: "Quante richieste arrivano a settimana?",
  });
  // Nota vuota o di soli spazi: nessuna nota; senza codice: null.
  const bare = projectForContributor(me, mine({ publicNote: "   ", code: null }))!;
  assert.equal(bare.own, true);
  if (bare.own) {
    assert.equal(bare.publicNote, null);
    assert.equal(bare.code, null);
  }
});

test("ContributorUseCase: per un doppione phaseLabel senza il codice dell'altra, anche su una propria", () => {
  const dup = { portfolioReviewStatus: "archived" as const, intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" }, duplicateOfCode: "XX-0007" };
  for (const r of [row(dup), mine(dup)]) {
    const out = projectForContributor(me, r)!;
    assert.equal(out.phaseLabel, "Chiuso · Doppione");
    assert.ok(!JSON.stringify(out).includes("XX-0007"), JSON.stringify(out));
  }
});

test("ContributorUseCase: «Quando» solo per gli approvati; nessun dato sul proponente nel risultato", () => {
  assert.equal(projectForContributor(me, row({ status: "accepted" }))!.quando, "Più avanti");
  assert.equal(projectForContributor(me, row({ status: "in_progress", targetQuarter: "2027-Q1" }))!.quando, null);
  assert.equal(projectForContributor(me, row({ portfolioReviewStatus: "scored", reviewBy: "2027-01-14" }))!.quando, null);
  for (const r of [row(), mine()]) {
    const text = JSON.stringify(projectForContributor(me, r));
    assert.ok(!text.includes(OTHER_ID) && !text.includes("ada.rossi"), text);
    assert.ok(!/proposed|proponent|submitter/i.test(text), text);
  }
});

test("schede nascoste alla ricerca: i contributori non le vedono, salvo le proprie; i revisori sì", () => {
  const hidden = { intake: { hiddenFromSearch: true } as Record<string, unknown> };
  assert.equal(isHiddenFromSearch(hidden.intake), true);
  assert.equal(isHiddenFromSearch({ hiddenFromSearch: "true" }), false);
  assert.equal(isHiddenFromSearch(null), false);

  assert.equal(projectForContributor(me, row(hidden)), null);
  assert.equal(projectForContributor(me, mine(hidden))?.own, true);
  assert.equal(canSeeUseCase(me, row(hidden)), false);
  assert.equal(canSeeUseCase(me, mine(hidden)), true);
  assert.equal(canSeeUseCase(me, row()), true);
  for (const person of [PEOPLE.lsLead, PEOPLE.aiBuilder, PEOPLE.clientSponsor]) assert.equal(canSeeUseCase(person, row(hidden)), true);
  for (const person of [PEOPLE.learner, PEOPLE.noRole, PEOPLE.unknownRole]) assert.equal(canSeeUseCase(person, row()), false);

  const list = contributorUseCases(me, [row(), row({ ...hidden, id: "x2" }), mine({ ...hidden, id: "x3" })]);
  assert.deepEqual(
    list.map((item: ContributorUseCase) => [item.id, item.own]),
    [
      ["00000000-0000-4000-8000-000000000e01", false],
      ["x3", true],
    ],
  );
  assert.deepEqual(contributorUseCases(PEOPLE.learner, [row(), mine()]), []);
});

// ─── Nomi (D16) ──────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function hubModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) hubModules(rel, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

/**
 * Le funzioni esportate di un sorgente: dichiarazioni `function`, costanti con una funzione
 * (freccia o `function`) e i loro alias in `export { … }`. Le altre costanti non sono
 * funzioni: D16 lascia stare nomi come `useCaseId` o uno schema zod `useCaseChangesSchema`.
 */
function exportedFunctionNamesOf(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isFunctionValue = (node: ts.Expression | undefined): boolean => {
    let inner = node;
    while (inner && (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner))) inner = inner.expression;
    return !!inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner));
  };
  const localFunctions = new Set<string>();
  const names: string[] = [];
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.add(statement.name.text);
      if (exported(statement)) names.push(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !isFunctionValue(d.initializer)) continue;
        localFunctions.add(d.name.text);
        if (exported(statement)) names.push(d.name.text);
      }
    }
  }
  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const e of statement.exportClause.elements) if (localFunctions.has((e.propertyName ?? e.name).text)) names.push(e.name.text);
    }
  }
  return names;
}

function exportedFunctionNames(file: string): string[] {
  return exportedFunctionNamesOf(readFileSync(join(ROOT, file), "utf8"), file);
}

test("D16: nessuna funzione esportata dei moduli dell'hub si chiama «use» più una maiuscola", () => {
  const files = [...hubModules("src/lib/use-cases"), "src/components/dashboard/nav-active.ts"];
  assert.ok(files.includes("src/lib/use-cases/phase.ts"));
  const offenders = files.flatMap((file) => exportedFunctionNames(file).filter((n) => /^use[A-Z0-9]/.test(n)).map((n) => `${file}: ${n}`));
  assert.deepEqual(offenders, []);
  assert.ok(exportedFunctionNames("src/lib/use-cases/phase.ts").includes("phaseOfUseCase"));
  assert.ok(exportedFunctionNames("src/lib/use-cases/permissions.ts").includes("abilitiesForUseCase"));
});

test("D16: prova del controllo dei nomi", () => {
  const source = [
    "export function useCasePhase() {}",
    "export const useCaseAbilities = (v: unknown) => v, other = 2;",
    "export const useCaseRealization = function () {} as () => void;",
    "export const useCaseChangesSchema = z.object({});",
    "export const useCaseId = \"x\";",
    "export type useT = () => void;",
    "function useLocal() {}",
    "const useValue = 1;",
    "export { useLocal as useAlias, useValue as useValueAlias };",
    "export { useRemote } from \"./other.ts\";",
    "export function phaseOfUseCase() {}",
  ].join("\n");
  assert.deepEqual(exportedFunctionNamesOf(source, "x.ts"), ["useCasePhase", "useCaseAbilities", "useCaseRealization", "phaseOfUseCase", "useAlias"]);
});
