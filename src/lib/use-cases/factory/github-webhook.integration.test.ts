import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Il webhook di GitHub vero (rilascio 8.1b) sul database del pacchetto, con la 0033:
// - lo schema: il file due volte e il self-heal due volte non cambiano niente; i CHECK rifiutano la riga sbagliata;
// - spento senza segreto; firma sbagliata e intestazioni strane rifiutate prima di leggere;
// - una PR pronta porta il compito in revisione e avvisa il team che costruisce (non chi ha il compito, non il
//   cliente); chiusa senza unire torna in corso; unita è fatto e resta fatto anche con eventi fuori ordine;
// - un evento rimandato non conta due volte; una PR da un fork, un repository non registrato, un ramo di un altro
//   caso non cambiano niente; un push è un segnale di vita;
// - la pagina «Agent Factory»: la PR da rivedere a chi non ha il compito, le PR del caso senza persone;
// - il cron toglie gli eventi vecchi.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let POST: Handler;
let ensure: typeof import("../../db/ensure-schema.ts");
let ddl: typeof import("../../db/use-case-hub-github-ddl.ts");

const migration = readFileSync(new URL("../../../../drizzle/0033_github.sql", import.meta.url), "utf8");
const SECRET = `segreto-${randomBytes(8).toString("hex")}`;
const suffix = randomBytes(3).toString("hex");
const REPO = `Prova/rondine-${suffix}`;
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  useCase: randomUUID(),
  other: randomUUID(),
  dossier: randomUUID(),
  lead: randomUUID(),
  dev: randomUUID(),
  owner: randomUUID(),
};
const t: Record<string, string> = {};
const delivery = () => `${randomUUID()}`;

function prPayload(over: { number: number; branch: string; state?: "open" | "closed"; draft?: boolean; merged?: boolean; action?: string; repo?: string; headRepo?: string }) {
  const repo = over.repo ?? REPO;
  const closed = over.state === "closed";
  return {
    action: over.action ?? "opened",
    repository: { full_name: repo },
    sender: { login: `persona-${suffix}` },
    pull_request: {
      number: over.number,
      state: over.state ?? "open",
      draft: over.draft === true,
      merged_at: closed && over.merged ? new Date().toISOString() : null,
      closed_at: closed ? new Date().toISOString() : null,
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
      user: { login: `persona-${suffix}` },
      head: { ref: over.branch, repo: { full_name: over.headRepo ?? repo } },
    },
  };
}

async function send(event: string, payload: unknown, o: { id?: string; secret?: string; signature?: string | null } = {}): Promise<{ status: number; json: Row }> {
  const body = JSON.stringify(payload);
  const signature = o.signature === undefined ? `sha256=${createHmac("sha256", o.secret ?? SECRET).update(body).digest("hex")}` : o.signature;
  const headers: Record<string, string> = { "content-type": "application/json", "x-github-event": event, "x-github-delivery": o.id ?? delivery() };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  const response = await POST(new Request("http://127.0.0.1:53110/api/github/webhook", { method: "POST", headers, body }));
  return { status: response.status, json: (await response.json()) as Row };
}

const task = async (ref: string) => (await q(`SELECT status, holder_user_id, pr_url, branch, last_activity_at, updated_at FROM use_case_tasks WHERE id = $1`, [t[ref]]))[0];
const pr = async (number: number) => (await q(`SELECT state, draft, merged_at, closed_at, task_id FROM use_case_pull_requests WHERE workspace_id = $1 AND repo = $2 AND number = $3`, [ids.ws, REPO, number]))[0];
const deliveries = async () => Number((await q(`SELECT count(*) AS n FROM use_case_github_deliveries WHERE repo = $1`, [REPO]))[0].n);

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

