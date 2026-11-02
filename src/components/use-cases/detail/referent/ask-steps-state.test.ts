import test from "node:test";
import assert from "node:assert/strict";
import { REFERENT_LIMITS, type ReferentContactOption, type ReferentGate, type ReferentMemberOption, type UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import { orgWordsOf } from "../../../../lib/use-cases/referent/match.ts";
import { ASK_MODE, MEMBER_PREFIX, NEW_CONTACT, askAgainMode, askPayload, initialAskDraft } from "./ask-dialog-state.ts";
import {
  againLineOf,
  askErrorStep,
  draftToKeep,
  enterQuestions,
  firstStep,
  initialSession,
  mergeTicks,
  okNoticeOf,
  personOf,
  questionsNextLabel,
  questionsOf,
  resumeStep,
  sendLabel,
  stepErrors,
  stepItems,
  toLine,
  type AskNeedInfo,
} from "./ask-steps-state.ts";
import { referentOutcome } from "./referent-outcome.ts";

// «Chiedi al referente» in tre passi (rilascio 4, §4-§10), senza React. Dati sintetici.
const T = REFERENT_UI_TEXT.askDialog;
const N = (i: number) => `${String(i).repeat(8)}-0000-4000-8000-00000000000${i}`;
const [Q1, Q2, Q3, Q4] = [N(1), N(2), N(3), N(4)];
const ORG = orgWordsOf(["Alfa Jet (prova)", "Alfa Jet e Belmonte"]);

function contact(over: Partial<ReferentContactOption> & { id: string; displayName: string }): ReferentContactOption {
  return { roleLabel: null, emailMasked: null, selectable: true, reason: null, team: false, hasOtherRequests: false, ...over };
}
const ALDO = contact({ id: "aaaaaaaa-0000-4000-8000-000000000001", displayName: "Aldo Prova", roleLabel: "Tesoreria", emailMasked: "a•••@alfa.test" });
const LIA: ReferentMemberOption = { userId: "cccccccc-0000-4000-8000-000000000001", displayName: "Lia Esempio", emailMasked: "l•••@alfa.test", team: false };
const needInfo: Record<string, AskNeedInfo> = {
  [Q1]: { title: "Quante fatture al mese?", owner: "Belmonte · Cliente", ownerLabel: "Belmonte" },
  [Q2]: { title: "Chi registra le fatture?", owner: "Tesoreria · Cliente", ownerLabel: "Tesoreria" },
  [Q3]: { title: "Quale gestionale?", owner: "Lia (sistemi)", ownerLabel: "Lia (sistemi)" },
  [Q4]: { title: "Quanto costa un errore?", owner: "Controllo di gestione", ownerLabel: "Controllo di gestione" },
};
const panel: Pick<UseCaseReferentPanel, "contacts" | "askableNeedIds" | "limits"> = { contacts: [ALDO], askableNeedIds: [Q1, Q2, Q3, Q4], limits: REFERENT_LIMITS };
const people = { ...panel, members: [LIA] };

test("i passi: «A chi», «Cosa chiedi», «Controlla e invia», uno solo «adesso»; «Chiedi di nuovo» parte da «Cosa chiedi»", () => {
  assert.deepEqual(stepItems(1).map((s) => [s.label, s.state]), [[T.steps.who, "adesso"], [T.steps.what, "dopo"], [T.steps.check, "dopo"]]);
  assert.deepEqual(stepItems(2).map((s) => s.state), ["fatto", "adesso", "dopo"]);
  assert.deepEqual(stepItems(3).map((s) => s.state), ["fatto", "fatto", "adesso"]);
  for (const n of [1, 2, 3] as const) assert.equal(stepItems(n).filter((s) => s.state === "adesso").length, 1);
  assert.equal(firstStep(ASK_MODE), 1);
  const again = askAgainMode({ id: "bbbbbbbb-0000-4000-8000-000000000001", status: "scaduta", contact: { id: ALDO.id, name: ALDO.displayName, roleLabel: null, emailMasked: null, hubOnly: true } });
  assert.equal(firstStep(again), 2);
  assert.equal(initialSession(initialAskDraft(panel, again, { needIds: [Q2] }), panel, again).step, 2);
});

test("«Avanti» di ogni passo: dice cosa manca, mai si spegne", () => {
  const draft = initialAskDraft(panel);
  assert.deepEqual(stepErrors(1, draft, people), { contact: T.whoMissing });
  assert.deepEqual(stepErrors(1, { ...draft, choice: NEW_CONTACT, name: "A", email: "x" }, people), { displayName: REFERENT_ERROR_MESSAGES.dati_non_validi, email: REFERENT_ERROR_MESSAGES.email_non_valida });
  assert.deepEqual(stepErrors(1, { ...draft, choice: ALDO.id }, people), {}, "le domande non contano ancora in «A chi»");
  assert.deepEqual(stepErrors(1, { ...draft, choice: `${MEMBER_PREFIX}${LIA.userId}` }, people), {});
  assert.deepEqual(stepErrors(2, { ...draft, choice: ALDO.id }, people), { needIds: REFERENT_ERROR_MESSAGES.nessuna_domanda });
  assert.equal(REFERENT_ERROR_MESSAGES.nessuna_domanda, "Scegli almeno una domanda aperta.");
  const tooMany = Array.from({ length: 21 }, (_, i) => `id-${i}`);
  assert.deepEqual(stepErrors(2, { ...draft, choice: ALDO.id, needIds: tooMany }, people), { needIds: REFERENT_ERROR_MESSAGES.troppe_domande });
  assert.deepEqual(stepErrors(2, { ...draft, choice: ALDO.id, needIds: [Q1], message: "x".repeat(1001) }, people), { message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo });
  assert.deepEqual(stepErrors(3, { ...draft }, people), {}, "«Controlla e invia» non ha controlli suoi: li rifà il server");
  assert.equal(questionsNextLabel(0), "Avanti · 0 domande");
  assert.equal(questionsNextLabel(1), "Avanti · 1 domanda");
  assert.equal(questionsNextLabel(3), "Avanti · 3 domande");
});

test("la persona scelta: referente, persona del workspace, persona nuova, o quella della richiesta in «Chiedi di nuovo»", () => {
  const draft = initialAskDraft(panel);
  assert.equal(personOf(draft, people), null);
  assert.deepEqual(personOf({ ...draft, choice: ALDO.id }, people), { key: `c:${ALDO.id}`, kind: "referente", revealId: ALDO.id, displayName: "Aldo Prova", roleLabel: "Tesoreria", email: "a•••@alfa.test" });
  assert.deepEqual(personOf({ ...draft, choice: `${MEMBER_PREFIX}${LIA.userId}` }, people), { key: `m:${LIA.userId}`, kind: "persona", revealId: LIA.userId, displayName: "Lia Esempio", roleLabel: null, email: "l•••@alfa.test" });
  assert.deepEqual(personOf({ ...draft, choice: NEW_CONTACT, name: "  Bruna   Esempio ", email: " bruna@alfa.test ", role: " Tesoreria " }, people), {
    key: "n:bruna esempio|tesoreria",
    kind: "nuova",
    revealId: null,
    displayName: "Bruna Esempio",
    roleLabel: "Tesoreria",
    email: "bruna@alfa.test",
  });
  assert.equal(personOf({ ...draft, choice: NEW_CONTACT }, people), null);
  // Una persona del workspace non più nell'elenco: nessuna persona.
  assert.equal(personOf({ ...draft, choice: `${MEMBER_PREFIX}${LIA.userId}` }, { ...panel, members: [] }), null);
  const request = { id: "bbbbbbbb-0000-4000-8000-000000000001", status: "scaduta" as const, contact: { id: "dddddddd-0000-4000-8000-000000000001", name: "Ex Referente", roleLabel: "Acquisti", emailMasked: "e•••@alfa.test", hubOnly: true } };
  const again = askAgainMode(request);
  assert.equal(personOf(initialAskDraft(panel, again, { needIds: [] }), people, again, request)?.displayName, "Ex Referente", "anche se non è più tra i referenti");
});

test("«Cosa chiedi»: le domande della persona e le generiche spuntate, le altre a parte con il loro «Chi»; nessuna che la nomini: tutte, nessuna spuntata", () => {
  const forAldo = questionsOf({ askableNeedIds: panel.askableNeedIds, needInfo, person: { displayName: "Aldo Prova", roleLabel: "Tesoreria" }, orgWords: ORG });
  assert.equal(forAldo.questions.layout, "split");
  if (forAldo.questions.layout !== "split") return;
  assert.deepEqual(forAldo.proposed, [Q1, Q2]);
  assert.deepEqual(forAldo.questions.proposed.map((q) => [q.id, q.meta]), [[Q1, null], [Q2, null]]);
  assert.deepEqual(forAldo.questions.others.map((q) => [q.id, q.title, q.meta]), [
    [Q3, "Quale gestionale?", "Lia (sistemi)"],
    [Q4, "Quanto costa un errore?", "Controllo di gestione"],
  ]);
  // Lia: la sua e la generica.
  assert.deepEqual(questionsOf({ askableNeedIds: panel.askableNeedIds, needInfo, person: { displayName: "Lia Esempio", roleLabel: null }, orgWords: ORG }).proposed, [Q1, Q3]);
  // Nessuna per la persona e niente di generico: tutte, non spuntate.
  const none = questionsOf({ askableNeedIds: [Q2, Q4], needInfo, person: { displayName: "Bruna Esempio", roleLabel: null }, orgWords: ORG });
  assert.deepEqual(none, { questions: { layout: "all", items: [{ id: Q2, title: "Chi registra le fatture?", meta: null }, { id: Q4, title: "Quanto costa un errore?", meta: null }] }, proposed: [], fresh: [] });
  // Nessuna per la persona ma una generica (Q1, il «Chi» dice solo l'azienda): tutte, aperte e non
  // spuntate; la generica non si propone da sola a chi nessun «Chi» nomina.
  const onlyGeneric = questionsOf({ askableNeedIds: panel.askableNeedIds, needInfo, person: { displayName: "Bruna Esempio", roleLabel: null }, orgWords: ORG });
  assert.deepEqual(onlyGeneric.questions, { layout: "all", items: [Q1, Q2, Q3, Q4].map((id) => ({ id, title: needInfo[id].title, meta: null })) });
  assert.deepEqual([onlyGeneric.proposed, onlyGeneric.fresh], [[], [Q1]]);
  // Lo stesso con un ruolo che dice solo l'azienda («Responsabile Belmonte»).
  assert.equal(questionsOf({ askableNeedIds: panel.askableNeedIds, needInfo, person: { displayName: "Dario Esempio", roleLabel: "Responsabile Belmonte" }, orgWords: ORG }).questions.layout, "all");
  // Dopo «Prepara le domande» (Q5, generica, arrivata a finestra aperta): arriva spuntata, Q1 no.
  const Q5 = N(5);
  const prepared = { ...needInfo, [Q5]: { title: "Quante volte al mese?", owner: null, ownerLabel: null } };
  const after = questionsOf({ askableNeedIds: [Q1, Q2, Q3, Q4, Q5], needInfo: prepared, person: { displayName: "Bruna Esempio", roleLabel: null }, orgWords: ORG });
  assert.equal(after.questions.layout, "all");
  assert.deepEqual(mergeTicks([], [Q1, Q2, Q3, Q4], [Q1, Q2, Q3, Q4, Q5], after.fresh), [Q5]);
  // Niente da chiedere: solo «Prepara le domande».
  assert.deepEqual(questionsOf({ askableNeedIds: [], needInfo, person: { displayName: "x", roleLabel: null }, orgWords: ORG }), { questions: { layout: "empty" }, proposed: [], fresh: [] });
  // «Chiedi di nuovo»: le domande di prima, mai i nomi.
  assert.deepEqual(questionsOf({ askableNeedIds: panel.askableNeedIds, needInfo, person: { displayName: "Lia Esempio", roleLabel: null }, orgWords: ORG, previous: [Q4] }).proposed, [Q4]);
});

test("cambiare persona rifà le spunte; tornare con la stessa tiene quelle di chi guarda", () => {
  let session = initialSession(initialAskDraft(panel), panel);
  const aldo = { key: `c:${ALDO.id}` };
  session = enterQuestions({ ...session, draft: { ...session.draft, choice: ALDO.id } }, aldo, [Q1, Q2], 20);
  assert.deepEqual([session.step, session.draft.needIds, session.ticksFor], [2, [Q1, Q2], aldo.key]);
  // Chi guarda toglie Q2, torna ad «A chi» e riprende la stessa persona: la sua scelta resta.
  session = { ...session, step: 1, draft: { ...session.draft, needIds: [Q1] } };
  session = enterQuestions(session, aldo, [Q1, Q2], 20);
  assert.deepEqual(session.draft.needIds, [Q1]);
  // Un'altra persona: le spunte si rifanno.
  session = enterQuestions({ ...session, step: 1 }, { key: `m:${LIA.userId}` }, [Q1, Q3], 20);
  assert.deepEqual(session.draft.needIds, [Q1, Q3]);
  // Più di 20 proposte: le prime 20.
  const many = Array.from({ length: 25 }, (_, i) => `id-${i}`);
  assert.equal(enterQuestions({ ...session, ticksFor: null }, { key: "x" }, many, 20).draft.needIds.length, 20);
});

test("le domande cambiano a finestra aperta: restano le spunte, le nuove proposte arrivano spuntate (non in «Chiedi di nuovo»)", () => {
  const again = askAgainMode({ id: "bbbbbbbb-0000-4000-8000-000000000001", status: "scaduta", contact: { id: ALDO.id, name: ALDO.displayName, roleLabel: null, emailMasked: null, hubOnly: true } });
  // Q3 e Q4 nuove (preparate): Q3 proposta, Q4 no; Q2 non si chiede più.
  assert.deepEqual(mergeTicks([Q1, Q2], [Q1, Q2], [Q1, Q3, Q4], [Q1, Q3]), [Q1, Q3]);
  assert.deepEqual(mergeTicks([Q1, Q2], [Q1, Q2], [Q1, Q3, Q4], [Q1, Q3], again), [Q1]);
  assert.deepEqual(mergeTicks([Q3.toUpperCase()], [Q3], [Q4, Q3], [Q4]), [Q4, Q3]);
});

test("il contenuto dell'action è quello di sempre, nei due modi", () => {
  const draft = { ...initialAskDraft(panel), choice: `${MEMBER_PREFIX}${LIA.userId}`, needIds: [Q3, Q1], message: " Grazie " };
  assert.deepEqual(askPayload(draft, panel), { contact: { kind: "membro", userId: LIA.userId }, needIds: [Q1, Q3], message: "Grazie" });
  const request = { id: "bbbbbbbb-0000-4000-8000-000000000001", status: "inviata" as const, contact: { id: ALDO.id, name: ALDO.displayName, roleLabel: null, emailMasked: null, hubOnly: true }, needIds: [Q2] };
  const again = askAgainMode(request);
  assert.deepEqual(askPayload(initialAskDraft(panel, again, request), panel, again), { contact: { kind: "esistente", contactId: ALDO.id }, needIds: [Q2], message: null, previousRequestId: request.id });
});

test("gli errori del server tornano al loro passo, nei due modi", () => {
  const again = askAgainMode({ id: "bbbbbbbb-0000-4000-8000-000000000001", status: "scaduta", contact: { id: ALDO.id, name: ALDO.displayName, roleLabel: null, emailMasked: null, hubOnly: true } });
  const fail = (code: string, fieldErrors?: Record<string, string>) => ({ ok: false as const, code, message: REFERENT_ERROR_MESSAGES[code] ?? "x", ...(fieldErrors ? { fieldErrors } : {}) });
  for (const code of ["referente_non_valido", "persona_non_disponibile", "richiesta_aperta", "email_in_uso", "referente_lateral_space", "referente_sei_tu", "referente_disattivato"]) {
    assert.equal(askErrorStep(fail(code)).step, 1, code);
    assert.equal(askErrorStep(fail(code), again).step, 3, `${code}, «Chiedi di nuovo»`);
  }
  assert.equal(askErrorStep(fail("x", { email: "e" })).step, 1);
  for (const code of ["nessuna_domanda", "troppe_domande", "domande_cambiate", "messaggio_troppo_lungo"]) assert.equal(askErrorStep(fail(code)).step, 2, code);
  assert.equal(askErrorStep(fail("titolo_non_valido", { needIds: "Nella domanda…" })).step, 2);
  assert.deepEqual(askErrorStep(fail("domande_cambiate")), { step: 2, close: false, refresh: true });
  // Un motivo arrivato nel frattempo (una corsa): si resta su «Controlla e invia» e la pagina si rilegge.
  for (const code of ["sub_responsabili_mancanti", "email_non_configurata", "risposte_non_attive", "email_non_verificata"]) assert.deepEqual(askErrorStep(fail(code)), { step: 3, close: false, refresh: true }, code);
  assert.deepEqual(askErrorStep(fail("riprova")), { step: 3, close: false, refresh: false });
  for (const code of ["non_trovato", "funzione_spenta", "permesso_mancante"]) assert.equal(askErrorStep(fail(code)).close, true, code);
});

test("riaprendo: lo stesso passo se tutto prima vale ancora, altrimenti il primo che non vale", () => {
  const base = { ...initialAskDraft(panel), choice: `${MEMBER_PREFIX}${LIA.userId}`, needIds: [Q1, Q3] };
  assert.equal(resumeStep({ step: 3, draft: base }, people), 3);
  assert.equal(resumeStep({ step: 2, draft: base }, people), 2);
  assert.equal(resumeStep({ step: 1, draft: base }, people), 1);
  // La persona non è più nell'elenco: «A chi».
  assert.equal(resumeStep({ step: 3, draft: base }, { ...panel, members: [] }), 1);
  // Le spunte non si chiedono più: «Cosa chiedi».
  assert.equal(resumeStep({ step: 3, draft: base }, { ...people, askableNeedIds: [Q2, Q4] }), 2);
  // Una persona nuova scritta resta valida.
  assert.equal(resumeStep({ step: 3, draft: { ...base, choice: NEW_CONTACT, name: "Bruna Esempio", email: "bruna@alfa.test" } }, { ...panel, members: [] }), 3);
});

test("dopo l'invio: la finestra si chiude con «Richiesta inviata a …», la bozza si cancella; chiusa senza inviare la bozza resta", () => {
  const outcome = referentOutcome({ ok: true, data: { requestId: "x" }, message: "Richiesta inviata a Lia Esempio." }, { inDialog: true });
  assert.deepEqual([outcome.close, outcome.toast], [true, { kind: "success", text: "Richiesta inviata a Lia Esempio." }]);
  assert.equal(REFERENT_UI_TEXT.toasts.sent, "Richiesta inviata a {Nome}.");
  const session = initialSession({ ...initialAskDraft(panel), choice: ALDO.id }, panel);
  assert.equal(draftToKeep("ask", true, session), null, "inviata: niente da riprendere");
  assert.equal(draftToKeep("ask", false, session), session, "chiusa: si riprende");
  assert.equal(draftToKeep("again", false, session), null, "«Chiedi di nuovo» non si tiene");
});

const SUB: ReferentGate = { code: "sub_responsabili_mancanti", message: "m", canDeclare: true, settingsHref: "/x", linkLabel: "Apri Impostazioni" };
const EMAIL: ReferentGate = { code: "email_non_configurata", message: REFERENT_UI_TEXT.gates.emailNotConfigured };

test("l'ok sui fornitori dato in un'altra scheda: «Ok di … dato.» una volta, «Puoi inviare.» solo senza altri motivi", () => {
  assert.equal(okNoticeOf({ sawSubGate: false, gatesNow: [], company: "Alfa Jet (prova)" }), null, "mai visto il motivo: niente riga");
  assert.equal(okNoticeOf({ sawSubGate: true, gatesNow: [SUB, EMAIL], company: "Alfa Jet (prova)" }), null, "il motivo c'è ancora");
  assert.equal(okNoticeOf({ sawSubGate: true, gatesNow: [EMAIL], company: "Alfa Jet (prova)" }), "Ok di Alfa Jet (prova) dato.");
  assert.equal(okNoticeOf({ sawSubGate: true, gatesNow: [], company: "Alfa Jet (prova)" }), "Ok di Alfa Jet (prova) dato. Puoi inviare.");
});

test("«A» e «Invia a …»: il nome con l'indirizzo intero quando è arrivato, altrimenti quello coperto", () => {
  const person = { displayName: "Lia Esempio", email: "l•••@alfa.test" };
  assert.equal(toLine(person, null), "Lia Esempio · l•••@alfa.test");
  assert.equal(toLine(person, "lia.esempio@alfa.test"), "Lia Esempio · lia.esempio@alfa.test");
  assert.equal(toLine({ displayName: "Lia Esempio", email: null }, null), "Lia Esempio");
  assert.equal(sendLabel(person), "Invia a Lia Esempio");
  assert.equal(againLineOf("Aldo Prova", "a•••@alfa.test"), "A Aldo Prova · a•••@alfa.test");
});
