import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";

// Le azioni della pagina «Contesto» (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §3.5, §11.3) con le funzioni condivise
// vere: chi non è di Lateral Space non scrive, senza sessione o con solo un corso nessuno scrive, e una scrittura
// rifiutata non aggiorna la pagina. Sessione e accesso finti; il database non c'è: un accesso al database fa fallire
// il test (il rifiuto arriva prima).

type Prova = {
  session: { user: { id: string; email: string; emailVerified: boolean; name: string | null; image: null } } | null;
  /** Il ruolo nel workspace di chi chiama; null: nessun accesso (anche chi segue solo un corso). */
  role: string | null;
  revalidated: string[];
  scheduled: number;
  dbTouched: number;
};
const prova: Prova = { session: null, role: null, revalidated: [], scheduled: 0, dbTouched: 0 };
(globalThis as { __prova?: Prova }).__prova = prova;

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

await installAppModules({
  "@/lib/auth": `export const auth = async () => globalThis.__prova.session;`,
  "@/lib/workspace-access": `
    export async function getCollaboratorAccess() {
      const role = globalThis.__prova.role;
      return role ? { role, workspace: { id: "${WS}", name: "Cliente di prova" }, source: "workspace" } : null;
    }`,
  // Nessun database: ogni accesso si conta e fallisce.
  "@/lib/db": `
    const fail = () => { globalThis.__prova.dbTouched += 1; throw new Error("niente database in questo test"); };
    export const db = new Proxy({}, { get: fail });`,
  "next/cache": `export function revalidatePath(path, type) { globalThis.__prova.revalidated.push(path + (type ? "|" + type : "")); }`,
  "next/server": `export function after() { globalThis.__prova.scheduled += 1; }`,
});
process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
// Alcuni moduli leggono il database da `..` e non da `@/lib/db`: un indirizzo che nessuno ascolta, mai usato.
process.env.DATABASE_URL = "postgresql://prova@127.0.0.1:9/prova";
const actions = await import("../../lib/actions/context.ts");

beforeEach(() => {
  Object.assign(prova, { session: null, role: null, revalidated: [], scheduled: 0, dbTouched: 0 });
});

function signIn(email: string, role: string | null, emailVerified = true) {
  prova.session = { user: { id: "33333333-3333-4333-8333-333333333333", email, emailVerified, name: "Persona di prova", image: null } };
  prova.role = role;
}

/** Le azioni che solo Lateral Space può fare, con argomenti validi. */
const LS_ONLY: ReadonlyArray<[name: string, run: () => Promise<{ ok: boolean; error?: string; message?: string }>]> = [
  ["confirmProposalsAction", () => actions.confirmProposalsAction(WS, [{ id: ID, version: 1 }])],
  ["editProposalAction", () => actions.editProposalAction(WS, ID, 1, { statement: "Il gestionale è SAP Business One." })],
  ["discardProposalsAction", () => actions.discardProposalsAction(WS, [ID])],
  ["writeFactAction", () => actions.writeFactAction(WS, { statement: "Il gestionale è SAP Business One.", section: "sistemi", visibility: "tutti" })],
  ["editFactAction", () => actions.editFactAction(WS, ID, 1, { visibility: "ls" })],
  ["reconfirmFactAction", () => actions.reconfirmFactAction(WS, ID)],
  ["retireFactAction", () => actions.retireFactAction(WS, ID, 1)],
  ["closeCommitmentAction", () => actions.closeCommitmentAction(WS, ID, 1)],
  ["reopenCommitmentAction", () => actions.reopenCommitmentAction(WS, ID, 1)],
  ["closeQuestionAction", () => actions.closeQuestionAction(WS, ID, 1)],
  ["setDocumentVisibilityAction", () => actions.setDocumentVisibilityAction(WS, ID, "tutti")],
];
/** Le azioni che può fare anche il cliente: aggiungere una domanda, togliere un suo documento. */
const EVERYONE: ReadonlyArray<[name: string, run: () => Promise<{ ok: boolean; error?: string; message?: string }>]> = [
  ["addQuestionAction", () => actions.addQuestionAction(WS, { question: "Chi decide sugli acquisti?" })],
  ["removeSourceAction", () => actions.removeSourceAction(WS, ID)],
];

test("il file delle azioni esporta le tredici azioni del piano", () => {
  const names = Object.keys(actions).sort();
  assert.deepEqual(names, [...LS_ONLY, ...EVERYONE].map(([name]) => name).sort());
});

for (const [who, email, role, verified] of [
  ["un revisore del cliente", "rev@cliente.test", "analyst", true],
  ["un contributore del cliente", "con@cliente.test", "contributor", true],
  ["chi ha un indirizzo di Lateral Space non verificato", "ls@ls.test", "transformation_lead", false],
] as const) {
  test(`${who}: ogni azione di Lateral Space risponde «permesso_mancante», senza toccare il database né la pagina`, async () => {
    for (const [name, run] of LS_ONLY) {
      signIn(email, role, verified);
      const result = await run();
      assert.equal(result.ok, false, name);
      assert.equal(result.error, "permesso_mancante", name);
      assert.equal(result.message, "Non hai i permessi per farlo.", name);
    }
    assert.equal(prova.dbTouched, 0);
    assert.deepEqual(prova.revalidated, []);
    assert.equal(prova.scheduled, 0, "nessun «In breve» da riscrivere");
  });
}

test("senza sessione, o con solo un corso (nessun accesso), nessuna azione passa: nemmeno le domande e i documenti", async () => {
  for (const setup of [() => (prova.session = null), () => signIn("lrn@cliente.test", null), () => signIn("ls@ls.test", null)]) {
    for (const [name, run] of [...LS_ONLY, ...EVERYONE]) {
      setup();
      const result = await run();
      assert.deepEqual([result.ok, result.error], [false, "permesso_mancante"], name);
    }
  }
  assert.equal(prova.dbTouched, 0);
  assert.deepEqual(prova.revalidated, []);
  assert.equal(prova.scheduled, 0);
});

test("chi ha il ruolo «learner» (letto dal database) non è Lateral Space neanche con l'indirizzo giusto", async () => {
  signIn("ls@ls.test", "learner");
  for (const [name, run] of LS_ONLY) assert.equal((await run()).error, "permesso_mancante", name);
  assert.equal(prova.dbTouched, 0);
});

test("un id di workspace che non è un UUID: «permesso_mancante» prima di tutto", async () => {
  signIn("ls@ls.test", "transformation_lead");
  const result = await actions.confirmProposalsAction("non-un-id", [{ id: ID, version: 1 }]);
  assert.deepEqual([result.ok, result.ok ? null : result.error], [false, "permesso_mancante"]);
  assert.equal(prova.dbTouched, 0);
});
