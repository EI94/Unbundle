import test, { before } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_TEXT, DELETE_WORD, matchesDeleteWord, splitQuestion } from "../../lib/confirm-text.ts";
import { findHubForbidden } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 1 · docs/ui-10/PROPOSTA-10.md §1 regola 7, §5.4) La finestra di conferma dell'app, resa in HTML: la
// finestra di base-ui si apre solo nel browser, il suo contenuto (`ConfirmDialogBody`) si rende dentro un `Dialog` aperto.
// E i testi delle finestre: la domanda come titolo, una frase, il verbo corto, nessun «OK». Dati inventati.

let h: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
let renderToStaticMarkup: (element: unknown) => string;
let Dialog: unknown;
let ConfirmDialogBody: unknown;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  h = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
  ({ Dialog } = await import("../ui/dialog.tsx"));
  ({ ConfirmDialogBody } = await import("../ui/confirm-dialog.tsx"));
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function render(props: Record<string, unknown>, ...children: unknown[]): string {
  const body = h(ConfirmDialogBody, { onConfirm: () => undefined, ...props }, ...children);
  return readable(renderToStaticMarkup(h(Dialog, { open: true }, body)));
}

/** I pulsanti della finestra, nell'ordine del DOM. */
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1], label: m[2] }));

test("the question as title, one sentence, «Annulla» and the verb; the verb is red only when it removes", () => {
  const html = render({ title: "Revocare «Portatile XX-0001»?", description: "Claude non potrà più usarlo.", confirmLabel: "Revoca", destructive: true });
  assert.match(html, /<h2 [^>]*data-slot="dialog-title"[^>]*>Revocare «Portatile XX-0001»\?<\/h2>/);
  assert.match(html, /<p [^>]*data-slot="dialog-description"[^>]*>Claude non potrà più usarlo\.<\/p>/);
  const [cancel, confirm] = buttons(html);
  assert.equal(cancel.label, "Annulla");
  assert.match(cancel.attrs, /type="button"/);
  assert.match(cancel.attrs, /data-slot="dialog-close"/, "«Annulla» closes the dialog");
  assert.match(cancel.attrs, /bg-background/, "outlined");
  assert.equal(confirm.label, "Revoca");
  assert.match(confirm.attrs, /type="submit"/);
  assert.match(confirm.attrs, /text-destructive/);
  assert.doesNotMatch(confirm.attrs, /bg-primary/);
  for (const button of [cancel, confirm]) assert.match(button.attrs, /\bh-11 sm:h-8\b/, "44 px on phones");
  assert.equal(buttons(html).length, 2, "no ✕ next to «Annulla»");
  assert.match(html, /^<form novalidate="" class="grid gap-4">/i, "its own form, without the browser's validation bubbles");

  const plain = buttons(render({ title: "Cambiare la soglia di aggregazione?", confirmLabel: "Cambia soglia" }))[1];
  assert.match(plain.attrs, /bg-primary/, "not removing: the dialog's own filled button");
  assert.doesNotMatch(plain.attrs, /text-destructive/);
});

test("a field between the sentence and the buttons; the verb stays off until it is complete, or while the action starts", () => {
  const field = h("input", { id: "parola", "data-field": "" });
  const html = render({ title: "Eliminare la rilevazione «Prova XX-0002»?", description: "Una frase.", confirmLabel: "Elimina", destructive: true, confirmDisabled: true }, field);
  assert.ok(html.indexOf("Una frase.") < html.indexOf("data-field") && html.indexOf("data-field") < html.indexOf(">Annulla<"));
  assert.match(buttons(html)[1].attrs, /\bdisabled=""/);
  const pending = buttons(render({ title: "Rimuovere persona@esempio.it dal workspace?", confirmLabel: "Rimuovi", destructive: true, pending: true }))[1];
  assert.match(pending.attrs, /\bdisabled=""/);
  assert.match(pending.attrs, /aria-busy="true"/);
  assert.doesNotMatch(buttons(render({ title: "Rimuovere persona@esempio.it dal workspace?", confirmLabel: "Rimuovi" }))[1].attrs, /\bdisabled=""/);
});

test("a notice has one button: «Ho capito», no «Annulla»; another cancel label replaces «Annulla»", () => {
  const T = CONFIRM_TEXT.learning;
  const notice = buttons(render({ title: T.waitTitle, description: T.waitBody, confirmLabel: T.waitOk, cancelLabel: null }));
  assert.deepEqual(notice.map((b) => b.label), ["Ho capito"]);
  const leave = buttons(render({ title: T.leaveTitle, description: T.lostBody, confirmLabel: T.leave, cancelLabel: T.stay, destructive: true }));
  assert.deepEqual(leave.map((b) => b.label), ["Resta", "Esci senza salvare"]);
});

test("splitQuestion: the question of a text kept in its own module becomes the title, the rest the sentence", () => {
  assert.deepEqual(splitQuestion("Scollegare Granola? Gli appunti già entrati restano."), { title: "Scollegare Granola?", description: "Gli appunti già entrati restano." });
  assert.deepEqual(
    splitQuestion("Salvare il modello di valutazione? Vale per tutto il workspace: il punteggio e la zona degli use case possono cambiare."),
    { title: "Salvare il modello di valutazione?", description: "Vale per tutto il workspace: il punteggio e la zona degli use case possono cambiare." },
  );
  assert.deepEqual(splitQuestion("Scollegare Granola?"), { title: "Scollegare Granola?", description: null });
  assert.deepEqual(splitQuestion("Un testo senza domanda."), { title: "Un testo senza domanda.", description: null });
});

