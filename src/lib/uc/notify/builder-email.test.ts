// Le e-mail a chi costruisce i casi da fuori Lateral Space (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §10, U4): partono solo
// se costruisce quel caso adesso e il cliente ha dato l'ok ai sub-responsabili; altrimenti si annullano e resta la
// campanella. Mai quelle del responsabile, dell'AI Board, e il riepilogo settimanale. «Costruisci i casi d'uso di…»
// aspetta l'ok al massimo 14 giorni e parte solo se la concessione c'è ancora.
import test from "node:test";
import assert from "node:assert/strict";
import { BUILDER_EMAIL_TEMPLATES, EMAIL_TEMPLATES, planDelivery, TEAM_ADDED_WAIT_DAYS, type ClaimedNotification, type DeliveryFacts } from "./dispatch.ts";
import { renderEmail } from "./email-templates.ts";
import { UC_NOTIFICATION_TEMPLATES } from "../../db/queries/uc-notifications.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const UC = "33333333-3333-4333-8333-333333333333";
const USER = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-11-16T09:30:00Z");
const OPTS = { origin: "https://app.unbundle.test", lsDomains: ["ls.test"], now: NOW };

const PAYLOAD: Record<string, Record<string, string | number | boolean>> = {
  pacchetto_aggiornato: { useCase: UC, version: 2 },
  compito_chiesto: { useCase: UC, ref: "T-3" },
  compito_passato: { useCase: UC, ref: "T-3" },
  compito_fermo: { useCase: UC, ref: "T-3" },
  compiti_pronti: { useCase: UC },
  pr_da_rivedere: { useCase: UC, repo: "Voltaen/nardi-esploso", pr: 7 },
  compito_proposto: { useCase: UC },
  banco_consiglio: { useCase: UC, role: "lettura", model: "anthropic/claude-haiku-5-5", label: "Claude Haiku 5.5" },
  evals_in_calo: { useCase: UC, alert: "sotto_soglia", qualityText: "80%" },
};

const claimed = (templateKey: string, payload: Record<string, string | number | boolean | null> = PAYLOAD[templateKey] ?? {}, caseId: string | null = CASE): ClaimedNotification => ({
  id: "88888888-8888-4888-8888-888888888888",
  workspaceId: WS,
  caseId,
  requestId: null,
  recipientContactId: null,
  recipientUserId: USER,
  templateKey,
  payload,
  attempts: 0,
  dedupeKey: `${templateKey}:${CASE}:${USER}:2026-11-16`,
});

const external = (builder: DeliveryFacts["builder"], withCase = true): DeliveryFacts => ({
  clientName: "Nardi di prova",
  case: withCase ? { id: CASE, code: "NM-0009", title: "Esploso dei ricambi", status: "in_sviluppo", ownerContactId: null, designated: { owner: null, privacy: null } } : null,
  recipient: { kind: "user", id: USER, email: "alessio@gmail.test", reachable: true, digestOptOut: false, lateralSpace: false },
  request: null,
  ...(builder ? { builder } : {}),
});

const action = (p: ReturnType<typeof planDelivery>) => (p.action === "send" ? "send" : `${p.action}:${p.reason}`);

test("U4: chi costruisce da fuori riceve le e-mail di chi costruisce solo se costruisce il caso adesso e c'è l'ok", () => {
  assert.deepEqual([...BUILDER_EMAIL_TEMPLATES].sort(), Object.keys(PAYLOAD).sort());
  for (const tpl of BUILDER_EMAIL_TEMPLATES) {
    assert.equal(action(planDelivery(claimed(tpl), external({ buildsCase: true, workspaceAck: true, grant: true }), OPTS)), "send", tpl);
    assert.equal(action(planDelivery(claimed(tpl), external({ buildsCase: true, workspaceAck: false, grant: true }), OPTS)), "cancel:sub_responsabili_mancanti", tpl);
    assert.equal(action(planDelivery(claimed(tpl), external({ buildsCase: false, workspaceAck: true, grant: true }), OPTS)), "cancel:destinatario_non_lateral_space", tpl);
    assert.equal(action(planDelivery(claimed(tpl), external(undefined), OPTS)), "cancel:destinatario_non_lateral_space", `${tpl}: senza i fatti, come prima`);
  }
});

test("U4: a chi costruisce da fuori il piede dice «Email automatica di Unbundle.»; a Lateral Space resta «Email interna di Lateral Space.»", () => {
  const all = { buildsCase: true, workspaceAck: true, grant: true };
  const ls: DeliveryFacts = { ...external(all), recipient: { kind: "user", id: USER, email: "leo@ls.test", reachable: true, digestOptOut: false, lateralSpace: true } };
  const footer = (facts: DeliveryFacts, tpl: string) => {
    const plan = planDelivery(claimed(tpl), facts, OPTS);
    assert.equal(plan.action, "send", tpl);
    if (plan.action !== "send") return "";
    const email = renderEmail(plan.build(null));
    assert.ok(email.text.includes("caso d'uso"), `${tpl}: «caso d'uso» nelle e-mail`);
    // L'ultima riga prima della firma («--»): il piede dell'e-mail.
    return email.text.split("\n--\n")[0].trim().split("\n").at(-1) ?? "";
  };
  for (const tpl of BUILDER_EMAIL_TEMPLATES) {
    const outside = footer(external(all), tpl);
    assert.equal(outside, "Email automatica di Unbundle.", tpl);
    assert.ok(!outside.includes("Lateral Space"), `${tpl}: mai «interna» a chi viene da fuori`);
    assert.equal(footer(ls, tpl), "Email interna di Lateral Space.", `${tpl}: a Lateral Space come prima`);
  }
});