async function schemaSnapshot(): Promise<string> {
  const tables = ["use_case_github_deliveries", "use_case_pull_requests", "use_case_notifications"];
  const list = tables.map((x) => `'${x}'`).join(", ");
  const columns = await q(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`);
  const constraints = await q(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid IN (${tables.map((x) => `'public.${x}'::regclass`).join(", ")}) ORDER BY 1, 2`);
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

before(async () => {
  if (!enabled) return;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "next/server": stub("export function after(task) { (globalThis.__ghAfter ??= []).push(task); }"),
    "next/cache": stub("export function revalidatePath() {}\nexport function revalidateTag() {}\nexport function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("../../db/use-case-hub-github-ddl.ts");
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  ({ POST } = (await import("../../../app/api/github/webhook/route.ts")) as { POST: Handler });

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova GitHub', $2)`, [ids.org, `org-gh-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova GitHub')`, [ids.ws, ids.org]);
  const people: [keyof typeof ids, string, string][] = [
    ["lead", `lead-${suffix}@ls.test`, "transformation_lead"],
    ["dev", `dev-${suffix}@ls.test`, "analyst"],
    ["owner", `owner-${suffix}@cliente.test`, "contributor"],
  ];
  for (const [person, email, role] of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], email, `Prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], role]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $3, 'Smistamento di prova', 'PX-0042'), ($2, $3, 'Altro caso', 'PX-0043')`, [ids.useCase, ids.other, ids.ws]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova GitHub', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.gh_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova GitHub', 'pronto_sviluppo', now())`,
    [ids.dossier, ids.ws, ids.org, ids.useCase, ids.template, `GH-${suffix.toUpperCase()}`],
  );
  for (const [person, caseRole] of [["lead", "ls_lead"], ["dev", "ls_sviluppatore"], ["owner", "owner_cliente"]] as const) {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, $3)`, [ids.dossier, ids[person], caseRole]);
  }
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $2, $3, 'casi/px-0042')`, [ids.useCase, ids.ws, REPO]);
  const rows = await q(
    `INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, last_activity_at, source)
     VALUES ($1, $2, 'T-1', 'Ingresso', 'in_corso', $3, now() - interval '3 days', now() - interval '3 days', 'progetto'),
            ($1, $2, 'T-2', 'Normalizzazione', 'da_fare', NULL, NULL, NULL, 'progetto'),
            ($1, $2, 'T-3', 'Risposta', 'in_corso', $4, now() - interval '3 days', now() - interval '3 days', 'progetto'),
            ($1, $2, 'T-4', 'Annullato', 'annullato', NULL, NULL, NULL, 'progetto')
     RETURNING id, ref`,
    [ids.useCase, ids.ws, ids.dev, ids.lead],
  );
  for (const r of rows) t[String(r.ref)] = String(r.id);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM use_case_github_deliveries WHERE repo = $1 OR repo LIKE $2 OR delivery_id LIKE $2`, [REPO, `%${suffix}%`]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.dev, ids.owner]]);
});

test("lo schema della 0033 c'è; il file due volte e il self-heal due volte non cambiano niente; i CHECK tengono", opts, async () => {
  assert.equal((await q(`SELECT ${ddl.GITHUB_PROBE_SQL} AS ok`))[0].ok, true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  await ensure.runGithubDdl();
  await ensure.runGithubDdl();
  assert.equal(await schemaSnapshot(), first);
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'compiti_pronti'[\s\S]*'pr_da_rivedere'/);
  assert.equal(kinds.convalidated, true);
  const insert = `INSERT INTO use_case_pull_requests (use_case_id, workspace_id, repo, number, branch, state, opened_at, merged_at) VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`;
  await rejects(insert, [ids.useCase, ids.ws, REPO, 0, "px-0042/x", "aperta", null], "use_case_pull_requests_number_check");
  await rejects(insert, [ids.useCase, ids.ws, REPO, 9001, "px-0042/x", "boh", null], "use_case_pull_requests_state_check");
  await rejects(insert, [ids.useCase, ids.ws, REPO, 9001, "px-0042/x", "unita", null], "use_case_pull_requests_merged_check");
  await rejects(insert, [ids.useCase, ids.ws, REPO, 9001, "px-0042/x", "aperta", "2026-11-14T10:00:00Z"], "use_case_pull_requests_merged_check");
  await rejects(insert, [ids.useCase, ids.ws, "non valido", 9001, "px-0042/x", "aperta", null], "use_case_pull_requests_repo_check");
  await rejects(`INSERT INTO use_case_github_deliveries (delivery_id, event, outcome) VALUES ($1, 'push', 'applicato')`, ["id con spazi"], "use_case_github_deliveries_id_check");
  await rejects(`INSERT INTO use_case_github_deliveries (delivery_id, event, outcome) VALUES ($1, 'push', 'boh')`, [`x-${suffix}`], "use_case_github_deliveries_outcome_check");
});

test("su un database senza la 0033 il self-heal la crea (in una transazione annullata)", opts, async () => {
  const marker = `prova-0033-annullata-${suffix}`;
  const text = [
    `DROP TABLE use_case_pull_requests, use_case_github_deliveries;`,
    `DELETE FROM use_case_notifications WHERE kind IN (${ddl.GITHUB_NOTICE_KINDS.map((k) => `'${k}'`).join(", ")});`,
    `DO $$ BEGIN IF ${ddl.GITHUB_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.GITHUB_DDL,
    `DO $$ BEGIN IF NOT ${ddl.GITHUB_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal((await q(`SELECT ${ddl.GITHUB_PROBE_SQL} AS ok`))[0].ok, true, "annullata: tutto come prima");
});

test("spento senza segreto; firma sbagliata e intestazioni strane si fermano prima di leggere", opts, async () => {
  const payload = prPayload({ number: 1, branch: "px-0042/t-1-ingresso" });
  delete process.env.GITHUB_WEBHOOK_SECRET;
  assert.equal((await send("pull_request", payload)).status, 404);
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  assert.equal((await send("pull_request", payload, { secret: "altro" })).status, 401);
  assert.equal((await send("pull_request", payload, { signature: null })).status, 401);
  assert.equal((await send("pull_request", payload, { id: "id con spazi" })).status, 400);
  assert.equal((await send("Pull-Request", payload)).status, 400);
  assert.equal(await deliveries(), 0, "niente registrato");
  assert.equal((await task("T-1")).status, "in_corso", "niente cambiato");
  const ping = await send("ping", { zen: "ok" }, { id: `ping-${suffix}` });
  assert.deepEqual([ping.status, ping.json.esito, ping.json.motivo], [200, "ignorato", "ping"]);
  assert.equal((await send("ping", { zen: "ok" }, { id: `ping-${suffix}` })).json.esito, "ripetuto");
});

test("una PR pronta: il compito in revisione, la PR salvata senza persone, l'avviso al team tranne chi ha il compito", opts, async () => {
  const id = `pr1-${suffix}`;
  const r = await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso" }), { id });
  assert.deepEqual([r.status, r.json.esito, r.json.compiti], [200, "applicato", [{ compito: "T-1", stato: "in_revisione" }]]);
  const t1 = await task("T-1");
  assert.equal(t1.status, "in_revisione");
  assert.equal(t1.holder_user_id, ids.dev, "chi lo ha resta");
  assert.equal(t1.pr_url, `https://github.com/${REPO}/pull/1`);
  assert.equal(t1.branch, "px-0042/t-1-ingresso");
  const row = await pr(1);
  assert.deepEqual([row.state, row.draft, row.task_id], ["aperta", false, t[`T-1`]]);
  const all = JSON.stringify(await q(`SELECT * FROM use_case_pull_requests WHERE repo = $1`, [REPO]));
  assert.ok(!all.includes(`persona-${suffix}`), "mai chi l'ha aperta");
  // La campanella e l'e-mail: al responsabile (ls_lead); non a chi ha il compito, non al cliente.
  const bell = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'pr_da_rivedere'`, [ids.useCase]);
  assert.deepEqual(bell.map((b) => b.recipient_user_id), [ids.lead]);
  const mail = await q(`SELECT recipient_user_id, payload, dedupe_key FROM uc_notifications WHERE case_id = $1 AND template_key = 'pr_da_rivedere'`, [ids.dossier]);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].recipient_user_id, ids.lead);
  assert.deepEqual(mail[0].payload, { useCase: ids.useCase, ref: "T-1", pr: 1, repo: REPO });
  assert.match(String(mail[0].dedupe_key), new RegExp(`:T-1:${REPO.replace("/", "\\/")}#1$`));
  const queued = (globalThis as { __ghAfter?: (() => Promise<void>)[] }).__ghAfter ?? [];
  assert.ok(queued.length >= 1, "l'invio dopo la risposta");
  while (queued.length) await queued.pop()!();
  // Lo stesso evento, rimandato: non conta di nuovo.
  const again = await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso" }), { id });
  assert.equal(again.json.esito, "ripetuto");
  assert.equal(Number((await q(`SELECT count(*) AS n FROM uc_notifications WHERE case_id = $1 AND template_key = 'pr_da_rivedere'`, [ids.dossier]))[0].n), 1);
});

