// Le email dell'Agent Factory (rilascio 8.0a): progetto da approvare, strumento nuovo, pacchetto aggiornato, modifica
// chiesta dall'AI Board. Solo a persone di Lateral Space del team, con il link alla pagina «Progetto dell'agente»
// del dossier; mai a un contatto o a un utente del cliente; mai a caso chiuso; testi senza nomi né valori.
import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_TEMPLATES, planDelivery, type ClaimedNotification, type DeliveryFacts } from "./dispatch.ts";
import { checkEmailLink, renderEmail } from "./email-templates.ts";
import { UC_NOTIFICATION_TEMPLATES } from "../../db/queries/uc-notifications.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const USER = "77777777-7777-4777-8777-777777777777";
const OPTS = { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: new Date("2026-11-11T09:30:00Z") };
const TEMPLATES = ["progetto_da_approvare", "strumento_da_approvare", "pacchetto_aggiornato", "modifica_richiesta"] as const;

const claimed = (templateKey: string, version: number | null = 2): ClaimedNotification => ({
  id: "88888888-8888-4888-8888-888888888888",
  workspaceId: WS,
  caseId: CASE,
  requestId: null,
  recipientContactId: null,
  recipientUserId: USER,
  templateKey,
  payload: version === null ? {} : { version },
  attempts: 0,
  dedupeKey: `${templateKey}:${CASE}:${USER}:2026-11-11`,
});

const facts = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({
  clientName: "Cliente prova",
  case: { id: CASE, code: "UC-PROVA", title: "Quotazioni di prova", status: "bozza", ownerContactId: null, designated: { owner: null, privacy: null } },
  recipient: { kind: "user", id: USER, email: "persona@ls.test", reachable: true, digestOptOut: false, lateralSpace: true },
  request: null,
  ...over,
});

test("i tre modelli sono nella coda e nel motore", () => {
  for (const t of TEMPLATES) {
    assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(t), `coda: ${t}`);
    assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(t), `motore: ${t}`);
  }
});

