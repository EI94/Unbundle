import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import {
  externalContributionSubmissions,
  workspaceConnectorConfigs,
  workspaceIntegrationTokens,
  workspaces,
  type ExternalContributionSubmission,
  type Workspace,
  type WorkspaceIntegrationToken,
} from "../schema";
import {
  decideExistingSubmission,
  IDEMPOTENCY_STALE_AFTER_SECONDS,
} from "@/lib/portfolio/idempotency";
import {
  CONNECTOR_PROVIDER,
  CONNECTOR_SCOPES,
  connectorTokenExpiresAt,
  hashIntegrationToken,
} from "@/lib/connector/auth";
import { isValidConnectorSlug, type ConnectorConfigRow } from "@/lib/connector/config";
import { isConnectorProfileReady, type ConnectorSettingsRow } from "@/lib/connector/settings-view";

export const CLAUDE_MCP_PROVIDER = "claude_mcp" as const;
export const PORTFOLIO_SUBMIT_SCOPE = "portfolio:submit" as const;
// Connettore MCP organizzativo (prompt WP4): token con i due scope del connettore,
// mai `portfolio:submit`. La fonte dei valori è `src/lib/connector/auth.ts` (modulo
// puro, testato), che esporta anche l'hash usato per ogni credenziale di workspace.
export {
  CONNECTOR_PROVIDER,
  CONNECTOR_READ_SCOPE,
  CONNECTOR_SCOPES,
  CONNECTOR_SUBMIT_SCOPE,
  hashIntegrationToken,
} from "@/lib/connector/auth";
// Casi d'uso (PIANO §5.8): token Claude in sola lettura, sempre limitati a un
// caso dal marcatore `uc:case:<uuid>`. La fonte dei valori è `src/lib/uc/mcp-access.ts`
// (modulo puro, testato); le rotte del portafoglio non accettano questi scope.
export {
  CASES_MEASURE_SCOPE,
  CASES_PROPOSE_SCOPE,
  CASES_READ_SCOPE,
  CASES_READ_VALIDATED_SCOPE,
  DATASETS_READ_META_SCOPE,
  DATASETS_READ_ROWS_SCOPE,
  UC_CASE_SCOPE_PREFIX,
} from "@/lib/uc/mcp-access";

export type WorkspaceIntegrationTokenListItem = Pick<
  WorkspaceIntegrationToken,
  | "id"
  | "workspaceId"
  | "label"
  | "provider"
  | "tokenPrefix"
  | "scopes"
  | "lastUsedAt"
  | "expiresAt"
  | "revokedAt"
  | "createdAt"
>;

export type AuthenticatedWorkspaceIntegrationToken = {
  token: WorkspaceIntegrationToken;
  workspace: Workspace;
};

/**
 * Le colonne timestamp (senza fuso) dell'app sono in UTC: `updated_at` si scrive e
 * si confronta con l'orologio del database in UTC, qualunque sia il fuso della sessione.
 */
const utcNow = sql`(now() AT TIME ZONE 'UTC')`;

function createIntegrationTokenSecret() {
  return `ub_mcp_${randomBytes(32).toString("base64url")}`;
}

function tokenPrefix(token: string) {
  return `${token.slice(0, 14)}...`;
}

