import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REFERENT_LIMITS, type ReferentContactOption, type ReferentGate, type ReferentMemberOption, type UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import {
  ASK_MODE,
  MEMBER_PREFIX,
  NEW_CONTACT,
  askAgainMode,
  askDialogEntry,
  askDraftErrors,
  askEntry,
  askErrorView,
  askOtherRequestsHint,
  askPayload,
  askPrepareOffer,
  askSelfHint,
  contactRowLine,
  initialAskDraft,
  memberRowLine,
  mergeAskSelection,
} from "./ask-dialog-state.ts";
import { referentOutcome } from "./referent-outcome.ts";

// La finestra «Chiedi al referente» e «Chiedi di nuovo» (SPEC §5.2, §9.3, §P3.7; rilascio 4 §3, §6), senza React.
const T = REFERENT_UI_TEXT.askDialog;
const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const N3 = "33333333-3333-4333-8333-333333333333";

function contact(over: Partial<ReferentContactOption> & { id: string; displayName: string }): ReferentContactOption {
  return { roleLabel: null, emailMasked: null, selectable: true, reason: null, team: false, hasOtherRequests: false, ...over };
}

const MARIO = contact({ id: "aaaaaaaa-0000-4000-8000-000000000001", displayName: "Mario Rossi", roleLabel: "Ufficio acquisti", emailMasked: "m•••@topjet.it" });
const FEDERICO = contact({ id: "aaaaaaaa-0000-4000-8000-000000000002", displayName: "Federico Barsi", emailMasked: "f•••@topjet.it", team: true, hasOtherRequests: true });
const ME = contact({ id: "aaaaaaaa-0000-4000-8000-000000000003", displayName: "Giulia Neri", emailMasked: "g•••@topjet.it", team: true, selectable: false, reason: "sei_tu" });
const NOMAIL = contact({ id: "aaaaaaaa-0000-4000-8000-000000000004", displayName: "Anna Verdi", roleLabel: "Logistica", selectable: false, reason: "senza_email" });
const OPEN = contact({ id: "aaaaaaaa-0000-4000-8000-000000000005", displayName: "Luca Bianchi", emailMasked: "l•••@topjet.it", selectable: false, reason: "richiesta_aperta" });

const panel: Pick<UseCaseReferentPanel, "contacts" | "askableNeedIds" | "limits" | "requester"> = {
  contacts: [MARIO, FEDERICO, ME, NOMAIL, OPEN],
  askableNeedIds: [N1, N2, N3],
  limits: REFERENT_LIMITS,
  requester: { name: "Giulia Neri", email: "giulia@topjet.it" },
};

test("bozza di partenza: nessuno scelto e nessuna spunta (le spunte arrivano con la persona, in «Cosa chiedi»)", () => {
  const draft = initialAskDraft(panel);
  assert.equal(draft.choice, null);
  assert.deepEqual(draft.needIds, []);
  assert.equal(draft.message, "");
});

test("le righe di «A chi»: ruolo · email coperta, «Fa parte del team», i motivi; mai un numero, mai i corsi", () => {
  assert.equal(contactRowLine(MARIO), "Ufficio acquisti · m•••@topjet.it");
  assert.equal(contactRowLine(FEDERICO), `f•••@topjet.it · ${T.teamTag}`);
  assert.equal(contactRowLine(NOMAIL), `Logistica ${T.suffix.senza_email}`);
  assert.equal(contactRowLine(OPEN), `l•••@topjet.it ${T.suffix.richiesta_aperta}`);
  assert.equal(contactRowLine(contact({ id: "x", displayName: "Solo nome" })), "");
  assert.equal(contactRowLine(contact({ id: "x", displayName: "Solo nome", selectable: false, reason: "lateral_space" })), T.suffix.lateral_space);
  // Chi guarda: «(sei tu)», non si sceglie; il motivo basta, senza «Fa parte del team».
  assert.equal(contactRowLine(ME), `g•••@topjet.it ${T.suffix.sei_tu}`);
  const sara: ReferentMemberOption = { userId: "cccccccc-0000-4000-8000-000000000001", displayName: "Sara Conti", emailMasked: "s•••@topjet.it", team: false };
  assert.equal(memberRowLine(sara), "s•••@topjet.it");
  assert.equal(memberRowLine({ ...sara, team: true }), `s•••@topjet.it · ${T.teamTag}`);
  assert.equal(memberRowLine({ ...sara, emailMasked: null }), "");
  for (const line of [MARIO, FEDERICO, ME, NOMAIL, OPEN].map(contactRowLine)) assert.doesNotMatch(line, /\d|corso|formazione|partecipant|learner/i, line);
});

