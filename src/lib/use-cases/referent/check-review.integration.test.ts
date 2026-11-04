import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// «Referente in un tocco» (rilascio 5, SPEC §9.2, §9.3, A6) sul database di prova: quello che il team fa con
// la risposta del referente. «Usa la stima di {Nome}» cambia solo i numeri dati della voce «ore» (per la
// strada di «Salva la valutazione»), con i suoi rifiuti (versione dello use case o della richiesta, stima
// cambiata, permessi) e il secondo clic sicuro; «Tieni la nostra» e «Fatto» chiudono senza toccare il
// modello; «Aggiungi alla stima» chiude la verifica quando il team salva una stima in ore.
//
// Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
// Nessuna email vera (mailer finto). Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
}
const opts = { skip: !enabled };

type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;
type Panel = import("./contract.ts").UseCaseReferentPanel;

let referents: typeof import("../../db/queries/use-case-referents.ts");
let check: typeof import("../../db/queries/use-case-referent-check.ts");
let pub: typeof import("../../db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../db/queries/use-case-referent-dispatch.ts");
let service: typeof import("../service.ts");
let needsMod: typeof import("../needs.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), contributor: randomUUID() };
const storageDir = mkdtempSync(join(tmpdir(), "referenti-verifica-"));
const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const ctx = (who: "builder" | "contributor" = "builder") => ({
  workspaceId: ids.ws,
  actor: { userId: ids[who], role: who === "builder" ? "function_lead" : "contributor", isLateralSpace: false, kind: "persona" as const },
  channel: "pagina" as const,
});
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function refused(result: { ok: boolean; error?: string }, error: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.error, error, label);
}
const pok = <T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, label = "esito"): T => {
  if (!r.ok) assert.fail(`${label}: atteso ok, ricevuto ${r.code} (${r.message})`);
  return r.value;
};

