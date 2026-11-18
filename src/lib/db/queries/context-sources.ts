import "server-only";
/**
 * Le fonti di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.3): gli appunti e le trascrizioni
 * delle call (dal web, da Claude, da Granola) e i documenti caricati.
 *
 * - Gli appunti li vede e li scrive solo Lateral Space; sono sempre «Solo Lateral Space» (lo garantisce anche il CHECK).
 * - Un documento ha la sua riga di `uploaded_documents` e la sua fonte, nate nella stessa transazione; chi non è di
 *   Lateral Space vede solo i documenti «Per tutti».
 * - Togliere una fonte lascia i fatti confermati, segnati «senza fonte»; le sue proposte spariscono. (9b) Una fonte di
 *   risposte del referente non si toglie: le risposte vivono nella scheda dello use case.
 * - (9b) Gli appunti arrivano anche dalla CLI (`unbundle nota`, origine `cli`).
 * - Salvare non chiama mai il modello: la lettura è `readContextSource` (context-read.ts).
 * Nei log e nella storia solo id, codici e numeri: mai un titolo o un testo.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contextSources, uploadedDocuments } from "@/lib/db/schema";
import { bodyHash, cleanBody, cut, oneLine } from "@/lib/context/normalize";
import { realIsoDate } from "@/lib/context/read/reconcile";
import { partsFor } from "@/lib/context/read/split";
import { scanNote } from "@/lib/context/scan";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { canRemoveDocument, contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { CONTEXT_LIMITS, type ContextVisibility, type ReadReason, type ReadStatus, type SkippedCounts, type SourceKind, type SourceOrigin } from "@/lib/context/vocab";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";
import { answerSourceUseCaseId } from "./context-referent";
import { contextStoreReady } from "./context-store";
import { denied, eventStatement, gate, invalid, isUniqueViolation, isUuid, notFound, ok, retry, rowsOf, toDate, toIsoDate } from "./context-shared";

const LOG_SCOPE = "context/sources";

// ─── Salvare un appunto ──────────────────────────────────────────────

export interface NewNoteInput {
  /** 3-200 caratteri. */
  title: string;
  /** AAAA-MM-GG */
  occurredOn: string;
  /** 20-300.000 caratteri. */
  body: string;
  /** «Con chi», testo libero. */
  participants?: string | null;
  /** Solo https. */
  link?: string | null;
  /** (9b) `cli`: `unbundle nota`, solo Lateral Space (lo controlla `canAddNotes`). */
  origin: "web" | "claude" | "granola" | "cli";
  kind?: "appunti" | "trascrizione";
}
export interface AddedSource {
  sourceId: string;
  created: boolean;
  readStatus: ReadStatus;
}

interface CleanNote {
  title: string;
  occurredOn: string;
  body: string;
  participants: string | null;
  link: string | null;
  origin: "web" | "claude" | "granola" | "cli";
  kind: "appunti" | "trascrizione";
  hash: string;
}

