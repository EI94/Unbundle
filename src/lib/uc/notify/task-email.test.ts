// Le e-mail dei compiti (rilascio 8.1a): interne, solo a persone di Lateral Space, con il compito (T-n) e il link al
// progetto dell'agente; senza compito valido non partono; i testi senza nomi.
import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_TEMPLATES, NOTICE_MODEL_NAMES, NOTICE_MODEL_RE, NOTICE_QUALITY_TEXT_RE, NOTICE_ROLE_RE, planDelivery, type ClaimedNotification, type DeliveryFacts } from "./dispatch.ts";
import { checkEmailLink, renderEmail } from "./email-templates.ts";
import { UC_NOTIFICATION_TEMPLATES } from "../../db/queries/uc-notifications.ts";
import { TASK_NOTICE_KINDS } from "../../db/use-case-hub-tasks-ddl.ts";
import { CASE_TEAM_BELL_KINDS, noticeHref } from "../../notifications/bell.ts";
import { noticeTextOf } from "../../use-cases/notices.ts";
import { CATALOGUE_MODEL_NAMES, catalogueModelName, formatQuality, isCatalogueModelName, MODEL_ID_RE, modelLabel, ROLE_RE } from "../../use-cases/factory/benchmark.ts";

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
    // (Rilascio 10, §3.12) «{Cliente}: {cosa} «{Titolo}»», al massimo 55 caratteri.
    assert.match(email.subject, /^Cliente prova: .+ «Smistamento.*»$/);
    assert.ok(email.subject.length <= 55, email.subject);
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
  assert.match(askedMail.subject, /^Cliente prova: chiedono il compito T-3 «Smistamento.*»$/);
  for (const m of [toHolder, toLead, askedMail]) assert.doesNotMatch(m.text, /\bcolleg[ahi]\b/i);
});

test("(8.1b) la PR da rivedere: nella coda, nel motore e nella campanella del team; solo a Lateral Space, con repository e numero", () => {
  const kind = "pr_da_rivedere";
  assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(kind));
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(kind));
  assert.ok(CASE_TEAM_BELL_KINDS.includes(kind));
  assert.equal(noticeHref(WS, { kind, useCaseId: UC }), `/dashboard/${WS}/use-cases/${UC}/progetto#compiti`);
  const t = noticeTextOf({ kind, answers: 0, unknowns: 0, documents: 0, followUp: null });
  assert.equal(t.title, "Una pull request da rivedere");
  const payload = { useCase: UC, ref: "T-3", repo: "Prova/rondine-alcione", pr: 12 } as unknown as Record<string, string | boolean>;
  const plan = planDelivery(claimed(kind, payload), facts(), OPTS);
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build(null));
  assert.match(email.subject, /^Cliente prova: PR da rivedere «Smistamento.*»$/);
  assert.match(email.text, /la pull request #12 in Prova\/rondine-alcione del compito T-3/);
  assert.ok(email.text.includes(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/progetto`));
  assert.doesNotMatch(email.text, /\b(collega|lui|lei)\b/i);
  const noTask = planDelivery(claimed(kind, { useCase: UC, repo: "Prova/rondine-alcione", pr: 7 } as unknown as Record<string, string | boolean>), facts(), OPTS);
  assert.ok(noTask.action === "send" && /di un ramo del caso/.test(renderEmail(noTask.build(null)).text));
  assert.deepEqual(planDelivery(claimed(kind, payload), facts(false), OPTS), { action: "cancel", reason: "destinatario_non_lateral_space" });
  assert.deepEqual(planDelivery(claimed(kind, { useCase: UC, repo: "non valido", pr: 12 } as unknown as Record<string, string | boolean>), facts(), OPTS), { action: "cancel", reason: "pr_assente" });
  assert.deepEqual(planDelivery(claimed(kind, { useCase: UC, repo: "Prova/rondine-alcione" }), facts(), OPTS), { action: "cancel", reason: "pr_assente" });
});

test("(8.1b) la proposta di compito: nella coda, nel motore e nella campanella del team; solo a Lateral Space, senza il testo", () => {
  const kind = "compito_proposto";
  assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(kind));
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(kind));
  assert.ok(CASE_TEAM_BELL_KINDS.includes(kind));
  assert.equal(noticeHref(WS, { kind, useCaseId: UC }), `/dashboard/${WS}/use-cases/${UC}/progetto#compiti`);
  assert.equal(noticeTextOf({ kind, answers: 0, unknowns: 0, documents: 0, followUp: null }).title, "Una proposta di compito");
  const plan = planDelivery(claimed(kind, { useCase: UC }), facts(), OPTS);
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build(null));
  assert.match(email.subject, /^Cliente prova: proposta di compito «Smistamento.*»$/);
  assert.match(email.text, /la accetti \(nasce il compito, da prendere\) o la scarti/);
  assert.deepEqual(planDelivery(claimed(kind, { useCase: UC }), facts(false), OPTS), { action: "cancel", reason: "destinatario_non_lateral_space" });
  assert.deepEqual(planDelivery(claimed(kind, {}), facts(), OPTS), { action: "cancel", reason: "use_case_assente" });
});