/** Un modello valido di prova: 3.000 volte l'anno, 12 minuti, il 50% che si risparmia. */
const MODEL = {
  v: 1,
  primary: "tempo",
  components: [{ kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", confidence: "ipotesi", volumeYear: 3000, unit: "pratiche", minutesPerUnit: 12, automatablePct: 50, basis: "Dal team" }],
};

async function newCard(model: unknown): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, value_model, target_quarter)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Le fatture arrivano via PEC.', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed', $4::jsonb, '2027-Q1')`,
    [id, ids.ws, `RV-${String(1000 + Math.floor(Math.random() * 8000))}`, model === null ? null : JSON.stringify(model)],
  );
  return id;
}

let seq = 0;
/** Il link di ogni richiesta di `answered`, per inviare dopo una bozza lasciata a metà. */
const links = new Map<string, import("../../db/queries/use-case-referent-public.ts").ReferentLink>();
/** Il referente risponde: «Sì, è così» o «Correggi», poi la stima, poi «Invia» (senza `send: false`). */
async function answered(
  useCaseId: string,
  step1: { confirm: "si" | "correggi"; note: string | null },
  step2: { estimate: "si" | "meno" | "piu" | null; timesPerMonth: number | string | null; minutesEach: number | string | null; teamSeen: { key: string; volumeYear: number; minutes: number } | null },
  o: { send?: boolean } = {},
): Promise<string> {
  const sent = ok(
    await referents.sendReferentRequest(
      ctx(),
      useCaseId,
      { kind: "referente", expectedReferentRequestId: null, contact: { kind: "nuovo", displayName: "Aldo Prova", email: `aldo.${seq++}.${suffix}@topjet.test` }, needIds: [] },
      { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } },
    ),
    "invio",
  );
  const outbox: Mail[] = [];
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  const token = /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(outbox[0]?.text ?? "")?.[1];
  assert.ok(token);
  const first = await pub.resolveReferentToken(token!, new Date());
  if (first.access !== "ok") assert.fail("link");
  pok(await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-10-1" }, new Date()) as never, "informativa");
  const link = await pub.resolveReferentToken(token!, new Date());
  if (link.access !== "ok") assert.fail("link");
  pok(await pub.saveReferentCheck(link.link, { step: 1, ...step1 }, new Date()) as never, "passo 1");
  pok(await pub.saveReferentCheck(link.link, { step: 2, ...step2 }, new Date()) as never, "passo 2");
  links.set(sent.requestId, link.link);
  if (o.send !== false) pok(await pub.submitReferentAnswers(link.link, {}, new Date()) as never, "invia");
  return sent.requestId;
}

async function panelOf(useCaseId: string): Promise<Panel> {
  const all = await (await import("../../db/queries/use-case-needs.ts")).listWorkspaceNeeds(ids.ws, { userId: ids.builder, role: "function_lead", isLateralSpace: false, emailVerified: true, email: `builder.${suffix}@cliente.test` } as never);
  const lists = needsMod.needListsOfUseCase(all ?? [], useCaseId);
  const panel = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId,
    viewer: { userId: ids.builder, role: "function_lead", isLateralSpace: false, emailVerified: true, email: `builder.${suffix}@cliente.test` } as never,
    session: { id: ids.builder, name: "Giulia Neri", email: `builder.${suffix}@cliente.test`, emailVerified: true },
    role: "function_lead",
    needs: lists,
    eligible: true,
    env: ENV,
  });
  assert.ok(panel?.available, "il pannello c'è");
  return panel!;
}
async function versionOf(useCaseId: string): Promise<number> {
  return Number((await q(`SELECT version FROM use_cases WHERE id = $1::uuid`, [useCaseId]))[0].version);
}
async function modelOf(useCaseId: string): Promise<{ components: Array<Record<string, unknown>> }> {
  const raw = (await q(`SELECT value_model FROM use_cases WHERE id = $1::uuid`, [useCaseId]))[0].value_model;
  return typeof raw === "string" ? JSON.parse(raw) : (raw as never);
}
async function checkOf(requestId: string) {
  return (await q(`SELECT estimate_outcome, estimate_outcome_at IS NOT NULL AS outcome_at, correction_done_at IS NOT NULL AS corrected FROM use_case_referent_checks WHERE request_id = $1::uuid`, [requestId]))[0];
}
async function story(useCaseId: string): Promise<string[]> {
  return (await q(`SELECT phase_after, action FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [useCaseId])).map((r) => `${r.action}:${r.phase_after ?? ""}`);
}
const requestVersion = async (id: string) => Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [id]))[0].version);

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  referents = await import("../../db/queries/use-case-referents.ts");
  check = await import("../../db/queries/use-case-referent-check.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  service = await import("../service.ts");
  needsMod = await import("../needs.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione verifica', $2)`, [ids.org, `hub-verifica-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  for (const [id, role, email] of [[ids.builder, "function_lead", `builder.${suffix}@cliente.test`], [ids.contributor, "contributor", `contrib.${suffix}@cliente.test`]] as const) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [id, email, `Persona ${role}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, id, role]);
  }
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(storageDir, { recursive: true, force: true });
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%'`);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.contributor]]);
});

const SEEN = { key: "tempo-1", volumeYear: 3000, minutes: 12 };