/** Un link all'originale: solo https, un indirizzo vero, al massimo 500 caratteri. */
function cleanLink(value: string | null | undefined): { ok: true; link: string | null } | { ok: false } {
  const link = (value ?? "").trim();
  if (!link) return { ok: true, link: null };
  if (link.length > CONTEXT_LIMITS.linkMax || !/^https:\/\//.test(link)) return { ok: false };
  try {
    return new URL(link).protocol === "https:" ? { ok: true, link } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Validazione e controllo dei testi di un appunto: i campi puliti, o gli errori per campo. */
function checkNote(input: NewNoteInput): { ok: true; note: CleanNote } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const T = CONTEXT_TEXT;
  const title = oneLine(typeof input?.title === "string" ? input.title : "");
  if (title.length < CONTEXT_LIMITS.titleMin) fieldErrors.title = T.add.titleMissing;
  else if (title.length > CONTEXT_LIMITS.titleMax) fieldErrors.title = T.errors.tooLong(CONTEXT_LIMITS.titleMax);
  const occurredOn = realIsoDate(input?.occurredOn);
  if (!occurredOn) fieldErrors.occurredOn = T.add.dateMissing;
  const body = cleanBody(typeof input?.body === "string" ? input.body : "");
  if (body.length < CONTEXT_LIMITS.bodyMin) fieldErrors.body = T.add.tooShort;
  else if (body.length > CONTEXT_LIMITS.bodyMax) fieldErrors.body = T.add.tooLong;
  const participants = oneLine(typeof input?.participants === "string" ? input.participants : "");
  if (participants.length > CONTEXT_LIMITS.participantsMax) fieldErrors.participants = T.errors.tooLong(CONTEXT_LIMITS.participantsMax);
  const link = cleanLink(input?.link);
  if (!link.ok) fieldErrors.link = T.add.linkInvalid;
  const origin = input?.origin;
  if (origin !== "web" && origin !== "claude" && origin !== "granola" && origin !== "cli") fieldErrors.origin = T.errors.invalid;
  const kind = input?.kind ?? "appunti";
  if (kind !== "appunti" && kind !== "trascrizione") fieldErrors.kind = T.errors.invalid;
  // Il controllo dei testi: dati sanitari e discriminatori fermano il salvataggio, con la parola trovata e il campo
  // giusto («Negli appunti», «Nel titolo», «In «Con chi»»).
  const A = T.add;
  const blocked = { title: [A.blockedTitleHealth, A.blockedTitleDiscrimination], participants: [A.blockedParticipantsHealth, A.blockedParticipantsDiscrimination] } as const;
  for (const [field, text] of [["body", body], ["title", title], ["participants", participants]] as const) {
    if (fieldErrors[field] || !text) continue;
    const scan = scanNote(text);
    if (scan.ok) continue;
    if (field === "body") fieldErrors[field] = scan.message;
    else fieldErrors[field] = (scan.category === "sanitario" ? blocked[field][0] : blocked[field][1])(scan.term);
  }
  if (Object.keys(fieldErrors).length > 0 || !occurredOn || !link.ok) return { ok: false, fieldErrors };
  return { ok: true, note: { title, occurredOn, body, participants: participants || null, link: link.link, origin: origin as CleanNote["origin"], kind, hash: bodyHash(body) } };
}

/** L'INSERT di un appunto nuovo (`da_leggere`), solo se la condizione vale. */
function insertNoteSql(id: string, actor: ContextActor, note: CleanNote, external: { id: string; updatedAt: Date | null } | null, when: SQL) {
  return sql`
    INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, participants, link, body, body_chars, body_hash,
      external_id, external_updated_at, visibility, read_status, parts_total, added_by_user_id)
    SELECT ${id}::uuid, ${actor.workspaceId}::uuid, ${note.kind}, ${note.origin}, ${note.title}, ${note.occurredOn}::date, ${note.participants}, ${note.link},
      ${note.body}, ${note.body.length}, ${note.hash}, ${external?.id ?? null}, ${external?.updatedAt ? external.updatedAt.toISOString() : null}::timestamptz,
      'ls', 'da_leggere', ${partsFor(note.body.length)}, ${actor.userId}::uuid
    WHERE ${when}`;
}

/**
 * Salva un appunto. Solo Lateral Space. Nell'ordine: validazione, `scanNote` (fermato: `dati_non_validi` con
 * `fieldErrors.body`), stesso testo già nel workspace (`body_hash`): torna quello, `created: false`.
 * Scrive `fonte_aggiunta`. Non chiama il modello.
 */
export async function addContextNote(actor: ContextActor, input: NewNoteInput): Promise<ServiceResult<AddedSource>> {
  const allowed = await gate(actor, "canAddNotes");
  if (!allowed.ok) return allowed;
  const checked = checkNote(input);
  if (!checked.ok) return invalid(checked.fieldErrors);
  const note = checked.note;
  const id = crypto.randomUUID();
  const ws = actor.workspaceId;
  try {
    // Lo stesso testo due volte insieme: il lock per testo le mette in fila, e la seconda trova la prima.
    const sameText = sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.workspace_id = ${ws}::uuid AND x.body_hash = ${note.hash} AND x.kind <> 'documento')`;
    const results = await db.batch([
      db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`unbundle:context-note:${ws}:${note.hash}`}))`),
      db.execute(insertNoteSql(id, actor, note, null, sql`NOT ${sameText}`)),
      eventStatement(
        { workspaceId: ws, action: "fonte_aggiunta", channel: actor.channel, actorUserId: actor.userId, sourceId: id, detail: { origine: note.origin, tipo: note.kind, caratteri: note.body.length } },
        sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${id}::uuid)`,
      ),
      db.execute(sql`
        SELECT id, read_status FROM context_sources
        WHERE workspace_id = ${ws}::uuid AND body_hash = ${note.hash} AND kind <> 'documento'
        ORDER BY created_at, id LIMIT 1`),
    ]);
    const [row] = rowsOf<{ id: string; read_status: ReadStatus }>(results[3]);
    if (!row) return retry();
    return ok({ sourceId: row.id, created: row.id === id, readStatus: row.read_status });
  } catch (error) {
    logSafeError(LOG_SCOPE, "appunto_non_salvato", error, { workspaceId: ws });
    return retry();
  }
}

/**
 * Granola: crea o aggiorna l'appunto di una call (`external_id`). Testo uguale: aggiorna solo
 * `external_updated_at`. Testo diverso: aggiorna, torna `da_leggere`, le proposte aperte diventano `superata`,
 * scrive `fonte_aggiornata`. Le proposte aperte che la persona ha corretto restano aperte: sono il suo lavoro, e la
 * lettura dopo non ripropone il loro passaggio (`editedQuotes`).
 */
export async function upsertExternalNote(
  actor: ContextActor,
  input: NewNoteInput & { externalId: string; externalUpdatedAt: Date | null },
): Promise<ServiceResult<AddedSource & { changed: boolean }>> {
  const allowed = await gate(actor, "canAddNotes");
  if (!allowed.ok) return allowed;
  const externalId = typeof input?.externalId === "string" ? input.externalId.trim() : "";
  if (!externalId || externalId.length > 120) return invalid({ externalId: CONTEXT_TEXT.errors.invalid });
  const checked = checkNote(input);
  if (!checked.ok) return invalid(checked.fieldErrors);
  const note = checked.note;
  const ws = actor.workspaceId;
  const updatedAt = input.externalUpdatedAt instanceof Date && !Number.isNaN(input.externalUpdatedAt.getTime()) ? input.externalUpdatedAt : null;
  const find = () =>
    db
      .select({ id: contextSources.id, bodyHash: contextSources.bodyHash, readStatus: contextSources.readStatus, textPurgedAt: contextSources.textPurgedAt })
      .from(contextSources)
      .where(and(eq(contextSources.workspaceId, ws), eq(contextSources.origin, note.origin), eq(contextSources.externalId, externalId)))
      .limit(1);
  try {
    let [existing] = await find();
    if (!existing) {
      const id = crypto.randomUUID();
      try {
        await db.batch([
          db.execute(insertNoteSql(id, actor, note, { id: externalId, updatedAt }, sql`true`)),
          eventStatement({ workspaceId: ws, action: "fonte_aggiunta", channel: actor.channel, actorUserId: actor.userId, sourceId: id, detail: { origine: note.origin, tipo: note.kind, caratteri: note.body.length } }),
        ]);
        return ok({ sourceId: id, created: true, readStatus: "da_leggere", changed: true });
      } catch (error) {
        // Due giri insieme sulla stessa call: l'indice unico ne lascia passare uno, l'altro rilegge.
        if (!isUniqueViolation(error, "context_sources_external_unique")) throw error;
        [existing] = await find();
        if (!existing) return retry();
      }
    }
    const stamp = updatedAt ? updatedAt.toISOString() : null;
    // Testo uguale, o testo già cancellato dopo i 12 mesi (non torna): solo la data di Granola.
    if (existing.bodyHash === note.hash || existing.textPurgedAt !== null) {
      await db.execute(sql`
        UPDATE context_sources SET external_updated_at = coalesce(${stamp}::timestamptz, external_updated_at)
        WHERE id = ${existing.id}::uuid AND workspace_id = ${ws}::uuid`);
      return ok({ sourceId: existing.id, created: false, readStatus: existing.readStatus, changed: false });
    }
    await db.batch([
      db.execute(sql`
        UPDATE context_sources SET kind = ${note.kind}, title = ${note.title}, occurred_on = ${note.occurredOn}::date, participants = ${note.participants}, link = ${note.link},
          body = ${note.body}, body_chars = ${note.body.length}, body_hash = ${note.hash}, external_updated_at = coalesce(${stamp}::timestamptz, external_updated_at),
          read_status = 'da_leggere', read_reason = NULL, read_attempts = 0, read_started_at = NULL, read_at = NULL,
          parts_total = ${partsFor(note.body.length)}, parts_read = 0, skipped = '{}'::jsonb, version = version + 1, updated_at = now()
        WHERE id = ${existing.id}::uuid AND workspace_id = ${ws}::uuid`),
      // Le proposte che nessuno ha toccato tornano, se il testo nuovo le dice ancora; quelle corrette dalla persona restano.
      db.execute(sql`
        UPDATE context_proposals SET status = 'superata', decided_at = now(), updated_at = now(), version = version + 1
        WHERE source_id = ${existing.id}::uuid AND workspace_id = ${ws}::uuid AND status = 'aperta' AND NOT edited`),
      eventStatement({ workspaceId: ws, action: "fonte_aggiornata", channel: actor.channel, actorUserId: actor.userId, sourceId: existing.id, detail: { origine: note.origin, caratteri: note.body.length } }),
    ]);
    return ok({ sourceId: existing.id, created: false, readStatus: "da_leggere", changed: true });
  } catch (error) {
    logSafeError(LOG_SCOPE, "appunto_esterno_non_salvato", error, { workspaceId: ws });
    return retry();
  }
}

// ─── Salvare un documento ────────────────────────────────────────────

/**
 * Un documento caricato: la riga di `uploaded_documents` e la sua fonte (`kind = 'documento'`) nella stessa
 * transazione. La chiama solo la rotta di caricamento, dopo aver messo il file nell'archivio.
 */
export async function saveUploadedDocument(
  actor: ContextActor,
  input: {
    fileName: string;
    fileType: string;
    fileSize: number;
    blobUrl: string;
    extractedText: string;
    summary: string;
    departmentId: string | null;
    title: string;
    occurredOn: string;
    visibility: ContextVisibility;
    participants?: string | null;
    link?: string | null;
    origin: "web";
  },
): Promise<ServiceResult<{ documentId: string; sourceId: string }>> {
  const allowed = await gate(actor, "canUploadDocuments");
  if (!allowed.ok) return allowed;
  const T = CONTEXT_TEXT;
  const fieldErrors: Record<string, string> = {};
  const fileName = cut(oneLine(typeof input?.fileName === "string" ? input.fileName : ""), 500);
  const fileType = cut(oneLine(typeof input?.fileType === "string" ? input.fileType : ""), 100);
  if (!fileName || !fileType) fieldErrors.file = T.documents.badType;
  if (!Number.isInteger(input?.fileSize) || input.fileSize <= 0 || input.fileSize > CONTEXT_LIMITS.uploadMaxBytes) fieldErrors.file = T.documents.tooBig;
  if (typeof input?.blobUrl !== "string" || !input.blobUrl.trim()) fieldErrors.file = T.errors.invalid;
  const title = cut(oneLine(typeof input?.title === "string" ? input.title : "") || fileName, CONTEXT_LIMITS.titleMax);
  if (!title) fieldErrors.title = T.add.titleMissing;
  const occurredOn = realIsoDate(input?.occurredOn);
  if (!occurredOn) fieldErrors.occurredOn = T.add.dateMissing;
  const participants = oneLine(typeof input?.participants === "string" ? input.participants : "");
  if (participants.length > CONTEXT_LIMITS.participantsMax) fieldErrors.participants = T.errors.tooLong(CONTEXT_LIMITS.participantsMax);
  const link = cleanLink(input?.link);
  if (!link.ok) fieldErrors.link = T.add.linkInvalid;
  if (input?.visibility !== "tutti" && input?.visibility !== "ls") fieldErrors.visibility = T.errors.visibilityMissing;
  if (input?.departmentId !== null && !isUuid(input?.departmentId)) fieldErrors.departmentId = T.errors.invalid;
  if (Object.keys(fieldErrors).length > 0 || !occurredOn || !link.ok) return invalid(fieldErrors);
  // «Solo Lateral Space» lo può dire solo Lateral Space: per gli altri un documento nasce sempre «Per tutti».
  const visibility: ContextVisibility = contextAbilities(actor).seesLateralSpace ? input.visibility : "tutti";
  const text = cut(typeof input.extractedText === "string" ? input.extractedText.replace(/\u0000/g, "") : "", CONTEXT_LIMITS.documentTextMax);
  const summary = typeof input.summary === "string" ? input.summary : "";
  const ws = actor.workspaceId;
  const documentId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  try {
    // L'unità deve essere di questo workspace: altrimenti non si scrive niente.
    const unitOk = input.departmentId === null ? sql`true` : sql`EXISTS (SELECT 1 FROM departments d WHERE d.id = ${input.departmentId}::uuid AND d.workspace_id = ${ws}::uuid)`;
    const results = await db.batch([
      db.execute(sql`
        INSERT INTO uploaded_documents (id, workspace_id, user_id, department_id, file_name, file_type, file_size, blob_url, extracted_text, summary)
        SELECT ${documentId}::uuid, ${ws}::uuid, ${actor.userId}::uuid, ${input.departmentId}::uuid, ${fileName}, ${fileType}, ${input.fileSize}, ${input.blobUrl.trim()}, ${text}, ${summary}
        WHERE ${unitOk}
        RETURNING id`),
      db.execute(sql`
        INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, participants, link, body_chars, document_id, visibility, read_status, parts_total, added_by_user_id)
        SELECT ${sourceId}::uuid, ${ws}::uuid, 'documento', 'web', ${title}, ${occurredOn}::date, ${participants || null}, ${link.link}, ${text.length}, ${documentId}::uuid, ${visibility},
          'da_leggere', ${partsFor(text.length)}, ${actor.userId}::uuid
        WHERE EXISTS (SELECT 1 FROM uploaded_documents d WHERE d.id = ${documentId}::uuid)`),
      eventStatement(
        { workspaceId: ws, action: "fonte_aggiunta", channel: actor.channel, actorUserId: actor.userId, sourceId, detail: { origine: "web", tipo: "documento", caratteri: text.length } },
        sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${sourceId}::uuid)`,
      ),
    ]);
    if (rowsOf(results[0]).length === 0) return invalid({ departmentId: T.errors.invalid });
    return ok({ documentId, sourceId });
  } catch (error) {
    logSafeError(LOG_SCOPE, "documento_non_salvato", error, { workspaceId: ws });
    return retry();
  }
}