test("chiusa senza unire torna in corso; riaperta torna in revisione; unita è fatto, anche con eventi fuori ordine", opts, async () => {
  const closed = await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso", state: "closed", action: "closed" }));
  assert.deepEqual(closed.json.compiti, [{ compito: "T-1", stato: "in_corso" }]);
  assert.equal((await pr(1)).state, "chiusa");
  // Un evento vecchio (aperta, ma non «reopened») non riapre una PR chiusa.
  await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso", action: "synchronize" }));
  assert.equal((await pr(1)).state, "chiusa");
  assert.equal((await task("T-1")).status, "in_corso");
  await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso", action: "reopened" }));
  assert.deepEqual([(await pr(1)).state, (await task("T-1")).status], ["aperta", "in_revisione"]);
  const merged = await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso", state: "closed", merged: true, action: "closed" }));
  assert.deepEqual(merged.json.compiti, [{ compito: "T-1", stato: "fatto" }]);
  const row = await pr(1);
  assert.equal(row.state, "unita");
  assert.ok(row.merged_at);
  // Fuori ordine: un «synchronize» in ritardo non riapre niente.
  await send("pull_request", prPayload({ number: 1, branch: "px-0042/t-1-ingresso", action: "synchronize" }));
  assert.deepEqual([(await pr(1)).state, (await task("T-1")).status], ["unita", "fatto"]);
});

