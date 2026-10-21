import "server-only";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import { useCaseMcpRequests } from "../schema";
import { decideExistingTeamRequest, TEAM_REQUEST_STALE_AFTER_SECONDS } from "@/lib/use-cases/mcp/idempotency";

/**
 * Richieste idempotenti del MCP del team (docs/use-case/DESIGN.md §9.4, tabella
 * `use_case_mcp_requests` della 0020). Le regole sono in `src/lib/use-cases/mcp/idempotency.ts`;
 * qui le scritture, ognuna in un solo statement (driver `neon-http`, niente transazioni
 * interattive), sicure con richieste concorrenti: mai un errore di unicità, quindi mai un 500.
 *
 * - Presa in carico: `INSERT … ON CONFLICT DO NOTHING RETURNING` sulla chiave (workspace,
 *   principal, chiave); se esiste, rilettura e decisione; per una ripresa, UPDATE condizionato
 *   che alza `attempt` (se un'altra richiesta la riprende prima, si rilegge).
 * - Chi ottiene `claimed` possiede la riga per il suo `attempt`: avanzamento, chiusura,
 *   fallimento e cancellazione valgono solo per quel tentativo. `createdAt` dice quando è nata
 *   la richiesta: una ripresa cerca da lì, nella Storia, le scritture di un tentativo di prima.
 * - `result` tiene solo id, codici e versioni; `reserved_ids` gli id delle schede di
 *   `create_use_cases`, decisi alla prima presa in carico e riusati a ogni ripresa.
 *
 * Le date sono `timestamptz` e si confrontano con l'orologio del database.
 */

export interface TeamRequestKey {
  workspaceId: string;
  principalKey: string;
  idempotencyKey: string;
}

export interface TeamRequestRow {
  status: string;
  requestHash: string;
  tool: string;
  result: Record<string, unknown> | null;
  reservedIds: string[] | null;
  attempt: number;
  ageSeconds: number;
}

export type TeamClaim =
  | {
      status: "claimed";
      attempt: number;
      reservedIds: string[] | null;
      result: Record<string, unknown> | null;
      takeover: boolean;
      /** Quando è nata la richiesta (primo tentativo), sull'orologio del database. */
      createdAt: Date;
    }
  | { status: "duplicate"; result: Record<string, unknown> | null }
  | { status: "conflict" }
  | { status: "in_progress"; retryAfterSeconds: number };

function keyWhere(key: TeamRequestKey) {
  return and(
    eq(useCaseMcpRequests.workspaceId, key.workspaceId),
    eq(useCaseMcpRequests.principalKey, key.principalKey),
    eq(useCaseMcpRequests.idempotencyKey, key.idempotencyKey),
  );
}

const AGE_SECONDS = sql<string>`extract(epoch from (now() - ${useCaseMcpRequests.updatedAt}))`;

/** La riga della chiave, senza scrivere; null se non c'è. */
export async function readTeamMcpRequest(key: TeamRequestKey): Promise<TeamRequestRow | null> {
  await ensureDbSchema();
  const [row] = await db
    .select({
      status: useCaseMcpRequests.status,
      requestHash: useCaseMcpRequests.requestHash,
      tool: useCaseMcpRequests.tool,
      result: useCaseMcpRequests.result,
      reservedIds: useCaseMcpRequests.reservedIds,
      attempt: useCaseMcpRequests.attempt,
      ageSeconds: AGE_SECONDS,
    })
    .from(useCaseMcpRequests)
    .where(keyWhere(key))
    .limit(1);
  return row ? { ...row, result: row.result ?? null, reservedIds: row.reservedIds ?? null, ageSeconds: Number(row.ageSeconds) } : null;
}

/**
 * Presa in carico per (workspace, principal, chiave). `reservedIds`: gli id da usare se la riga
 * nasce adesso; una ripresa tiene quelli salvati.
 */