// (8.2a) Il banco di prova e le evals: interne, solo a Lateral Space, con il link al progetto; il ruolo e il modello
// consigliato, o l'avviso delle evals, dalla coda e controllati. Mai una persona.
const evalPayload = (payload: Record<string, string | number | boolean>) => payload as unknown as Record<string, string | boolean>;

test("(8.2a) il consiglio del banco: nella coda, nel motore e nella campanella del team; il ruolo e il modello, il link al progetto", () => {
  const kind = "banco_consiglio";
  assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(kind));
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(kind));
  assert.ok(CASE_TEAM_BELL_KINDS.includes(kind));
  assert.equal(noticeHref(WS, { kind, useCaseId: UC }), `/dashboard/${WS}/use-cases/${UC}/progetto#banco`);
  const text = noticeTextOf({ kind, answers: 0, unknowns: 0, documents: 0, followUp: null });
  assert.equal(text.title, "Il banco di prova consiglia un altro modello");
  assert.match(text.description, /«Evals e banco di prova», nel progetto\.$/);
  const payload = { useCase: UC, role: "lettura", model: "anthropic/claude-haiku-5-5", label: modelLabel("anthropic/claude-haiku-5-5") };
  const plan = planDelivery(claimed(kind, payload), facts(), OPTS);
  assert.equal(plan.action, "send");
  if (plan.action !== "send") return;
  const email = renderEmail(plan.build(null));
  assert.match(email.subject, /^Cliente prova: un altro modello «Smistamento.*»$/);
  assert.match(email.text, /per il ruolo «lettura» dell'agente del caso d'uso «Smistamento di prova», il banco di prova consiglia Claude Haiku 5\.5\./);
  assert.ok(email.text.includes(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/progetto`));
  assert.ok(!email.text.includes("#banco"), "il link dell'e-mail non ha frammenti");
  assert.match(email.text, /Email interna di Lateral Space\./);
  assert.deepEqual(planDelivery(claimed(kind, payload), facts(false), OPTS), { action: "cancel", reason: "destinatario_non_lateral_space" });
  // Senza il nome del catalogo (o con un altro testo), mai l'id del modello: «un altro modello», e il confronto nel progetto.
  const generic = "il banco di prova consiglia un altro modello: il confronto è nel progetto.";
  for (const label of [undefined, "<b>Haiku</b>", "anthropic/claude-haiku-5-5", "Claude Haiku 6", "claude haiku 5.5"]) {
    const bare = planDelivery(claimed(kind, { useCase: UC, role: "lettura", model: "anthropic/claude-haiku-5-5", ...(label ? { label } : {}) }), facts(), OPTS);
    assert.ok(bare.action === "send", String(label));
    if (bare.action !== "send") continue;
    const mail = renderEmail(bare.build(null));
    assert.ok(mail.text.includes(generic), String(label));
    assert.ok(!mail.text.includes("anthropic/claude-haiku-5-5") && !mail.text.includes("Haiku"), String(label));
  }
  assert.deepEqual(planDelivery(claimed(kind, { role: "lettura", model: "anthropic/claude-haiku-5-5" }), facts(), OPTS), { action: "cancel", reason: "use_case_assente" });
  const badAdvice: Record<string, string>[] = [{ useCase: UC, model: "anthropic/claude-haiku-5-5" }, { useCase: UC, role: "Lettura!", model: "anthropic/claude-haiku-5-5" }, { useCase: UC, role: "lettura", model: "modello con spazi" }];
  for (const bad of badAdvice) {
    assert.deepEqual(planDelivery(claimed(kind, bad), facts(), OPTS), { action: "cancel", reason: "consiglio_assente" }, JSON.stringify(bad));
  }
});

test("(8.2a) il consiglio del banco verso un modello scelto da chi manda: nell'e-mail mai l'id, né un indirizzo, un dominio o una e-mail", () => {
  const kind = "banco_consiglio";
  const generic = "il banco di prova consiglia un altro modello: il confronto è nel progetto.";
  for (const model of ["anthropic/claude-haiku-6.ai", "https://evil.example/", "it-helpdesk@evil.example"]) {
    // Un id che le regole del banco accettano: lo sceglie chi lancia il banco con la CLI.
    assert.match(model, MODEL_ID_RE);
    assert.equal(catalogueModelName(model), null, "fuori dal catalogo: niente nome per l'e-mail");
    // Il nome da mostrare nella pagina (modelLabel) e l'id stesso: nessuno dei due arriva nell'e-mail.
    for (const label of [undefined, modelLabel(model), model]) {
      const plan = planDelivery(claimed(kind, { useCase: UC, role: "lettura", model, ...(label === undefined ? {} : { label }) }), facts(), OPTS);
      assert.equal(plan.action, "send", `${model} ${label}`);
      if (plan.action !== "send") continue;
      const email = renderEmail(plan.build(null));
      assert.ok(email.text.includes(generic), `${model} ${label}`);
      for (const part of [model, "evil", "claude-haiku-6", "helpdesk", "https://evil"]) {
        assert.ok(!email.text.includes(part) && !email.html.includes(part) && !email.subject.includes(part), `${model}: «${part}» nell'e-mail`);
      }
    }
  }
});