test("il suggerimento «sei tu» sotto l'elenco, solo quando chi guarda è tra i referenti", () => {
  assert.equal(askSelfHint(panel), T.selfHint);
  assert.equal(askSelfHint({ contacts: [MARIO, FEDERICO] }), null);
});

test("domande aperte su altri use case: un sì, mai un numero", () => {
  assert.equal(askOtherRequestsHint(panel, { choice: FEDERICO.id }), "Federico Barsi ha già domande aperte su altri use case: i promemoria arriveranno in un'unica email.");
  assert.equal(askOtherRequestsHint(panel, { choice: MARIO.id }), null);
  assert.equal(askOtherRequestsHint(panel, { choice: NEW_CONTACT }), null);
});

test("controlli prima dell'invio: referente, nome, email, domande, messaggio", () => {
  const base = { ...initialAskDraft(panel), needIds: [N1, N2, N3] };
  assert.deepEqual(askDraftErrors(base, panel), { contact: T.whoMissing });
  assert.equal(T.whoMissing, "Scegli un referente");
  assert.deepEqual(askDraftErrors({ ...base, choice: MARIO.id }, panel), {});
  assert.deepEqual(askDraftErrors({ ...base, choice: ME.id }, panel), { contact: REFERENT_ERROR_MESSAGES.referente_sei_tu });
  assert.deepEqual(askDraftErrors({ ...base, choice: NOMAIL.id }, panel), { contact: REFERENT_ERROR_MESSAGES.email_mancante_esistente });
  assert.deepEqual(askDraftErrors({ ...base, choice: NEW_CONTACT }, panel), { displayName: REFERENT_ERROR_MESSAGES.dati_non_validi, email: REFERENT_ERROR_MESSAGES.email_mancante });
  assert.deepEqual(askDraftErrors({ ...base, choice: NEW_CONTACT, name: "Mario Rossi", email: "non-un-indirizzo" }, panel), { email: REFERENT_ERROR_MESSAGES.email_non_valida });
  assert.deepEqual(askDraftErrors({ ...base, choice: MARIO.id, needIds: [] }, panel), { needIds: REFERENT_ERROR_MESSAGES.nessuna_domanda });
  const tooMany = Array.from({ length: REFERENT_LIMITS.questionsPerRequest + 1 }, (_, i) => `id-${i}`);
  assert.deepEqual(askDraftErrors({ ...base, choice: MARIO.id, needIds: tooMany }, panel), { needIds: REFERENT_ERROR_MESSAGES.troppe_domande });
  assert.deepEqual(askDraftErrors({ ...base, choice: MARIO.id, message: "x".repeat(REFERENT_LIMITS.messageMax + 1) }, panel), { message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo });
  assert.deepEqual(askDraftErrors({ ...base, choice: MARIO.id, message: "x".repeat(REFERENT_LIMITS.messageMax) }, panel), {});
});

test("il contenuto dell'action: referente esistente o nuovo, domande nell'ordine della scheda, testi puliti", () => {
  const draft = { ...initialAskDraft(panel), choice: MARIO.id, needIds: [N3, N1], message: "  Ci serve per la stima.  " };
  assert.deepEqual(askPayload(draft, panel), { contact: { kind: "esistente", contactId: MARIO.id }, needIds: [N1, N3], message: "Ci serve per la stima." });
  const fresh = { ...initialAskDraft(panel), choice: NEW_CONTACT, name: " Paola Neri ", email: " paola@topjet.it ", role: "  ", message: "   ", needIds: [N1, N2, N3] };
  assert.deepEqual(askPayload(fresh, panel), {
    contact: { kind: "nuovo", displayName: "Paola Neri", email: "paola@topjet.it", roleLabel: null },
    needIds: [N1, N2, N3],
    message: null,
  });
});