test("«Usa la stima di {Nome}»: i rifiuti, poi solo i numeri dati nella voce, l'esito e la Storia; il secondo clic non riscrive", opts, async () => {
  const card = await newCard(MODEL);
  const requestId = await answered(card, { confirm: "si", note: null }, { estimate: "meno", timesPerMonth: 200, minutesEach: null, teamSeen: SEEN });
  const before = await panelOf(card);
  assert.equal(before.referent?.state, "da_verificare");
  assert.equal(before.referent?.review, "stima");
  assert.equal(before.referent?.check?.team?.hours, 600);
  assert.equal(before.referent?.check?.referentHours, 480);
  const v = await versionOf(card);
  const rv = await requestVersion(requestId);
  refused(await check.adoptReferentEstimate(ctx("contributor"), card, requestId, { requestVersion: rv, useCaseVersion: v }, ENV), "permesso_mancante", "un contributore");
  refused(await check.adoptReferentEstimate(ctx(), card, requestId, { requestVersion: rv + 1, useCaseVersion: v }, ENV), "versione_superata", "la richiesta cambiata");
  refused(await check.adoptReferentEstimate(ctx(), card, requestId, { requestVersion: rv, useCaseVersion: v + 7 }, ENV), "versione_superata", "lo use case cambiato");
  // Il team cambia la stima dopo la risposta: rifiutata, niente scritto.
  await q(`UPDATE use_cases SET value_model = jsonb_set(value_model, '{components,0,volumeYear}', '4000') WHERE id = $1::uuid`, [card]);
  refused(await check.adoptReferentEstimate(ctx(), card, requestId, { requestVersion: rv, useCaseVersion: await versionOf(card) }, ENV), "stima_cambiata");
  assert.equal((await panelOf(card)).referent?.check?.teamChanged, true, "«La stima del team è cambiata dopo la risposta.»");
  await q(`UPDATE use_cases SET value_model = $2::jsonb WHERE id = $1::uuid`, [card, JSON.stringify(MODEL)]);
  assert.equal((await checkOf(requestId)).estimate_outcome, null);

  const adopted = ok(await check.adoptReferentEstimate(ctx(), card, requestId, { requestVersion: rv, useCaseVersion: await versionOf(card) }, ENV), "adozione");
  assert.deepEqual(adopted, { before: 600, after: 480 });
  const [component] = (await modelOf(card)).components;
  assert.deepEqual([component.volumeYear, component.minutesPerUnit, component.automatablePct, component.confidence, component.basis, component.label], [2400, 12, 50, "ipotesi", "Dal team", "Controllo delle fatture"], "solo i numeri dati (D10)");
  assert.equal((await checkOf(requestId)).estimate_outcome, "adottata");
  const codes = await story(card);
  assert.ok(codes.includes("modificato:stima_adottata"), JSON.stringify(codes));
  assert.ok(codes.some((c) => c.startsWith("valutato:")), "la Storia di «Benefici e costi»");
  const after = await panelOf(card);
  assert.equal(after.referent?.state, "fatto");
  assert.equal(after.referent?.check?.outcome, "adottata");
  // Il secondo clic (la stessa versione letta): rifiutato, niente si riscrive.
  const vAfter = await versionOf(card);
  refused(await check.adoptReferentEstimate(ctx(), card, requestId, { requestVersion: rv, useCaseVersion: vAfter }, ENV), "versione_superata");
  assert.equal(await versionOf(card), vAfter);
  // Un errore a metà (il modello scritto, l'esito no): un nuovo clic scrive solo l'esito.
  await q(`UPDATE use_case_referent_checks SET estimate_outcome = NULL, estimate_outcome_at = NULL WHERE request_id = $1::uuid`, [requestId]);
  ok(await check.adoptReferentEstimate(ctx(), card, requestId, { requestVersion: await requestVersion(requestId), useCaseVersion: vAfter }, ENV), "di nuovo");
  assert.equal(await versionOf(card), vAfter, "il modello non si riscrive");
  assert.equal((await checkOf(requestId)).estimate_outcome, "adottata");
});

test("«Tieni la nostra», «Fatto» sulla stima senza numeri e sulla correzione: niente nel modello, la verifica si chiude", opts, async () => {
  const card = await newCard(MODEL);
  const keep = await answered(card, { confirm: "correggi", note: "Arrivano anche via PEC." }, { estimate: "piu", timesPerMonth: null, minutesEach: null, teamSeen: SEEN });
  const panel = await panelOf(card);
  assert.equal(panel.referent?.review, "correzione", "prima la correzione");
  refused(await check.adoptReferentEstimate(ctx(), card, keep, { requestVersion: await requestVersion(keep), useCaseVersion: await versionOf(card) }, ENV), "dati_non_validi", "senza numeri non si adotta");
  const v = await versionOf(card);
  ok(await check.markCorrectionDone(ctx(), card, keep, await requestVersion(keep), ENV), "correzione fatta");
  assert.equal((await checkOf(keep)).corrected, true);
  assert.equal((await panelOf(card)).referent?.review, "stima", "poi la stima");
  ok(await check.keepTeamEstimate(ctx(), card, keep, await requestVersion(keep), ENV), "vista");
  assert.equal((await checkOf(keep)).estimate_outcome, "tenuta");
  assert.equal(await versionOf(card), v, "il modello non cambia");
  const done = await panelOf(card);
  assert.deepEqual([done.referent?.state, done.referent?.review], ["fatto", null]);
  const codes = await story(card);
  for (const code of ["correzione", "stima_diversa", "correzione_fatta", "stima_tenuta"]) assert.ok(codes.includes(`modificato:${code}`), code);
  // «Sì» non ha niente da tenere.
  const yes = await newCard(MODEL);
  const plain = await answered(yes, { confirm: "si", note: null }, { estimate: "si", timesPerMonth: null, minutesEach: null, teamSeen: SEEN });
  refused(await check.keepTeamEstimate(ctx(), yes, plain, await requestVersion(plain), ENV), "dati_non_validi");
  refused(await check.markCorrectionDone(ctx(), yes, plain, await requestVersion(plain), ENV), "dati_non_validi");
});

