import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules, recordLogs } from "../../lib/ai/claude-test-kit.ts";

// Le azioni della pagina «Contesto» quando la funzione condivisa riesce o no (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md
// §3.5, §11.3): la conferma e le azioni che cambiano un fatto (scritto, modificato, ritirato) programmano «In breve» dopo
// la risposta (`after`), con `force`; ogni azione riuscita aggiorna la pagina (`revalidatePath` di /contesto, con «Da
// confermare» sotto); una non riuscita non aggiorna niente e non programma niente; un errore inatteso risponde
// «riprova» e nei log non porta testi.
// Chi chiama e le funzioni condivise sono finti.

type Call = { fn: string; args: unknown[] };
type Prova = {
  /** Che cosa risponde la funzione condivisa finta. */
  result: unknown;
  throws: boolean;
  actorOk: boolean;
  calls: Call[];
  revalidated: string[];
  /** Le funzioni passate ad `after`, da eseguire a mano. */
  afterTasks: Array<() => unknown>;
  briefs: Array<{ workspaceId: string; opts: unknown }>;
};
const prova: Prova = { result: null, throws: false, actorOk: true, calls: [], revalidated: [], afterTasks: [], briefs: [] };
(globalThis as { __prova?: Prova }).__prova = prova;

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

/** Una funzione condivisa finta: registra gli argomenti e risponde quello che dice il test. */
const fake = (name: string) => `export async function ${name}(...args) {
  globalThis.__prova.calls.push({ fn: "${name}", args });
  if (globalThis.__prova.throws) throw new Error("testo riservato di una proposta");
  return globalThis.__prova.result;
}`;

await installAppModules({
  "@/lib/context/server/actor": `
    export async function contextActorFromSession(workspaceId) {
      if (!globalThis.__prova.actorOk) return { ok: false, status: 404 };
      return { ok: true, actor: { workspaceId, userId: "33333333-3333-4333-8333-333333333333", role: "transformation_lead", isLateralSpace: true, channel: "web" } };
    }`,
  "@/lib/db/queries/context-proposals": [fake("confirmProposals"), fake("editProposal"), fake("discardProposals")].join("\n"),
  "@/lib/db/queries/context-memory": [fake("writeFact"), fake("editFact"), fake("reconfirmFact"), fake("retireFact"), fake("closeCommitment"), fake("reopenCommitment"), fake("closeQuestion"), fake("addQuestion")].join("\n"),
  "@/lib/db/queries/context-sources": [fake("removeContextSource"), fake("setDocumentVisibility")].join("\n"),
  "@/lib/db/queries/context-brief": `export async function refreshContextBrief(workspaceId, opts) { globalThis.__prova.briefs.push({ workspaceId, opts }); return "aggiornato"; }`,
  "next/cache": `export function revalidatePath(path, type) { globalThis.__prova.revalidated.push(path + (type ? "|" + type : "")); }`,
  "next/server": `export function after(task) { globalThis.__prova.afterTasks.push(task); }`,
});
const actions = await import("../../lib/actions/context.ts");

const OK_CONFIRM = { ok: true, value: { confirmed: 2, newFacts: 1, changedFacts: 0, reconfirmed: 1, commitments: 0, questions: 0, remaining: 0 } };

beforeEach(() => {
  Object.assign(prova, { result: { ok: true, value: true }, throws: false, actorOk: true, calls: [], revalidated: [], afterTasks: [], briefs: [] });
});

test("«Conferma»: la funzione condivisa riceve chi chiama e le voci; poi la pagina si aggiorna e «In breve» si riscrive dopo la risposta", async () => {
  prova.result = OK_CONFIRM;
  const items = [
    { id: ID, version: 2 },
    { id: "44444444-4444-4444-8444-444444444444", version: 1, resolution: "ora" as const },
  ];
  const result = await actions.confirmProposalsAction(WS, items);
  assert.deepEqual(result, OK_CONFIRM);
  assert.equal(prova.calls.length, 1);
  const [actor, sent] = prova.calls[0].args as [{ workspaceId: string; isLateralSpace: boolean; channel: string }, unknown];
  assert.deepEqual([actor.workspaceId, actor.isLateralSpace, actor.channel], [WS, true, "web"]);
  assert.deepEqual(sent, items);
  assert.deepEqual(prova.revalidated, [`/dashboard/${WS}/contesto|layout`]);
  // «In breve» non parte durante la risposta: è programmato, e parte solo con `after`.
  assert.equal(prova.afterTasks.length, 1);
  assert.deepEqual(prova.briefs, []);
  await prova.afterTasks[0]();
  assert.deepEqual(prova.briefs, [{ workspaceId: WS, opts: { force: true } }]);
});

test("una conferma non riuscita (versione superata, dati non validi): niente pagina aggiornata, niente «In breve»", async () => {
  for (const failure of [
    { ok: false, error: "versione_superata", message: "Qualcuno l'ha appena cambiato. Aggiorna la pagina e riprova." },
    { ok: false, error: "dati_non_validi", message: "Controlla i campi indicati.", fieldErrors: { [ID]: "Scegli quale tenere." } },
  ]) {
    prova.result = failure;
    prova.revalidated = [];
    prova.afterTasks = [];
    assert.deepEqual(await actions.confirmProposalsAction(WS, [{ id: ID, version: 1 }]), failure);
    assert.deepEqual(prova.revalidated, []);
    assert.equal(prova.afterTasks.length, 0);
  }
});