test("«Chiedi di nuovo»: il referente della richiesta resta scelto, le sue domande ancora aperte spuntate, la richiesta sostituita", () => {
  const request = { id: "bbbbbbbb-0000-4000-8000-000000000001", status: "inviata" as const, contact: { id: OPEN.id, name: OPEN.displayName, roleLabel: null, emailMasked: OPEN.emailMasked, hubOnly: true }, needIds: [N2.toUpperCase(), "99999999-9999-4999-8999-999999999999"] };
  const mode = askAgainMode(request);
  assert.deepEqual(mode, { kind: "again", lockedContactId: OPEN.id, previousRequestId: request.id, liveHint: true });
  assert.equal(askAgainMode({ ...request, status: "scaduta" }).liveHint, false);
  const draft = initialAskDraft(panel, mode, request);
  assert.equal(draft.choice, OPEN.id);
  assert.deepEqual(draft.needIds, [N2], "solo le domande di prima che si possono ancora chiedere");
  // La sua richiesta aperta è proprio quella che si sostituisce: si può tenere.
  assert.deepEqual(askDraftErrors(draft, panel, mode), {});
  assert.deepEqual(askPayload(draft, panel, mode), { contact: { kind: "esistente", contactId: OPEN.id }, needIds: [N2], message: null, previousRequestId: request.id });
  assert.equal(ASK_MODE.kind, "ask");
});

test("errori del server: i campi nella finestra, gli altri nell'area degli errori; «sei tu» sempre nell'area, e sotto «Email» per un referente nuovo", () => {
  const self = REFERENT_ERROR_MESSAGES.referente_sei_tu;
  assert.deepEqual(askErrorView({ ok: false, code: "referente_sei_tu", message: self, fieldErrors: { email: self } }, { choice: NEW_CONTACT }), { formError: self, fieldErrors: { email: self } });
  assert.deepEqual(askErrorView({ ok: false, code: "referente_sei_tu", message: self }, { choice: ME.id }), { formError: self, fieldErrors: {} });
  assert.deepEqual(
    askErrorView({ ok: false, code: "email_in_uso", message: REFERENT_ERROR_MESSAGES.email_in_uso, fieldErrors: { email: REFERENT_ERROR_MESSAGES.email_in_uso } }, { choice: NEW_CONTACT }),
    { formError: null, fieldErrors: { email: REFERENT_ERROR_MESSAGES.email_in_uso } },
  );
  // Un errore sull'email di un referente esistente non ha un campo «Email» a schermo: va nell'area.
  assert.deepEqual(
    askErrorView({ ok: false, code: "email_mancante", message: REFERENT_ERROR_MESSAGES.email_mancante_esistente, fieldErrors: { email: REFERENT_ERROR_MESSAGES.email_mancante_esistente } }, { choice: NOMAIL.id }),
    { formError: REFERENT_ERROR_MESSAGES.email_mancante_esistente, fieldErrors: {} },
  );
  assert.deepEqual(askErrorView({ ok: false, code: "sub_responsabili_mancanti", message: "Prima TopJet deve autorizzare…" }, { choice: MARIO.id }), { formError: "Prima TopJet deve autorizzare…", fieldErrors: {} });
  assert.deepEqual(
    askErrorView({ ok: false, code: "messaggio_troppo_lungo", message: "m", fieldErrors: { message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo } }, { choice: MARIO.id }),
    { formError: null, fieldErrors: { message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo } },
  );
});

// ── Referente già iscritto (27/10): le persone del workspace con un account ──

const SARA: ReferentMemberOption = { userId: "cccccccc-0000-4000-8000-000000000001", displayName: "Sara Conti", emailMasked: "s•••@topjet.it", team: false };
const PAOLO: ReferentMemberOption = { userId: "cccccccc-0000-4000-8000-000000000002", displayName: "Paolo Galli", emailMasked: "p•••@topjet.it", team: true };
const withMembers = { ...panel, members: [PAOLO, SARA] };