test("senza una stima del team: «Non serve» chiude; «Aggiungi alla stima» chiude quando il team salva una stima in ore", opts, async () => {
  const none = await newCard(null);
  const a = await answered(none, { confirm: "si", note: null }, { estimate: null, timesPerMonth: 20, minutesEach: 30, teamSeen: null });
  const p = await panelOf(none);
  assert.deepEqual([p.referent?.state, p.referent?.review, p.referent?.check?.team, p.referent?.check?.referentHours], ["da_verificare", "stima", null, 120]);
  ok(await check.keepTeamEstimate(ctx(), none, a, await requestVersion(a), ENV), "non serve");
  assert.equal((await panelOf(none)).referent?.state, "fatto");

  const prefill = await newCard(null);
  await answered(prefill, { confirm: "si", note: null }, { estimate: null, timesPerMonth: 20, minutesEach: 30, teamSeen: null });
  assert.equal((await panelOf(prefill)).referent?.review, "stima");
  // Il modulo «Modifica valutazione» con la voce già scritta: il salvataggio di sempre.
  const model = { v: 1, primary: "tempo", components: [{ kind: "ore", key: "voce-1", lever: "tempo", label: "Lavoro di oggi", confidence: "fonte", volumeYear: 240, minutesPerUnit: 30, automatablePct: 40, basis: "Stima del referente del 3 nov." }] };
  const saved = await service.saveValuation(ctx(), prefill, await versionOf(prefill), { model } as never);
  assert.ok(saved.ok, JSON.stringify(saved));
  const closed = await panelOf(prefill);
  assert.deepEqual([closed.referent?.state, closed.referent?.review, closed.referent?.check?.teamNow], ["fatto", null, true], "la verifica si chiude da sola (D11)");
});

test("la bozza del referente resta sua fino a «Invia»: il pannello del team non ha la nota, la scelta né i numeri", opts, async () => {
  const card = await newCard(MODEL);
  const NOTE = "Bozza RK-NOTA-7781: le fatture le manda mario.rossi@acme.test";
  const draft = await answered(card, { confirm: "correggi", note: NOTE }, { estimate: "meno", timesPerMonth: "123,5", minutesEach: "7,25", teamSeen: SEEN }, { send: false });
  const row = (await q(`SELECT confirm, confirm_note IS NOT NULL AS has_note, estimate, times_per_month::text AS t, submitted_at FROM use_case_referent_checks WHERE request_id = $1::uuid`, [draft]))[0];
  assert.deepEqual([row.confirm, row.has_note, row.estimate, row.t, row.submitted_at], ["correggi", true, "meno", "123.50", null], "la bozza è salvata");
  const before = await panelOf(card);
  assert.equal(before.referent?.state, "in_attesa");
  const c = before.referent?.check;
  assert.ok(c, "la richiesta al referente ha la sua conferma");
  assert.deepEqual(
    [c!.submittedAt, c!.confirm, c!.note, c!.estimate, c!.timesPerMonth, c!.minutesEach, c!.team, c!.referentHours, c!.teamChanged],
    [null, null, null, null, null, null, null, null, false],
    "prima di «Invia» al team arriva solo che la richiesta c'è",
  );
  // Niente della bozza in tutto il pannello, che la scheda passa a un componente client.
  const json = JSON.stringify(before);
  for (const token of ["RK-NOTA-7781", "mario.rossi", "123.5", "7.25"]) assert.ok(!json.includes(token), token);
  // Il referente toglie l'email dalla nota e invia: il team vede la correzione e la stima.
  const CLEAN = "Arrivano anche via PEC.";
  pok(await pub.saveReferentCheck(links.get(draft)!, { step: 1, confirm: "correggi", note: CLEAN }, new Date()) as never, "nota corretta");
  pok(await pub.submitReferentAnswers(links.get(draft)!, {}, new Date()) as never, "invia");
  const after = (await panelOf(card)).referent?.check;
  assert.deepEqual([after?.confirm, after?.note, after?.estimate, after?.timesPerMonth, after?.minutesEach], ["correggi", CLEAN, "meno", 123.5, 7.25]);
  assert.ok(after?.submittedAt);
});