export async function createWorkspaceIntegrationToken(params: {
  workspaceId: string;
  label: string;
  createdByUserId: string | null;
  provider?: typeof CLAUDE_MCP_PROVIDER | typeof CONNECTOR_PROVIDER;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  await ensureDbSchema();
  const token = createIntegrationTokenSecret();
  const [row] = await db
    .insert(workspaceIntegrationTokens)
    .values({
      workspaceId: params.workspaceId,
      label: params.label.trim() || "Claude MCP",
      provider: params.provider ?? CLAUDE_MCP_PROVIDER,
      tokenHash: hashIntegrationToken(token),
      tokenPrefix: tokenPrefix(token),
      scopes: params.scopes ?? [PORTFOLIO_SUBMIT_SCOPE],
      createdByUserId: params.createdByUserId,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  return { token, row };
}

const tokenListColumns = {
  id: workspaceIntegrationTokens.id,
  workspaceId: workspaceIntegrationTokens.workspaceId,
  label: workspaceIntegrationTokens.label,
  provider: workspaceIntegrationTokens.provider,
  tokenPrefix: workspaceIntegrationTokens.tokenPrefix,
  scopes: workspaceIntegrationTokens.scopes,
  lastUsedAt: workspaceIntegrationTokens.lastUsedAt,
  expiresAt: workspaceIntegrationTokens.expiresAt,
  revokedAt: workspaceIntegrationTokens.revokedAt,
  createdAt: workspaceIntegrationTokens.createdAt,
};

/**
 * Token per la card v1 «Claude per Unbundle» (Impostazioni › Integrazioni): per
 * default solo `provider = 'claude_mcp'`, compresi i token dei casi d'uso (scope
 * `cases:*`), che la card separa da sé. I token del connettore non ci sono mai:
 * hanno la loro scheda «Connettore Claude» (`getConnectorIntegrationTokens`,
 * PIANO-LAVORI §3.5 K7r), dove la revoca dice che ferma il connettore per tutta
 * l'organizzazione. Un altro elenco di provider si chiede in modo esplicito.
 */
export async function getWorkspaceIntegrationTokens(
  workspaceId: string,
  opts: { providers?: readonly string[] } = {}
): Promise<WorkspaceIntegrationTokenListItem[]> {
  const providers = opts.providers ?? [CLAUDE_MCP_PROVIDER];
  if (providers.length === 0) return [];
  await ensureDbSchema();
  return db
    .select(tokenListColumns)
    .from(workspaceIntegrationTokens)
    .where(
      and(
        eq(workspaceIntegrationTokens.workspaceId, workspaceId),
        inArray(workspaceIntegrationTokens.provider, [...providers])
      )
    )
    .orderBy(desc(workspaceIntegrationTokens.createdAt));
}

export async function revokeWorkspaceIntegrationToken(params: {
  workspaceId: string;
  tokenId: string;
}) {
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceIntegrationTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceIntegrationTokens.id, params.tokenId),
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId)
      )
    )
    .returning();
  return row ?? null;
}

export async function authenticateWorkspaceIntegrationToken(
  rawToken: string | null | undefined
): Promise<AuthenticatedWorkspaceIntegrationToken | null> {
  await ensureDbSchema();
  const token = rawToken?.trim();
  if (!token) return null;

  const now = new Date();
  const [row] = await db
    .select({
      token: workspaceIntegrationTokens,
      workspace: workspaces,
    })
    .from(workspaceIntegrationTokens)
    .innerJoin(workspaces, eq(workspaces.id, workspaceIntegrationTokens.workspaceId))
    .where(
      and(
        eq(workspaceIntegrationTokens.tokenHash, hashIntegrationToken(token)),
        isNull(workspaceIntegrationTokens.revokedAt),
        or(isNull(workspaceIntegrationTokens.expiresAt), gt(workspaceIntegrationTokens.expiresAt, now))
      )
    )
    .limit(1);

  if (!row) return null;

  await db
    .update(workspaceIntegrationTokens)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(workspaceIntegrationTokens.id, row.token.id));

  return row;
}

// ─── Connettore MCP organizzativo (prompt WP4) ──────────────────────

/**
 * Token del connettore: entrambi gli scope `connector:read` e `connector:submit`,
 * scadenza a 90 giorni, mostrato una sola volta (lo restituisce solo questa
 * funzione; in tabella resta l'hash).
 */
export async function createConnectorIntegrationToken(params: {
  workspaceId: string;
  label: string;
  createdByUserId: string | null;
  now?: Date;
}) {
  return createWorkspaceIntegrationToken({
    workspaceId: params.workspaceId,
    label: params.label.trim() || "Connettore Claude",
    createdByUserId: params.createdByUserId,
    provider: CONNECTOR_PROVIDER,
    scopes: [...CONNECTOR_SCOPES],
    expiresAt: connectorTokenExpiresAt(params.now),
  });
}

const TOKEN_HASH = /^[0-9a-f]{64}$/;

/**
 * Autenticazione del connettore, in un solo statement: il token con questo hash,
 * non revocato, non scaduto, del workspace dello slug e con tutti gli scope
 * richiesti riceve `last_used_at` e torna indietro. Un token che non passa non
 * viene toccato. A differenza di `authenticateWorkspaceIntegrationToken`, qui
 * workspace e scope fanno parte della ricerca.
 */
