import test from "node:test";
import assert from "node:assert/strict";
import {
  READINESS_ANCHOR_TAB,
  READINESS_TABS,
  SYNTHESIS_STEP,
  expectedRespondentsOf,
  insightStatusView,
  insightTypeLabel,
  inviteStatusView,
  maturityLabel,
  personRowView,
  proposalFact,
  questionAudienceOf,
  questionsHref,
  readinessAnchorTarget,
  readinessHref,
  readinessIndexView,
  readinessNextStep,
  readinessStage,
  readinessStatusView,
  readinessSummary,
  readinessTabOf,
  strengthsAndAttention,
  synthesisOf,
  trackLabel,
  visibleReadinessTabs,
  type ReadinessStageInput,
} from "./dashboard-view.ts";
import { READINESS_TEXT, formatScore } from "./dashboard-text.ts";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";

// (Rilascio 10, ondata 7b, docs/ui-10/PROPOSTA-10.md §3.9; audit «Fuori» §5.4, §8.4) La dashboard AI Readiness come
// modello: la tabella stato → pulsante pieno, le quattro schede e le ancore di prima, la riga sotto il titolo, le
// etichette in italiano. Dati inventati.

const WS = "11111111-2222-4333-8444-555555555555";
const AS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const T0 = new Date("2026-11-20T10:00:00Z");
const T1 = new Date("2026-11-21T10:00:00Z");

const base: ReadinessStageInput = { status: "open", hasOpenLink: true, completed: 0, threshold: 5, draftInsights: 0, synthesis: null };
const manager = { manages: true, reviews: true, draftInsights: 0 };

test("the state → filled button table of §3.9, for whoever manages the assessment", () => {
  const rows: Array<[Partial<ReadinessStageInput>, string, string]> = [
    [{ status: "draft", hasOpenLink: false }, "bozza", "Apri la raccolta"],
    [{ hasOpenLink: false }, "senza_link", "Crea il link per tutti"],
    [{}, "aperta", "Copia il link per tutti"],
    [{ completed: 4 }, "aperta", "Copia il link per tutti"],
    [{ completed: 5 }, "sopra_soglia", "Genera la sintesi"],
    [{ completed: 5, hasOpenLink: false }, "sopra_soglia", "Genera la sintesi"],
    [{ completed: 6, draftInsights: 6, synthesis: { responses: 6 } }, "da_rivedere", "Rivedi 6 insight"],
    [{ status: "closed" }, "chiusa", "Scarica il report"],
    [{ status: "archived" }, "chiusa", "Scarica il report"],
  ];
  for (const [patch, stage, label] of rows) {
    const input = { ...base, ...patch };
    const got = readinessStage(input);
    assert.equal(got, stage, JSON.stringify(patch));
    const step = readinessNextStep(got, { ...manager, draftInsights: input.draftInsights });
    assert.equal(step.label, label, stage);
    assert.equal(step.mine, true, stage);
    assert.equal(step.turn, null, stage);
    assert.ok(step.why.length > 10, `${stage}: il «?»`);
  }
});

test(`(revisione 7b) the synthesis is due when there is none, when it was made below the threshold, or after ${SYNTHESIS_STEP} new answers`, () => {
  assert.equal(SYNTHESIS_STEP, 20);
  // Una sintesi a 46 risposte: fino a 65 il passo resta copiare il link (o rivedere gli insight), da 66 si rigenera.
  for (const [completed, stage] of [
    [47, "aperta"],
    [65, "aperta"],
    [66, "sopra_soglia"],
    [120, "sopra_soglia"],
  ] as const) {
    assert.equal(readinessStage({ ...base, completed, synthesis: { responses: 46 } }), stage, String(completed));
  }
  // Ogni risposta nuova non rimette in testa «Genera la sintesi»: con bozze aperte si rivedono, poi si torna al link.
  assert.equal(readinessStage({ ...base, completed: 50, draftInsights: 3, synthesis: { responses: 46 } }), "da_rivedere");
  assert.equal(readinessStage({ ...base, completed: 50, synthesis: { responses: 46 }, hasOpenLink: false }), "senza_link");
  // Con 20 risposte nuove si rigenera anche con le bozze di prima (la sintesi nuova le sostituisce).
  assert.equal(readinessStage({ ...base, completed: 66, draftInsights: 3, synthesis: { responses: 46 } }), "sopra_soglia");
  // Una sintesi nata sotto la soglia (il punto «servono più risposte») torna dovuta appena le risposte bastano.
  assert.equal(readinessStage({ ...base, completed: 5, synthesis: { responses: 2 } }), "sopra_soglia");
  // Una sintesi di cui non si sa il numero non torna dovuta da sola.
  assert.equal(readinessStage({ ...base, completed: 90, synthesis: { responses: null } }), "aperta");
  // Chiusa con insight in bozza: prima la revisione, poi il report.
  assert.equal(readinessStage({ ...base, status: "closed", draftInsights: 2 }), "da_rivedere");
  // Una soglia a 0 vale 1: senza risposte niente sintesi.
  assert.equal(readinessStage({ ...base, threshold: 0 }), "aperta");
});

