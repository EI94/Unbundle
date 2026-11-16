/**
 * Solo per le suite d'integrazione della mappatura (`src/lib/mappatura/*.integration.test.ts`): nessun file dell'app lo
 * importa. Le suite girano con `scripts/use-case-test/run-db-tests.mjs` (HUB_TEST_ISOLATED=true, database `hub_<id>` su
 * 127.0.0.1): senza, si saltano, come quelle dell'area «Use case».
 *
 * Dati inventati, creati e cancellati da ogni suite: un'organizzazione, due workspace, l'unità «Ufficio acquisti» con
 * passi generici. Mai nomi, persone o testi di un cliente.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { UcExecutor } from "../db/uc-executor.ts";

const url = process.env.DATABASE_URL;
export const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
}
export const opts = { skip: !enabled };

export type Row = Record<string, unknown>;
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

export interface Connection {
  q: Query;
  exec: UcExecutor;
  ensure: typeof import("../db/ensure-schema.ts");
}

/** Il database del pacchetto, con lo schema allineato dal self-heal (0039 compresa). */
export async function connect(): Promise<Connection> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  const q: Query = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const ensure = await import("../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  const exec = (await import("../db/uc-executor.ts")).ucExecutorForUrl(url!);
  return { q, exec, ensure };
}

export interface Fixture {
  suffix: string;
  org: string;
  /** Il workspace della prova. */
  ws: string;
  /** Un altro workspace della stessa organizzazione. */
  otherWs: string;
  /** L'unità della prova: «Ufficio acquisti». */
  unit: string;
  /** Un'altra unità dello stesso workspace: «Magazzino». */
  otherUnit: string;
  /** Un'unità dell'altro workspace. */
  foreignUnit: string;
  /** Chi rivede (transformation_lead). */
  lead: string;
  /** Chi contribuisce (contributor). */
  contributor: string;
}

export function newFixture(): Fixture {
  return {
    suffix: randomBytes(3).toString("hex"),
    org: randomUUID(),
    ws: randomUUID(),
    otherWs: randomUUID(),
    unit: randomUUID(),
    otherUnit: randomUUID(),
    foreignUnit: randomUUID(),
    lead: randomUUID(),
    contributor: randomUUID(),
  };
}

/** Organizzazione, due workspace, due persone, tre unità. Nessuna attività: le mette la suite. */
export async function seed(q: Query, f: Fixture, label: string): Promise<void> {
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`, [f.org, `Organizzazione di prova ${label}`, `org-mappa-${label}-${f.suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $3, 'Workspace di prova mappatura'), ($2, $3, 'Altro workspace di prova')`, [f.ws, f.otherWs, f.org]);
  await q(
    `INSERT INTO users (id, email, name, email_verified) VALUES ($1, $3, 'Persona di prova uno', now()), ($2, $4, 'Persona di prova due', now())`,
    [f.lead, f.contributor, `guida-${label}-${f.suffix}@prova.test`, `contributo-${label}-${f.suffix}@prova.test`],
  );
  await q(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role), ($1::uuid, $3::uuid, 'contributor'::member_role)`,
    [f.ws, f.lead, f.contributor],
  );
  await q(
    `INSERT INTO departments (id, workspace_id, name, description, team_size) VALUES
       ($1, $4, 'Ufficio acquisti', 'Compra materiali e servizi per gli altri uffici.', 6),
       ($2, $4, 'Magazzino', NULL, NULL),
       ($3, $5, 'Unità di un altro workspace', NULL, NULL)`,
    [f.unit, f.otherUnit, f.foreignUnit, f.ws, f.otherWs],
  );
}

/** Tutto quello che la suite ha creato: il workspace porta via unità, attività e board. */
export async function unseed(q: Query, f: Fixture): Promise<void> {
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[f.ws, f.otherWs]]);
  await q(`DELETE FROM organizations WHERE id = $1`, [f.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[f.lead, f.contributor]]);
}

/** Un'attività inserita con SQL semplice, come fanno le fixture di prima e il codice di prima. Restituisce l'id. */
export async function insertActivity(
  q: Query,
  f: Pick<Fixture, "ws" | "unit">,
  values: { title: string; minutesAgo?: number; unit?: string; ws?: string } & Record<string, unknown>,
): Promise<string> {
  const { title, minutesAgo = 0, unit = f.unit, ws = f.ws, ...columns } = values;
  const id = randomUUID();
  const names = Object.keys(columns);
  for (const name of names) if (!/^[a-z_]+$/.test(name)) throw new Error(`colonna non valida: ${name}`);
  const cast = (name: string) => (name === "tools_used" || name === "dependencies" ? "::jsonb" : name === "work_type" ? "::work_type" : name === "classification" ? "::classification" : "");
  const params: unknown[] = [id, unit, ws, title, minutesAgo, ...names.map((name) => (cast(name) === "::jsonb" ? JSON.stringify(columns[name]) : columns[name]))];
  await q(
    `INSERT INTO activities (id, department_id, workspace_id, title, created_at, updated_at${names.map((name) => `, ${name}`).join("")})
     VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5::int), now() - make_interval(mins => $5::int)${names.map((name, i) => `, $${i + 6}${cast(name)}`).join("")})`,
    params,
  );
  return id;
}

export async function rejects(q: Query, text: string, params: unknown[], constraint: string): Promise<void> {
  let message = "";
  try {
    await q(text, params);
  } catch (error) {
    message = String((error as { message?: unknown })?.message ?? error);
  }
  if (!message) throw new Error(`atteso un errore su ${constraint}, e l'istruzione è passata`);
  if (!message.includes(constraint)) throw new Error(`atteso ${constraint}, ricevuto: ${message}`);
}

/** Quante righe ha ogni tabella della board per quel workspace. */
export async function boardCounts(q: Query, workspaceIds: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ["mapping_boards", "mapping_processes", "mapping_steps", "mapping_notes", "mapping_votes"]) {
    out[table] = Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [workspaceIds]))[0].n);
  }
  return out;
}