export async function authenticateConnectorIntegrationToken(params: {
  tokenHash: string;
  workspaceId: string;
  requiredScopes: readonly string[];
}): Promise<{ id: string; scopes: string[] } | null> {
  if (!TOKEN_HASH.test(params.tokenHash) || params.requiredScopes.length === 0) return null;
  await ensureDbSchema();
  const now = new Date();
  const [row] = await db
    .update(workspaceIntegrationTokens)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(
      and(
        eq(workspaceIntegrationTokens.tokenHash, params.tokenHash),
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId),
        isNull(workspaceIntegrationTokens.revokedAt),
        or(isNull(workspaceIntegrationTokens.expiresAt), gt(workspaceIntegrationTokens.expiresAt, now)),
        sql`${workspaceIntegrationTokens.scopes} @> ${JSON.stringify(params.requiredScopes)}::jsonb`
      )
    )
    .returning({ id: workspaceIntegrationTokens.id, scopes: workspaceIntegrationTokens.scopes });
  return row ? { id: row.id, scopes: Array.isArray(row.scopes) ? row.scopes : [] } : null;
}

export type ConnectorIntegrationTokenListItem = WorkspaceIntegrationTokenListItem & {
  /** Arrivato dentro un indirizzo: «esposto, da revocare» (null se mai). */
  exposedAt: Date | null;
};

/**
 * Token del connettore del workspace (`provider = 'claude_connector'`) per la scheda
 * «Connettore Claude» (K7r), con lo stato «esposto» letto dalla riga del token:
 * nessun membro lo può spegnere segnando letta una notifica.
 */
export async function getConnectorIntegrationTokens(workspaceId: string): Promise<ConnectorIntegrationTokenListItem[]> {
  await ensureDbSchema();
  return db
    .select({ ...tokenListColumns, exposedAt: workspaceIntegrationTokens.exposedAt })
    .from(workspaceIntegrationTokens)
    .where(
      and(
        eq(workspaceIntegrationTokens.workspaceId, workspaceId),
        eq(workspaceIntegrationTokens.provider, CONNECTOR_PROVIDER)
      )
    )
    .orderBy(desc(workspaceIntegrationTokens.createdAt));
}

/**
 * Revoca dalla scheda «Connettore Claude» (K7r): solo un token del connettore
 * (`provider = 'claude_connector'`) di questo workspace e non ancora revocato. Un id
 * della card v1, di un altro workspace o già revocato non cambia nulla (null).
 * Revocare il token ferma il connettore per tutta l'organizzazione finché l'Owner non
 * lo riaggiunge in Claude con un token nuovo.
 */
export async function revokeConnectorIntegrationToken(params: {
  workspaceId: string;
  tokenId: string;
}): Promise<{ id: string; revokedAt: Date | null } | null> {
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceIntegrationTokens)
    .set({ revokedAt: utcNow, updatedAt: utcNow })
    .where(
      and(
        eq(workspaceIntegrationTokens.id, params.tokenId),
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId),
        eq(workspaceIntegrationTokens.provider, CONNECTOR_PROVIDER),
        isNull(workspaceIntegrationTokens.revokedAt)
      )
    )
    .returning({ id: workspaceIntegrationTokens.id, revokedAt: workspaceIntegrationTokens.revokedAt });
  return row ?? null;
}

/**
 * Configurazione del connettore per la scheda «Connettore Claude» (K7r): tutto tranne
 * la guida, di cui si legge solo se c'è (un oggetto JSON) e la sua `guideVersion` (la
 * versione che `get_intake_guide` usa quando la colonna è vuota), e tranne profilo e modello
 * delle istruzioni (K8), di cui esce solo se sono validi (`profileReady`): il loro contenuto
 * non lascia il server. Null senza riga.
 */
