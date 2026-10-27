import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findHubForbidden } from "./copy-guard.ts";
import {
  HUB_SIGNAL_LABEL,
  HUB_SIGNAL_PATH,
  USE_CASE_DIGEST_SIGNAL,
  USE_CASE_QUARTER_SIGNAL,
  digestCounts,
  digestSignal,
  dueHubSignalTypes,
  hubSignalHref,
  hubWeeklySignals,
  isFirstMondayOfQuarter,
  quarterSignal,
  type DigestCounts,
  type DigestDossierLookup,
  type DigestRow,
} from "./digest.ts";
import type { ValuationModel } from "./valuation.ts";
import { buildDecideList, buildRoadmap, decideCount, projectHubItem, waitingDays, type HubContext, type HubSourceRow } from "./views.ts";

// Riepilogo settimanale in campanella (docs/use-case/DESIGN.md §14.3, §4.3, §4.5, D8;
// PIANO-LAVORI H4d). Dati inventati: codici XX-0000, nessun testo di scheda.

const TODAY = "2026-10-19"; // lunedì, T4 2026
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

let seq = 0;
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Una riga del riepilogo: di base «Da valutare · Nuova», arrivata il 1° ottobre. */
function row(o: Partial<DigestRow> = {}): DigestRow {
  seq += 1;
  return {
    id: uuid(seq),
    status: "proposed",
    portfolioReviewStatus: "in_review",
    reviewedBy: null,
    publicNote: null,
    intake: null,
    reviewBy: null,
    portfolioKind: "use_case_ai",
    targetQuarter: null,
    submittedAt: new Date("2026-10-01T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    reopenedOn: null,
    ...o,
  };
}

const REVIEWER = "00000000-0000-4000-8000-999999999999";
const noDossiers: DigestDossierLookup = () => null;

/** Uno use case per ogni sotto-stato che conta (o non conta) in «Da decidere». */
const SUB_STATE_ROWS = {
  nuova: () => row(),
  possibileDoppione: () => row({ intake: { possibleDuplicateOf: "XX-0007" } }),
  valutata: () => row({ portfolioReviewStatus: "scored" }),
  daRivedere: () => row({ portfolioReviewStatus: "scored", reviewBy: "2026-10-12" }),
  rimandata: () => row({ portfolioReviewStatus: "scored", reviewBy: "2026-11-30" }),
  serveInfo: () => row({ portfolioReviewStatus: "needs_inputs", reviewedBy: REVIEWER, publicNote: "Manca il volume mensile." }),
  approvato: () => row({ status: "accepted", targetQuarter: "2026-Q4" }),
  chiuso: () => row({ status: "rejected" }),
};

// ═══ Conteggi ════════════════════════════════════════════════════════

test("«da decidere» conta tutto tranne «Serve info»; le «Rimandate» non ancora scadute restano fuori", () => {
  const rows = Object.values(SUB_STATE_ROWS).map((make) => make());
  const counts = digestCounts(rows, TODAY, noDossiers);
  // nuova, possibile doppione, valutata, da rivedere: 4. Serve info, rimandata, approvato, chiuso: fuori.
  assert.equal(counts.toDecide, 4);
  assert.equal(counts.toReview, 1);
});

test("solo «Serve info»: nessuno da decidere, nessuna attesa, nessun riepilogo", () => {
  const counts = digestCounts([SUB_STATE_ROWS.serveInfo(), SUB_STATE_ROWS.serveInfo()], TODAY, noDossiers);
  assert.deepEqual(counts, { toDecide: 0, toReview: 0, oldestWaitingDays: null, notStarted: 0 });
  assert.equal(digestSignal(counts), null);
});

test("l'attesa più lunga ignora le «Serve info», anche se aspettano da più tempo", () => {
  const counts = digestCounts(
    [
      row({ createdAt: new Date("2026-10-09T10:00:00Z"), submittedAt: null }),
      row({
        portfolioReviewStatus: "needs_inputs",
        reviewedBy: REVIEWER,
        publicNote: "Serve un esempio.",
        submittedAt: new Date("2026-06-01T10:00:00Z"),
      }),
    ],
    TODAY,
    noDossiers,
  );
  assert.equal(counts.oldestWaitingDays, 10);
});

test("attesa dall'arrivo: coalesce(submitted_at, created_at), giorno di Roma", () => {
  // Inviata il 7 ottobre: conta l'invio, non la creazione della bozza.
  assert.equal(
    digestCounts([row({ createdAt: new Date("2026-09-01T10:00:00Z"), submittedAt: new Date("2026-10-07T10:00:00Z") })], TODAY, noDossiers).oldestWaitingDays,
    12,
  );
  // Senza invio, la creazione.
  assert.equal(digestCounts([row({ createdAt: new Date("2026-10-07T10:00:00Z"), submittedAt: null })], TODAY, noDossiers).oldestWaitingDays, 12);
  // 6 ottobre alle 23:30 UTC è già il 7 a Roma.
  assert.equal(digestCounts([row({ submittedAt: new Date("2026-10-06T23:30:00Z") })], TODAY, noDossiers).oldestWaitingDays, 12);
});

test("attesa dall'ultimo «Riapri» quando c'è", () => {
  const counts = digestCounts([row({ submittedAt: new Date("2026-03-01T10:00:00Z"), reopenedOn: "2026-10-16" })], TODAY, noDossiers);
  assert.equal(counts.oldestWaitingDays, 3);
});

test("«Da rivedere» aspetta dalla data di revisione", () => {
  const counts = digestCounts(
    [row({ portfolioReviewStatus: "scored", reviewBy: "2026-10-12", submittedAt: new Date("2026-01-10T10:00:00Z") })],
    TODAY,
    noDossiers,
  );
  assert.equal(counts.toReview, 1);
  assert.equal(counts.oldestWaitingDays, 7);
});

test("mai dall'ultimo cambio di stato: una valutazione salvata ieri non azzera l'attesa", () => {
  const scoredYesterday = { ...row({ portfolioReviewStatus: "scored", submittedAt: new Date("2026-09-01T10:00:00Z") }), statusChangedAt: new Date("2026-10-18T10:00:00Z") };
  assert.equal(digestCounts([scoredYesterday as DigestRow], TODAY, noDossiers).oldestWaitingDays, 48);
});

test("arrivata oggi: attesa zero, e la frase sull'attesa non si scrive", () => {
  const counts = digestCounts([row({ submittedAt: new Date("2026-10-19T08:00:00Z") }), row({ submittedAt: new Date("2026-10-19T09:00:00Z") })], TODAY, noDossiers);
  assert.equal(counts.oldestWaitingDays, 0);
  assert.deepEqual(digestSignal(counts), { signalType: USE_CASE_DIGEST_SIGNAL, title: "2 use case da decidere", description: null });
});

test("«approvati non partiti»: trimestre passato e senza avvio, come «Scaduti» della Roadmap", () => {
  const rows = [
    row({ status: "accepted", targetQuarter: "2026-Q3" }), // scaduto
    row({ status: "accepted", targetQuarter: "2025-Q4" }), // scaduto da tempo
    row({ status: "accepted", targetQuarter: "2026-Q3", portfolioKind: "best_practice" }), // da diffondere, scaduto
    row({ status: "accepted", targetQuarter: "2026-Q4" }), // questo trimestre
    row({ status: "accepted", targetQuarter: "2027-Q1" }), // prossimo
    row({ status: "accepted", targetQuarter: null }), // Più avanti
    row({ status: "in_progress", targetQuarter: "2026-Q2" }), // In realizzazione, senza dossier
    row({ status: "implemented", targetQuarter: "2026-Q1" }), // Realizzato
    row({ status: "accepted", targetQuarter: "2026-Q2", portfolioReviewStatus: "archived", intake: { archiveReason: "superato" } }), // Chiuso
  ];
  assert.equal(digestCounts(rows, TODAY, noDossiers).notStarted, 3);
});

test("un approvato con il dossier avviato è partito; senza la lettura dei dossier il numero non si sa", () => {
  const started = row({ status: "accepted", targetQuarter: "2026-Q3" });
  const waiting = row({ status: "accepted", targetQuarter: "2026-Q3" });
  const lookup: DigestDossierLookup = (id) => (id === started.id ? { code: "AB-12", status: "raccolta" } : null);
  assert.equal(digestCounts([started, waiting], TODAY, lookup).notStarted, 1);
  const unknown = digestCounts([started, waiting, SUB_STATE_ROWS.nuova()], TODAY, null);
  assert.equal(unknown.notStarted, null);
  // I conteggi di «Da decidere» restano, come nella pagina senza dossier.
  assert.equal(unknown.toDecide, 1);
  // Il primo lunedì del trimestre il segnale parte lo stesso, senza il numero che non si sa.
  assert.deepEqual(quarterSignal(unknown, "2027-01-04"), {
    signalType: USE_CASE_QUARTER_SIGNAL,
    title: "Nuovo trimestre: rivedi la roadmap",
    description: null,
  });
});

// ═══ Gli stessi numeri della pagina ══════════════════════════════════

const MODEL: ValuationModel = {
  dimensions: { impact: [{ id: "efficiency", weight: 1 }], feasibility: [{ id: "effort", weight: 1, direction: "lower_better" }], esg: [] },
  overall: { impact: 0.6, feasibility: 0.4, esg: 0 },
  thresholds: { highImpact: 3.5, midImpact: 2.5, highFeasibility: 3.5 },
};
const CTX: HubContext = { model: MODEL, esgEnabled: false, today: TODAY };

/** La riga intera della pagina, con le colonne del riepilogo prese da `digest`. */
function pageRow(digest: DigestRow, n: number): HubSourceRow {
  return {
    ...digest,
    code: `XX-${String(n).padStart(4, "0")}`,
    title: `Use case di prova ${n}`,
    description: "Testo di prova.",
    origin: n % 2 ? "adoption" : "transformation",
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: null,
    source: "web_proposed",
    aiLab: null,
    // Un cambio di stato recente su tutte: la pagina non lo guarda, il riepilogo nemmeno.
    statusChangedAt: new Date("2026-10-18T10:00:00Z"),
    version: 1,
    impactEconomic: null,
    impactTime: null,
    impactQuality: null,
    impactCoordination: null,
    impactSocial: null,
    feasibilityData: null,
    feasibilityWorkflow: null,
    feasibilityRisk: null,
    feasibilityTech: null,
    feasibilityTeam: null,
    esgEnvironmental: null,
    esgSocial: null,
    esgGovernance: null,
    realizedOn: null,
  };
}

test("contatore, «da rivedere», attesa del più vecchio e «Scaduti» coincidono con le viste della pagina", () => {
  const rows = [
    ...Object.values(SUB_STATE_ROWS).map((make) => make()),
    row({ submittedAt: new Date("2026-08-20T10:00:00Z") }),
    row({ submittedAt: new Date("2026-02-01T10:00:00Z"), reopenedOn: "2026-10-02" }),
    row({ portfolioReviewStatus: "scored", reviewBy: "2026-09-30", submittedAt: new Date("2026-05-01T10:00:00Z") }),
    row({ status: "accepted", targetQuarter: "2026-Q2" }),
    row({ status: "accepted", targetQuarter: "2026-Q1", portfolioKind: "best_practice" }),
  ];
  const items = rows.map((r, i) => projectHubItem(pageRow(r, i + 1), CTX, null));
  const decide = buildDecideList(items);
  const scaduti = buildRoadmap(items, TODAY).upcoming.find((group) => group.key === "scaduti");
  const counts = digestCounts(rows, TODAY, noDossiers);
  assert.equal(counts.toDecide, decideCount(items));
  assert.equal(counts.toDecide, decide.count);
  assert.equal(counts.toReview, decide.waiting.filter((item) => item.subState === "da_rivedere").length);
  assert.equal(counts.oldestWaitingDays, waitingDays(decide.waiting[0].waitingSince, TODAY));
  assert.equal(counts.notStarted, scaduti?.items.length ?? 0);
  assert.deepEqual(counts, { toDecide: 7, toReview: 2, oldestWaitingDays: 60, notStarted: 2 });
});

// ═══ Primo lunedì del trimestre ══════════════════════════════════════

test("primo lunedì del trimestre: solo il primo lunedì di gennaio, aprile, luglio e ottobre", () => {
  for (const day of ["2026-01-05", "2026-04-06", "2026-07-06", "2026-10-05", "2027-01-04", "2024-04-01", "2025-04-07"]) {
    assert.equal(isFirstMondayOfQuarter(day), true, day);
  }
  for (const day of [
    "2026-10-12", // secondo lunedì
    "2026-10-19", // terzo lunedì
    "2026-11-02", // primo lunedì, ma non di un trimestre
    "2026-12-28",
    "2025-04-01", // martedì 1
    "2026-10-04", // domenica prima del primo lunedì
    "2026-10-06", // martedì dopo
    "2026-02-30", // non esiste
    "2026-10-5",
    "",
  ]) {
    assert.equal(isFirstMondayOfQuarter(day), false, day);
  }
});

// ═══ Testi (§14.3) ═══════════════════════════════════════════════════

test("testi di §14.3: riepilogo e nuovo trimestre", () => {
  assert.deepEqual(digestSignal({ toDecide: 8, toReview: 3, oldestWaitingDays: 12 }), {
    signalType: "use_case_digest",
    title: "8 use case da decidere",
    description: "3 sono da rivedere. Il più vecchio aspetta da 12 giorni.",
  });
  assert.deepEqual(quarterSignal({ notStarted: 4 }, "2027-01-04"), {
    signalType: "use_case_quarter",
    title: "Nuovo trimestre: rivedi la roadmap",
    description: "4 use case approvati non sono partiti.",
  });
});

test("singolari e frasi a zero: lo zero non si mostra", () => {
  assert.deepEqual(digestSignal({ toDecide: 1, toReview: 0, oldestWaitingDays: 1 }), {
    signalType: USE_CASE_DIGEST_SIGNAL,
    title: "1 use case da decidere",
    description: "Aspetta da 1 giorno.",
  });
  assert.equal(digestSignal({ toDecide: 5, toReview: 1, oldestWaitingDays: 0 })?.description, "1 è da rivedere.");
  assert.equal(digestSignal({ toDecide: 5, toReview: 0, oldestWaitingDays: 6 })?.description, "Il più vecchio aspetta da 6 giorni.");
  assert.equal(digestSignal({ toDecide: 0, toReview: 0, oldestWaitingDays: null }), null);
  assert.equal(quarterSignal({ notStarted: 1 }, "2027-01-04")?.description, "1 use case approvato non è partito.");
  // Il trimestre parte comunque il primo lunedì: senza approvati fermi resta il solo titolo.
  assert.deepEqual(quarterSignal({ notStarted: 0 }, "2027-01-04"), {
    signalType: USE_CASE_QUARTER_SIGNAL,
    title: "Nuovo trimestre: rivedi la roadmap",
    description: null,
  });
  assert.equal(quarterSignal({ notStarted: null }, "2027-01-04")?.description, null);
  assert.equal(quarterSignal({ notStarted: 4 }, "2027-01-11"), null);
  assert.equal(quarterSignal({ notStarted: null }, "2027-01-11"), null);
});

test("il segnale del trimestre solo il primo lunedì; il riepilogo ogni settimana", () => {
  const counts: DigestCounts = { toDecide: 8, toReview: 3, oldestWaitingDays: 12, notStarted: 4 };
  assert.deepEqual(
    hubWeeklySignals(counts, "2027-01-04").map((signal) => signal.signalType),
    [USE_CASE_DIGEST_SIGNAL, USE_CASE_QUARTER_SIGNAL],
  );
  assert.deepEqual(
    hubWeeklySignals(counts, "2027-01-11").map((signal) => signal.signalType),
    [USE_CASE_DIGEST_SIGNAL],
  );
  assert.deepEqual(hubWeeklySignals({ toDecide: 0, toReview: 0, oldestWaitingDays: null, notStarted: 2 }, "2027-01-04").map((signal) => signal.signalType), [
    USE_CASE_QUARTER_SIGNAL,
  ]);
  assert.deepEqual(
    hubWeeklySignals({ toDecide: 0, toReview: 0, oldestWaitingDays: null, notStarted: 0 }, "2027-01-04"),
    [{ signalType: USE_CASE_QUARTER_SIGNAL, title: "Nuovo trimestre: rivedi la roadmap", description: null }],
  );
  assert.deepEqual(hubWeeklySignals({ toDecide: 0, toReview: 0, oldestWaitingDays: null, notStarted: null }, "2027-01-11"), []);
});

test("i tipi che il passo rinnova: il riepilogo sempre, il trimestre il primo lunedì", () => {
  assert.deepEqual(dueHubSignalTypes("2027-01-04"), [USE_CASE_DIGEST_SIGNAL, USE_CASE_QUARTER_SIGNAL]);
  assert.deepEqual(dueHubSignalTypes("2026-10-05"), [USE_CASE_DIGEST_SIGNAL, USE_CASE_QUARTER_SIGNAL]);
  for (const day of ["2027-01-11", "2027-01-05", "2026-10-19", "non-una-data"]) assert.deepEqual(dueHubSignalTypes(day), [USE_CASE_DIGEST_SIGNAL], day);
  // Ogni segnale che il passo scrive è di un tipo che quel giorno si rinnova.
  for (const day of ["2027-01-04", "2027-01-11"]) {
    for (const signal of hubWeeklySignals({ toDecide: 3, toReview: 1, oldestWaitingDays: 4, notStarted: 2 }, day)) {
      assert.ok(dueHubSignalTypes(day).includes(signal.signalType), `${day} ${signal.signalType}`);
    }
  }
});

test("i segnali portano solo tipo, titolo e descrizione, con le parole dell'area", () => {
  const signals = hubWeeklySignals({ toDecide: 8, toReview: 3, oldestWaitingDays: 12, notStarted: 4 }, "2027-01-04");
  for (const signal of signals) {
    assert.deepEqual(Object.keys(signal).sort(), ["description", "signalType", "title"]);
    assert.deepEqual(findHubForbidden(`${signal.title} ${signal.description}`, "area"), []);
    assert.ok(!/[—–]/.test(`${signal.title}${signal.description}`), "niente trattini lunghi");
  }
  // Le etichette di Intelligence: titoli, non chiavi.
  assert.deepEqual(HUB_SIGNAL_LABEL, { use_case_digest: "Use case", use_case_quarter: "Roadmap" });
  for (const label of Object.values(HUB_SIGNAL_LABEL)) {
    assert.ok(!/_/.test(label), label);
    assert.deepEqual(findHubForbidden(label, "area"), [], label);
  }
});

test("link dei segnali: Da decidere e Roadmap; nessun link per gli altri tipi", () => {
  const ws = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual(HUB_SIGNAL_PATH, { use_case_digest: "/use-cases?vista=da-decidere", use_case_quarter: "/use-cases?vista=roadmap" });
  assert.equal(hubSignalHref(ws, "use_case_digest"), `/dashboard/${ws}/use-cases?vista=da-decidere`);
  assert.equal(hubSignalHref(ws, "use_case_quarter"), `/dashboard/${ws}/use-cases?vista=roadmap`);
  for (const type of ["new_portfolio_item", "risk_alert", "toString", "__proto__", ""]) assert.equal(hubSignalHref(ws, type), null, type);
});

// ═══ Sorgenti: nessun modello, passo prima del ciclo AI ══════════════

function source(path: string): string {
  return readFileSync(`${ROOT}${path}`, "utf8");
}

const AI_IMPORT = /from\s+["'](?:ai|@ai-sdk\/[^"']+)["']|import\(\s*["'](?:ai|@ai-sdk\/[^"']+)["']\s*\)|generateObject|generateText|streamText/;

test("il passo dell'hub non usa il modello: né l'SDK AI né le sue funzioni", () => {
  for (const path of ["src/lib/use-cases/digest.ts", "src/lib/db/queries/use-case-digest.ts"]) {
    assert.ok(!AI_IMPORT.test(source(path)), path);
  }
});

test("weekly-pulse: il passo dell'hub gira prima del ciclo AI, senza rotte o pianificazioni nuove", () => {
  const route = source("src/app/api/cron/weekly-pulse/route.ts");
  const step = route.indexOf("await runUseCaseDigestStep(");
  assert.ok(step > 0, "il passo dell'hub è nel handler");
  assert.ok(step > route.indexOf("Unauthorized"), "dopo il controllo del segreto del cron");
  // Il segreto si controlla con il controllo dei cron dei Casi d'uso: un segreto assente rifiuta.
  assert.ok(route.includes('checkCronAuthorization(req.headers.get("authorization"), process.env.CRON_SECRET) !== "ok"'));
  assert.ok(!route.includes("Bearer ${process.env.CRON_SECRET}"), "niente confronto che fa passare «Bearer undefined»");
  assert.ok(step < route.indexOf('eq(workspaces.status, "mapping")'), "prima della lettura dei workspace del ciclo AI");
  assert.ok(step < route.indexOf("await generateObject("), "prima della chiamata al modello");
  // vercel.json: una sola pianificazione di weekly-pulse, il lunedì, e nessuna rotta del riepilogo.
  const crons = (JSON.parse(source("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }).crons;
  assert.deepEqual(
    crons.filter((cron) => cron.path === "/api/cron/weekly-pulse"),
    [{ path: "/api/cron/weekly-pulse", schedule: "0 9 * * 1" }],
  );
  // Nessuna rotta del riepilogo. L'unica rotta dell'area è quella di «Chiedi al referente» (scadenze e
  // promemoria, drizzle/0024), che non è il riepilogo.
  assert.ok(!crons.some((cron) => /digest/.test(cron.path)));
  assert.deepEqual(
    crons.filter((cron) => /use-case/.test(cron.path)).map((cron) => cron.path),
    ["/api/cron/use-case-referents"],
  );
});