test("scrivere, modificare o ritirare un fatto: la pagina si aggiorna e «In breve» si riscrive dopo la risposta; se non riesce, niente", async () => {
  const cases: Array<[string, () => Promise<unknown>, string, unknown[]]> = [
    ["writeFactAction", () => actions.writeFactAction(WS, { statement: "Il gestionale è SAP.", section: "sistemi", visibility: "tutti" }), "writeFact", [{ statement: "Il gestionale è SAP.", section: "sistemi", visibility: "tutti" }]],
    // «Solo Lateral Space» su un fatto che «In breve» dice: il cliente non deve continuare a leggerlo lì.
    ["editFactAction", () => actions.editFactAction(WS, ID, 4, { visibility: "ls" }), "editFact", [ID, 4, { visibility: "ls" }]],
    ["retireFactAction", () => actions.retireFactAction(WS, ID, 2), "retireFact", [ID, 2]],
  ];
  for (const [name, run, fn, args] of cases) {
    Object.assign(prova, { calls: [], revalidated: [], afterTasks: [], briefs: [], result: { ok: true, value: { factId: ID } } });
    await run();
    assert.equal(prova.calls[0]?.fn, fn, name);
    assert.deepEqual(prova.calls[0].args.slice(1), args, name);
    assert.deepEqual(prova.revalidated, [`/dashboard/${WS}/contesto|layout`], name);
    assert.equal(prova.afterTasks.length, 1, `${name}: «In breve» programmato`);
    assert.deepEqual(prova.briefs, [], `${name}: non durante la risposta`);
    await prova.afterTasks[0]();
    assert.deepEqual(prova.briefs, [{ workspaceId: WS, opts: { force: true } }], name);
    // Non riuscita: niente pagina aggiornata, niente «In breve».
    Object.assign(prova, { revalidated: [], afterTasks: [], briefs: [], result: { ok: false, error: "versione_superata", message: "Qualcuno l'ha appena cambiato. Aggiorna la pagina e riprova." } });
    await run();
    assert.deepEqual([prova.revalidated, prova.afterTasks.length], [[], 0], name);
  }
});

test("le altre azioni: la funzione giusta, con i suoi argomenti; se riesce la pagina si aggiorna, «In breve» no", async () => {
  const cases: Array<[string, () => Promise<unknown>, string, unknown[]]> = [
    ["editProposalAction", () => actions.editProposalAction(WS, ID, 3, { section: "sistemi" }), "editProposal", [ID, 3, { section: "sistemi" }]],
    ["discardProposalsAction", () => actions.discardProposalsAction(WS, [ID]), "discardProposals", [[ID]]],
    ["reconfirmFactAction", () => actions.reconfirmFactAction(WS, ID), "reconfirmFact", [ID]],
    ["closeCommitmentAction", () => actions.closeCommitmentAction(WS, ID, 1), "closeCommitment", [ID, 1]],
    ["reopenCommitmentAction", () => actions.reopenCommitmentAction(WS, ID, 2), "reopenCommitment", [ID, 2]],
    ["closeQuestionAction", () => actions.closeQuestionAction(WS, ID, 1), "closeQuestion", [ID, 1]],
    ["addQuestionAction", () => actions.addQuestionAction(WS, { question: "Chi decide?" }), "addQuestion", [{ question: "Chi decide?" }]],
    ["removeSourceAction", () => actions.removeSourceAction(WS, ID), "removeContextSource", [ID]],
    ["setDocumentVisibilityAction", () => actions.setDocumentVisibilityAction(WS, ID, "ls"), "setDocumentVisibility", [ID, "ls"]],
  ];
  for (const [name, run, fn, args] of cases) {
    prova.calls = [];
    prova.revalidated = [];
    prova.result = { ok: true, value: { factId: ID } };
    await run();
    assert.equal(prova.calls.length, 1, name);
    assert.equal(prova.calls[0].fn, fn, name);
    assert.deepEqual(prova.calls[0].args.slice(1), args, name);
    assert.deepEqual(prova.revalidated, [`/dashboard/${WS}/contesto|layout`], name);
    // Non riuscita: la pagina non si aggiorna.
    prova.revalidated = [];
    prova.result = { ok: false, error: "non_trovato", message: "Non trovato." };
    assert.deepEqual(await run(), prova.result, name);
    assert.deepEqual(prova.revalidated, [], name);
  }
  assert.equal(prova.afterTasks.length, 0);
  assert.deepEqual(prova.briefs, []);
});

test("chi chiama non entra: «permesso_mancante» e la funzione condivisa non parte", async () => {
  prova.actorOk = false;
  const result = await actions.confirmProposalsAction(WS, [{ id: ID, version: 1 }]);
  assert.deepEqual(result, { ok: false, error: "permesso_mancante", message: "Non hai i permessi per farlo." });
  assert.deepEqual(prova.calls, []);
  assert.deepEqual(prova.revalidated, []);
  assert.equal(prova.afterTasks.length, 0);
});

test("un errore inatteso: «riprova», nei log solo il codice e il workspace, mai il testo", async (t) => {
  const lines = recordLogs(t);
  prova.throws = true;
  const result = await actions.writeFactAction(WS, { statement: "Il gestionale è SAP.", section: "sistemi", visibility: "tutti" });
  assert.deepEqual(result, { ok: false, error: "riprova", message: "Non è riuscito. Riprova tra poco." });
  assert.deepEqual(prova.revalidated, []);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[context\/actions\] fatto_scritto_non_riuscita /);
  assert.match(lines[0], new RegExp(WS));
  assert.doesNotMatch(lines[0], /riservat|SAP/);
});
