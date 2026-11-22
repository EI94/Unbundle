import test from "node:test";
import assert from "node:assert/strict";
import { SETUP_TOPICS, SETUP_TOPIC_LABELS } from "../../db/use-case-hub-factory-ddl.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  CONSTRUCTION_TEXT,
  CONSTRUCTION_TOPIC_LABEL,
  TASKS_SHOWN,
  agentFoldSummary,
  choicesMade,
  constructionTopicLabel,
  missingChoices,
  projectAction,
  projectStateLine,
  projectTone,
  seesBuildDetails,
  tasksInOrder,
  tasksTally,
  type ProjectActionInput,
} from "./construction.ts";

// (Rilascio 10, §3.5, D9 (a)) La Costruzione: le regole pure della pagina. Dati inventati.

const day = (iso: string) => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" }).format(new Date(iso));
const topics = (n: number) => Object.fromEntries(SETUP_TOPICS.slice(0, n).map((t) => [t, { scelta: `Scelta per ${t}` }]));

test("the ten topics have Italian names on screen (§3.5); the package and the CLI keep theirs", () => {
  assert.deepEqual(Object.keys(CONSTRUCTION_TOPIC_LABEL), [...SETUP_TOPICS]);
  assert.equal(CONSTRUCTION_TOPIC_LABEL.journey, "Percorso dell'utente");
  assert.equal(CONSTRUCTION_TOPIC_LABEL.framework, "Strumenti");
  assert.equal(CONSTRUCTION_TOPIC_LABEL.osservabilita, "Monitoraggio");
  assert.equal(CONSTRUCTION_TOPIC_LABEL.evals_autonomia, "Prove e autonomia");
  for (const label of Object.values(CONSTRUCTION_TOPIC_LABEL)) assert.doesNotMatch(label, /journey|framework|backend|frontend|evals/i, label);
  assert.equal(SETUP_TOPIC_LABELS.journey, "User journey", "PROGETTO.md and the skill keep their names");
  assert.equal(constructionTopicLabel("journey"), "Percorso dell'utente");
  assert.equal(constructionTopicLabel(null, "Strumenti nuovi"), "Strumenti nuovi", "a team decision keeps its own topic");
  assert.equal(constructionTopicLabel("toString", "x"), "x", "only the real topics");
});

test("the project in one line: «8 di 10 scelte», the status as a dot", () => {
  assert.equal(projectStateLine(null, day), CONSTRUCTION_TEXT.notSet);
  assert.equal(projectStateLine({ status: "in_corso", version: 1, approvedAt: null, topics: topics(8) }, day), "In corso · versione 1 · 8 di 10 scelte");
  assert.equal(projectStateLine({ status: "approvato", version: 2, approvedAt: "2026-11-12T10:00:00Z", topics: topics(10) }, day), "Approvato · versione 2 · 10 di 10 scelte · approvato il 12/11/2026");
  assert.equal(choicesMade({ ...topics(3), backend: { scelta: "  " } }), 3, "a blank choice is not a choice");
  assert.deepEqual(missingChoices(topics(8)), ["Monitoraggio", "Prove e autonomia"]);
  assert.equal(CONSTRUCTION_TEXT.missing(missingChoices(topics(9))), "Manca una scelta: Prove e autonomia.");
  assert.deepEqual([projectTone("approvato"), projectTone("da_approvare"), projectTone("in_corso"), projectTone(null)], ["verde", "giallo", "blu", "grigio"]);
});