export async function getConnectorSettings(workspaceId: string): Promise<ConnectorSettingsRow | null> {
  await ensureDbSchema();
  const [row] = await db
    .select({
      slug: workspaceConnectorConfigs.slug,
      enabled: workspaceConnectorConfigs.enabled,
      codePrefix: workspaceConnectorConfigs.codePrefix,
      codeSeq: workspaceConnectorConfigs.nextCodeSeq,
      identityMode: workspaceConnectorConfigs.identityMode,
      authMode: workspaceConnectorConfigs.authMode,
      workspaceDisplayName: workspaceConnectorConfigs.workspaceDisplayName,
      guideVersion: workspaceConnectorConfigs.guideVersion,
      guideJsonVersion: sql<string | null>`case when jsonb_typeof(${workspaceConnectorConfigs.guide}) = 'object' and jsonb_typeof(${workspaceConnectorConfigs.guide} -> 'guideVersion') = 'string' then ${workspaceConnectorConfigs.guide} ->> 'guideVersion' end`,
      hasGuide: sql<boolean>`coalesce(jsonb_typeof(${workspaceConnectorConfigs.guide}) = 'object', false)`,
      profile: workspaceConnectorConfigs.profile,
      instructionsTemplate: workspaceConnectorConfigs.instructionsTemplate,
      allowedDomains: workspaceConnectorConfigs.allowedDomains,
      allowedOrigins: workspaceConnectorConfigs.allowedOrigins,
      limits: workspaceConnectorConfigs.limits,
    })
    .from(workspaceConnectorConfigs)
    .where(eq(workspaceConnectorConfigs.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  const { profile, instructionsTemplate, ...rest } = row;
  return { ...rest, hasGuide: row.hasGuide === true, profileReady: isConnectorProfileReady(profile, instructionsTemplate) };
}

/**
 * Interruttore di sospensione del workspace (`workspace_connector_configs.enabled`),
 * con chi l'ha cambiato. Spento: handshake e `tools/list` funzionano e ogni tool
 * risponde `connector_disabled`. Si accende solo con la guida, il profilo del cliente e il
 * modello delle istruzioni caricati (una riga senza guida, come quelle di D6, non è un
 * connettore pronto; senza profilo o modello la rotta risponde 500); si spegne sempre. Null
 * se il workspace non ha la configurazione o se manca qualcosa per accenderlo. La validità
 * completa di profilo e modello la controlla l'azione (`canActivateConnector`) prima di
 * chiamare: qui la condizione nello stesso UPDATE è che ci siano.
 */
export async function setConnectorEnabled(params: {
  workspaceId: string;
  enabled: boolean;
  updatedBy: string | null;
}): Promise<{ enabled: boolean } | null> {
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceConnectorConfigs)
    .set({ enabled: params.enabled, updatedAt: sql`now()`, updatedBy: params.updatedBy })
    .where(
      and(
        eq(workspaceConnectorConfigs.workspaceId, params.workspaceId),
        params.enabled
          ? sql`jsonb_typeof(${workspaceConnectorConfigs.guide}) = 'object' AND jsonb_typeof(${workspaceConnectorConfigs.profile}) = 'object' AND ${workspaceConnectorConfigs.instructionsTemplate} IS NOT NULL`
          : undefined
      )
    )
    .returning({ enabled: workspaceConnectorConfigs.enabled });
  return row ?? null;
}

export type ExposedIntegrationToken = { tokenId: string; workspaceId: string; provider: string };

/**
 * Un token valido arrivato in un indirizzo (query o percorso) si considera
 * compromesso e diventa «esposto, da revocare»: `exposed_at` sulla sua riga, una
 * volta sola per token. È un solo UPDATE condizionato su `exposed_at IS NULL`: con
 * richieste contemporanee la riga bloccata dalla prima si ricontrolla e le altre
 * non trovano più nulla, quindi una sola richiesta riceve il token appena segnalato.
 *
 * Nessuna revoca automatica: revocare il token del connettore ferma l'intera
 * organizzazione, quindi lo decide Lateral Space. Nessuna riga in `weekly_signals`:
 * la campanella è di tutto il workspace, si segna letta per tutti e finisce nel
 * prompt dell'analisi competitiva (la stessa regola di `src/lib/uc/notify/bell.ts`).
 * L'avviso a Lateral Space lo manda chi chiama (`src/lib/connector/exposed-token-alert.ts`).
 * Restituisce il token appena segnalato, oppure null (sconosciuto, revocato,
 * scaduto o già segnalato).
 */
export async function markIntegrationTokenExposed(tokenHash: string): Promise<ExposedIntegrationToken | null> {
  if (!TOKEN_HASH.test(tokenHash)) return null;
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceIntegrationTokens)
    .set({ exposedAt: utcNow, updatedAt: utcNow })
    .where(
      and(
        eq(workspaceIntegrationTokens.tokenHash, tokenHash),
        isNull(workspaceIntegrationTokens.exposedAt),
        isNull(workspaceIntegrationTokens.revokedAt),
        or(isNull(workspaceIntegrationTokens.expiresAt), gt(workspaceIntegrationTokens.expiresAt, utcNow))
      )
    )
    .returning({
      tokenId: workspaceIntegrationTokens.id,
      workspaceId: workspaceIntegrationTokens.workspaceId,
      provider: workspaceIntegrationTokens.provider,
    });
  return row ?? null;
}

