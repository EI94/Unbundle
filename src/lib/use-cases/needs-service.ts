import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { useCaseNeeds, useCases } from "@/lib/db/schema";
import {
  NEED_ERRORS,
  NEED_LIMITS,
  isNeedDone,
  validateArchiveReason,
  validateNeedInput,
  validateNeedPatch,
  type NeedInput,
  type NeedPatch,
} from "./needs";
import { fail, guarded, invalid, personaWriter, type Failure, type WriteContext } from "./service";
import type { ServiceResult } from "./types";

/**
 * Scritture di «Cosa serve» (`use_case_needs`, `use_case_need_links`; drizzle/0022): aggiungere,
 * modificare con la versione, collegare e scollegare uno use case, archiviare con il motivo. Le
 * esigenze non si cancellano mai.
 *
 * - **Chi**: solo i revisori (`canEditNeeds`), con ruolo e «Lateral Space» riletti a ogni
 *   chiamata e l'area accesa per i canali `pagina` e `mcp_team` (`personaWriter` di
 *   `service.ts`). Sistemi e AI non scrivono esigenze.
 * - **Versione**: ogni modifica e l'archiviazione la alzano di uno (nessun trigger su questa
 *   tabella) e scrivono solo se è ancora quella letta; una modifica che non cambia niente non
 *   scrive. I legami non cambiano la versione dell'esigenza: sono un insieme, e collegare due
 *   volte lo stesso use case non fa niente.
 * - **`done_at`**: si scrive quando l'esigenza diventa fatta (requisito a posto, passo fatto),
 *   resta finché lo è, torna vuoto quando non lo è più (`isNeedDone`).
 * - **Workspace**: un legame non porta il workspace; ogni statement unisce esigenza e use case
 *   sullo stesso `workspace_id`.
 * - Un errore del database diventa `riprova` (`guarded`); la chiave di importazione già usata
 *   torna come errore del campo `importKey`.
 * - Niente Storia: la Storia è degli use case, e il suo elenco chiuso di campi non ha le esigenze.
 */

export interface NeedWritten {
  id: string;
  version: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const IMPORT_KEY_CONSTRAINT = "use_case_needs_import_key_unique";

/** La chiave di importazione è già di un'altra esigenza del workspace (SQLSTATE 23505 sul suo vincolo). */
function importKeyTaken(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const record = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "23505" && (record.constraint === IMPORT_KEY_CONSTRAINT || String(record.message ?? "").includes(IMPORT_KEY_CONSTRAINT))) return true;
    current = record.cause;
  }
  return false;
}

function insertValues(workspaceId: string, input: NeedInput) {
  return {
    workspaceId,
    type: input.type,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    ownerLabel: input.ownerLabel,
    ownerSide: input.ownerSide,
    status: input.status,
    availability: input.availability,
    dueOn: input.dueOn,
    dueLabel: input.dueLabel,
    dueIsProposal: input.dueIsProposal,
    forLabel: input.forLabel,
    sortOrder: input.sortOrder,
    importKey: input.importKey,
    doneAt: isNeedDone(input.type, input.status) ? new Date() : null,
  };
}

/** Gli use case da collegare: UUID, senza doppioni, tutti di questo workspace. */
async function linkTargetsOf(workspaceId: string, raw: readonly unknown[] | undefined): Promise<{ ok: true; ids: string[] } | Failure> {
  const ids = [...new Set((raw ?? []).map((id) => (typeof id === "string" ? id.toLowerCase() : id)))];
  if (!ids.length) return { ok: true, ids: [] };
  if (ids.length > NEED_LIMITS.useCaseIds || !ids.every(isUuid)) return invalid({ useCaseIds: NEED_ERRORS.useCase });
  const found = await db
    .select({ id: useCases.id })
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), inArray(useCases.id, ids as string[])));
  if (found.length !== ids.length) return invalid({ useCaseIds: NEED_ERRORS.useCase });
  return { ok: true, ids: ids as string[] };
}

/**
 * Un'esigenza nuova, già collegata agli use case dati (dalla scheda: lo use case aperto), in un
 * solo statement: l'esigenza e i suoi legami vanno insieme o non vanno. `id` è facoltativo: il
 * MCP del team passa l'id deciso alla presa in carico della richiesta (`reserved_ids`), così una
 * ripresa ritrova l'esigenza invece di crearne un'altra.
 */