test("one action for the project, the rules of 8.0a: who sets up, sends, approves, gives the AI Board's ok", () => {
  const base: ProjectActionInput = { hasProject: true, openStatus: null, writer: false, approver: false, needsBoard: false, boardAllowed: false, changeRequested: false };
  assert.deepEqual(projectAction({ ...base, hasProject: false, writer: true }), { action: "imposta", reopenAside: false, filled: true });
  assert.deepEqual(projectAction({ ...base, hasProject: false }), { action: null, reopenAside: false, filled: false }, "the client reads");
  assert.equal(projectAction({ ...base, openStatus: "in_corso", writer: true }).action, "manda");
  assert.deepEqual(projectAction({ ...base, openStatus: "da_approvare", approver: true }), { action: "approva", reopenAside: true, filled: true });
  assert.deepEqual(projectAction({ ...base, openStatus: "da_approvare", approver: true, needsBoard: true }), { action: "ok_board", reopenAside: true, filled: true });
  assert.deepEqual(projectAction({ ...base, openStatus: "da_approvare", approver: true, needsBoard: true, changeRequested: true }), { action: "riapri", reopenAside: false, filled: true });
  assert.equal(projectAction({ ...base, openStatus: "da_approvare", needsBoard: true, boardAllowed: true }).action, "ok_board", "the AI Board");
  assert.equal(projectAction({ ...base, openStatus: "da_approvare", writer: true }).action, null, "who writes does not approve alone");
  assert.deepEqual(projectAction({ ...base, writer: true }), { action: "rivedi", reopenAside: false, filled: false }, "«Rivedi il progetto» is not urgent: outlined");
  // (Review fix 2) The Costruzione is a tab: when the header shows its own filled step here (reconfirm the via, sign,
  // resume…), the project's action is outlined. One filled button per screen.
  assert.deepEqual(projectAction({ ...base, openStatus: "in_corso", writer: true, headerStep: true }), { action: "manda", reopenAside: false, filled: false });
  assert.equal(projectAction({ ...base, openStatus: "da_approvare", approver: true, needsBoard: true, changeRequested: true, headerStep: true }).filled, false);
  assert.equal(projectAction({ ...base, openStatus: "in_corso", writer: true, headerStep: false }).filled, true);
});

test("tasks: the tally hides zeros, the rows start from the ones in progress, three at most in view", () => {
  type S = Parameters<typeof tasksTally>[0][number]["status"];
  const list = (statuses: S[]) => statuses.map((status, i) => ({ status, ref: `T-${i + 1}` }));
  assert.equal(tasksTally(list(["da_fare", "da_fare", "in_corso", "in_revisione", "fatto"])), "2 da prendere · 2 in corso · 1 fatto");
  assert.equal(tasksTally(list(["fatto", "fatto"])), "2 fatti");
  assert.equal(tasksTally(list(["annullato"])), "");
  assert.deepEqual(tasksInOrder(list(["fatto", "da_fare", "in_corso", "annullato", "in_revisione", "da_fare"])).map((t) => t.ref), ["T-5", "T-3", "T-2", "T-6", "T-1", "T-4"]);
  assert.equal(TASKS_SHOWN, 3);
  assert.equal(CONSTRUCTION_TEXT.seeAll(8), "Vedi tutti (8)");
});

test("the details of who builds: builders (also from outside) and Lateral Space; the client reads one sentence", () => {
  assert.equal(seesBuildDetails({ builder: true, lateralSpace: false }), true);
  assert.equal(seesBuildDetails({ builder: false, lateralSpace: true }), true);
  assert.equal(seesBuildDetails({ builder: false, lateralSpace: false }), false);
  assert.equal(agentFoldSummary({ packageShown: true, commandsShown: true, claudeShown: true }), "Pacchetto · comandi · accessi di Claude");
  assert.equal(agentFoldSummary({ packageShown: false, commandsShown: false, claudeShown: true }), "Accessi di Claude");
  assert.equal(agentFoldSummary({ packageShown: false, commandsShown: false, claudeShown: false }), "");
});