test("the last synthesis is the latest generated insight, with the answers it was made from", () => {
  assert.equal(synthesisOf([]), null);
  assert.deepEqual(
    synthesisOf([
      { generatedAt: T0, inputScope: { responseCount: 12 } },
      { generatedAt: T1, inputScope: { responseCount: 30 } },
    ]),
    { responses: 30 },
  );
  assert.deepEqual(synthesisOf([{ generatedAt: T1, inputScope: null }]), { responses: null });
  assert.deepEqual(synthesisOf([{ generatedAt: T1, inputScope: { responseCount: "30" } }]), { responses: null });
});

test("whoever cannot take the step sees the state, never a filled button; «Tocca a …» only when the step is someone's", () => {
  const contributor = { manages: false, reviews: false, draftInsights: 4 };
  const reviewer = { manages: false, reviews: true, draftInsights: 4 };
  const expected: Record<string, [string, string | null, boolean]> = {
    bozza: ["Raccolta in bozza", "Tocca a chi gestisce la rilevazione", false],
    senza_link: ["Raccolta aperta", "Tocca a chi gestisce la rilevazione", false],
    aperta: ["Raccolta aperta", null, false],
    sopra_soglia: ["Genera la sintesi", null, true],
    da_rivedere: ["Insight da rivedere", "Tocca a chi gestisce la rilevazione", false],
    chiusa: ["Scarica il report", null, true],
  };
  for (const [stage, [label, turn, mine]] of Object.entries(expected)) {
    const step = readinessNextStep(stage as Parameters<typeof readinessNextStep>[0], reviewer);
    assert.deepEqual([step.label, step.turn, step.mine], [label, turn, mine], `chi valuta: ${stage}`);
  }
  for (const stage of Object.keys(expected)) {
    const step = readinessNextStep(stage as Parameters<typeof readinessNextStep>[0], contributor);
    assert.equal(step.mine, false, `contributore: ${stage}`);
  }
  assert.equal(readinessNextStep("sopra_soglia", contributor).turn, "Tocca a chi valuta gli use case");
  assert.equal(readinessNextStep("da_rivedere", { ...manager, draftInsights: 1 }).label, "Rivedi 1 insight");
});

test("the line under the title: «46 risposte su 120 attese · bastano 5 per i risultati»; the zero is not shown", () => {
  assert.equal(readinessSummary({ completed: 46, expected: 120, threshold: 5 }), "46 risposte su 120 attese · bastano 5 per i risultati");
  assert.equal(readinessSummary({ completed: 1, expected: null, threshold: 5 }), "1 risposta · bastano 5 per i risultati");
  assert.equal(readinessSummary({ completed: 0, expected: 120, threshold: 5 }), "Ancora nessuna risposta · bastano 5 per i risultati");
  assert.equal(readinessSummary({ completed: 1200, expected: 3000, threshold: 1 }), "1.200 risposte su 3.000 attese · basta 1 per i risultati");
  assert.doesNotMatch(readinessSummary({ completed: 0, expected: null, threshold: 5 }), /\b0\b/);
  assert.equal(expectedRespondentsOf({ expectedRespondents: 120 }), 120);
  for (const raw of [null, {}, { expectedRespondents: 0 }, { expectedRespondents: 2.5 }, { expectedRespondents: "120" }]) assert.equal(expectedRespondentsOf(raw), null);
});

