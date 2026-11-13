// Le e-mail dei compiti (rilascio 8.1a): interne, solo a persone di Lateral Space, con il compito (T-n) e il link al
// progetto dell'agente; senza compito valido non partono; i testi senza nomi.
import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_TEMPLATES, planDelivery, type ClaimedNotification, type DeliveryFacts } from "./dispatch.ts";
import { checkEmailLink, renderEmail } from "./email-templates.ts";
import { UC_NOTIFICATION_TEMPLATES } from "../../db/queries/uc-notifications.ts";
import { TASK_NOTICE_KINDS } from "../../db/use-case-hub-tasks-ddl.ts";
import { CASE_TEAM_BELL_KINDS, noticeHref } from "../../notifications/bell.ts";
import { noticeTextOf } from "../../use-cases/notices.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const UC = "33333333-3333-4333-8333-333333333333";
const USER = "77777777-7777-4777-8777-777777777777";
const OPTS = { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: new Date("2026-11-13T09:30:00Z") };

const claimed = (templateKey: string, payload: Record<string, string | boolean> = { useCase: UC, ref: "T-3" }): ClaimedNotification => ({
  id: "88888888-8888-4888-8888-888888888888",
  workspaceId: WS,
  caseId: CASE,
  requestId: null,
  recipientContactId: null,
  recipientUserId: USER,
  templateKey,
  payload,
  attempts: 0,
  dedupeKey: `${templateKey}:${CASE}:${USER}:2026-11-13`,
});

const facts = (lateralSpace = true): DeliveryFacts => ({
  clientName: "Cliente prova",
  case: { id: CASE, code: "PX-0042", title: "Smistamento di prova", status: "pronto_sviluppo", ownerContactId: null, designated: { owner: null, privacy: null } },
  recipient: { kind: "user", id: USER, email: lateralSpace ? "persona@ls.test" : "persona@cliente.test", reachable: true, digestOptOut: false, lateralSpace },
  request: null,
});

test("i quattro tipi sono nella coda, nel motore, nella campanella del team e hanno un testo", () => {
  for (const kind of TASK_NOTICE_KINDS) {
    assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(kind), `coda: ${kind}`);
    assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(kind), `motore: ${kind}`);
    assert.ok(CASE_TEAM_BELL_KINDS.includes(kind), `campanella: ${kind}`);
    const t = noticeTextOf({ kind, answers: 0, unknowns: 0, documents: 0, followUp: null });
    assert.ok(t.title.length > 0 && t.description.length > 0, kind);
    assert.equal(noticeHref(WS, { kind, useCaseId: UC }), `/dashboard/${WS}/use-cases/${UC}/progetto#compiti`);
  }
});

test("solo a Lateral Space, con il compito e il link al progetto; senza compito si annulla (tranne «compiti pronti»)", () => {
  for (const kind of TASK_NOTICE_KINDS) {
    const plan = planDelivery(claimed(kind), facts(), OPTS);
    assert.equal(plan.action, "send", kind);
    if (plan.action !== "send") continue;
    const email = renderEmail(plan.build(null));
    assert.ok(email.text.includes(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/progetto`), kind);
    assert.match(email.subject, /^Cliente prova · Smistamento di prova: /);
    if (kind !== "compiti_pronti") assert.ok(email.subject.includes("T-3") && email.text.includes("T-3"), kind);
    assert.match(email.text, /Email interna di Lateral Space\./);
    assert.deepEqual(planDelivery(claimed(kind), facts(false), OPTS), { action: "cancel", reason: "destinatario_non_lateral_space" });
  }
  assert.deepEqual(planDelivery(claimed("compito_passato", { useCase: UC, ref: "compito 3" }), facts(), OPTS), { action: "cancel", reason: "compito_assente" });
  assert.equal(planDelivery(claimed("compiti_pronti", { useCase: UC }), facts(), OPTS).action, "send");
  assert.deepEqual(planDelivery(claimed("compito_fermo", { ref: "T-3" }), facts(), OPTS), { action: "cancel", reason: "use_case_assente" });
});

test("il link al progetto dello use case è ammesso, solo pulito", () => {
  assert.ok(checkEmailLink(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/progetto`, "dashboard"));
  assert.throws(() => checkEmailLink(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/progetto#compiti`, "dashboard"));
  assert.throws(() => checkEmailLink(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/altro`, "dashboard"));
});

test("il compito fermo: a chi lo ha, riprenderlo con «unbundle take»; al responsabile, un testo suo; nessun genere", () => {
  const holder = planDelivery(claimed("compito_fermo"), facts(), OPTS);
  const lead = planDelivery(claimed("compito_fermo", { useCase: UC, ref: "T-3", responsabile: true }), facts(), OPTS);
  assert.ok(holder.action === "send" && lead.action === "send");
  const toHolder = renderEmail(holder.build(null));
  const toLead = renderEmail(lead.build(null));
  assert.match(toHolder.text, /due giorni lavorativi/);
  assert.match(toHolder.text, /riprendilo con «unbundle take»/);
  assert.match(toLead.text, /quattro giorni lavorativi/);
  assert.match(toLead.text, /Parlane con chi lo ha/);
  assert.doesNotMatch(toLead.text, /Se ci stai lavorando/);
  // Il segnale «responsabile» vale solo per il compito fermo.
  const asked = planDelivery(claimed("compito_chiesto", { useCase: UC, ref: "T-3", responsabile: true }), facts(), OPTS);
  assert.ok(asked.action === "send");
  const askedMail = renderEmail(asked.build(null));
  assert.match(askedMail.subject, /qualcuno del team chiede il compito T-3/);
  for (const m of [toHolder, toLead, askedMail]) assert.doesNotMatch(m.text, /\bcolleg[ahi]\b/i);
});