test("copy guard: the words a client role can read on the Costruzione are clean, never «caso», gender neutral", () => {
  const T = CONSTRUCTION_TEXT;
  const client = [
    T.project, ...Object.values(T.status), T.notSet, T.version(2), T.choices(8, 10), T.approvedOn("12/11/2026"), T.boardOkNeeded,
    T.changeRequest("12/11/2026"), T.changeRequestOthers, T.changeRequestStays, ...Object.values(T.primary), T.tasks, ...Object.values(T.taskStatus),
    T.noTasks, T.seeAll(8), T.seeFewer, T.taskAreas(["posta"]), T.taskEstimate("3,5"), T.taskEvidence("una prova"), T.choicesTitle, T.choiceTodo,
    T.choiceWhy("x"), T.choiceDropped("y"), T.previous(1, "12/11/2026"), T.toolsTitle, T.noTools, T.boardOk("12/11/2026", null), T.boardOkAfterSubmit,
    T.boardChangeAsked, T.boardOkMissing, T.estimateHours("40"), T.estimateHoursNone, T.estimateCost("120"), T.estimateCostNone, T.decisionsTitle,
    T.decisionsHint, T.decisionsNone, T.decisionsAll(4, 1), T.decisionReplaced("12/11/2026"), T.catalog, T.unavailable, ...Object.values(CONSTRUCTION_TOPIC_LABEL),
  ];
  assert.deepEqual(findForbiddenIn(client, "cliente"), []);
  for (const text of client) {
    assert.doesNotMatch(text, /\b(?:il|del|al|nel|dal|sul|questo|un) caso\b|\bcolleg(?:a|he|hi)\b|\b(?:lui|lei)\b/i, text);
    assert.doesNotMatch(text, /\bcoding agent\b|\bCLI\b|\bcommit\b|\bp95\b|\bramo\b/i, text);
  }
});

test("the Costruzione page: no second H1, closed folds, one action, the client without commands, every 8.2b piece in the details", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/costruzione/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<h1\b|PAGE_TITLE_CLASS|SettingsSection/, "the realization's header has the H1; no settings frames on a work page");
  assert.doesNotMatch(source, /defaultOpen/, "folds closed unless a link opens them");
  for (const fold of ["T.choicesId", "T.decisionsId", "T.contextId", "T.agentId", "QUALITY_ANCHORS.details"]) assert.match(source, new RegExp(`<Fold id=\\{${fold.replace(".", "\\.")}\\}`), fold);
  // One action for the project, outlined when the header shows its own step here (the Persone/Domande pattern).
  assert.equal((source.match(/<ProjectPrimaryAction /g) ?? []).length, 1);
  assert.match(source, /const headerStep = headerStepShownOn\(caseAccess, header, \{ caseBase: casePath\(workspaceId, caseId\), pagePath: base \}\);/);
  assert.match(source, /const \{ action, reopenAside, filled \} = projectAction\(\{[\s\S]*?headerStep,\s*\}\);/);
  assert.match(source, /blocked=\{missing\.length > 0\} filled=\{filled\} \/>/);
  assert.match(source, /primary=\{action === "riapri" && filled\}/);
  // Every 8.2b element stays: the whole evals section, with «dalla CI» and its link for who builds.
  assert.match(source, /<EvalSection overview=\{evals\.overview\} caseCode=\{caseCode\} unavailable=\{evals\.unavailable\} origins=\{evals\.origins\} ciLinks=\{ciLinks\} \/>/);
  assert.match(source, /readEvalOrigins\(executor, target, r\.overview\)/);
  assert.match(source, /const summary = qualitySummary\(evals\.overview, \{ builder: details \}\);/, "the client's roles read one sentence");
  // Branches and the change on GitHub only for who builds; commands only in «Per il coding agent».
  assert.match(source, /details && t\.branch \? T\.taskBranch\(t\.branch\) : null/);
  assert.match(source, /const pr = details && t\.prUrl \? t\.prUrl : null;/);
  assert.match(source, /\{builder \? \(\s*<section aria-labelledby="comandi-titolo"/);
  // Topics in Italian on screen; «Catalogo ›» after the via.
  assert.match(source, /constructionTopicLabel\(topic\)/);
  assert.match(source, /const catalogHref = pastVia && canOpenPage\("voci", roles\)/);
});