test("una bozza non è pronta; un compito senza persona va in revisione e, chiusa la PR, torna da fare; annullato non cambia", opts, async () => {
  await send("pull_request", prPayload({ number: 2, branch: "px-0042/t-2-normalizza", draft: true }));
  assert.deepEqual([(await pr(2)).draft, (await task("T-2")).status], [true, "da_fare"]);
  assert.equal(Number((await q(`SELECT count(*) AS n FROM uc_notifications WHERE case_id = $1 AND template_key = 'pr_da_rivedere' AND payload->>'pr' = '2'`, [ids.dossier]))[0].n), 0, "una bozza non si annuncia");
  await send("pull_request", prPayload({ number: 2, branch: "px-0042/t-2-normalizza", action: "ready_for_review" }));
  assert.equal((await task("T-2")).status, "in_revisione");
  // Chi costruisce lo sa tutto il team: qui nessuno ha il compito, quindi responsabile e sviluppatore.
  const toWhom = await q(`SELECT recipient_user_id FROM uc_notifications WHERE case_id = $1 AND template_key = 'pr_da_rivedere' AND payload->>'pr' = '2' ORDER BY recipient_user_id`, [ids.dossier]);
  assert.deepEqual(toWhom.map((x) => x.recipient_user_id), [ids.lead, ids.dev].sort());
  await send("pull_request", prPayload({ number: 2, branch: "px-0042/t-2-normalizza", action: "converted_to_draft", draft: true }));
  assert.equal((await task("T-2")).status, "da_fare", "tornata in bozza: nessuno lo ha");
  await send("pull_request", prPayload({ number: 4, branch: "px-0042/t-4-annullato" }));
  assert.equal((await task("T-4")).status, "annullato");
  await send("pull_request", prPayload({ number: 4, branch: "px-0042/t-4-annullato", state: "closed", action: "closed" }));
  assert.equal((await task("T-4")).status, "annullato");
});