test("(8.2a) le evals scese: sotto soglia o giù di 5 punti, con la qualità; nella campanella del team; il link al progetto", () => {
  const kind = "evals_in_calo";
  assert.ok((UC_NOTIFICATION_TEMPLATES as readonly string[]).includes(kind));
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(kind));
  assert.ok(CASE_TEAM_BELL_KINDS.includes(kind));
  assert.equal(noticeHref(WS, { kind, useCaseId: UC }), `/dashboard/${WS}/use-cases/${UC}/progetto#banco`);
  // Il titolo vale per tutti e due gli avvisi: sotto soglia, o in calo.
  const bellText = noticeTextOf({ kind, answers: 0, unknowns: 0, documents: 0, followUp: null });
  assert.equal(bellText.title, "Le evals di main sono sotto soglia o in calo");
  assert.match(bellText.description, /Guarda quali gruppi non passano in «Evals e banco di prova», nel progetto\.$/);
  const below = planDelivery(claimed(kind, evalPayload({ useCase: UC, alert: "sotto_soglia", qualityText: formatQuality(0.8) })), facts(), OPTS);
  assert.equal(below.action, "send");
  if (below.action !== "send") return;
  const belowEmail = renderEmail(below.build(null));
  assert.match(belowEmail.subject, /^Cliente prova: evals sotto soglia «Smistamento.*»$/);
  assert.match(belowEmail.text, /le evals di main del caso d'uso «Smistamento di prova» sono sotto soglia: 80%\./);
  // (Rilascio 10, §3.12) La metà delle parole: i gruppi e l'andamento sono nel progetto.
  assert.match(belowEmail.text, /guarda quali gruppi non passano: sono nel progetto, in «Evals e banco di prova»\./);
  assert.ok(!/<id>|&lt;id&gt;/.test(belowEmail.text + belowEmail.html), "un comando vero, senza segnaposto");
  assert.doesNotMatch(belowEmail.text, /quali prove non passano/);
  assert.ok(belowEmail.text.includes(`https://app.unbundle.test/dashboard/${WS}/use-cases/${UC}/progetto`));
  const down = planDelivery(claimed(kind, evalPayload({ useCase: UC, alert: "in_calo", qualityText: formatQuality(0.91), drop: 0.064 })), facts(), OPTS);
  assert.equal(down.action, "send");
  if (down.action !== "send") return;
  const downEmail = renderEmail(down.build(null));
  assert.match(downEmail.subject, /^Cliente prova: evals in calo «Smistamento.*»$/);
  assert.match(downEmail.text, /sono scese di 6,4 punti rispetto alle precedenti: ora sono al 91%\./);
  // La preposizione come si legge: «all'80%» (ottanta), «all'8%», «all'11%», «all'1%», «allo 0%»; «al 91%», «al 18%».
  const atQuality: [number, string][] = [
    [0.8, "all'80%"],
    [0.889, "all'88,9%"],
    [0.08, "all'8%"],
    [0.11, "all'11%"],
    [0.01, "all'1%"],
    [0, "allo 0%"],
    [0.91, "al 91%"],
    [0.18, "al 18%"],
    [1, "al 100%"],
  ];
  for (const [q, expected] of atQuality) {
    const plan = planDelivery(claimed(kind, evalPayload({ useCase: UC, alert: "in_calo", qualityText: formatQuality(q), drop: 0.064 })), facts(), OPTS);
    assert.ok(plan.action === "send", String(q));
    if (plan.action === "send") assert.ok(renderEmail(plan.build(null)).text.includes(`ora sono ${expected}.`), `${q} → ${expected}`);
  }
  assert.deepEqual(planDelivery(claimed(kind, evalPayload({ useCase: UC, alert: "sotto_soglia", qualityText: "80%" })), facts(false), OPTS), { action: "cancel", reason: "destinatario_non_lateral_space" });
  const badAlerts: Record<string, string | number | boolean>[] = [
    { useCase: UC, alert: "giù", qualityText: "80%" },
    { useCase: UC, alert: "sotto_soglia" },
    { useCase: UC, alert: "sotto_soglia", qualityText: "150%" },
    { useCase: UC, alert: "sotto_soglia", qualityText: "80% <a href=x>" },
    { useCase: UC, alert: "sotto_soglia", qualityText: 0.8 },
    { useCase: UC, alert: "in_calo", qualityText: "90%" },
    { useCase: UC, alert: "in_calo", qualityText: "90%", drop: 0 },
    { useCase: UC, alert: "in_calo", qualityText: "90%", drop: "6 punti" },
  ];
  for (const bad of badAlerts) {
    assert.deepEqual(planDelivery(claimed(kind, evalPayload(bad)), facts(), OPTS), { action: "cancel", reason: "avviso_assente" }, JSON.stringify(bad));
  }
});

