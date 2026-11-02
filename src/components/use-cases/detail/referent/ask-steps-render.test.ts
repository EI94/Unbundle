import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { REFERENT_LIMITS, type ReferentContactOption, type ReferentGate, type ReferentMemberOption } from "../../../../lib/use-cases/referent/contract.ts";
import { referentRequestParts } from "../../../../lib/use-cases/referent/email.ts";
import { REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import { PREVIEW_LINK, referentRequestPreview } from "../../../../lib/use-cases/referent/preview.ts";
import { NEW_CONTACT, memberValue } from "./ask-dialog-state.ts";
import { enableTsxImports } from "./tsx-test-loader.ts";

// «Chiedi al referente» in tre passi resa in HTML (rilascio 4, §4, §6, §8, §9, §22): un solo controllo
// pieno per passo, il titolo di ogni passo visibile e focalizzabile, l'elenco di «A chi» con il suo
// nome, l'anteprima che è l'email vera e senza pulsanti pieni, «Apri Impostazioni» pieno in una scheda
// nuova per chi può dare l'ok, e mai le parole dei corsi. Le azioni del server qui non servono: un
// modulo vuoto al loro posto.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
const T = REFERENT_UI_TEXT.askDialog;

let people: typeof import("./ask-people.tsx");
let questions: typeof import("./ask-questions.tsx");
let preview: typeof import("./ask-preview.tsx");
let steps: typeof import("./ask-steps.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  const actions = `data:text/javascript,${encodeURIComponent(
    ["listReferentPeopleAction", "prepareReferentQuestionsAction", "revealReferentContactEmailAction", "revealReferentMemberEmailAction", "sendReferentRequestAction"]
      .map((name) => `export async function ${name}() { throw new Error("non in questa prova"); }`)
      .join("\n"),
  )}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/actions/use-case-referents") return { url: actions, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  people = await import("./ask-people.tsx");
  questions = await import("./ask-questions.tsx");
  preview = await import("./ask-preview.tsx");
  steps = await import("./ask-steps.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** I controlli pieni (`[data-slot=button].bg-primary`, anche i link), con il loro testo. */
function filled(html: string): string[] {
  return [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(([, , attrs]) => /\sdata-slot="button"/.test(attrs) && (/\sclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? []).includes("bg-primary"))
    .map(([, , , body]) => readable(body.replace(/<[^>]+>/g, "")).trim());
}
const buttons = (html: string) => (html.match(/<button\b/g) ?? []).length;
const COURSE = /learner|corso|formazione|partecipant/i;

function contact(over: Partial<ReferentContactOption> & { id: string; displayName: string }): ReferentContactOption {
  return { roleLabel: null, emailMasked: null, selectable: true, reason: null, team: false, hasOtherRequests: false, ...over };
}
const ALDO = contact({ id: "aaaaaaaa-0000-4000-8000-000000000001", displayName: "Aldo Prova", roleLabel: "Tesoreria", emailMasked: "a•••@alfa.test" });
const ME = contact({ id: "aaaaaaaa-0000-4000-8000-000000000002", displayName: "Giulia Neri", emailMasked: "g•••@alfa.test", selectable: false, reason: "sei_tu", team: true });
const LIA: ReferentMemberOption = { userId: "cccccccc-0000-4000-8000-000000000001", displayName: "Lia Esempio", emailMasked: "l•••@alfa.test", team: false };
const FEDE: ReferentMemberOption = { userId: "cccccccc-0000-4000-8000-000000000002", displayName: "Fede Revisore", emailMasked: "f•••@alfa.test", team: true };
const IDS = { heading: "chi", error: "chi-errore", name: "nome", email: "email", role: "ruolo" };
const EMAIL_GATE: ReferentGate = { code: "email_non_configurata", message: REFERENT_UI_TEXT.gates.emailNotConfigured };
const SUB_GATE: ReferentGate = {
  code: "sub_responsabili_mancanti",
  message: "Alfa Jet (prova) deve autorizzare i fornitori che usiamo, per esempio quello delle email: puoi farlo tu, in Impostazioni › Sub-responsabili.",
  canDeclare: true,
  settingsHref: "/dashboard/ws/settings#sub-responsabili",
  linkLabel: REFERENT_UI_TEXT.gates.subprocessorsLink,
};

function renderPeople(over: Record<string, unknown> = {}) {
  return readable(
    renderToStaticMarkup(
      h(people.AskPeopleStep, {
        ids: IDS,
        notice: null,
        contacts: [ALDO, ME],
        people: { state: "ready", members: [FEDE, LIA] },
        draft: { choice: null, name: "", email: "", role: "" },
        errors: {},
        limits: REFERENT_LIMITS,
        selfHint: null,
        otherHint: null,
        onChoice: () => {},
        onField: () => {},
        ...over,
      }),
    ),
  );
}

test("«A chi»: il titolo visibile prende il fuoco, l'elenco è una sola scelta con il suo nome, nessun pulsante pieno", () => {
  const html = renderPeople();
  assert.match(html, /<h3 id="chi" tabindex="-1" class="[^"]*focus-visible:ring-2[^"]*">A chi chiedi\?<\/h3>/);
  assert.match(html, /role="radiogroup"[^>]*aria-labelledby="chi"|aria-labelledby="chi"[^>]*role="radiogroup"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5, "due referenti, due persone, «Una persona nuova»");
  assert.deepEqual(filled(html), []);
  assert.equal(buttons(html), 0, "le scelte non sono pulsanti");
  for (const text of [T.contactsGroup, T.membersGroup, T.newPerson, "Tesoreria · a•••@alfa.test", `f•••@alfa.test · ${T.teamTag}`, `g•••@alfa.test ${T.suffix.sei_tu}`]) assert.ok(html.includes(text), text);
  // Chi guarda non si sceglie: il motivo nella riga visibile.
  assert.match(html, /data-disabled=""/);
  // Nessun conteggio accanto a una persona, niente dei corsi.
  assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /\b\d+\s+domand/i);
  assert.doesNotMatch(html, COURSE);
});

test("«A chi»: senza persone ancora, la riga di attesa; non arrivate, la riga che lo dice; il motivo in cima", () => {
  const loading = renderPeople({ people: { state: "loading", members: [] } });
  assert.match(loading, new RegExp(`<p role="status"[^>]*>${T.peopleLoading}</p>`));
  assert.ok(!loading.includes(T.membersGroup), "i gruppi solo con le persone");
  const failed = renderPeople({ people: { state: "failed", members: [] } });
  assert.ok(failed.includes(T.peopleFailed));
  const notice = renderPeople({ notice: EMAIL_GATE });
  assert.match(notice, new RegExp(`data-gate="email_non_configurata"[^>]*>${REFERENT_UI_TEXT.gates.emailNotConfigured}</p>`));
  const missing = renderPeople({ errors: { contact: T.whoMissing } });
  assert.match(missing, /aria-invalid="true"/);
  assert.match(missing, new RegExp(`<p id="chi-errore" role="alert"[^>]*>${T.whoMissing}</p>`));
  const fresh = renderPeople({ draft: { choice: NEW_CONTACT, name: "", email: "", role: "" } });
  for (const text of [T.newName, T.newEmail, T.newRole, T.newHint]) assert.ok(fresh.includes(text), text);
  const member = renderPeople({ draft: { choice: memberValue(LIA.userId), name: "", email: "", role: "" } });
  assert.match(member, /aria-checked="true"/);
});

function renderQuestions(over: Record<string, unknown> = {}) {
  return readable(
    renderToStaticMarkup(
      h(questions.AskQuestionsStep, {
        ids: { heading: "cosa", list: "cosa-elenco", error: "cosa-errore", hint: "cosa-aiuto", prepare: "prepara", message: "messaggio" },
        name: "Lia Esempio",
        againLine: null,
        questions: {
          layout: "split",
          proposed: [{ id: "q1", title: "Quante fatture al mese?", meta: null }],
          others: [{ id: "q2", title: "Quale gestionale?", meta: "Sistemi informativi · Cliente" }],
        },
        selected: ["q1"],
        errors: {},
        prepare: { offer: { count: 2, hint: "Aggiunge 2 domande standard sui dati che mancano: arrivano già spuntate." }, pending: false, done: null, error: null, onPrepare: () => {} },
        message: "",
        limits: REFERENT_LIMITS,
        onChange: () => {},
        onMessage: () => {},
        ...over,
      }),
    ),
  );
}

test("«Cosa chiedi»: le proposte spuntate, le altre chiuse con il loro «Chi», «Prepara le domande» non pieno", () => {
  const html = renderQuestions();
  assert.match(html, /<h3 id="cosa" tabindex="-1"[^>]*>Cosa chiedi a Lia Esempio\?<\/h3>/);
  assert.match(html, /<details data-slot="ask-others"/);
  assert.ok(html.includes("Altre domande di questo use case · 1") || html.includes("Altre domande di questo use case · 1"));
  assert.ok(html.includes("Sistemi informativi · Cliente"), "il «Chi» delle altre");
  assert.ok(html.includes(T.questionsFor.replace("{Nome}", "Lia Esempio")));
  assert.deepEqual(filled(html), [], "nessun controllo pieno nel corpo");
  assert.equal(buttons(html), 1, "al massimo un pulsante nel corpo: «Prepara le domande»");
  assert.ok(html.includes(REFERENT_UI_TEXT.prepare));
  const none = renderQuestions({ questions: { layout: "all", items: [{ id: "q2", title: "Quale gestionale?", meta: null }] }, selected: [] });
  assert.ok(none.includes("Nessuna domanda è segnata per Lia Esempio: scegli tu quelle da fare."));
  assert.ok(!none.includes("ask-others"));
  const empty = renderQuestions({ questions: { layout: "empty" }, selected: [] });
  assert.ok(empty.includes(T.questionsEmpty));
  const error = renderQuestions({ errors: { needIds: "Scegli almeno una domanda aperta." } });
  assert.match(error, /<p id="cosa-errore" role="alert"[^>]*>Scegli almeno una domanda aperta\.<\/p>/);
  assert.doesNotMatch(html, COURSE);
});

const PARTS = referentRequestPreview({ company: "Alfa Jet (prova)", useCase: { code: "AJ-0002", title: "Lettura delle fatture" }, requesterName: "Giulia Neri", questions: 2, message: "Ci serve per fine mese.", today: new Date("2026-11-02T10:00:00Z") });

function renderPreview(over: Record<string, unknown> = {}) {
  return readable(
    renderToStaticMarkup(
      h(preview.AskPreviewStep, {
        headingId: "controlla",
        name: "Lia Esempio",
        to: "Lia Esempio · lia.esempio@alfa.test",
        parts: PARTS,
        questions: ["Quante fatture al mese?", "Quale gestionale?"],
        replyTo: "giulia@alfa.test",
        gates: [],
        okNotice: null,
        error: null,
        ...over,
      }),
    ),
  );
}

test("«Controlla e invia»: l'anteprima è l'email vera, senza pulsanti pieni né indirizzi del link", () => {
  const html = renderPreview();
  assert.match(html, /<h3 id="controlla" tabindex="-1"[^>]*>Ecco l'email che riceve Lia Esempio\.<\/h3>/);
  assert.match(html, /<section aria-label="Anteprima dell'email" data-slot="ask-preview"/);
  const real = referentRequestParts({
    template: "richiesta",
    company: "Alfa Jet (prova)",
    useCase: { code: "AJ-0002", title: "Lettura delle fatture" },
    requesterName: "Giulia Neri",
    questions: 2,
    message: "Ci serve per fine mese.",
    expiresAt: new Date(new Date("2026-11-02T10:00:00Z").getTime() + 30 * 86_400_000),
    link: PREVIEW_LINK,
    replyToKnown: true,
  });
  assert.ok(html.includes(`>${real.subject}</dd>`), "l'oggetto");
  for (const block of real.blocks) {
    const text = "p" in block ? block.p : "quote" in block ? block.quote : "small" in block ? block.small : "link" in block ? block.link.label : "";
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /<span data-slot="ask-preview-link" class="[^"]*">Apri le domande<\/span>/);
  assert.ok(!html.includes("unbundle.invalid") && !html.includes("/rispondi/"), "nessun indirizzo del link");
  assert.ok(!/<section[^>]*ask-preview[\s\S]*bg-primary[\s\S]*<\/section>/.test(html), "niente pieno nell'anteprima");
  assert.deepEqual(filled(html), []);
  assert.equal(buttons(html), 0);
  assert.ok(html.includes("Lia Esempio · lia.esempio@alfa.test"));
  assert.match(html, /<ol data-slot="ask-preview-questions"[^>]*><li[^>]*>Quante fatture al mese\?<\/li><li[^>]*>Quale gestionale\?<\/li><\/ol>/);
  assert.ok(html.includes("Le risposte all'email arrivano a te (giulia@alfa.test). Se serve, partono due promemoria dopo 3 e 7 giorni lavorativi."));
  assert.ok(!html.includes('data-slot="ask-gates"'));
  assert.doesNotMatch(html, COURSE);
});

test("«Controlla e invia» con l'ok sui fornitori da dare: il motivo e «Apri Impostazioni» pieno, in una scheda nuova", () => {
  const html = renderPreview({ gates: [SUB_GATE, EMAIL_GATE] });
  assert.match(html, /<div role="status" data-slot="ask-gates"/);
  assert.ok(html.includes(`data-gate="sub_responsabili_mancanti"`) && html.includes(`data-gate="email_non_configurata"`));
  assert.ok(html.indexOf("sub_responsabili_mancanti") < html.indexOf("email_non_configurata"), "nell'ordine del server");
  assert.deepEqual(filled(html), [`${REFERENT_UI_TEXT.gates.subprocessorsLink}${T.newTab}`]);
  assert.match(html, /<a href="\/dashboard\/ws\/settings#sub-responsabili" target="_blank" rel="noopener noreferrer"[^>]*data-slot="button"/);
  assert.ok(html.includes(`<span class="sr-only">${T.newTab}</span>`));
  // Solo le email spente: il motivo, nessun pulsante.
  const system = renderPreview({ gates: [EMAIL_GATE] });
  assert.deepEqual(filled(system), []);
  assert.ok(system.includes(REFERENT_UI_TEXT.gates.emailNotConfigured));
  // L'ok dato in un'altra scheda: la riga.
  const ok = renderPreview({ gates: [EMAIL_GATE], okNotice: "Ok di Alfa Jet (prova) dato." });
  assert.match(ok, /<p role="status" data-slot="ask-ok"[^>]*>Ok di Alfa Jet \(prova\) dato\.<\/p>/);
});

test("il piede: «Annulla» o «Indietro» e il passo dopo pieno; con un motivo «Chiudi», niente di pieno", () => {
  const foot = (primary: unknown, back = false) => readable(renderToStaticMarkup(h(steps.AskFooter, { formId: "passo", back, busy: false, primary, onBack: () => {}, onCancel: () => {} })));
  const one = foot({ kind: "submit", label: T.next });
  assert.deepEqual(filled(one), [T.next]);
  assert.ok(one.includes(`>${T.cancel}</button>`));
  assert.match(one, /<button[^>]*type="submit"[^>]*form="passo"|<button[^>]*form="passo"[^>]*type="submit"/);
  assert.equal(buttons(one), 2);
  const two = foot({ kind: "submit", label: "Avanti · 1 domanda" }, true);
  assert.deepEqual(filled(two), ["Avanti · 1 domanda"]);
  assert.ok(two.includes(`>${T.back}</button>`));
  const send = foot({ kind: "submit", label: "Invia a Lia Esempio" }, true);
  assert.deepEqual(filled(send), ["Invia a Lia Esempio"], "un solo «Invia a …» pieno senza motivi");
  const closed = foot({ kind: "close", label: T.close }, true);
  assert.deepEqual(filled(closed), [], "con un motivo nessun «Invia»");
  assert.ok(closed.includes(`>${T.close}</button>`) && !closed.includes("Invia a"));
  for (const html of [one, two, send, closed]) assert.doesNotMatch(html, /disabled=""/, "mai spento");
  const busy = readable(renderToStaticMarkup(h(steps.AskFooter, { formId: "passo", back: true, busy: true, primary: { kind: "submit", label: "Invia a Lia Esempio" }, onBack: () => {}, onCancel: () => {} })));
  assert.match(busy, /aria-busy="true"/);
});

test("la barra dei passi: tre voci, una sola «adesso» con aria-current, lo stato anche senza colore", () => {
  for (const step of [1, 2, 3] as const) {
    const html = readable(renderToStaticMarkup(h(steps.AskStepBar, { step })));
    assert.match(html, /<ol aria-label="Passi" data-slot="ask-steps"/);
    assert.equal((html.match(/<li /g) ?? []).length, 3);
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
    assert.equal((html.match(/data-state="adesso"/g) ?? []).length, 1);
    assert.ok(html.includes(`<span class="sr-only">${T.steps.now}</span>`));
    assert.equal((html.match(/<span class="sr-only"> \(fatto\)<\/span>/g) ?? []).length, step - 1);
    for (const label of [T.steps.who, T.steps.what, T.steps.check]) assert.ok(html.includes(label), label);
    assert.doesNotMatch(html, /<button\b/, "non si clicca");
  }
});