test("un push sul ramo di un compito in corso è un segnale di vita; su un compito da fare no", opts, async () => {
  const before3 = await task("T-3");
  const pushed = await send("push", { ref: "refs/heads/px-0042/t-3-risposta", repository: { full_name: REPO }, pusher: { name: "qualcuno" } });
  assert.equal(pushed.json.esito, "applicato");
  const after3 = await task("T-3");
  assert.ok(new Date(String(after3.last_activity_at)) > new Date(String(before3.last_activity_at)));
  assert.equal(after3.status, "in_corso");
  const before2 = await task("T-2");
  await send("push", { ref: "refs/heads/px-0042/t-2-normalizza", repository: { full_name: REPO } });
  assert.equal(String((await task("T-2")).last_activity_at), String(before2.last_activity_at));
});

test("una PR da un fork, un repository non registrato, un ramo senza caso o di un altro caso non cambiano niente", opts, async () => {
  const fork = await send("pull_request", prPayload({ number: 9, branch: "px-0042/t-3-risposta", headRepo: "Altro/rondine" }));
  assert.deepEqual([fork.json.esito, fork.json.motivo], ["ignorato", "fork"]);
  const stranger = await send("pull_request", prPayload({ number: 9, branch: "px-0042/t-3-risposta", repo: `Prova/sconosciuto-${suffix}` }));
  assert.deepEqual([stranger.json.esito, stranger.json.motivo], ["ignorato", "repository_non_registrato"]);
  const main = await send("push", { ref: "refs/heads/main", repository: { full_name: REPO } });
  assert.deepEqual([main.json.esito, main.json.motivo], ["ignorato", "ramo_senza_caso"]);
  const otherCase = await send("pull_request", prPayload({ number: 9, branch: "px-0043/t-3-risposta" }));
  assert.deepEqual([otherCase.json.esito, otherCase.json.motivo], ["ignorato", "repository_non_registrato"]);
  assert.equal((await task("T-3")).status, "in_corso");
  assert.equal(await pr(9), undefined);
});

test("la pagina: la PR pronta a chi non ha il compito, i numeri delle PR per caso, mai per persona", opts, async () => {
  const line = await import("../../db/queries/use-case-factory-line.ts");
  await send("pull_request", prPayload({ number: 3, branch: "px-0042/t-3-risposta" }));
  const forDev = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.dev, seeAll: false, canSeeNeeds: false });
  assert.deepEqual(
    forDev.todos.filter((x) => x.kind === "rivedi").map((x) => [x.text, x.href]),
    [["La PR #3 di T-3 aspetta una revisione.", `https://github.com/${REPO}/pull/3`]],
    "la PR del compito di un altro",
  );
  const forLead = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids.lead, seeAll: false, canSeeNeeds: false });
  assert.deepEqual(forLead.todos.filter((x) => x.kind === "rivedi"), [], "il proprio compito no");
  const row = forLead.cases.find((c) => c.useCaseId === ids.useCase);
  assert.ok(row);
  assert.equal(row.prs.open, 2, "la #3 e la bozza #2");
  assert.equal(row.prs.merged, 1);
  assert.ok(row.prs.medianDays !== null && row.prs.medianDays > 0, "dalla presa all'unione");
  assert.ok(!JSON.stringify(forLead).includes("Prova lead") && !JSON.stringify(forLead).includes("Prova dev"), "nessun nome");
});

test("il cron toglie gli eventi ricevuti da più di 30 giorni", opts, async () => {
  const prune = await import("../../db/queries/use-case-github-prune.ts");
  await q(`INSERT INTO use_case_github_deliveries (delivery_id, event, repo, outcome, received_at) VALUES ($1, 'push', $2, 'ignorato', now() - interval '31 days')`, [`vecchio-${suffix}`, REPO]);
  const n = await prune.pruneGithubDeliveries(exec);
  assert.ok(n >= 1);
  assert.equal((await q(`SELECT 1 FROM use_case_github_deliveries WHERE delivery_id = $1`, [`vecchio-${suffix}`])).length, 0);
  assert.ok((await deliveries()) > 0, "quelli recenti restano");
});