test("(8.2a) le regole della coda sono quelle del modulo del banco, che il motore delle e-mail non importa", () => {
  assert.equal(NOTICE_ROLE_RE.source, ROLE_RE.source);
  assert.equal(NOTICE_MODEL_RE.source, MODEL_ID_RE.source);
  for (const q of [0, 0.004, 0.05, 0.5, 0.8, 0.9643, 27 / 28, 0.999, 1]) assert.match(formatQuality(q), NOTICE_QUALITY_TEXT_RE, String(q));
  // I nomi del catalogo sono quelli del modulo del banco, nello stesso ordine; fuori dal catalogo nessun nome.
  assert.deepEqual([...NOTICE_MODEL_NAMES], [...CATALOGUE_MODEL_NAMES]);
  for (const name of CATALOGUE_MODEL_NAMES) assert.ok(isCatalogueModelName(name) && NOTICE_MODEL_NAMES.has(name), name);
  assert.equal(catalogueModelName("anthropic/claude-haiku-5-5"), "Claude Haiku 5.5");
  assert.equal(catalogueModelName("claude-opus-5-5"), "Claude Opus 5.5");
  for (const id of ["openai/gpt-x", "fornitore/modello:v1@2", "anthropic/constructor", "toString", "anthropic/"]) assert.equal(catalogueModelName(id), null, id);
  for (const name of ["Claude Haiku 6", "claude-haiku-5-5", "", "constructor"]) assert.equal(isCatalogueModelName(name), false, name);
});