/** Token del workspace segnalati come esposti, con la data della segnalazione. */
export async function getExposedIntegrationTokenIds(workspaceId: string): Promise<Map<string, Date>> {
  await ensureDbSchema();
  const rows = await db
    .select({ tokenId: workspaceIntegrationTokens.id, exposedAt: workspaceIntegrationTokens.exposedAt })
    .from(workspaceIntegrationTokens)
    .where(and(eq(workspaceIntegrationTokens.workspaceId, workspaceId), isNotNull(workspaceIntegrationTokens.exposedAt)));
  return new Map(rows.flatMap((r) => (r.exposedAt ? [[r.tokenId, r.exposedAt] as const] : [])));
}

/**
 * Configurazione del connettore per slug (lo slug non è un segreto), con `esg_enabled` del
 * workspace, il profilo del cliente e il modello delle istruzioni del server.
 */
export async function getConnectorConfigBySlug(slug: string): Promise<ConnectorConfigRow | null> {
  if (!isValidConnectorSlug(slug)) return null;
  await ensureDbSchema();
  const [row] = await db
    .select({
      workspaceId: workspaceConnectorConfigs.workspaceId,
      slug: workspaceConnectorConfigs.slug,
      enabled: workspaceConnectorConfigs.enabled,
      codePrefix: workspaceConnectorConfigs.codePrefix,
      identityMode: workspaceConnectorConfigs.identityMode,
      authMode: workspaceConnectorConfigs.authMode,
      workspaceDisplayName: workspaceConnectorConfigs.workspaceDisplayName,
      guide: workspaceConnectorConfigs.guide,
      guideVersion: workspaceConnectorConfigs.guideVersion,
      allowedOrigins: workspaceConnectorConfigs.allowedOrigins,
      limits: workspaceConnectorConfigs.limits,
      esgEnabled: workspaces.esgEnabled,
      // Profilo del cliente e modello delle istruzioni (coda della 0019, decisione 1 dell'arresto B).
      profile: workspaceConnectorConfigs.profile,
      instructionsTemplate: workspaceConnectorConfigs.instructionsTemplate,
    })
    .from(workspaceConnectorConfigs)
    .innerJoin(workspaces, eq(workspaces.id, workspaceConnectorConfigs.workspaceId))
    .where(eq(workspaceConnectorConfigs.slug, slug))
    .limit(1);
  return row ?? null;
}

export type ClaimExternalContributionResult =
  | { status: "claimed"; submission: ExternalContributionSubmission; takeover: boolean }
  | { status: "duplicate"; submission: ExternalContributionSubmission }
  | { status: "conflict"; submission: ExternalContributionSubmission }
  | { status: "in_progress"; retryAfterSeconds: number };

/**
 * Presa in carico idempotente per (workspace, principal, chiave), sicura con invii
 * concorrenti: mai un errore di unicità (quindi mai un 500).
 *  1. `INSERT … ON CONFLICT DO NOTHING RETURNING`: senza target, così fanno da
 *     arbitro sia l'indice nuovo (principal_key) sia quello vecchio (token). La riga
 *     nasce con `reserved_use_case_id` (id della futura segnalazione) e `attempt = 1`.
 *  2. Se la chiave esiste, rilettura e decisione (src/lib/portfolio/idempotency.ts).
 *  3. Ripresa di un invio `failed` o abbandonato (> 2 minuti), mai collegato a una
 *     segnalazione e scritto dal codice nuovo (`reserved_use_case_id` presente):
 *     UPDATE atomico condizionato che alza `attempt` e tiene lo stesso
 *     `reserved_use_case_id`. Se un'altra richiesta lo riprende prima, si rilegge.
 * Chi ottiene `claimed` possiede la riga per il suo `attempt`: chiusura e
 * fallimento (complete/fail) valgono solo per quel tentativo.
 */