// ─── Leggere l'elenco e una fonte ────────────────────────────────────

export type SourceState = "da_leggere" | "in_lettura" | "da_confermare" | "confermato" | "letto" | "non_letto";
export interface SourceListItem {
  id: string;
  kind: SourceKind;
  origin: SourceOrigin;
  title: string;
  occurredOn: string;
  state: SourceState;
  readReason: ReadReason | null;
  openProposals: number;
  visibility: ContextVisibility;
  document: { id: string; fileName: string; fileType: string; fileSize: number } | null;
  canRemove: boolean;
}

/**
 * Lo stato a schermo di una fonte: `da_leggere` e `non_letto` dal database; `in_lettura` solo se la presa in carico ha
 * meno di 180 secondi; `letto` con proposte aperte è `da_confermare`; senza proposte aperte e con almeno una
 * confermata è `confermato`; altrimenti `letto`.
 */
export function sourceStateOf(row: { readStatus: ReadStatus; leaseFresh: boolean; open: number; confirmed: number }): SourceState {
  if (row.readStatus === "non_letto") return "non_letto";
  if (row.readStatus === "in_lettura") return row.leaseFresh ? "in_lettura" : "da_leggere";
  if (row.readStatus === "da_leggere") return "da_leggere";
  if (row.open > 0) return "da_confermare";
  return row.confirmed > 0 ? "confermato" : "letto";
}