test("persone del workspace: il contenuto dell'action è { kind: «membro», userId }; il server ricontrolla tutto", () => {
  const draft = { ...initialAskDraft(withMembers), choice: `${MEMBER_PREFIX}${SARA.userId}`, needIds: [N1, N2, N3] };
  assert.deepEqual(askDraftErrors(draft, withMembers), {});
  assert.deepEqual(askPayload(draft, withMembers), { contact: { kind: "membro", userId: SARA.userId }, needIds: [N1, N2, N3], message: null });
  assert.deepEqual(askDraftErrors({ ...draft, choice: `${MEMBER_PREFIX}dddddddd-0000-4000-8000-000000000009` }, withMembers), { contact: REFERENT_ERROR_MESSAGES.persona_non_disponibile });
  // Le persone non ancora arrivate: la persona scelta non si trova, come una tolta.
  assert.deepEqual(askDraftErrors(draft, { ...panel, members: null }), { contact: REFERENT_ERROR_MESSAGES.persona_non_disponibile });
  assert.equal(askOtherRequestsHint(withMembers, { choice: draft.choice }), null);
  // Un errore sull'email di una persona scelta dall'elenco va nell'area degli errori (non c'è un campo «Email»).
  const ls = REFERENT_ERROR_MESSAGES.referente_lateral_space;
  assert.deepEqual(askErrorView({ ok: false, code: "referente_lateral_space", message: ls, fieldErrors: { email: ls } }, { choice: draft.choice }), { formError: ls, fieldErrors: {} });
});

// (Referente già iscritto, revisione) Il risultato vero dell'action passa da `referentOutcome` (chiudere
// o no) e poi da `askErrorView` (dove scrivere l'errore).
function afterSend(result: Extract<Parameters<typeof askErrorView>[0], { ok: false }>, draft: { choice: string | null }) {
  const outcome = referentOutcome(result, { inDialog: true });
  if (outcome.close) return { closed: true, refresh: outcome.refresh, toast: outcome.toast?.text ?? null, view: null };
  return { closed: false, refresh: outcome.refresh, toast: null, view: askErrorView(result, draft) };
}

test("«Una persona nuova» con l'email di un referente disattivato: la finestra resta aperta, l'errore sotto «Email», la bozza resta", () => {
  const text = REFERENT_ERROR_MESSAGES.referente_disattivato;
  assert.equal(text, "Questa email è di un referente non più attivo: usa un altro indirizzo.");
  assert.deepEqual(afterSend({ ok: false, code: "referente_disattivato", message: text, fieldErrors: { email: text } }, { choice: NEW_CONTACT }), {
    closed: false,
    refresh: false,
    toast: null,
    view: { formError: null, fieldErrors: { email: text } },
  });
});

const GATE: Record<ReferentGate["code"], ReferentGate> = {
  sub_responsabili_mancanti: { code: "sub_responsabili_mancanti", message: REFERENT_UI_TEXT.gates.subprocessorsCanDeclare, canDeclare: true, settingsHref: "/dashboard/x/settings#sub-responsabili", linkLabel: REFERENT_UI_TEXT.gates.subprocessorsLink },
  email_non_configurata: { code: "email_non_configurata", message: REFERENT_UI_TEXT.gates.emailNotConfigured },
  risposte_non_attive: { code: "risposte_non_attive", message: REFERENT_UI_TEXT.gates.publicWritesOff },
  email_non_verificata: { code: "email_non_verificata", message: REFERENT_UI_TEXT.gates.emailNotVerified },
  nessuna_domanda: { code: "nessuna_domanda", message: REFERENT_UI_TEXT.gates.noQuestions },
};
const SUB_OTHER: ReferentGate = { code: "sub_responsabili_mancanti", message: REFERENT_UI_TEXT.gates.subprocessorsOther, canDeclare: false, settingsHref: "/dashboard/x/settings#sub-responsabili", linkLabel: REFERENT_UI_TEXT.gates.subprocessorsLink };