test("a una persona di Lateral Space parte, con il link al progetto del dossier e la versione", () => {
  for (const t of TEMPLATES) {
    const plan = planDelivery(claimed(t), facts(), OPTS);
    assert.equal(plan.action, "send", t);
    if (plan.action !== "send") continue;
    assert.equal(plan.to, "persona@ls.test");
    const email = renderEmail(plan.build("") as Parameters<typeof renderEmail>[0]);
    assert.match(email.text, new RegExp(`https://app\\.unbundle\\.test/dashboard/${WS}/casi-duso/${CASE}/progetto`), t);
    assert.match(email.subject, /^Cliente prova · Quotazioni di prova: /, t);
    assert.match(email.text, /caso d'uso «Quotazioni di prova»/, `fuori dalla dashboard si dice «caso d'uso»: ${t}`);
    assert.doesNotMatch(email.text, /use case/i, t);
  }
  const k = planDelivery(claimed("pacchetto_aggiornato", 3), facts(), OPTS);
  assert.ok(k.action === "send");
  if (k.action === "send") assert.match(renderEmail(k.build("") as Parameters<typeof renderEmail>[0]).subject, /pacchetto k3$/);
});

test("«progetto da approvare» dice degli strumenti nuovi, così il responsabile riceve una email sola", () => {
  const plan = planDelivery({ ...claimed("progetto_da_approvare"), payload: { version: 1, count: 2 } }, facts(), OPTS);
  assert.ok(plan.action === "send");
  if (plan.action !== "send") return;
  assert.match(renderEmail(plan.build("") as Parameters<typeof renderEmail>[0]).text, /Usa 2 strumenti nuovi per il cliente: prima dell'approvazione serve anche l'ok dell'AI Board\./);
  const none = planDelivery({ ...claimed("progetto_da_approvare"), payload: { version: 1, count: 0 } }, facts(), OPTS);
  if (none.action === "send") assert.doesNotMatch(renderEmail(none.build("") as Parameters<typeof renderEmail>[0]).text, /strumenti nuovi per il cliente/);
});

test("«l'AI Board chiede una modifica» dice di riaprire il progetto, senza la nota (che sta nella pagina)", () => {
  const plan = planDelivery({ ...claimed("modifica_richiesta", 2), payload: { version: 2, count: 0 } }, facts(), OPTS);
  assert.ok(plan.action === "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build("") as Parameters<typeof renderEmail>[0]);
  assert.match(email.subject, /: l'AI Board chiede una modifica$/);
  assert.match(email.text, /\(versione 2\)/);
  assert.match(email.text, /Riapri il progetto, cambialo con il team e rimandalo in approvazione\./);
});

test("mai al cliente: un utente che non è di Lateral Space o un contatto si annullano; a caso chiuso pure", () => {
  for (const t of TEMPLATES) {
    const client = planDelivery(claimed(t), facts({ recipient: { kind: "user", id: USER, email: "persona@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false } }), OPTS);
    assert.deepEqual(client.action === "cancel" ? client.reason : client.action, "destinatario_non_lateral_space", t);
    const contact = planDelivery({ ...claimed(t), recipientContactId: USER, recipientUserId: null }, facts({ recipient: { kind: "contact", id: USER, email: "x@ls.test", reachable: true, digestOptOut: false, lateralSpace: false } }), OPTS);
    assert.equal(contact.action, "cancel", t);
    const closed = planDelivery(claimed(t), facts({ case: { id: CASE, code: "UC-PROVA", title: "x", status: "chiuso", ownerContactId: null, designated: { owner: null, privacy: null } } }), OPTS);
    assert.equal(closed.action === "cancel" ? closed.reason : closed.action, "caso_chiuso", t);
  }
});

test("il link della dashboard accetta solo la pagina del caso o il suo progetto", () => {
  const base = `https://app.unbundle.test/dashboard/${WS}/casi-duso/${CASE}`;
  assert.equal(checkEmailLink(`${base}/progetto`, "dashboard"), `${base}/progetto`);
  assert.equal(checkEmailLink(base, "dashboard"), base);
  for (const bad of [`${base}/persone`, `${base}/progetto?x=1`, `${base}/progetto#a`, `https://app.unbundle.test/dashboard/${WS}/progetto`]) {
    assert.throws(() => checkEmailLink(bad, "dashboard"), bad);
  }
});

test("«un coding agent propone una domanda»: al responsabile di Lateral Space, con il link alle proposte dello use case; mai al cliente", () => {
  const UC = "33333333-3333-4333-8333-333333333333";
  assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes("domanda_proposta"));
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes("domanda_proposta"));
  const plan = planDelivery({ ...claimed("domanda_proposta", null), payload: { version: 0, count: 0, useCase: UC } }, facts(), OPTS);
  assert.ok(plan.action === "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build("") as Parameters<typeof renderEmail>[0]);
  assert.match(email.subject, /^Cliente prova · Quotazioni di prova: un coding agent propone una domanda$/);
  assert.match(email.text, new RegExp(`https://app\\.unbundle\\.test/dashboard/${WS}/use-cases/${UC}/proposte`));
  assert.match(email.text, /Non parte da sola/);
  assert.doesNotMatch(email.text, /use case/i);
  const noUseCase = planDelivery({ ...claimed("domanda_proposta", null), payload: {} }, facts(), OPTS);
  assert.equal(noUseCase.action === "cancel" ? noUseCase.reason : noUseCase.action, "use_case_assente");
  const client = planDelivery({ ...claimed("domanda_proposta", null), payload: { useCase: UC } }, facts({ recipient: { kind: "user", id: USER, email: "persona@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false } }), OPTS);
  assert.equal(client.action === "cancel" ? client.reason : client.action, "destinatario_non_lateral_space");
  const base = `https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}`;
  assert.equal(checkEmailLink(`${base}/proposte`, "dashboard"), `${base}/proposte`);
  for (const bad of [base, `${base}/progetto`, `${base}/proposte?x=1`, `${base}/altro`]) assert.throws(() => checkEmailLink(bad, "dashboard"), bad);
});