export async function claimTeamMcpRequest(
  params: TeamRequestKey & { tool: string; requestHash: string; reservedIds: string[] | null },
): Promise<TeamClaim> {
  await ensureDbSchema();
  const where = keyWhere(params);
  for (let round = 0; round < 3; round += 1) {
    const [inserted] = await db
      .insert(useCaseMcpRequests)
      .values({
        workspaceId: params.workspaceId,
        principalKey: params.principalKey,
        idempotencyKey: params.idempotencyKey,
        tool: params.tool,
        requestHash: params.requestHash,
        status: "pending",
        reservedIds: params.reservedIds,
        attempt: 1,
      })
      .onConflictDoNothing()
      .returning({ attempt: useCaseMcpRequests.attempt, reservedIds: useCaseMcpRequests.reservedIds, createdAt: useCaseMcpRequests.createdAt });
    if (inserted) {
      return { status: "claimed", attempt: inserted.attempt, reservedIds: inserted.reservedIds ?? null, result: null, takeover: false, createdAt: inserted.createdAt };
    }

    const existing = await readTeamMcpRequest(params);
    if (!existing) continue;
    const decision = decideExistingTeamRequest(existing, params.requestHash);
    if (decision.kind === "duplicate") return { status: "duplicate", result: existing.result };
    if (decision.kind === "conflict") return { status: "conflict" };
    if (decision.kind === "in_progress") return { status: "in_progress", retryAfterSeconds: decision.retryAfterSeconds };

    const [taken] = await db
      .update(useCaseMcpRequests)
      .set({ status: "pending", updatedAt: sql`now()`, attempt: sql`${useCaseMcpRequests.attempt} + 1` })
      .where(
        and(
          where,
          eq(useCaseMcpRequests.requestHash, params.requestHash),
          eq(useCaseMcpRequests.attempt, existing.attempt),
          or(
            eq(useCaseMcpRequests.status, "failed"),
            and(
              eq(useCaseMcpRequests.status, "pending"),
              lt(useCaseMcpRequests.updatedAt, sql`now() - make_interval(secs => ${TEAM_REQUEST_STALE_AFTER_SECONDS})`),
            ),
          ),
        ),
      )
      .returning({
        attempt: useCaseMcpRequests.attempt,
        reservedIds: useCaseMcpRequests.reservedIds,
        result: useCaseMcpRequests.result,
        createdAt: useCaseMcpRequests.createdAt,
      });
    if (taken) {
      return { status: "claimed", attempt: taken.attempt, reservedIds: taken.reservedIds ?? null, result: taken.result ?? null, takeover: true, createdAt: taken.createdAt };
    }
  }
  return { status: "in_progress", retryAfterSeconds: 1 };
}

/** Il tentativo che possiede la riga: ancora `pending` e con il suo `attempt`. */
function ownedBy(key: TeamRequestKey, attempt: number) {
  return and(keyWhere(key), eq(useCaseMcpRequests.status, "pending"), eq(useCaseMcpRequests.attempt, attempt));
}

/** Salva l'avanzamento (`update_use_case`: i passi già scritti e la version dopo), tenendo la riga `pending`. */
export async function saveTeamMcpProgress(key: TeamRequestKey, attempt: number, result: Record<string, unknown>): Promise<boolean> {
  await ensureDbSchema();
  const rows = await db
    .update(useCaseMcpRequests)
    .set({ result, updatedAt: sql`now()` })
    .where(ownedBy(key, attempt))
    .returning({ attempt: useCaseMcpRequests.attempt });
  return rows.length > 0;
}

/** Chiude la richiesta con il suo risultato (solo id, codici e versioni). */
export async function completeTeamMcpRequest(key: TeamRequestKey, attempt: number, result: Record<string, unknown>): Promise<boolean> {
  await ensureDbSchema();
  const rows = await db
    .update(useCaseMcpRequests)
    .set({ status: "completed", result, updatedAt: sql`now()` })
    .where(ownedBy(key, attempt))
    .returning({ attempt: useCaseMcpRequests.attempt });
  return rows.length > 0;
}

/** Esito incerto o scrittura a metà: `failed`, si riprende con la stessa chiave e lo stesso contenuto. */
export async function failTeamMcpRequest(key: TeamRequestKey, attempt: number): Promise<boolean> {
  await ensureDbSchema();
  const rows = await db
    .update(useCaseMcpRequests)
    .set({ status: "failed", updatedAt: sql`now()` })
    .where(ownedBy(key, attempt))
    .returning({ attempt: useCaseMcpRequests.attempt });
  return rows.length > 0;
}

/** Errore certo senza effetti: la riga si cancella e la chiave torna libera. */
export async function releaseTeamMcpRequest(key: TeamRequestKey, attempt: number): Promise<boolean> {
  await ensureDbSchema();
  const rows = await db.delete(useCaseMcpRequests).where(ownedBy(key, attempt)).returning({ attempt: useCaseMcpRequests.attempt });
  return rows.length > 0;
}
