/**
 * `connector-admin token --workspace <id> [--label <nome>]` (prompt WP8): crea un token del
 * connettore e lo stampa **una sola volta**, nell'uscita di `--apply`. Serve quando la
 * scheda «Connettore Claude» non si può usare; le regole sono le stesse della scheda
 * (`createConnectorIntegrationToken`): `provider = claude_connector`, i due scope
 * `connector:read` e `connector:submit`, scadenza a 90 giorni, in tabella solo l'hash
 * SHA-256 e l'inizio del token. Nessun creatore (`created_by_user_id` vuoto): è lo script.
 *
 * Creare un token non revoca i precedenti. Il token va nel connettore come header
 * `Authorization: Bearer <token>`: mai in un indirizzo, in chat o in un file. La prova a
 * secco non genera nulla: dice nome, scope, scadenza e cosa manca ancora. Dopo l'INSERT il
 * token esce sempre: se la rilettura della prontezza fallisce, `prontezza` è null con un
 * avviso, mai un errore senza il token.
 */
import { randomBytes } from "node:crypto";
import { CONNECTOR_PROVIDER, CONNECTOR_SCOPES, CONNECTOR_TOKEN_PREFIX, CONNECTOR_TOKEN_TTL_DAYS, hashIntegrationToken } from "../auth.ts";
import { CONNECTOR_TOKEN_DEFAULT_LABEL } from "../settings-view.ts";
import { AdminStop, done, DRY_RUN_NOTE, type AdminCommand } from "./cli.ts";
import { readiness, readWorkspace, requireConfigRow, requireSchema } from "./state.ts";

/** Un segreto nuovo, nella forma dei token di workspace (`ub_mcp_…`). */
export function newConnectorTokenSecret(): string {
  return `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Inizio del token mostrato nelle liste (come `createWorkspaceIntegrationToken`). */
export function connectorTokenPrefix(token: string): string {
  return `${token.slice(0, 14)}...`;
}

export const INSERT_TOKEN_SQL = `INSERT INTO workspace_integration_tokens
  (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, expires_at)
VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, NULL, (now() AT TIME ZONE 'UTC') + make_interval(days => $7::int))
RETURNING id::text AS id, to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`;

function labelOf(value: string | null): string {
  const label = (value ?? CONNECTOR_TOKEN_DEFAULT_LABEL).replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > 80 || /[\p{Cc}\p{Cf}]/u.test(label)) {
    throw new AdminStop("label", "--label: da 2 a 80 caratteri, su una riga.");
  }
  return label;
}

export const command: AdminCommand = {
  name: "token",
  options: { values: ["label"] },
  async run(ctx) {
    await requireSchema(ctx.db);
    const label = labelOf(ctx.value("label"));
    const workspace = await readWorkspace(ctx.db, ctx.workspaceId);
    const row = await requireConfigRow(ctx.db, ctx.workspaceId);
    const before = await readiness(ctx.db, ctx.workspaceId, row);
    const plan = {
      workspace: { id: workspace.id, nome: workspace.name },
      token: { nome: label, provider: CONNECTOR_PROVIDER, scope: [...CONNECTOR_SCOPES], scadenza: `${CONNECTOR_TOKEN_TTL_DAYS} giorni dalla creazione` },
      tokenAttiviPrima: before.tokenAttivi,
      avvisi: [
        "Il token si vede una sola volta, nell'uscita di --apply: copialo subito nel connettore (Authorization: Bearer <token>), mai in un indirizzo, in chat o in un file.",
        "Creare un token non revoca i precedenti: la revoca si fa dalla scheda «Connettore Claude».",
        ...before.mancano.filter((m) => !m.startsWith("token")).map((m) => `Manca ancora: ${m}. Senza, la rotta risponde 500.`),
      ],
    };
    if (!ctx.apply) return done({ status: "DRY_RUN", message: DRY_RUN_NOTE, ...plan });
    ctx.print({ status: "PLAN", command: ctx.command, ...plan });
    const token = ctx.newTokenSecret();
    const [inserted = []] = await ctx.db.write([
      {
        text: INSERT_TOKEN_SQL,
        params: [ctx.workspaceId, label, CONNECTOR_PROVIDER, hashIntegrationToken(token), connectorTokenPrefix(token), JSON.stringify([...CONNECTOR_SCOPES]), CONNECTOR_TOKEN_TTL_DAYS],
      },
    ]);
    const created = inserted[0];
    if (!created) throw new AdminStop("token", "Token non creato.");
    // Da qui il token esiste nel database: deve uscire comunque, anche se la rilettura della
    // prontezza fallisce (altrimenti resterebbe attivo per 90 giorni senza che nessuno lo veda).
    const applied = {
      status: "APPLIED" as const,
      message: "Token creato. È l'unica volta che si vede: copialo ora nel connettore come header Authorization: Bearer <token>.",
      token,
      tokenId: String(created.id),
      inizio: connectorTokenPrefix(token),
      scadenza: String(created.expires_at),
    };
    try {
      return done({ ...applied, prontezza: await readiness(ctx.db, ctx.workspaceId, row) });
    } catch {
      return done({ ...applied, prontezza: null, avvisi: ["Token creato, ma la prontezza non si è potuta rileggere: rilancia a secco per vederla."] });
    }
  },
};