test("four tabs, each at its address; the old anchors open their tab", () => {
  assert.deepEqual([...READINESS_TABS], ["risultati", "raccolta", "insight", "impostazioni"]);
  assert.equal(readinessHref(WS, { assessmentId: AS }), `/dashboard/${WS}/ai-readiness?assessment=${AS}`);
  assert.equal(readinessHref(WS, { assessmentId: AS, tab: "risultati" }), `/dashboard/${WS}/ai-readiness?assessment=${AS}`, "Risultati: senza parametro");
  assert.equal(readinessHref(WS, { assessmentId: AS, tab: "raccolta", panel: "invita" }), `/dashboard/${WS}/ai-readiness?assessment=${AS}&scheda=raccolta&apri=invita`);
  assert.equal(readinessHref(WS, { tab: "insight", anchor: "da-rivedere" }), `/dashboard/${WS}/ai-readiness?scheda=insight#da-rivedere`);
  assert.equal(readinessHref(WS), `/dashboard/${WS}/ai-readiness`);
  assert.equal(readinessTabOf("raccolta"), "raccolta");
  assert.equal(readinessTabOf("respondents"), "risultati", "un valore sconosciuto apre Risultati");
  assert.equal(readinessTabOf(undefined), "risultati");
  assert.equal(readinessTabOf("raccolta", ["risultati", "insight", "impostazioni"]), "risultati", "una scheda che chi guarda non vede");
  // Le ancore di prima: «Invita una persona» (`#respondents`) e gli insight (`#intelligence`).
  assert.equal(READINESS_ANCHOR_TAB.respondents, "raccolta");
  assert.equal(READINESS_ANCHOR_TAB.intelligence, "insight");
  const all = [...READINESS_TABS];
  assert.equal(readinessAnchorTarget({ hash: "#respondents", current: "risultati", visible: all, workspaceId: WS, assessmentId: AS }), `/dashboard/${WS}/ai-readiness?assessment=${AS}&scheda=raccolta#persone`);
  assert.equal(readinessAnchorTarget({ hash: "#intelligence", current: "risultati", visible: all, workspaceId: WS, assessmentId: null }), `/dashboard/${WS}/ai-readiness?scheda=insight#da-rivedere`);
  assert.equal(readinessAnchorTarget({ hash: "#respondents", current: "raccolta", visible: all, workspaceId: WS, assessmentId: AS }), null, "già nella sua scheda");
  assert.equal(readinessAnchorTarget({ hash: "#respondents", current: "risultati", visible: ["risultati", "insight", "impostazioni"], workspaceId: WS, assessmentId: AS }), null, "una scheda che chi guarda non vede");
  assert.equal(readinessAnchorTarget({ hash: "#qualcosa", current: "risultati", visible: all, workspaceId: WS, assessmentId: AS }), null);
  assert.equal(readinessAnchorTarget({ hash: "", current: "risultati", visible: all, workspaceId: WS, assessmentId: AS }), null);
});

test("who sees which tab: Raccolta to whoever manages (or with proposed use cases), Insight to reviewers (or with insights)", () => {
  assert.deepEqual(visibleReadinessTabs({ manages: true, reviews: true, proposals: 0, insights: 0 }), ["risultati", "raccolta", "insight", "impostazioni"]);
  assert.deepEqual(visibleReadinessTabs({ manages: false, reviews: true, proposals: 0, insights: 0 }), ["risultati", "insight", "impostazioni"]);
  assert.deepEqual(visibleReadinessTabs({ manages: false, reviews: false, proposals: 0, insights: 0 }), ["risultati", "impostazioni"]);
  assert.deepEqual(visibleReadinessTabs({ manages: false, reviews: false, proposals: 2, insights: 3 }), ["risultati", "raccolta", "insight", "impostazioni"]);
});

test("the Domande page: «Per tutti» at its address, «Referenti» with ?per=referenti", () => {
  assert.equal(questionsHref(WS, AS), `/dashboard/${WS}/ai-readiness/questions/${AS}`);
  assert.equal(questionsHref(WS, AS, "referenti"), `/dashboard/${WS}/ai-readiness/questions/${AS}?per=referenti`);
  assert.equal(questionAudienceOf("referenti"), "referenti");
  assert.equal(questionAudienceOf("altro"), "tutti");
  assert.equal(questionAudienceOf(undefined), "tutti");
});

test("states, insights, invitations and tracks in Italian, with a dot and a word; never the stored key", () => {
  assert.deepEqual(readinessStatusView("open"), { label: "Aperta", tone: "blu" });
  assert.deepEqual(readinessStatusView("draft"), { label: "Bozza", tone: "grigio" });
  assert.deepEqual(readinessStatusView("closed"), { label: "Chiusa", tone: "grigio" });
  assert.equal(readinessStatusView("archived").label, "Archiviata");
  assert.equal(readinessStatusView("qualcosa").label, "Bozza");
  assert.equal(insightTypeLabel("executive_summary"), "Sintesi");
  assert.equal(insightTypeLabel("bottleneck"), "Area più debole");
  assert.equal(insightTypeLabel("non_previsto"), null);
  assert.deepEqual(insightStatusView("draft"), { label: "Da rivedere", tone: "giallo" });
  assert.deepEqual(insightStatusView("approved"), { label: "Approvato", tone: "verde" });
  assert.equal(insightStatusView("reviewed").label, "Visto");
  assert.equal(insightStatusView("rejected").label, "Scartato");
  for (const [key, label] of [["invited", "Link creato"], ["opened", "Link aperto"], ["started", "In corso"], ["completed", "Ha risposto"], ["privacy_deleted", "Dati cancellati"], ["sconosciuto", "Link creato"]]) {
    assert.equal(inviteStatusView(key).label, label, key);
  }
  assert.equal(trackLabel("internal"), "Scheda per i referenti");
  assert.equal(trackLabel("use_case_expert"), "Raccolta di use case");
  assert.equal(trackLabel("everyone"), "Questionario per tutti");
  assert.equal(trackLabel(null), "Questionario per tutti");
  assert.equal(maturityLabel(3.1), "Strutturata");
  assert.equal(maturityLabel(4.6), "AI integrata");
  assert.equal(maturityLabel(null), null);
});