export async function claimExternalContributionSubmission(params: {
  workspaceId: string;
  principalKey: string;
  integrationTokenId: string | null;
  idempotencyKey: string;
  requestHash: string;
}): Promise<ClaimExternalContributionResult> {
  await ensureDbSchema();
  const key = and(
    eq(externalContributionSubmissions.workspaceId, params.workspaceId),
    eq(externalContributionSubmissions.principalKey, params.principalKey),
    eq(externalContributionSubmissions.idempotencyKey, params.idempotencyKey)
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [inserted] = await db
      .insert(externalContributionSubmissions)
      .values({
        workspaceId: params.workspaceId,
        integrationTokenId: params.integrationTokenId,
        principalKey: params.principalKey,
        idempotencyKey: params.idempotencyKey,
        requestHash: params.requestHash,
        status: "pending",
        reservedUseCaseId: sql`gen_random_uuid()`,
        createdAt: utcNow,
        updatedAt: utcNow,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { status: "claimed", submission: inserted, takeover: false };

    const [existing] = await db
      .select({
        submission: externalContributionSubmissions,
        ageSeconds: sql<string>`extract(epoch from (${utcNow} - ${externalContributionSubmissions.updatedAt}))`,
      })
      .from(externalContributionSubmissions)
      .where(key)
      .limit(1);
    if (!existing) continue;

    const { submission } = existing;
    const decision = decideExistingSubmission(
      {
        status: submission.status,
        requestHash: submission.requestHash,
        useCaseId: submission.useCaseId,
        reservedUseCaseId: submission.reservedUseCaseId,
        ageSeconds: Number(existing.ageSeconds),
      },
      params.requestHash
    );
    if (decision.kind === "duplicate") return { status: "duplicate", submission };
    if (decision.kind === "conflict") return { status: "conflict", submission };
    if (decision.kind === "in_progress") {
      return { status: "in_progress", retryAfterSeconds: decision.retryAfterSeconds };
    }

    const [taken] = await db
      .update(externalContributionSubmissions)
      .set({
        status: "pending",
        errorCode: null,
        updatedAt: utcNow,
        attempt: sql`${externalContributionSubmissions.attempt} + 1`,
      })
      .where(
        and(
          eq(externalContributionSubmissions.id, submission.id),
          eq(externalContributionSubmissions.requestHash, params.requestHash),
          isNull(externalContributionSubmissions.useCaseId),
          isNotNull(externalContributionSubmissions.reservedUseCaseId),
          or(
            eq(externalContributionSubmissions.status, "failed"),
            and(
              eq(externalContributionSubmissions.status, "pending"),
              lt(
                externalContributionSubmissions.updatedAt,
                sql`${utcNow} - make_interval(secs => ${IDEMPOTENCY_STALE_AFTER_SECONDS})`
              )
            )
          )
        )
      )
      .returning();
    if (taken) return { status: "claimed", submission: taken, takeover: true };
  }

  return { status: "in_progress", retryAfterSeconds: 1 };
}

/**
 * Chiude la presa in carico collegando la segnalazione, solo se la riga è ancora
 * `pending` e appartiene a questo tentativo. `false`: un'altra richiesta l'ha
 * ripresa o chiusa nel frattempo (nessuna sovrascrittura).
 */
export async function completeExternalContributionSubmission(params: {
  submissionId: string;
  attempt: number;
  useCaseId: string;
}): Promise<boolean> {
  await ensureDbSchema();
  const rows = await db
    .update(externalContributionSubmissions)
    .set({
      status: "completed",
      useCaseId: params.useCaseId,
      errorCode: null,
      updatedAt: utcNow,
    })
    .where(
      and(
        eq(externalContributionSubmissions.id, params.submissionId),
        eq(externalContributionSubmissions.status, "pending"),
        eq(externalContributionSubmissions.attempt, params.attempt)
      )
    )
    .returning({ id: externalContributionSubmissions.id });
  return rows.length > 0;
}

/**
 * Segna il tentativo come fallito, solo se la riga è ancora `pending` e di questo
 * tentativo: una riga già completata o ripresa da altri non torna mai indietro.
 */
export async function failExternalContributionSubmission(params: {
  submissionId: string;
  attempt: number;
  errorCode: string;
}): Promise<boolean> {
  await ensureDbSchema();
  const rows = await db
    .update(externalContributionSubmissions)
    .set({
      status: "failed",
      errorCode: params.errorCode.slice(0, 100),
      updatedAt: utcNow,
    })
    .where(
      and(
        eq(externalContributionSubmissions.id, params.submissionId),
        eq(externalContributionSubmissions.status, "pending"),
        eq(externalContributionSubmissions.attempt, params.attempt)
      )
    )
    .returning({ id: externalContributionSubmissions.id });
  return rows.length > 0;
}

/** Stato attuale di una presa in carico, per decidere dopo un esito incerto. */
export async function readExternalContributionSubmission(submissionId: string) {
  await ensureDbSchema();
  const [row] = await db
    .select({
      status: externalContributionSubmissions.status,
      attempt: externalContributionSubmissions.attempt,
      useCaseId: externalContributionSubmissions.useCaseId,
    })
    .from(externalContributionSubmissions)
    .where(eq(externalContributionSubmissions.id, submissionId))
    .limit(1);
  return row ?? null;
}
