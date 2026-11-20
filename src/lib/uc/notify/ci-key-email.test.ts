// Le e-mail della chiave della CI (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.6): `chiave_ci_creata`, `chiave_ci_scade`,
// `chiave_ci_bloccata`. Interne di Lateral Space e senza caso, solo a chi gestisce le chiavi del repository (riletto
// all'invio); l'avviso di scadenza si annulla se la chiave è già cambiata. Il modello del rilascio 10 (§3.12): oggetto al
// massimo di 55 caratteri, corpo corto, un pulsante con un verbo, l'indirizzo in chiaro nel testo semplice. Mai la chiave.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILDER_EMAIL_TEMPLATES,
  CI_KEY_EMAIL_TEMPLATES,
  EMAIL_TEMPLATES,
  WINDOWED_TEMPLATES,
  isCiKeyEmailTemplate,
  planCiKeyDelivery,
  planDelivery,
  type ClaimedNotification,
  type DeliveryFacts,
} from "./dispatch.ts";
import { CI_KEY_EMAIL_TEMPLATE_KEYS, renderCiKeyEmail, type CiKeyEmailInput } from "./email-templates.ts";
import { EMAIL_BODY_MAX_WORDS, EMAIL_SUBJECT_MAX, emailBodyWords } from "./email-render.ts";
import { UC_NOTIFICATION_TEMPLATES } from "../../db/queries/uc-notifications.ts";
import { CI_KEY_EMAIL_TEMPLATES as STORE_TEMPLATES } from "../../db/queries/use-case-ci-keys.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "77777777-7777-4777-8777-777777777777";
const KEY = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-11-18T20:04:00Z");
const OPTS = { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: NOW };
const LINK = `https://app.unbundle.test/dashboard/${WS}/agent-factory`;
const REPO = "Voltaen/esempio-rosa";

const claimed = (templateKey: string, over: Partial<ClaimedNotification> = {}): ClaimedNotification => ({
  id: "88888888-8888-4888-8888-888888888888",
  workspaceId: WS,
  caseId: null,
  requestId: null,
  recipientContactId: null,
  recipientUserId: USER,
  templateKey,
  payload: { keyId: KEY },
  attempts: 0,
  dedupeKey: `${templateKey}:${KEY}:${USER}`,
  ...over,
});

const facts = (over: Partial<DeliveryFacts> = {}, key: Partial<NonNullable<DeliveryFacts["ciKey"]>> = {}): DeliveryFacts => ({
  clientName: "Cliente di prova",
  case: null,
  recipient: { kind: "user", id: USER, email: "Responsabile@LS.test", reachable: true, digestOptOut: false, lateralSpace: true },
  request: null,
  ciKey: { repo: REPO, createdAt: NOW, expiresAt: new Date("2026-12-02T10:00:00Z"), revokedAt: null, recipientManages: true, superseded: false, ...key },
  ...over,
});

const action = (plan: ReturnType<typeof planCiKeyDelivery>) => (plan.action === "send" ? "send" : `${plan.action}:${plan.reason}`);

function built(templateKey: string, f = facts()): CiKeyEmailInput {
  const plan = planCiKeyDelivery(claimed(templateKey), f, OPTS);
  assert.equal(plan.action, "send", templateKey);
  if (plan.action !== "send") throw new Error("non parte");
  assert.equal(plan.email.template, templateKey);
  return plan.email;
}

test("i tre modelli sono nella coda, nel motore e nel modulo delle chiavi; partono a qualunque ora; non sono di chi costruisce", () => {
  assert.deepEqual([...CI_KEY_EMAIL_TEMPLATES], ["chiave_ci_creata", "chiave_ci_scade", "chiave_ci_bloccata"]);
  assert.deepEqual([...CI_KEY_EMAIL_TEMPLATE_KEYS], [...CI_KEY_EMAIL_TEMPLATES]);
  assert.deepEqual([...STORE_TEMPLATES], [...CI_KEY_EMAIL_TEMPLATES]);
  for (const tpl of CI_KEY_EMAIL_TEMPLATES) {
    assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(tpl), `coda: ${tpl}`);
    assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(tpl), `motore: ${tpl}`);
    assert.ok(!(WINDOWED_TEMPLATES as readonly string[]).includes(tpl), "un avviso sulla chiave non aspetta la finestra");
    assert.ok(!(BUILDER_EMAIL_TEMPLATES as readonly string[]).includes(tpl), "solo Lateral Space, mai chi costruisce da fuori");
    assert.equal(isCiKeyEmailTemplate(tpl), true);
  }
  assert.equal(isCiKeyEmailTemplate("cli_collegata"), false);
});

test("a chi gestisce le chiavi, di Lateral Space, senza caso; il link all'Agent Factory del workspace", () => {
  for (const tpl of CI_KEY_EMAIL_TEMPLATES) {
    const plan = planCiKeyDelivery(claimed(tpl), facts(), OPTS);
    assert.equal(plan.action, "send", tpl);
    if (plan.action !== "send") continue;
    assert.equal(plan.to, "responsabile@ls.test");
    assert.equal(plan.email.template, tpl);
    assert.equal(plan.email.link, LINK);
    assert.equal(plan.email.repo, REPO);
    // Il motore delle altre e-mail non le manda mai: hanno il loro piano e il loro modello.
    assert.deepEqual(planDelivery(claimed(tpl), facts(), OPTS), { action: "cancel", reason: "modello_della_chiave_ci" });
  }
  assert.equal(action(planCiKeyDelivery(claimed("cli_collegata"), facts(), OPTS)), "cancel:modello_non_previsto");
});