interface SourceRow {
  id: string;
  kind: SourceKind;
  origin: SourceOrigin;
  title: string;
  occurred_on: unknown;
  read_status: ReadStatus;
  read_reason: ReadReason | null;
  lease_fresh: boolean;
  open_proposals: number;
  confirmed_proposals: number;
  visibility: ContextVisibility;
  document_id: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  body: string | null;
  participants: string | null;
  link: string | null;
  added_by_name: string | null;
  created_at: unknown;
  text_purged_at: unknown;
  parts_total: number;
  parts_read: number;
  skipped: unknown;
  external_id: string | null;
}

/** Le colonne di una fonte per chi guarda. Chi non è di Lateral Space vede solo i documenti «Per tutti», senza lo stato della lettura. */
function sourcesQuery(actor: ContextActor, lateralSpace: boolean, where: SQL, limit: number) {
  return sql`
    SELECT s.id, s.kind, s.origin, s.title, s.occurred_on, s.read_status, s.read_reason,
      (s.read_started_at IS NOT NULL AND s.read_started_at > now() - make_interval(secs => ${CONTEXT_LIMITS.readLeaseSeconds})) AS lease_fresh,
      (SELECT count(*)::int FROM context_proposals p WHERE p.source_id = s.id AND p.status = 'aperta') AS open_proposals,
      (SELECT count(*)::int FROM context_proposals p WHERE p.source_id = s.id AND p.status = 'confermata') AS confirmed_proposals,
      s.visibility, s.document_id, d.file_name, d.file_type, d.file_size, d.user_id AS uploaded_by,
      s.body, s.participants, s.link, coalesce(nullif(btrim(u.name), ''), u.email) AS added_by_name,
      s.created_at, s.text_purged_at, s.parts_total, s.parts_read, s.skipped, s.external_id
    FROM context_sources s
    LEFT JOIN uploaded_documents d ON d.id = s.document_id
    LEFT JOIN users u ON u.id = s.added_by_user_id
    WHERE s.workspace_id = ${actor.workspaceId}::uuid
      AND (${lateralSpace} OR (s.kind = 'documento' AND s.visibility = 'tutti'))
      AND ${where}
    ORDER BY s.occurred_on DESC, s.created_at DESC, s.id
    LIMIT ${limit}`;
}

