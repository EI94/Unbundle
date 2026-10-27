import test from "node:test";
import assert from "node:assert/strict";
import { REFERENT_LIMITS, type ReferentContactOption, type UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import {
  ASK_MODE,
  NEW_CONTACT,
  askAgainMode,
  askDraftErrors,
  askErrorView,
  askOtherRequestsHint,
  askPayload,
  askSelfHint,
  askSummary,
  contactChoices,
  contactOptionLabel,
  initialAskDraft,
} from "./ask-dialog-state.ts";

// La finestra «Chiedi al referente» e «Chiedi di nuovo» (SPEC §5.2, §9.3, §P3.7), senza React.
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

test("bozza di partenza: tutte le domande che si possono chiedere spuntate, nessun referente scelto", () => {
  const draft = initialAskDraft(panel);
  assert.equal(draft.choice, null);
  assert.deepEqual(draft.needIds, [N1, N2, N3]);
  assert.equal(draft.message, "");
});

test("le voci del selettore: nome · ruolo · email coperta, «Fa parte del team», i motivi, poi «+ Nuovo referente»", () => {
  assert.equal(contactOptionLabel(MARIO), "Mario Rossi · Ufficio acquisti · m•••@topjet.it");
  assert.equal(contactOptionLabel(FEDERICO), `Federico Barsi · f•••@topjet.it · ${T.teamTag}`);
  assert.equal(contactOptionLabel(NOMAIL), `Anna Verdi · Logistica ${T.suffix.senza_email}`);
  assert.equal(contactOptionLabel(contact({ id: "x", displayName: "Solo nome" })), "Solo nome");
  // Chi guarda: «(sei tu)», non selezionabile; il motivo basta, senza «Fa parte del team».
  assert.equal(contactOptionLabel(ME), `Giulia Neri · g•••@topjet.it ${T.suffix.sei_tu}`);
  const choices = contactChoices(panel);
  assert.deepEqual(
    choices.map((c) => [c.label, c.disabled]),
    [
      ["Mario Rossi · Ufficio acquisti · m•••@topjet.it", false],
      [`Federico Barsi · f•••@topjet.it · ${T.teamTag}`, false],
      [`Giulia Neri · g•••@topjet.it ${T.suffix.sei_tu}`, true],
      [`Anna Verdi · Logistica ${T.suffix.senza_email}`, true],
      [`Luca Bianchi · l•••@topjet.it ${T.suffix.richiesta_aperta}`, true],
      [T.newContact, false],
    ],
  );
  assert.equal(choices.at(-1)?.value, NEW_CONTACT);
  // Nessun numero, nessun dato di altre aree nelle voci.
  for (const choice of choices) assert.doesNotMatch(choice.label, /\d|corso|formazione/i, choice.label);
});

test("il suggerimento «sei tu» sotto il selettore, solo quando chi guarda è tra i referenti", () => {
  assert.equal(askSelfHint(panel), T.selfHint);
  assert.equal(askSelfHint({ contacts: [MARIO, FEDERICO] }), null);
});

test("domande aperte su altri use case: un sì, mai un numero", () => {
  assert.equal(askOtherRequestsHint(panel, { choice: FEDERICO.id }), "Federico Barsi ha già domande aperte su altri use case: i promemoria arriveranno in un'unica email.");
  assert.equal(askOtherRequestsHint(panel, { choice: MARIO.id }), null);
  assert.equal(askOtherRequestsHint(panel, { choice: NEW_CONTACT }), null);
});

test("controlli prima dell'invio: referente, nome, email, domande, messaggio", () => {
  const base = initialAskDraft(panel);
  assert.deepEqual(askDraftErrors(base, panel), { contact: T.whoPlaceholder });
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
  const fresh = { ...initialAskDraft(panel), choice: NEW_CONTACT, name: " Paola Neri ", email: " paola@topjet.it ", role: "  ", message: "   " };
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
  const choices = contactChoices(panel, mode);
  assert.equal(choices.some((c) => c.value === NEW_CONTACT), false, "il referente non si cambia");
  assert.deepEqual(choices.filter((c) => !c.disabled).map((c) => c.value), [OPEN.id]);
  assert.equal(choices.find((c) => c.value === OPEN.id)?.label, "Luca Bianchi · l•••@topjet.it");
  assert.deepEqual(askPayload(draft, panel, mode), { contact: { kind: "esistente", contactId: OPEN.id }, needIds: [N2], message: null, previousRequestId: request.id });
  assert.equal(ASK_MODE.kind, "ask");
});

test("il riepilogo: l'indirizzo scritto per un referente nuovo, quello intero quando arriva, altrimenti quello coperto", () => {
  assert.equal(askSummary(panel, { choice: null, email: "" }, null), null);
  assert.equal(
    askSummary(panel, { choice: NEW_CONTACT, email: " paola@topjet.it " }, null),
    "Mandiamo un'email a paola@topjet.it da «Lateral Space via Unbundle». Se risponde all'email, la risposta arriva a te (giulia@topjet.it). Il link vale 30 giorni; se serve, partono due promemoria dopo 3 e 7 giorni lavorativi.",
  );
  assert.match(askSummary(panel, { choice: MARIO.id, email: "" }, null) ?? "", /^Mandiamo un'email a m•••@topjet\.it /);
  assert.match(askSummary(panel, { choice: MARIO.id, email: "" }, "mario.rossi@topjet.it") ?? "", /^Mandiamo un'email a mario\.rossi@topjet\.it /);
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
