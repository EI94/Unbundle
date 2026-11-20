import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// I comandi dell'operatore e il passo del cron sulle chiavi della CI (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.8), sul
// database del pacchetto: `ci-keys` (sola lettura: repository, prefisso, date, stato; mai la chiave, mai chi),
// `ci-key-revoke` (a secco, poi `--apply`), `repo-unregister` che revoca le chiavi del repository senza più casi, e
// `runRemindersCron` con il passo delle chiavi nella finestra d'invio.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Lo script
//   gira come lo lancia l'operatore. Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let store: typeof import("../../db/queries/use-case-ci-keys.ts");

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const parsedUrl = enabled ? new URL(url!) : null;
const port = parsedUrl?.port ?? "";
const packageDb = parsedUrl?.pathname.slice(1) ?? "";
const suffix = randomBytes(3).toString("hex");
const REPO = `Voltaen/esempio-operatore-${suffix}`;
const OTHER = `Voltaen/esempio-tolto-${suffix}`;
const LS = ["ls.test"];
const MANAGER_EMAIL = `gestisce-operatore-${suffix}@ls.test`;
const ids = { org: randomUUID(), ws: randomUUID(), uc1: randomUUID(), uc2: randomUUID(), manager: randomUUID() };
const keys: string[] = [];

function runAdmin(command: string, args: string[]): { status: number; docs: Row[]; last: Row; stdout: string } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    UC_TEST_DATABASE_URL: url!,
    UC_TEST_PG_PORT: port,
    UC_TEST_PG_DB: packageDb,
    USE_CASE_ADMIN_DATABASE_URL: url!,
    DATABASE_URL: `postgresql://uc_test@127.0.0.1:${port}/hub_trappola_r82b`,
  };
  const result = spawnSync(process.execPath, ["--no-warnings", "--require", "./scripts/uc-test/local-neon.cjs", "scripts/use-case-admin.ts", command, ...args], {
    cwd: ROOT,
    env: env as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const docs = result.stdout
    .split(/^\}$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(`${chunk}\n}`) as Row);
  return { status: result.status ?? -1, docs, last: docs.at(-1) ?? {}, stdout: result.stdout };
}

const confirm = () => ["--apply", "--confirm-authorized", "--confirm-database", `127.0.0.1:${port}/${packageDb}`, "--environment", "local"];
const keyRows = (repo: string) => q(`SELECT revoked_reason, revoked_by_user_id FROM use_case_ci_keys WHERE workspace_id = $1 AND lower(repo) = lower($2) ORDER BY created_at`, [ids.ws, repo]);

async function newKey(repo: string): Promise<string> {
  const issued = await store.createCiKey(exec, { workspaceId: ids.ws, repo, actor: { userId: ids.manager }, lsDomains: LS });
  if (!issued.ok) assert.fail(`chiave non creata: ${issued.code}`);
  keys.push(issued.value.key);
  return issued.value.keyId;
}