test("the word to delete a survey: spaces and case do not matter, as with the browser prompt before", () => {
  assert.equal(DELETE_WORD, "ELIMINA");
  for (const typed of ["ELIMINA", "elimina", "  Elimina  "]) assert.equal(matchesDeleteWord(typed), true, typed);
  for (const typed of ["", "ELIMIN", "ELIMINARE", "E LIMINA"]) assert.equal(matchesDeleteWord(typed), false, typed);
});

/** Ogni finestra di CONFIRM_TEXT, con dati inventati. */
function dialogs(): { title: string; body: string; verb: string; cancel?: string }[] {
  const P = CONFIRM_TEXT.people;
  const C = CONFIRM_TEXT.claude;
  const E = CONFIRM_TEXT.esg;
  const Z = CONFIRM_TEXT.personalZone;
  const A = CONFIRM_TEXT.aiReadiness;
  const L = CONFIRM_TEXT.learning;
  const S = CONFIRM_TEXT.shareLinks;
  return [
    { title: P.roleTitle("persona@esempio.it", "Analista"), body: P.roleBody, verb: P.roleConfirm },
    { title: P.removeTitle("persona@esempio.it"), body: P.removeBody, verb: P.removeConfirm },
    { title: P.revokeLinkTitle("persona@esempio.it"), body: P.revokeLinkBody, verb: P.revokeLinkConfirm },
    { title: P.revokeLinkTitle(null), body: P.revokeLinkBody, verb: P.revokeLinkConfirm },
    { title: P.recreateLinkTitle, body: P.recreateLinkBody, verb: P.recreateLinkConfirm },
    { title: S.title, body: S.body, verb: S.confirm },
    { title: C.revokeTitle("Portatile XX-0003"), body: C.setupBody, verb: C.revoke },
    { title: C.revokeTitle("Portatile XX-0003"), body: C.realizationBody, verb: C.revoke },
    { title: C.revokeTitle("Portatile XX-0003"), body: C.teamBody, verb: C.revoke },
    { title: C.revokeTitle("Portatile XX-0003"), body: C.connectorRevokeBody, verb: C.revoke },
    { title: C.revokeAllTitle(1), body: C.revokeAllBody, verb: C.revokeAll },
    { title: C.revokeAllTitle(4), body: C.revokeAllBody, verb: C.revokeAll },
    { title: C.resumeTitle, body: C.resumeBody, verb: C.resume },
    { title: C.suspendTitle, body: C.suspendBody, verb: C.suspend },
    { title: E.onTitle, body: E.onBody, verb: E.on },
    { title: E.offTitle, body: E.offBody, verb: E.off },
    { title: Z.title("Persona Prova"), body: Z.body, verb: Z.confirm },
    { title: Z.title(null), body: Z.body, verb: Z.confirm },
    { title: A.thresholdTitle, body: A.thresholdBody, verb: A.threshold },
    { title: A.removeQuestionTitle, body: A.removeQuestionBody, verb: A.removeQuestion },
    { title: A.newLinkTitle, body: A.newLinkBody, verb: A.newLink },
    { title: A.closeTitle, body: A.closeBody, verb: A.close },
    { title: A.deleteTitle("Rilevazione di prova XX-0004"), body: A.deleteBody(1, 1), verb: A.delete },
    { title: A.deleteTitle(""), body: A.deleteBody(12, 7), verb: A.delete },
    { title: L.leaveTitle, body: L.lostBody, verb: L.leave, cancel: L.stay },
    { title: L.continueTitle, body: L.lostBody, verb: L.continue, cancel: L.stay },
    { title: L.discardTitle, body: L.lostBody, verb: L.discard },
  ];
}

test("every dialog: a question, one short sentence, a verb of at most four words, no «OK» and no forbidden words", () => {
  const all = dialogs();
  assert.equal(all.length, 27);
  for (const { title, body, verb, cancel } of all) {
    assert.match(title, /^\p{Lu}[^?]*\?$/u, `the title is one question: ${title}`);
    assert.match(body, /^\p{Lu}[^.?!]*\.$/u, `the sentence is one sentence: ${body}`);
    assert.ok(body.split(/\s+/).length <= 30, `short: ${body}`);
    assert.match(verb, /^\p{Lu}\p{Ll}+(?: \p{L}+){0,3}$/u, `a verb of a few words: ${verb}`);
    for (const text of [title, body, verb, cancel ?? CONFIRM_TEXT.cancel]) {
      assert.doesNotMatch(text, /\bOK\b|\bPremi\b|\btoken\b|\bsurvey\b|\bassessment\b|\brespondent/i, text);
      assert.deepEqual(findHubForbidden(text, "area"), [], text);
    }
  }
  assert.equal(CONFIRM_TEXT.cancel, "Annulla");
  assert.equal(CONFIRM_TEXT.learning.waitTitle, "Operazione in corso", "the notice is not a question: there is nothing to choose");
  assert.equal(CONFIRM_TEXT.aiReadiness.deleteBody(1, 1), "Per tutto il team si cancellano 1 invito (i link smettono di funzionare), 1 risposta inviata, punteggi, insight ed export: non si può annullare.");
  assert.match(CONFIRM_TEXT.aiReadiness.deleteBody(12, 7), /12 inviti .*, 7 risposte inviate,/);
  assert.equal(CONFIRM_TEXT.aiReadiness.deleteField, "Per confermare, scrivi ELIMINA");
  assert.equal(CONFIRM_TEXT.claude.revokeAllTitle(4), "Revocare i 4 accessi attivi nel workspace?");
});