function listItemOf(actor: ContextActor, lateralSpace: boolean, row: SourceRow): SourceListItem {
  const isDocument = row.kind === "documento";
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    title: row.title,
    occurredOn: toIsoDate(row.occurred_on),
    // La lettura e le proposte sono di Lateral Space: agli altri la fonte risulta soltanto letta.
    state: lateralSpace ? sourceStateOf({ readStatus: row.read_status, leaseFresh: row.lease_fresh === true, open: Number(row.open_proposals), confirmed: Number(row.confirmed_proposals) }) : "letto",
    readReason: lateralSpace ? row.read_reason : null,
    openProposals: lateralSpace ? Number(row.open_proposals) : 0,
    visibility: row.visibility,
    document: isDocument && row.document_id ? { id: row.document_id, fileName: row.file_name ?? "", fileType: row.file_type ?? "", fileSize: Number(row.file_size ?? 0) } : null,
    // (9b) Le risposte del referente non si tolgono da qui: vivono nella scheda dello use case, in «Cosa serve».
    canRemove: isDocument ? canRemoveDocument(actor, { uploadedByUserId: row.uploaded_by }) : row.kind === "risposta" ? false : lateralSpace,
  };
}

/** Lateral Space: tutto. Gli altri: solo i documenti «Per tutti». Dal più recente. */
export async function listContextSources(actor: ContextActor, opts: { limit?: number } = {}): Promise<SourceListItem[]> {
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen || !isUuid(actor.workspaceId) || !(await contextStoreReady())) return [];
  const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 200), 500));
  const rows = rowsOf<SourceRow>(await db.execute(sourcesQuery(actor, abilities.seesLateralSpace, sql`true`, limit)));
  return rows.map((row) => listItemOf(actor, abilities.seesLateralSpace, row));
}