export const createNeed = guarded("create_need", async function createNeed(
  ctx: WriteContext,
  raw: unknown,
  opts: { useCaseIds?: readonly unknown[]; id?: string } = {},
): Promise<ServiceResult<NeedWritten>> {
  const writer = await personaWriter(ctx, "canEditNeeds");
  if (!writer.ok) return writer;
  if (opts.id !== undefined && !isUuid(opts.id)) return invalid({ id: NEED_ERRORS.invalid });
  const parsed = validateNeedInput(raw);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const linked = await linkTargetsOf(ctx.workspaceId, opts.useCaseIds);
  if (!linked.ok) return linked;

  const values = { ...insertValues(ctx.workspaceId, parsed.value), ...(opts.id ? { id: opts.id.toLowerCase() } : {}) };
  const insert = db.insert(useCaseNeeds).values(values).returning({ id: useCaseNeeds.id, version: useCaseNeeds.version });
  const links = linked.ids.length
    ? sql`, lnk AS (
        INSERT INTO use_case_need_links (need_id, use_case_id)
        SELECT ins.id, u.id FROM ins JOIN use_cases u ON u.workspace_id = ${ctx.workspaceId}::uuid AND u.id = ANY(${sql.param(linked.ids)}::uuid[])
        ON CONFLICT DO NOTHING
        RETURNING need_id
      )`
    : sql``;
  try {
    const { rows } = await db.execute(sql`WITH ins AS (${insert.getSQL()})${links} SELECT id, version FROM ins`);
    const row = rows[0] as { id?: string; version?: number } | undefined;
    if (!row?.id) return fail("riprova");
    return { ok: true, value: { id: row.id, version: Number(row.version) } };
  } catch (error) {
    if (importKeyTaken(error)) return invalid({ importKey: NEED_ERRORS.importKeyTaken });
    throw error;
  }
});

