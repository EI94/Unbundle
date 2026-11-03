import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// «Referente in un tocco» (rilascio 5, SPEC §10.1, A8) sul database di prova: lo stato del referente di ogni
// use case per le card e le righe (`listReferentStates`), per i revisori con che cosa aspetta il team, per i
// contributori solo la parola e solo degli use case che vedono; mai una persona, mai un conteggio per persona.
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

let referents: typeof import("../../db/queries/use-case-referents.ts");
let states: typeof import("../../db/queries/use-case-referent-states.ts");
let pub: typeof import("../../db/queries/use-case-referent-public.ts");
let dispatch: typeof import("../../db/queries/use-case-referent-dispatch.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), contributor: randomUUID() };
const storageDir = mkdtempSync(join(tmpdir(), "referenti-stati-"));
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
/** Il referente risponde: «Sì, è così» o «Correggi», poi la stima, poi «Invia». */
async function answered(useCaseId: string, step1: { confirm: "si" | "correggi"; note: string | null }, step2: { estimate: "si" | "meno" | "piu" | null; timesPerMonth: number | null; minutesEach: number | null; teamSeen: { key: string; volumeYear: number; minutes: number } | null }): Promise<string> {
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
  pok(await pub.submitReferentAnswers(link.link, {}, new Date()) as never, "invia");
  return sent.requestId;
}


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
  states = await import("../../db/queries/use-case-referent-states.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione stati', $2)`, [ids.org, `hub-stati-${ids.org}`]);
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
const viewer = (who: "builder" | "contributor") => ({
  userId: ids[who],
  email: who === "builder" ? `builder.${suffix}@cliente.test` : `contrib.${suffix}@cliente.test`,
  emailVerified: true,
  role: who === "builder" ? "function_lead" : "contributor",
  isLateralSpace: false,
});

test("gli stati del referente: manca, in attesa, da verificare con la stima, ha risposto; niente per chi non ne ha uno da scegliere", opts, async () => {
  const missing = await newCard(MODEL);
  const waiting = await newCard(MODEL);
  const toVerify = await newCard(MODEL);
  const done = await newCard(MODEL);
  const best = await newCard(MODEL);
  await q(`UPDATE use_cases SET portfolio_kind = 'best_practice' WHERE id = $1::uuid`, [best]);
  ok(
    await referents.sendReferentRequest(ctx(), waiting, { kind: "referente", expectedReferentRequestId: null, contact: { kind: "nuovo", displayName: "Bruna Esempio", email: `bruna.${suffix}@topjet.test` }, needIds: [] }, { env: ENV, requester: { name: "Giulia Neri", emailVerified: true } }),
    "in attesa",
  );
  await answered(toVerify, { confirm: "si", note: null }, { estimate: "meno", timesPerMonth: 200, minutesEach: null, teamSeen: SEEN });
  await answered(done, { confirm: "si", note: null }, { estimate: "si", timesPerMonth: null, minutesEach: null, teamSeen: SEEN });
  const items = [
    { id: missing, phase: "approvato" as const },
    { id: waiting, phase: "approvato" as const },
    { id: toVerify, phase: "da_valutare" as const },
    { id: done, phase: "approvato" as const },
    { id: best, phase: "approvato" as const },
    { id: missing.replace(/^./, "f"), phase: "approvato" as const },
  ];
  const forTeam = await states.listReferentStates(ids.ws, viewer("builder") as never, items, { env: ENV });
  assert.ok(forTeam);
  assert.deepEqual(forTeam.states, { [missing]: "manca", [waiting]: "in_attesa", [toVerify]: "da_verificare", [done]: "fatto" });
  assert.deepEqual(forTeam.review, { [missing]: null, [waiting]: null, [toVerify]: "stima", [done]: null });
  // In realizzazione: niente stato.
  const started = await states.listReferentStates(ids.ws, viewer("builder") as never, [{ id: missing, phase: "in_realizzazione" }], { env: ENV });
  assert.deepEqual(started?.states, {});
  // Il contributore: solo gli use case che la pagina gli passa (quelli che vede), solo la parola.
  const forContributor = await states.listReferentStates(ids.ws, viewer("contributor") as never, [{ id: waiting, phase: "approvato" }], { env: ENV });
  assert.deepEqual(forContributor, { states: { [waiting]: "in_attesa" }, review: null });
  const json = JSON.stringify(forContributor);
  const contactIds = (await q(`SELECT id::text AS id, email FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws])).flatMap((r) => [String(r.id), String(r.email)]);
  assert.ok(contactIds.length > 0);
  for (const secret of [...contactIds, "Bruna", "Aldo", "Giulia"]) assert.ok(!json.includes(secret), secret);
  // Con la funzione spenta per il workspace: null.
  assert.equal(await states.listReferentStates(ids.ws, viewer("builder") as never, items, { env: { ...ENV, USE_CASE_HUB_WORKSPACES: "" } }), null);
});
