// L'e-mail «CLI collegata» (rilascio 8.0b): alla persona che possiede il token, di qualunque dominio, senza caso; il
// link porta a `settings`, che arrivando da fuori apre «Il tuo account › Claude e terminale» (rilascio 10); niente
// etichetta della CLI (la sceglie chi avvia il login); parte anche se il token è già revocato; data e ora di Roma, con
// «l'11» e «all'8».
import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_TEMPLATES, WINDOWED_TEMPLATES, planDelivery, type ClaimedNotification, type DeliveryFacts } from "./dispatch.ts";
import { checkEmailLink, renderEmail } from "./email-templates.ts";
import { UC_NOTIFICATION_TEMPLATES } from "../../db/queries/uc-notifications.ts";
import { accountPartForSettingsLanding } from "../../shell/account.ts";
import { SHELL_TEXT } from "../../shell/text.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "77777777-7777-4777-8777-777777777777";
const TOKEN = "99999999-9999-4999-8999-999999999999";
const OPTS = { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: new Date("2026-11-11T09:30:00Z") };

const claimed = (over: Partial<ClaimedNotification> = {}): ClaimedNotification => ({
  id: "88888888-8888-4888-8888-888888888888",
  workspaceId: WS,
  caseId: null,
  requestId: null,
  recipientContactId: null,
  recipientUserId: USER,
  templateKey: "cli_collegata",
  payload: { tokenId: TOKEN },
  attempts: 0,
  dedupeKey: `cli_collegata:${TOKEN}`,
  ...over,
});

const facts = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({
  clientName: "Cliente <prova>",
  case: null,
  recipient: { kind: "user", id: USER, email: "Persona@Cliente.test", reachable: true, digestOptOut: false, lateralSpace: false },
  request: null,
  cliToken: { createdAt: new Date("2026-11-11T09:30:00Z"), expiresAt: new Date("2027-02-08T09:30:00Z") },
  ...over,
});

test("il modello è nella coda e nel motore, e parte a qualunque ora", () => {
  assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes("cli_collegata"));
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes("cli_collegata"));
  assert.ok(!(WINDOWED_TEMPLATES as readonly string[]).includes("cli_collegata"), "un avviso di sicurezza non aspetta la finestra");
});

test("alla persona stessa, anche del cliente e senza caso; il link porta a Impostazioni", () => {
  const plan = planDelivery(claimed(), facts(), OPTS);
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  assert.equal(plan.to, "persona@cliente.test");
  assert.equal(plan.link, null, "nessun link dei referenti");
  const input = plan.build(null);
  assert.equal(input.template, "cli_collegata");
  assert.equal((input as { link: string }).link, `https://app.unbundle.test/dashboard/${WS}/settings`);
});

test("mai a un contatto; senza il token (o di un'altra persona) si annulla", () => {
  const contact = facts({ recipient: { kind: "contact", id: USER, email: "a@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false } });
  assert.deepEqual(planDelivery(claimed(), contact, OPTS), { action: "cancel", reason: "destinatario_non_utente" });
  assert.deepEqual(planDelivery(claimed(), facts({ cliToken: null }), OPTS), { action: "cancel", reason: "collegamento_assente" });
  assert.deepEqual(planDelivery(claimed(), facts({ recipient: null }), OPTS), { action: "cancel", reason: "destinatario_non_raggiungibile" });
});

test("il testo: workspace, data e ora di Roma, scadenza, come revocare; niente etichetta, niente immagini", () => {
  const plan = planDelivery(claimed(), facts(), OPTS);
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build(null));
  // (Rilascio 10, §3.12) L'oggetto al massimo di 55 caratteri.
  assert.equal(email.subject, "Cliente <prova>: CLI collegata al tuo account");
  assert.match(email.text, /l'11 novembre 2026 alle 10:30 la CLI è stata collegata al tuo account, nel workspace «Cliente <prova>»\./);
  assert.match(email.text, /Il collegamento vale fino all'8 febbraio 2027\./);
  assert.match(email.text, /Se l'hai collegata tu, non serve fare niente\./);
  assert.match(email.text, /revocala in «Il tuo account › Claude e terminale»/);
  assert.match(email.text, /Apri il tuo account:/);
  assert.doesNotMatch(email.text, /Impostazioni/);
  assert.ok(email.text.includes(`https://app.unbundle.test/dashboard/${WS}/settings`));
  assert.ok(email.html.includes("Cliente &lt;prova&gt;"), "HTML con i caratteri protetti");
  assert.ok(!email.html.includes("<prova>"));
  assert.ok(!/<img|src=/i.test(email.html), "nessuna immagine");
  const other = renderEmail({ template: "cli_collegata", clientName: "W", connectedAt: new Date("2026-11-12T22:30:00Z"), expiresAt: null, link: `https://app.unbundle.test/dashboard/${WS}/settings` });
  assert.match(other.text, /il 12 novembre 2026 alle 23:30/);
  assert.ok(!other.text.includes("vale fino"), "senza scadenza, niente frase");
});

test("(rilascio 10) il link e le parole portano a «Il tuo account › Claude e terminale», come le chiama il foglio", () => {
  const plan = planDelivery(claimed(), facts(), OPTS);
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  const input = plan.build(null);
  assert.equal(input.template, "cli_collegata");
  if (input.template !== "cli_collegata") return;
  // Il link senza ancora delle Impostazioni: arrivando da fuori, il foglio si apre sulla parte di Claude e del terminale.
  const link = new URL(input.link);
  assert.equal(accountPartForSettingsLanding(link.pathname, link.search, link.hash, WS), "claude");
  // Le parole dell'e-mail sono quelle del foglio e del menu sotto il nome.
  const email = renderEmail(input);
  const A = SHELL_TEXT.account;
  assert.ok(email.text.includes(`«${A.title} › ${A.claude.title}»`), email.text);
  assert.equal(SHELL_TEXT.user.account, A.title);
});

test("il link di Impostazioni è pulito: niente parametri, niente altri percorsi", () => {
  assert.equal(checkEmailLink(`https://app.unbundle.test/dashboard/${WS}/settings`, "dashboard"), `https://app.unbundle.test/dashboard/${WS}/settings`);
  assert.throws(() => checkEmailLink(`https://app.unbundle.test/dashboard/${WS}/settings?x=1`, "dashboard"));
  assert.throws(() => checkEmailLink(`https://app.unbundle.test/dashboard/${WS}/settings/altro`, "dashboard"));
  assert.throws(() => checkEmailLink(`http://app.unbundle.test/dashboard/${WS}/settings`, "dashboard"));
});