test("il riquadro «Prossimo passo» (G5): «Chiedi al referente» quando niente blocca, o manca solo cosa chiedere e si può preparare", () => {
  assert.deepEqual(askEntry({ gates: [], preparable: [] }), { canOpen: true, gates: [] });
  assert.deepEqual(askEntry({ gates: [GATE.nessuna_domanda], preparable: ["frequenza", "tempo"] }), { canOpen: true, gates: [] });
  // Niente da preparare: il motivo nomina solo «Aggiungi», non un «Prepara le domande» che non c'è.
  const page = { ...GATE.nessuna_domanda, message: REFERENT_UI_TEXT.gates.noQuestionsPage };
  assert.deepEqual(askEntry({ gates: [GATE.nessuna_domanda], preparable: [] }), { canOpen: false, gates: [page] });
  assert.ok(!REFERENT_UI_TEXT.gates.noQuestionsPage.includes(REFERENT_UI_TEXT.prepare));
  assert.deepEqual(askEntry({ gates: [GATE.email_non_configurata, GATE.nessuna_domanda], preparable: [] }), { canOpen: false, gates: [GATE.email_non_configurata, page] });
  const gates = [GATE.sub_responsabili_mancanti, GATE.email_non_configurata, GATE.nessuna_domanda];
  assert.deepEqual(askEntry({ gates, preparable: ["frequenza"] }), { canOpen: false, gates });
  assert.ok(!Object.hasOwn(askEntry({ gates, preparable: ["frequenza"] }), "showPrepare"), "«Prepara le domande» sta solo nella finestra");
});

const entryPanel = (over: Partial<Pick<UseCaseReferentPanel, "available" | "canAsk" | "gates" | "askableNeedIds" | "preparable">> = {}) => ({
  available: true,
  canAsk: true,
  gates: [] as ReferentGate[],
  askableNeedIds: [N1],
  preparable: [] as UseCaseReferentPanel["preparable"],
  ...over,
});

test("(rilascio 4) la riga di «Cosa serve» ha «Chiedi al referente» solo per chi può arrivare in fondo (la tabella di §3)", () => {
  // Nessun motivo: si apre.
  assert.deepEqual(askDialogEntry(entryPanel()), { canOpen: true, canAskAgain: true, sendGates: [], notice: null });
  // Manca l'ok sui fornitori e chi guarda lo può dare: si apre, il motivo in cima e in «Controlla e invia».
  assert.deepEqual(askDialogEntry(entryPanel({ gates: [GATE.sub_responsabili_mancanti] })), { canOpen: true, canAskAgain: true, sendGates: [GATE.sub_responsabili_mancanti], notice: GATE.sub_responsabili_mancanti });
  // L'ok lo dà un'altra persona (Lateral Space, un analista del cliente): niente pulsante, lo dice il riquadro.
  assert.equal(askDialogEntry(entryPanel({ gates: [SUB_OTHER] })).canOpen, false);
  assert.equal(askDialogEntry(entryPanel({ gates: [SUB_OTHER, GATE.email_non_configurata] })).canOpen, false);
  // L'email di chi guarda non è verificata: niente pulsante.
  assert.equal(askDialogEntry(entryPanel({ gates: [GATE.email_non_verificata] })).canOpen, false);
  // Email o risposte dal link spente: nessuno le accende, si apre e lo dice.
  for (const system of [GATE.email_non_configurata, GATE.risposte_non_attive]) {
    const entry = askDialogEntry(entryPanel({ gates: [system] }));
    assert.deepEqual([entry.canOpen, entry.notice?.code, entry.sendGates.map((g) => g.code)], [true, system.code, [system.code]]);
  }
  // Fornitori (li dà chi guarda) ed email spente: tutti in ordine, il primo in cima.
  const both = askDialogEntry(entryPanel({ gates: [GATE.sub_responsabili_mancanti, GATE.email_non_configurata, GATE.nessuna_domanda] }));
  assert.deepEqual([both.canOpen, both.notice?.code, both.sendGates.map((g) => g.code)], [true, "sub_responsabili_mancanti", ["sub_responsabili_mancanti", "email_non_configurata"]]);
  // Niente da chiedere ma qualcosa da preparare (G1, G9): si apre («Prepara le domande» in «Cosa chiedi»); niente «Chiedi di nuovo».
  const prepOnly = askDialogEntry(entryPanel({ gates: [GATE.nessuna_domanda], askableNeedIds: [], preparable: ["frequenza"] }));
  assert.deepEqual([prepOnly.canOpen, prepOnly.canAskAgain, prepOnly.sendGates], [true, false, []]);
  // Niente da chiedere né da preparare: niente pulsante, e niente lo sostituisce.
  assert.equal(askDialogEntry(entryPanel({ gates: [GATE.nessuna_domanda], askableNeedIds: [] })).canOpen, false);
  // Funzione spenta o chi guarda non chiede: mai.
  assert.equal(askDialogEntry(entryPanel({ available: false })).canOpen, false);
  assert.equal(askDialogEntry(entryPanel({ canAsk: false })).canOpen, false);
  assert.equal(askDialogEntry(entryPanel({ gates: [GATE.email_non_verificata] })).canAskAgain, false);
});