test("the big number: the readiness index on 5 with a comma, the maturity and the weakest area; no number, no index", () => {
  assert.deepEqual(readinessIndexView(3.12, "Processi"), { value: "3,1 su 5", note: "Strutturata · più debole: Processi" });
  assert.deepEqual(readinessIndexView(2, null), { value: "2,0 su 5", note: "Sperimentale" });
  assert.equal(readinessIndexView(null, "Processi"), null);
  assert.equal(formatScore(3.15), "3,2");
});

test("a person: the name, or the e-mail, or «Dal link per tutti»; never the pseudonymous id", () => {
  const row = personRowView({ name: "Prova", surname: "Uno", email: "prova@esempio.it", organizationUnit: "Amministrazione", surveyTrack: "internal", inviteStatus: "completed" });
  assert.deepEqual(row, { title: "Prova Uno", fact: "Scheda per i referenti · Amministrazione", status: { label: "Ha risposto", tone: "verde" } });
  assert.equal(personRowView({ name: null, surname: null, email: "x@esempio.it", organizationUnit: null, surveyTrack: null, inviteStatus: "invited" }).title, "x@esempio.it");
  const anonymous = personRowView({ name: null, surname: null, email: null, organizationUnit: " ", surveyTrack: "everyone", inviteStatus: "opened" });
  assert.equal(anonymous.title, "Dal link per tutti");
  assert.equal(anonymous.fact, "Questionario per tutti · area non indicata");
  assert.equal(personRowView({ name: "Prova", surname: null, email: null, organizationUnit: "IT", role: "Responsabile dei sistemi", surveyTrack: "internal", inviteStatus: "started" }).fact, "Scheda per i referenti · IT · Responsabile dei sistemi");
  assert.equal(proposalFact({ riskLevel: "Alta", frequency: "Ogni settimana" }), "priorità alta · Ogni settimana");
  assert.equal(proposalFact({ riskLevel: null, frequency: null }), null);
});

test("strengths are the two highest sections, attention the two lowest, never the same twice", () => {
  const s = (title: string, score: number) => ({ title, score });
  const got = strengthsAndAttention([s("A", 2), s("B", 4), s("C", 3), s("D", 1), s("E", 5)]);
  assert.deepEqual(got.strengths.map((x) => x.title), ["E", "B"]);
  assert.deepEqual(got.attention.map((x) => x.title), ["D", "A"]);
  const three = strengthsAndAttention([s("A", 2), s("B", 4), s("C", 3)]);
  assert.deepEqual(three.strengths.map((x) => x.title), ["B", "C"]);
  assert.deepEqual(three.attention.map((x) => x.title), ["A"]);
  assert.deepEqual(strengthsAndAttention([]), { strengths: [], attention: [] });
});

test("every text of the dashboard speaks the dashboard's words: no «caso d'uso», no English of the old page", () => {
  const texts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      for (const args of [[3, 5], ["Prova", "Esempio"], ["Prova", 3]]) {
        try {
          const out = fn(...args);
          if (typeof out === "string") texts.push(out);
        } catch {
          // Un testo che vuole altri argomenti: si prova con i successivi.
        }
      }
    } else if (value && typeof value === "object") for (const v of Object.values(value)) walk(v);
  };
  walk(READINESS_TEXT);
  assert.ok(texts.length > 150, `${texts.length} testi`);
  assert.deepEqual(findHubForbiddenIn(texts, "area").map((m) => `«${m.match}» in «${m.text}»`), []);
  const english = /\b(?:survey|assessment|respondent|intelligence|readiness index|roadmap|waves?|bottleneck|pillar|score|guardrails?|draft|open|closed|portfolio|export audit|heatmap)\b/i;
  assert.deepEqual(texts.filter((t) => english.test(t.replace(/AI Readiness/g, ""))), []);
});