/** L'esigenza com'è adesso, del workspace; null se non c'è. */
async function readNeed(workspaceId: string, needId: string) {
  const [row] = await db
    .select()
    .from(useCaseNeeds)
    .where(and(eq(useCaseNeeds.id, needId), eq(useCaseNeeds.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

type NeedRecord = NonNullable<Awaited<ReturnType<typeof readNeed>>>;

/** Perché una scrittura con la versione non ha toccato righe: non c'è, è archiviata, o la versione è vecchia. */
async function whyNotWritten(workspaceId: string, needId: string): Promise<Failure> {
  const current = await readNeed(workspaceId, needId);
  if (!current) return fail("non_trovato");
  if (current.archivedAt) return fail("transizione_non_ammessa", NEED_ERRORS.archived);
  return fail("versione_superata");
}

/** Le colonne che la modifica cambia davvero. */
function changedColumns(current: NeedRecord, patch: NeedPatch): NeedPatch {
  const out: NeedPatch = {};
  for (const [key, value] of Object.entries(patch) as Array<[keyof NeedPatch, NeedPatch[keyof NeedPatch]]>) {
    if ((current as Record<string, unknown>)[key] !== value) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Modifica un'esigenza (`expectedVersion` è quella letta con la pagina). Lo stato deve valere per
 * il tipo; cambiando tipo senza stato, lo stato riparte da quello del tipo nuovo. Le archiviate non
 * si modificano.
 */
export const updateNeed = guarded("update_need", async function updateNeed(
  ctx: WriteContext,
  needId: string,
  expectedVersion: number,
  raw: unknown,
): Promise<ServiceResult<NeedWritten>> {
  const writer = await personaWriter(ctx, "canEditNeeds");
  if (!writer.ok) return writer;
  if (!isUuid(needId)) return fail("non_trovato");
  if (!Number.isSafeInteger(expectedVersion)) return invalid({ expectedVersion: "Versione non valida." });
  const current = await readNeed(ctx.workspaceId, needId);
  if (!current) return fail("non_trovato");
  if (current.archivedAt) return fail("transizione_non_ammessa", NEED_ERRORS.archived);
  if (current.version !== expectedVersion) return fail("versione_superata");
  const parsed = validateNeedPatch(raw, { type: current.type, status: current.status });
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const changes = changedColumns(current, parsed.value);
  if (!Object.keys(changes).length) return { ok: true, value: { id: current.id, version: current.version } };

  const type = changes.type ?? current.type;
  const status = changes.status ?? current.status;
  const done = isNeedDone(type, status);
  const wasDone = isNeedDone(current.type, current.status);
  try {
    const [row] = await db
      .update(useCaseNeeds)
      .set({
        ...changes,
        ...(done === wasDone ? {} : { doneAt: done ? sql`now()` : null }),
        version: sql`${useCaseNeeds.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(useCaseNeeds.id, needId),
          eq(useCaseNeeds.workspaceId, ctx.workspaceId),
          eq(useCaseNeeds.version, expectedVersion),
          isNull(useCaseNeeds.archivedAt),
        ),
      )
      .returning({ id: useCaseNeeds.id, version: useCaseNeeds.version });
    if (!row) return whyNotWritten(ctx.workspaceId, needId);
    return { ok: true, value: row };
  } catch (error) {
    if (importKeyTaken(error)) return invalid({ importKey: NEED_ERRORS.importKeyTaken });
    throw error;
  }
});

/** «Archivia», con il motivo: l'esigenza esce da Priorità, pannello e scheda, e resta nel database. */
export const archiveNeed = guarded("archive_need", async function archiveNeed(
  ctx: WriteContext,
  needId: string,
  expectedVersion: number,
  reason: unknown,
): Promise<ServiceResult<NeedWritten>> {
  const writer = await personaWriter(ctx, "canEditNeeds");
  if (!writer.ok) return writer;
  if (!isUuid(needId)) return fail("non_trovato");
  if (!Number.isSafeInteger(expectedVersion)) return invalid({ expectedVersion: "Versione non valida." });
  const parsed = validateArchiveReason(reason);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  const [row] = await db
    .update(useCaseNeeds)
    .set({ archivedAt: sql`now()`, archiveReason: parsed.value, version: sql`${useCaseNeeds.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(useCaseNeeds.id, needId),
        eq(useCaseNeeds.workspaceId, ctx.workspaceId),
        eq(useCaseNeeds.version, expectedVersion),
        isNull(useCaseNeeds.archivedAt),
      ),
    )
    .returning({ id: useCaseNeeds.id, version: useCaseNeeds.version });
  return row ? { ok: true, value: row } : whyNotWritten(ctx.workspaceId, needId);
});

/** Dopo un legame che non ha toccato righe: l'esigenza o lo use case mancano, oppure era già così. */
async function linkOutcome(workspaceId: string, needId: string, useCaseId: string): Promise<ServiceResult<NeedWritten>> {
  const need = await readNeed(workspaceId, needId);
  if (!need) return fail("non_trovato");
  if (need.archivedAt) return fail("transizione_non_ammessa", NEED_ERRORS.archived);
  const [useCase] = await db
    .select({ id: useCases.id })
    .from(useCases)
    .where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, workspaceId)))
    .limit(1);
  if (!useCase) return fail("non_trovato", NEED_ERRORS.useCase);
  return { ok: true, value: { id: need.id, version: need.version } };
}

/** Collega l'esigenza a uno use case dello stesso workspace. Già collegata: niente da fare. */
export const linkNeed = guarded("link_need", async function linkNeed(
  ctx: WriteContext,
  needId: string,
  useCaseId: string,
): Promise<ServiceResult<NeedWritten>> {
  const writer = await personaWriter(ctx, "canEditNeeds");
  if (!writer.ok) return writer;
  if (!isUuid(needId) || !isUuid(useCaseId)) return fail("non_trovato");
  const { rows } = await db.execute(sql`INSERT INTO use_case_need_links (need_id, use_case_id)
    SELECT n.id, u.id
      FROM use_case_needs n
      JOIN use_cases u ON u.workspace_id = n.workspace_id
     WHERE n.id = ${needId}::uuid AND n.workspace_id = ${ctx.workspaceId}::uuid AND n.archived_at IS NULL AND u.id = ${useCaseId}::uuid
    ON CONFLICT DO NOTHING
    RETURNING (SELECT version FROM use_case_needs WHERE id = ${needId}::uuid) AS version`);
  const row = rows[0] as { version?: number } | undefined;
  if (row) return { ok: true, value: { id: needId.toLowerCase(), version: Number(row.version) } };
  return linkOutcome(ctx.workspaceId, needId, useCaseId);
});

/** Scollega l'esigenza da uno use case. L'esigenza resta; già scollegata: niente da fare. */
export const unlinkNeed = guarded("unlink_need", async function unlinkNeed(
  ctx: WriteContext,
  needId: string,
  useCaseId: string,
): Promise<ServiceResult<NeedWritten>> {
  const writer = await personaWriter(ctx, "canEditNeeds");
  if (!writer.ok) return writer;
  if (!isUuid(needId) || !isUuid(useCaseId)) return fail("non_trovato");
  const { rows } = await db.execute(sql`DELETE FROM use_case_need_links l
     USING use_case_needs n
     WHERE l.need_id = n.id AND n.id = ${needId}::uuid AND n.workspace_id = ${ctx.workspaceId}::uuid AND n.archived_at IS NULL
       AND l.use_case_id = ${useCaseId}::uuid
    RETURNING n.version`);
  const row = rows[0] as { version?: number } | undefined;
  if (row) return { ok: true, value: { id: needId.toLowerCase(), version: Number(row.version) } };
  return linkOutcome(ctx.workspaceId, needId, useCaseId);
});