test("U4: mai «da approvare», «modifica richiesta», «domanda proposta», «strumento da approvare» né il riepilogo settimanale", () => {
  const all = { buildsCase: true, workspaceAck: true, grant: true };
  for (const tpl of ["progetto_da_approvare", "strumento_da_approvare", "modifica_richiesta", "domanda_proposta"]) {
    assert.equal(action(planDelivery(claimed(tpl, { useCase: UC, version: 1 }), external(all), OPTS)), "cancel:destinatario_non_lateral_space", tpl);
  }
  const weekly = planDelivery(claimed("riepilogo_settimanale", { week: "2026-W47" }, null), { ...external(all, false), weekly: { cases: [] } }, OPTS);
  assert.equal(action(weekly), "cancel:destinatario_non_lateral_space");
});

test("U4: «Costruisci i casi d'uso di…» aspetta l'ok al massimo 14 giorni e parte solo con la concessione", () => {
  const added = (queuedAt: string, payload: Record<string, string | number | boolean | null> = { tutti: true }) => claimed("team_aggiunto", { ...payload, queuedAt }, null);
  const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString();
  const longAgo = new Date(NOW.getTime() - (TEAM_ADDED_WAIT_DAYS + 1) * 86_400_000).toISOString();
  assert.equal(TEAM_ADDED_WAIT_DAYS, 14);
  assert.equal(action(planDelivery(added(yesterday), external({ buildsCase: false, workspaceAck: false, grant: true }, false), OPTS)), "hold:sub_responsabili_mancanti");
  assert.equal(action(planDelivery(added(longAgo), external({ buildsCase: false, workspaceAck: false, grant: true }, false), OPTS)), "cancel:sub_responsabili_mancanti");
  assert.equal(action(planDelivery(added("non è una data"), external({ buildsCase: false, workspaceAck: false, grant: true }, false), OPTS)), "cancel:sub_responsabili_mancanti", "senza data non aspetta");
  assert.equal(action(planDelivery(added(yesterday), external({ buildsCase: false, workspaceAck: true, grant: false }, false), OPTS)), "cancel:concessione_tolta");
  const sent = planDelivery(added(yesterday), external({ buildsCase: false, workspaceAck: true, grant: true }, false), OPTS);
  assert.equal(sent.action, "send");
  if (sent.action !== "send") return;
  const email = renderEmail(sent.build(null));
  assert.equal(email.subject, "Costruisci i casi d'uso di Nardi di prova con l'Agent Factory");
  assert.match(email.text, /Da oggi costruisci con Lateral Space i casi d'uso di Nardi di prova: tutti, anche quelli che si apriranno\. Un caso d'uso è un lavoro che un agente AI fa insieme alle persone\./);
  assert.match(email.text, /Per cominciare: apri l'Agent Factory, collega Claude Code con «unbundle login» e prendi un compito\./);
  assert.match(email.text, /Il progetto di ogni caso lo approva il suo responsabile; l'accesso ai repository su GitHub te lo dà Lateral Space\./);
  assert.ok(email.text.includes(`Apri l'Agent Factory: https://app.unbundle.test/dashboard/${WS}/agent-factory`));
  assert.ok(!/@|alessio/i.test(email.text), "nessun nome né indirizzo");
  const some = planDelivery(added(yesterday, { tutti: false, casi: 3 }), external({ buildsCase: false, workspaceAck: true, grant: true }, false), OPTS);
  assert.ok(some.action === "send" && renderEmail(some.build(null)).text.includes("di Nardi di prova: 3 casi d'uso."));
  // A una persona di Lateral Space non parte mai (non si mette in coda, ma la regola lo dice).
  const ls = { ...external({ buildsCase: false, workspaceAck: true, grant: true }, false), recipient: { kind: "user" as const, id: USER, email: "leo@ls.test", reachable: true, digestOptOut: false, lateralSpace: true } };
  assert.equal(action(planDelivery(added(yesterday), ls, OPTS)), "cancel:destinatario_lateral_space");
});

test("U4: «Non costruisci più…» solo con l'ok e solo se non costruisce più", () => {
  const removed = claimed("team_tolto", { queuedAt: NOW.toISOString() }, null);
  assert.equal(action(planDelivery(removed, external({ buildsCase: false, workspaceAck: false, grant: false }, false), OPTS)), "cancel:sub_responsabili_mancanti");
  assert.equal(action(planDelivery(removed, external({ buildsCase: false, workspaceAck: true, grant: true }, false), OPTS)), "cancel:concessione_ancora_presente");
  const sent = planDelivery(removed, external({ buildsCase: false, workspaceAck: true, grant: false }, false), OPTS);
  assert.equal(sent.action, "send");
  if (sent.action !== "send") return;
  const email = renderEmail(sent.build(null));
  assert.equal(email.subject, "Non costruisci più i casi d'uso di Nardi di prova");
  assert.match(email.text, /da adesso non lavori più ai casi d'uso di Nardi di prova dall'Agent Factory\. I compiti che avevi in corso sono tornati da prendere\./);
  assert.match(email.text, /L'accesso ai repository su GitHub lo toglie Lateral Space\./);
});

test("i due modelli nuovi sono nel motore e nella coda", () => {
  for (const tpl of ["team_aggiunto", "team_tolto"]) {
    assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(tpl), tpl);
    assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(tpl), tpl);
  }
});
