import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import type { ReferentRequestView } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import { enableTsxImports } from "./tsx-test-loader.ts";

// (Rilascio 4, §11) Una richiesta di «Richieste inviate»: al massimo un pulsante, il resto in «Altro»
// secondo lo stato; le voci che non si possono usare restano spente con il loro motivo.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
let list: typeof import("./requests-list.tsx");
before(async () => {
  await enableTsxImports();
  const actions = `data:text/javascript,${encodeURIComponent(
    ["remindReferentRequestAction", "retryReferentRequestEmailAction"].map((name) => `export async function ${name}() { throw new Error("non in questa prova"); }`).join("\n"),
  )}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/actions/use-case-referents") return { url: actions, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  list = await import("./requests-list.tsx");
});

const T = REFERENT_UI_TEXT;
type Actions = ReferentRequestView["actions"];
const actions = (over: Partial<Actions> = {}): Actions => ({
  remind: { allowed: true, reason: null },
  add: { allowed: true, reason: null },
  revoke: true,
  askAgain: false,
  retry: false,
  correctEmail: true,
  erase: true,
  ...over,
});
const req = (status: ReferentRequestView["status"], over: Partial<Actions> = {}, silent = false) => ({ status, silent, actions: actions(over) });
const keys = (r: ReturnType<typeof req>, canAskAgain = true) => {
  const shown = list.requestActionsShown(r, true, canAskAgain);
  return { primary: shown.primary, menu: shown.menu.map((m) => m.key) };
};

test("viva: nessun pulsante («Riprova l'invio» se l'email non è partita); in «Altro» promemoria, domande, revoca, email, dati", () => {
  assert.deepEqual(keys(req("inviata")), { primary: null, menu: ["remind", "add", "revoke", "correct", "erase"] });
  assert.deepEqual(keys(req("inviata", { retry: true })).primary, "retry");
});

test("senza risposta: «Chiedi di nuovo» solo a chi può arrivare in fondo; «Riprova l'invio» vince", () => {
  assert.deepEqual(keys(req("inviata", { askAgain: true }, true)), { primary: "askAgain", menu: ["remind", "add", "revoke", "correct", "erase"] });
  assert.equal(keys(req("inviata", { askAgain: true }, true), false).primary, null, "chi non può finire non vede «Chiedi di nuovo»");
  assert.equal(keys(req("inviata", { askAgain: true, retry: true }, true)).primary, "retry");
  assert.deepEqual(keys(req("scaduta", { askAgain: true, remind: { allowed: false, reason: null }, add: { allowed: false, reason: null }, revoke: false })), { primary: "askAgain", menu: ["correct", "erase"] });
});

test("con le risposte: «Revoca il link» e i dati; chiusa: solo i dati; nessun pulsante", () => {
  assert.deepEqual(keys(req("completata", { remind: { allowed: false, reason: null }, add: { allowed: false, reason: T.addReasons.closed } })), { primary: null, menu: ["revoke", "erase"] });
  assert.deepEqual(keys(req("scaduta", { revoke: false, askAgain: false })), { primary: null, menu: ["erase"] });
  assert.deepEqual(keys(req("revocata", { revoke: false })), { primary: null, menu: ["erase"] });
});

test("le voci che non si possono usare restano spente con il loro motivo; chi non chiede non vede niente", () => {
  const shown = list.requestActionsShown(req("inviata", { remind: { allowed: false, reason: T.remindReasons.gate }, add: { allowed: false, reason: T.addReasons.nothing }, correctEmail: false }), true, true);
  assert.deepEqual(
    shown.menu.filter((m) => !m.allowed).map((m) => [m.key, m.reason]),
    [
      ["remind", T.remindReasons.gate],
      ["add", T.addReasons.nothing],
      ["correct", T.correctEmailInDossier],
    ],
  );
  assert.deepEqual(list.requestActionsShown(req("inviata", { askAgain: true }, true), false, true), { primary: null, menu: [] });
});