test("l'offerta di «Prepara le domande» nella finestra: solo in «Chiedi al referente» e solo con qualcosa da aggiungere", () => {
  const six = ["frequenza", "tempo", "persone", "sistemi", "esempio", "costi"] as const;
  assert.deepEqual(askPrepareOffer({ preparable: [...six] }, ASK_MODE), { count: 6, hint: "Aggiunge 6 domande standard, già spuntate." });
  assert.deepEqual(askPrepareOffer({ preparable: ["tempo"] }), { count: 1, hint: T.prepareHintOne });
  const again = askAgainMode({ id: "bbbbbbbb-0000-4000-8000-000000000001", status: "scaduta", contact: { id: MARIO.id, name: MARIO.displayName, roleLabel: null, emailMasked: null, hubOnly: true } });
  assert.equal(askPrepareOffer({ preparable: [...six] }, again), null, "non in «Chiedi di nuovo»");
  assert.equal(askPrepareOffer({ preparable: [] }), null);
});

test("dopo «Prepara le domande» le nuove arrivano spuntate, quelle tolte restano tolte, quelle che non si chiedono più escono", () => {
  const again = askAgainMode({ id: "bbbbbbbb-0000-4000-8000-000000000001", status: "scaduta", contact: { id: MARIO.id, name: MARIO.displayName, roleLabel: null, emailMasked: null, hubOnly: true } });
  assert.deepEqual(mergeAskSelection([N1], [N1, N2], [N1, N2, N3], ASK_MODE), [N1, N3]);
  assert.deepEqual(mergeAskSelection([N1], [N1, N2], [N1, N2, N3], again), [N1]);
  assert.deepEqual(mergeAskSelection([N1, N2], [N1, N2], [N2, N3]), [N2, N3]);
  assert.deepEqual(mergeAskSelection([N3], [N3.toUpperCase()], [N2.toUpperCase(), N3.toUpperCase(), N1.toUpperCase()]), [N2, N3, N1]);
});

test("le sorgenti: un solo «Chiedi al referente» nella riga, mai spento; niente «Prepara le domande» né motivi fuori dalla finestra", () => {
  const section = readFileSync(new URL("../section-needs.tsx", import.meta.url), "utf8");
  assert.equal((section.match(/REFERENT_UI_TEXT\.ask\b/g) ?? []).length, 1, "un solo «Chiedi al referente»");
  assert.match(section, /\{feature\?\.canAsk && boxAsk !== "ask" && entry\?\.canOpen \? \(/);
  assert.match(section, /const entry = feature \? askDialogEntry\(feature\) : null;/);
  for (const gone of ["PrepareButton", "GateNotice", "prepareReferentQuestionsAction", "REFERENT_UI_TEXT.prepare", "disabled={askBlocked}"]) assert.ok(!section.includes(gone), gone);
  const steps = readFileSync(new URL("./ask-steps.tsx", import.meta.url), "utf8");
  assert.match(steps, /prep\.run\(\(\) => prepareReferentQuestionsAction\(workspaceId, useCaseId\), \{ inDialog: true, successToast: false \}\)/);
  // Il pulsante di «Prepara le domande» è dentro il <form> della finestra: type="button".
  const questions = readFileSync(new URL("./ask-questions.tsx", import.meta.url), "utf8");
  const at = questions.indexOf("{REFERENT_UI_TEXT.prepare}");
  assert.ok(at > 0, "il pulsante nella finestra");
  assert.match(questions.slice(questions.lastIndexOf("<Button", at), at), /type="button"/);
  // Il pulsante di conferma non si spegne mai.
  assert.ok(!/disabled=\{/.test(steps), "nessun pulsante spento nella finestra");
});