export interface SourceDetail extends SourceListItem {
  /** null dopo i 12 mesi, o per chi non è di Lateral Space. */
  body: string | null;
  participants: string | null;
  link: string | null;
  /** Solo sull'appunto, solo a Lateral Space. */
  addedByName: string | null;
  createdAt: Date;
  textPurgedAt: Date | null;
  partsTotal: number;
  partsRead: number;
  skipped: SkippedCounts;
  /** (9b) Solo per le risposte di un referente, solo a Lateral Space: lo use case della richiesta, per «Apri lo use case». */
  useCaseId: string | null;
}

export async function getContextSource(actor: ContextActor, sourceId: string): Promise<SourceDetail | null> {
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen || !isUuid(actor.workspaceId) || !isUuid(sourceId) || !(await contextStoreReady())) return null;
  const lateralSpace = abilities.seesLateralSpace;
  const [row] = rowsOf<SourceRow>(await db.execute(sourcesQuery(actor, lateralSpace, sql`s.id = ${sourceId}::uuid`, 1)));
  if (!row) return null;
  const skipped = row.skipped !== null && typeof row.skipped === "object" && !Array.isArray(row.skipped) ? (row.skipped as SkippedCounts) : {};
  return {
    ...listItemOf(actor, lateralSpace, row),
    body: lateralSpace && row.kind !== "documento" ? row.body : null,
    participants: lateralSpace ? row.participants : null,
    link: lateralSpace ? row.link : null,
    addedByName: lateralSpace && row.kind !== "documento" ? row.added_by_name : null,
    createdAt: toDate(row.created_at) ?? new Date(0),
    textPurgedAt: toDate(row.text_purged_at),
    partsTotal: Number(row.parts_total),
    partsRead: Number(row.parts_read),
    skipped: lateralSpace ? skipped : {},
    useCaseId: lateralSpace && row.kind === "risposta" ? await answerSourceUseCaseId(actor.workspaceId, row.external_id) : null,
  };
}

