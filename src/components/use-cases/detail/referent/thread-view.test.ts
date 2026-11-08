import test from "node:test";
import assert from "node:assert/strict";
import type { ClarifyTarget, ThreadMessageView, UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_THREAD_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import { clarifyViewOf, referentRequestIds, suggestionFor, targetKeyOf, threadLinesOf, turnTextOf } from "./thread-view.ts";

// (Rilascio 6) Che cosa si mostra del filo con il referente sulla scheda. Dati sintetici.

const R1 = "11111111-0000-4000-8000-000000000001";
const R2 = "22222222-0000-4000-8000-000000000002";
const NEED = "aaaaaaaa-0000-4000-8000-000000000001";
const T = REFERENT_THREAD_TEXT;

function msg(m: Partial<ThreadMessageView>): ThreadMessageView {
  return {
    id: `m-${Math.random()}`,
    requestId: R1,
    anchor: "domanda",
    needId: NEED,
    componentKey: null,
    anchorKey: `d:${NEED}`,
    anchorLabel: "Su «Volumi mensili»",
    side: "team",
    kind: "chiarimento",
    header: "Bruna Esempio (team) · 08/11",
    text: "Quante, più o meno?",
    waiting: true,
    canReply: false,
    canDone: false,
    ...m,
  };
}
const target = (t: Partial<ClarifyTarget> = {}): ClarifyTarget => ({ requestId: R1, anchor: "domanda", needId: NEED, componentKey: null, contactName: "Aldo Prova", quote: "Circa 200", pending: null, ...t });

test("le righe del filo: in ordine, della richiesta del referente o di una domanda; un testo cancellato lo dice", () => {
  const messages = [
    msg({ id: "a" }),
    msg({ id: "b", side: "referente", kind: "dubbio", anchor: "generale", needId: null, anchorKey: "g", anchorLabel: "In generale", canReply: true }),
    msg({ id: "c", requestId: R2 }),
    msg({ id: "d", text: null, waiting: false }),
  ];
  const block = threadLinesOf(messages, { requestIds: new Set([R1]), showAnchor: true });
  assert.deepEqual(block.map((l) => `${l.id}:${l.anchorLabel}:${l.reply}`), ["a:Su «Volumi mensili»:false", "b:In generale:true", "d:Su «Volumi mensili»:false"]);
  assert.equal(block[2].text, T.removed);
  assert.equal(block[2].removed, true);
  const need = threadLinesOf(messages, { needId: NEED.toUpperCase(), showAnchor: false });
  assert.deepEqual(need.map((l) => l.id), ["a", "c", "d"], "solo i messaggi della domanda, di ogni richiesta");
  assert.ok(need.every((l) => l.anchorLabel === null));
  assert.deepEqual(threadLinesOf(undefined, { showAnchor: true }), []);
});

test("le richieste del referente: solo quelle della sua persona", () => {
  const panel = {
    referent: { contact: { id: "C1" } },
    requests: [
      { id: R1, contact: { id: "c1" } },
      { id: R2, contact: { id: "c2" } },
    ],
  } as unknown as Pick<UseCaseReferentPanel, "requests" | "referent">;
  assert.deepEqual([...referentRequestIds(panel)], [R1]);
  assert.deepEqual([...referentRequestIds({ ...panel, referent: null })], []);
});

test("«Chiedi un chiarimento», il chiarimento in attesa, il suggerimento dell'AI solo dove si può ancora chiedere", () => {
  assert.equal(clarifyViewOf(null), null);
  assert.deepEqual(clarifyViewOf(target()), { kind: "button", label: T.clarify });
  assert.deepEqual(clarifyViewOf(target({ pending: "Quante?" })), { kind: "pending", text: "Chiarimento in attesa: «Quante?»" });
  assert.equal(targetKeyOf(target()), `d:${NEED}`);
  assert.equal(targetKeyOf(target({ anchor: "beneficio", needId: null, componentKey: "tempo-1" })), "b:tempo-1");
  assert.equal(targetKeyOf(target({ anchor: "generale", needId: null })), "g");
  const suggestions = [
    { id: "s1", requestId: R1, anchorKey: `d:${NEED}`, text: "Quante al mese?" },
    { id: "s2", requestId: R2, anchorKey: "g", text: "Altro" },
  ];
  assert.equal(suggestionFor(suggestions, target())?.id, "s1");
  assert.equal(suggestionFor(suggestions, target({ pending: "Quante?" })), null, "con un chiarimento in attesa no");
  assert.equal(suggestionFor(suggestions, target({ anchor: "generale", needId: null })), null, "un'altra richiesta");
  assert.equal(suggestionFor(undefined, target()), null);
});

test("il turno: «Tocca a noi», «Tocca al referente», niente", () => {
  assert.equal(turnTextOf("team"), "Tocca a noi");
  assert.equal(turnTextOf("referente"), "Tocca al referente");
  assert.equal(turnTextOf(null), null);
  assert.equal(turnTextOf(undefined), null);
});