/** Nessuna uscita dello script contiene una chiave o un'e-mail. */
function clean(stdout: string): void {
  for (const key of keys) assert.ok(!stdout.includes(key) && !stdout.includes(key.slice(10)), "mai la chiave nell'uscita");
  assert.ok(!stdout.includes(MANAGER_EMAIL) && !stdout.includes(ids.manager), "mai chi");
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  store = await import("../../db/queries/use-case-ci-keys.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova operatore CI', $2)`, [ids.org, `org-ci-op-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova operatore CI')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona che gestisce', now())`, [ids.manager, MANAGER_EMAIL]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role)`, [ids.ws, ids.manager]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $3, 'Caso operatore', 'XX-0031'), ($2, $3, 'Caso da togliere', 'XX-0032')`, [ids.uc1, ids.uc2, ids.ws]);
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $3, $4, 'casi/xx-0031'), ($2, $3, $5, 'casi/xx-0032')`, [ids.uc1, ids.uc2, ids.ws, REPO, OTHER]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.manager]);
});

test("ci-keys: le chiavi del workspace con prefisso, date e stato; mai la chiave, mai chi; niente --apply", opts, async () => {
  await newKey(REPO);
  const run = runAdmin("ci-keys", ["--workspace", ids.ws]);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.last.status, "REPORT");
  const list = run.last.chiavi as Row[];
  assert.equal(list.length, 1);
  assert.equal(list[0].repository, REPO);
  assert.equal(list[0].stato, "viva");
  assert.match(String(list[0].prefisso), /^ub_ci_[A-Za-z0-9_-]{4}$/);
  clean(run.stdout);
  assert.equal(runAdmin("ci-keys", ["--workspace", ids.ws, ...confirm()]).last.code, "sola_lettura");
});

test("ci-key-revoke: a secco dice che cosa, con --apply revoca (a mano, senza persona)", opts, async () => {
  const dry = runAdmin("ci-key-revoke", ["--workspace", ids.ws, "--repo", REPO.toLowerCase()]);
  assert.equal(dry.last.status, "DRY_RUN", dry.stdout);
  assert.equal((dry.last.chiaviDaRevocare as Row[]).length, 1);
  assert.deepEqual(await keyRows(REPO), [{ revoked_reason: null, revoked_by_user_id: null }], "a secco non scrive");
  const applied = runAdmin("ci-key-revoke", ["--workspace", ids.ws, "--repo", REPO, ...confirm()]);
  assert.deepEqual(applied.docs.map((d) => d.status), ["PLAN", "APPLIED"], applied.stdout);
  assert.equal(applied.last.revocate, 1);
  assert.deepEqual(await keyRows(REPO), [{ revoked_reason: "a_mano", revoked_by_user_id: null }]);
  assert.equal(runAdmin("ci-key-revoke", ["--workspace", ids.ws, "--repo", REPO]).last.status, "NOTHING_TO_DO");
  clean(dry.stdout + applied.stdout);
});

test("repo-unregister revoca le chiavi del repository quando non gli restano casi (senza_casi)", opts, async () => {
  await newKey(OTHER);
  const dry = runAdmin("repo-unregister", ["--workspace", ids.ws, "--repo", OTHER]);
  assert.equal(dry.last.status, "DRY_RUN", dry.stdout);
  assert.equal(dry.last.chiaviCiDaRevocare, 1);
  const applied = runAdmin("repo-unregister", ["--workspace", ids.ws, "--repo", OTHER, ...confirm()]);
  assert.equal(applied.last.status, "APPLIED", applied.stdout);
  assert.equal(applied.last.chiaviCiRevocate, 1);
  assert.deepEqual(await keyRows(OTHER), [{ revoked_reason: "senza_casi", revoked_by_user_id: null }]);
  clean(dry.stdout + applied.stdout);
});

test("il cron dei dossier: nella finestra il passo delle chiavi avvisa a 14 giorni, una volta; fuori dalla finestra no", opts, async () => {
  const cron = await import("../../db/queries/uc-cron.ts");
  const keyId = await newKey(REPO);
  await q(`UPDATE use_case_ci_keys SET created_at = now() - interval '170 days', expires_at = now() + interval '9 days' WHERE id = $1`, [keyId]);
  const run = (now: Date) => cron.runRemindersCron(exec, { env: {}, lsDomains: LS, workspaceId: ids.ws, now, dispatch: false });
  // Giovedì 19 novembre 2026, alle 21 di Roma: fuori dalla finestra d'invio.
  const late = await run(new Date("2026-11-19T20:00:00Z"));
  assert.equal(late.inWindow, false);
  assert.equal(late.ciKeys, null);
  // Alle 10 di Roma dello stesso giorno: dentro.
  const first = await run(new Date("2026-11-19T09:00:00Z"));
  assert.equal(first.inWindow, true);
  assert.deepEqual(first.ciKeys, { ready: true, reminded: 1, reminderNotices: 1, revokedWithoutCases: 0, deleted: 0 });
  assert.equal((await run(new Date("2026-11-19T09:00:00Z"))).ciKeys?.reminded, 0, "una volta sola");
  const [notice] = await q(`SELECT template_key, recipient_user_id, channel, case_id FROM uc_notifications WHERE payload->>'keyId' = $1`, [keyId]);
  assert.deepEqual(notice, { template_key: "chiave_ci_scade", recipient_user_id: ids.manager, channel: "email", case_id: null });
});