test("si annullano: un contatto, chi non è di Lateral Space, chi non gestisce più le chiavi, la chiave che non c'è più", () => {
  for (const tpl of CI_KEY_EMAIL_TEMPLATES) {
    const contact = facts({ recipient: { kind: "contact", id: USER, email: "a@ls.test", reachable: true, digestOptOut: false, lateralSpace: false } });
    assert.equal(action(planCiKeyDelivery(claimed(tpl), contact, OPTS)), "cancel:destinatario_non_utente", tpl);
    const client = facts({ recipient: { kind: "user", id: USER, email: "a@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false } });
    assert.equal(action(planCiKeyDelivery(claimed(tpl), client, OPTS)), "cancel:destinatario_non_lateral_space", tpl);
    assert.equal(action(planCiKeyDelivery(claimed(tpl), facts({}, { recipientManages: false }), OPTS)), "cancel:non_gestisce_le_chiavi", tpl);
    assert.equal(action(planCiKeyDelivery(claimed(tpl), facts({ ciKey: null }), OPTS)), "cancel:chiave_assente", tpl);
    assert.equal(action(planCiKeyDelivery(claimed(tpl), facts({ recipient: null }), OPTS)), "cancel:destinatario_non_raggiungibile", tpl);
  }
  // L'avviso di scadenza non serve più se la chiave è già stata revocata, ruotata o è scaduta; le altre due partono.
  for (const key of [{ revokedAt: NOW }, { superseded: true }, { expiresAt: NOW }]) {
    assert.equal(action(planCiKeyDelivery(claimed("chiave_ci_scade"), facts({}, key), OPTS)), "cancel:chiave_cambiata", JSON.stringify(key));
    assert.equal(action(planCiKeyDelivery(claimed("chiave_ci_creata"), facts({}, key), OPTS)), "send");
  }
});

test("i testi: oggetto corto senza codici, il repository intero nel corpo, un pulsante, l'indirizzo in chiaro; mai la chiave", () => {
  const brand = { logoUrl: "https://app.unbundle.test/email/unbundle-u.png" };
  const created = renderCiKeyEmail(built("chiave_ci_creata"), brand);
  assert.equal(created.subject, "Cliente di prova: nuova chiave della CI «esempio-rosa»");
  assert.match(created.text, /^Buongiorno,\n\nil 18 novembre 2026 alle 21:04 è stata creata una chiave con cui la CI di Voltaen\/esempio-rosa manda a Unbundle le evals di main\./);
  assert.match(created.text, /Se sai chi l'ha creata, non serve fare niente\. Se no, revocala dall'Agent Factory\./);
  assert.match(created.text, /Email automatica di Unbundle: arriva a ogni nuova chiave della CI\./);
  const expiring = renderCiKeyEmail(built("chiave_ci_scade"), brand);
  // Oltre 55 caratteri si accorcia il nome, mai l'azione.
  assert.equal(expiring.subject, "Cliente di prova: chiave della CI in scadenza «esempi…»");
  assert.match(expiring.text, /il 2 dicembre 2026 scade la chiave con cui la CI di Voltaen\/esempio-rosa manda a Unbundle le evals di main\. Da quel giorno il job «unbundle» si ferma con un errore\./);
  assert.match(expiring.text, /Ruotala dall'Agent Factory e metti la chiave nuova nel segreto UNBUNDLE_CI_TOKEN su GitHub\./);
  const blocked = renderCiKeyEmail(built("chiave_ci_bloccata"), brand);
  assert.equal(blocked.subject, "Cliente di prova: chiave della CI bloccata «esempio-r…»");
  assert.match(blocked.text, /Unbundle ha trovato la chiave della CI di Voltaen\/esempio-rosa dentro un indirizzo web e l'ha revocata\./);
  assert.match(blocked.text, /Crea una chiave nuova dall'Agent Factory e mettila nel segreto UNBUNDLE_CI_TOKEN su GitHub\. Fino ad allora le evals di main restano su GitHub\./);
  for (const email of [created, expiring, blocked]) {
    assert.ok(email.subject.length <= EMAIL_SUBJECT_MAX, email.subject);
    assert.ok(!/[A-Z]{2,4}-\d{4}/.test(email.subject), "mai il codice di un caso");
    assert.ok(emailBodyWords(email.text) <= EMAIL_BODY_MAX_WORDS, `${emailBodyWords(email.text)} parole`);
    assert.ok(email.text.includes(`Apri l'Agent Factory: ${LINK}`), "l'indirizzo in chiaro nel testo semplice");
    assert.equal((email.html.match(/<a href=/g) ?? []).length, 1, "un pulsante");
    assert.ok(!email.text.includes("ub_ci_") && !email.html.includes("ub_ci_"), "mai la chiave");
    assert.ok(!/caso\b/.test(email.text), "nessun caso: la chiave è del repository");
  }
});

test("solo un repository owner/nome e un link pulito all'Agent Factory: altrimenti l'e-mail non parte", () => {
  const base = { template: "chiave_ci_bloccata" as const, clientName: "Cliente", repo: REPO, link: LINK };
  assert.doesNotThrow(() => renderCiKeyEmail(base));
  for (const repo of ["esempio-rosa", "Voltaen/esempio rosa", "https://evil.test/x"]) assert.throws(() => renderCiKeyEmail({ ...base, repo }), repo);
  for (const link of [`${LINK}?chiave=1`, `${LINK}#famiglia-esempio-rosa`, "http://app.unbundle.test/x", `https://app.unbundle.test/dashboard/${WS}/agent-factory/altro`]) {
    assert.throws(() => renderCiKeyEmail({ ...base, link }), link);
  }
});