// ─── Togliere, cambiare chi vede, cancellare il testo ────────────────

/** Cancella il file dall'archivio (Vercel Blob). Nei test se ne passa uno finto. */
async function deleteBlobFile(url: string): Promise<void> {
  const { del } = await import("@vercel/blob");
  await del(url);
}

/**
 * Toglie un appunto (solo Lateral Space) o un documento (`canRemoveDocument`). I fatti restano «senza fonte»,
 * le proposte spariscono; di un documento si cancellano anche il file dell'archivio e i frammenti; di un appunto
 * di Granola la call passa a `fuori` (senza workspace e senza fonte) e non rientra: è l'unico statement di questo
 * modulo su una tabella `context_granola_*`. Scrive `fonte_tolta` o `documento_tolto`.
 */
export async function removeContextSource(actor: ContextActor, sourceId: string, deps: { deleteBlob?: (url: string) => Promise<void> } = {}): Promise<ServiceResult<true>> {
  const allowed = await gate(actor, "canOpen");
  if (!allowed.ok) return allowed;
  if (!isUuid(sourceId)) return notFound();
  const abilities = contextAbilities(actor);
  const ws = actor.workspaceId;
  try {
    const [source] = await db
      .select({ id: contextSources.id, kind: contextSources.kind, visibility: contextSources.visibility, documentId: contextSources.documentId, uploadedBy: uploadedDocuments.userId, blobUrl: uploadedDocuments.blobUrl })
      .from(contextSources)
      .leftJoin(uploadedDocuments, eq(uploadedDocuments.id, contextSources.documentId))
      .where(and(eq(contextSources.id, sourceId), eq(contextSources.workspaceId, ws)))
      .limit(1);
    // Una fonte che chi chiama non può vedere non esiste, per lui.
    if (!source || (!abilities.seesLateralSpace && (source.kind !== "documento" || source.visibility !== "tutti"))) return notFound();
    const isDocument = source.kind === "documento";
    if (isDocument ? !canRemoveDocument(actor, { uploadedByUserId: source.uploadedBy }) : !abilities.canAddNotes) return denied();
    // (9b) Una fonte di risposte del referente non si toglie: le risposte vivono nella scheda dello use case.
    if (source.kind === "risposta") return denied();
    const results = await db.batch([
      // La call di Granola non rientra al prossimo giro: resta solo il suo id, «fuori».
      db.execute(sql`
        UPDATE context_granola_meetings SET decision = 'fuori', decided_by = 'persona', workspace_id = NULL, source_id = NULL, block_code = NULL, decided_at = now()
        WHERE source_id = ${sourceId}::uuid
          AND EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${sourceId}::uuid AND x.workspace_id = ${ws}::uuid)`),
      eventStatement(
        { workspaceId: ws, action: isDocument ? "documento_tolto" : "fonte_tolta", channel: actor.channel, actorUserId: actor.userId, sourceId },
        sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${sourceId}::uuid AND x.workspace_id = ${ws}::uuid)`,
      ),
      isDocument && source.documentId
        ? db.execute(sql`DELETE FROM uploaded_documents WHERE id = ${source.documentId}::uuid AND workspace_id = ${ws}::uuid RETURNING id`)
        : db.execute(sql`DELETE FROM context_sources WHERE id = ${sourceId}::uuid AND workspace_id = ${ws}::uuid AND kind <> 'documento' RETURNING id`),
    ]);
    if (rowsOf(results[2]).length === 0) return notFound();
    if (isDocument && source.blobUrl) {
      // Il file si cancella dopo la riga: se non riesce resta un file senza riga, mai una riga senza file.
      try {
        await (deps.deleteBlob ?? deleteBlobFile)(source.blobUrl);
      } catch (error) {
        logSafeError(LOG_SCOPE, "file_non_cancellato", error, { workspaceId: ws, sourceId });
      }
    }
    return ok(true);
  } catch (error) {
    logSafeError(LOG_SCOPE, "fonte_non_tolta", error, { workspaceId: ws, sourceId });
    return retry();
  }
}

/** Solo documenti, solo Lateral Space. */
export async function setDocumentVisibility(actor: ContextActor, sourceId: string, visibility: ContextVisibility): Promise<ServiceResult<true>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  if (!isUuid(sourceId)) return notFound();
  if (visibility !== "tutti" && visibility !== "ls") return invalid({ visibility: CONTEXT_TEXT.errors.visibilityMissing });
  const ws = actor.workspaceId;
  try {
    const [source] = await db.select({ kind: contextSources.kind, visibility: contextSources.visibility }).from(contextSources).where(and(eq(contextSources.id, sourceId), eq(contextSources.workspaceId, ws))).limit(1);
    if (!source) return notFound();
    if (source.kind !== "documento") return invalid({ visibility: CONTEXT_TEXT.errors.documentsOnly }, CONTEXT_TEXT.errors.documentsOnly);
    if (source.visibility === visibility) return ok(true);
    const changed = sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${sourceId}::uuid AND x.visibility = ${visibility} AND x.updated_at = now())`;
    await db.batch([
      db.execute(sql`
        UPDATE context_sources SET visibility = ${visibility}, version = version + 1, updated_at = now()
        WHERE id = ${sourceId}::uuid AND workspace_id = ${ws}::uuid AND kind = 'documento' AND visibility <> ${visibility}`),
      eventStatement({ workspaceId: ws, action: "visibilita_cambiata", channel: actor.channel, actorUserId: actor.userId, sourceId, detail: { da: source.visibility, a: visibility } }, changed),
    ]);
    return ok(true);
  } catch (error) {
    logSafeError(LOG_SCOPE, "visibilita_non_cambiata", error, { workspaceId: ws, sourceId });
    return retry();
  }
}

/**
 * Gli appunti con più di 12 mesi (`created_at`): `body`, `body_hash` e `participants` a null, `text_purged_at`,
 * proposte aperte `superata`. Restano fatti e citazioni. Un appunto ancora da leggere non si potrà più leggere.
 * (9b) Non le fonti delle risposte di un referente: non hanno testo salvato, e le chiude la conservazione del referente
 * (12 mesi dalla chiusura della richiesta o dall'ultimo messaggio, `referentSourcesEraseStatements`).
 */
export async function purgeExpiredNoteText(now: Date = new Date()): Promise<number> {
  if (!(await contextStoreReady())) return 0;
  const result = await db.execute(sql`
    WITH purged AS (
      UPDATE context_sources
      SET body = NULL, body_hash = NULL, participants = NULL, text_purged_at = ${now.toISOString()}::timestamptz, updated_at = now(), version = version + 1,
        read_status = CASE WHEN read_status IN ('da_leggere', 'in_lettura') THEN 'non_letto' ELSE read_status END,
        read_reason = CASE WHEN read_status IN ('da_leggere', 'in_lettura') THEN 'vuoto' ELSE read_reason END,
        read_started_at = NULL
      WHERE kind NOT IN ('documento', 'risposta') AND text_purged_at IS NULL
        AND created_at < ${now.toISOString()}::timestamptz - make_interval(months => ${CONTEXT_LIMITS.retentionMonths})
      RETURNING id, workspace_id
    ), closed AS (
      UPDATE context_proposals p SET status = 'superata', decided_at = now(), updated_at = now(), version = p.version + 1
      FROM purged WHERE p.source_id = purged.id AND p.status = 'aperta'
      RETURNING p.id
    ), logged AS (
      INSERT INTO context_events (workspace_id, action, channel, source_id)
      SELECT workspace_id, 'testo_cancellato', 'cron', id FROM purged
      RETURNING id
    )
    SELECT (SELECT count(*)::int FROM purged) AS purged, (SELECT count(*)::int FROM closed) AS closed, (SELECT count(*)::int FROM logged) AS logged`);
  return Number(rowsOf<{ purged: number }>(result)[0]?.purged ?? 0);
}
