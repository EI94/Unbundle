/**
 * Solo per i test: nessun file dell'app lo importa. Un Granola finto su 127.0.0.1, con una porta libera
 * (RILASCIO-9a-COSTRUZIONE.md §8.10): il server di autorizzazione e il server MCP, senza rete e senza account veri.
 *
 * | Indirizzo finto | Che cosa fa |
 * |---|---|
 * | `/.well-known/oauth-authorization-server` | I metadati, con o senza `client_id_metadata_document_supported` |
 * | `/.well-known/oauth-protected-resource/mcp` | La risorsa protetta e i suoi scope (se ce ne sono) |
 * | `/oauth2/register` | Registra un cliente e conta le chiamate |
 * | `/oauth2/authorize` | Il reindirizzamento a `redirect_uri` con `code` e `state` (o `error=access_denied`) |
 * | `/oauth2/token` | Verifica PKCE S256; il codice vale una volta; il `refresh_token` cambia a ogni rinnovo; può rispondere `invalid_grant` |
 * | `/oauth2/revoke` | Registra il token revocato |
 * | `/mcp` | `initialize`, `tools/call` per i cinque strumenti, in JSON o in SSE; senza token 401 con `WWW-Authenticate`; può rispondere `rate_limit`; registra ogni strumento chiamato |
 *
 * I dati sono sintetici: nomi, aziende e indirizzi inventati. Il testo delle risposte ha la forma che il piano descrive
 * (`<meetings_data>`, `<meeting …>`, `<known_participants>`, `<summary>`, `<private_notes>`, `<pagination …/>`).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { GranolaEndpoints } from "./endpoints.ts";

export interface FakeMeeting {
  id: string;
  title: string;
  /** ISO. */
  meetingAt: string | null;
  /** ISO. */
  updatedAt: string | null;
  url?: string | null;
  /** Il testo di `<known_participants>`. */
  participants: string;
  summary?: string | null;
  privateNotes?: string | null;
  folderIds?: string[];
  transcript?: string | null;
  /** `search_meetings` la elenca, `get_meetings` non ne dà la nota (tolta nel frattempo, o non più condivisa). */
  noteless?: boolean;
}

export interface FakeToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface FakeMcpRequest {
  method: string;
  protocolVersion: string | null;
  sessionId: string | null;
}

export interface FakeGranola {
  /** `http://127.0.0.1:<porta>` */
  url: string;
  endpoints: GranolaEndpoints;
  meetings: FakeMeeting[];
  folders: Array<{ id: string; name: string }>;
  /** Le call future: compaiono in `<upcoming_meetings>`. */
  upcoming: FakeMeeting[];
  account: { email: string; plan: string };
  // Manopole.
  metadataDocumentSupported: boolean;
  sse: boolean;
  /** Le prossime risposte `rate_limit`, per strumento (o `*`). */
  rateLimits: Array<{ tool: string; seconds: number; retryable?: boolean }>;
  /** I prossimi errori 500, per strumento. */
  failures: string[];
  /** Il rinnovo risponde `invalid_grant`. */
  invalidGrant: boolean;
  /** Il consenso risponde `error=access_denied`. */
  denyConsent: boolean;
  /** Secondi di validità dell'access token. */
  expiresIn: number;
  /** Ritardo del server dei token, in millisecondi. */
  tokenDelayMs: number;
  /** `get_meetings` mette in `<omitted_meetings>` le call oltre questo numero. */
  notesPerResponse: number | null;
  // Registri.
  toolCalls: FakeToolCall[];
  mcpRequests: FakeMcpRequest[];
  tokenRequests: Array<{ grantType: string; clientId: string | null; resource: string | null; withVerifier: boolean }>;
  registrations: Array<Record<string, unknown>>;
  revoked: Array<{ token: string; hint: string | null; clientId: string | null }>;
  /** Ogni coppia di token data, in ordine: per controllare che nessuno finisca in chiaro nel database. */
  issued: Array<{ accessToken: string; refreshToken: string }>;
  /** Ogni richiesta ricevuta: metodo e percorso. */
  requests: Array<{ method: string; path: string }>;
  /** Ritardo del server MCP, in millisecondi. */
  mcpDelayMs: number;
  /** Ritardo di uno strumento, in millisecondi. */
  toolDelays: Record<string, number>;
  /** Fa scadere tutti gli access token: la prossima chiamata all'MCP risponde 401. */
  expireAccessTokens(): void;
  /** Token validi senza passare dal consenso (per i test del client MCP). */
  grant(clientId?: string): { access_token: string; refresh_token: string; expires_in: number };
  /** Vero se il token è un access token o un refresh token ancora valido. */
  isLive(token: string): boolean;
  /** La persona dice sì su Granola: segue l'indirizzo di autorizzazione e restituisce il reindirizzamento. */
  consent(authorizationUrl: string): Promise<URL>;
  close(): Promise<void>;
}

export const FAKE_READ_TOOLS = ["search_meetings", "get_meetings", "list_meeting_folders", "get_account_info", "get_meeting_transcript"] as const;

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

function meetingXml(meeting: FakeMeeting, withNote: boolean): string {
  const attrs = [
    `id="${escapeXml(meeting.id)}"`,
    `title="${escapeXml(meeting.title)}"`,
    meeting.meetingAt ? `meeting_at="${meeting.meetingAt}"` : "",
    meeting.updatedAt ? `updated_at="${meeting.updatedAt}"` : "",
    meeting.url ? `url="${escapeXml(meeting.url)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [`<meeting ${attrs}>`, `<known_participants total="1" omitted="0">${escapeXml(meeting.participants)}</known_participants>`];
  if (withNote) {
    if (meeting.summary) lines.push(`<summary>\n${escapeXml(meeting.summary)}\n</summary>`);
    lines.push(meeting.privateNotes ? `<private_notes>${escapeXml(meeting.privateNotes)}</private_notes>` : `<private_notes status="empty" />`);
  } else {
    lines.push("<note_headers>Sintesi</note_headers>");
  }
  lines.push("</meeting>");
  return lines.join("\n");
}

export async function startFakeGranola(seed: { meetings?: FakeMeeting[]; folders?: Array<{ id: string; name: string }>; metadataDocumentSupported?: boolean; resourceScopes?: string[] } = {}): Promise<FakeGranola> {
  const codes = new Map<string, { challenge: string; clientId: string; redirectUri: string; resource: string | null; used: boolean }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Map<string, { clientId: string }>();
  const sessions = new Set<string>();

  const fake: FakeGranola = {
    url: "",
    endpoints: null as unknown as GranolaEndpoints,
    meetings: seed.meetings ?? [],
    folders: seed.folders ?? [],
    upcoming: [],
    account: { email: "paola@ls.test", plan: "Business" },
    metadataDocumentSupported: seed.metadataDocumentSupported ?? true,
    sse: false,
    rateLimits: [],
    failures: [],
    invalidGrant: false,
    denyConsent: false,
    expiresIn: 3600,
    tokenDelayMs: 0,
    notesPerResponse: null,
    toolCalls: [],
    mcpRequests: [],
    tokenRequests: [],
    registrations: [],
    revoked: [],
    issued: [],
    requests: [],
    mcpDelayMs: 0,
    toolDelays: {},
    expireAccessTokens: () => accessTokens.clear(),
    grant: (clientId = "cliente-di-prova") => issue(clientId),
    isLive: (token) => accessTokens.has(token) || refreshTokens.has(token),
    consent: async (authorizationUrl) => {
      const response = await fetch(authorizationUrl, { redirect: "manual" });
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error(`il consenso finto non ha reindirizzato (${response.status})`);
      return new URL(location);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  const issue = (clientId: string) => {
    const accessToken = `at-${randomBytes(12).toString("hex")}`;
    const refreshToken = `rt-${randomBytes(12).toString("hex")}`;
    accessTokens.add(accessToken);
    refreshTokens.set(refreshToken, { clientId });
    fake.issued.push({ accessToken, refreshToken });
    return { access_token: accessToken, token_type: "Bearer", expires_in: fake.expiresIn, refresh_token: refreshToken, scope: "openid email profile offline_access" };
  };

  // ─── Strumenti ──────────────────────────────────────────────────────

  const tools: Record<string, (args: Record<string, unknown>) => { text: string; isError?: boolean }> = {
    search_meetings(args) {
      const limit = Math.min(Number(args.limit ?? 30) || 30, 100);
      const offset = Number(args.cursor ?? 0) || 0;
      const day = (iso: string | null) => (iso ?? "").slice(0, 10);
      let list = fake.meetings.slice();
      if (typeof args.folder_id === "string") list = list.filter((m) => (m.folderIds ?? []).includes(args.folder_id as string));
      if (typeof args.from_date === "string") list = list.filter((m) => day(m.meetingAt) >= (args.from_date as string));
      if (typeof args.to_date === "string") list = list.filter((m) => day(m.meetingAt) <= (args.to_date as string));
      if (typeof args.updated_after === "string") {
        const after = new Date(args.updated_after as string).getTime();
        list = list.filter((m) => m.updatedAt !== null && new Date(m.updatedAt).getTime() > after);
      }
      list.sort((a, b) => (b.meetingAt ?? "").localeCompare(a.meetingAt ?? ""));
      const page = list.slice(offset, offset + limit);
      const next = offset + limit < list.length ? String(offset + limit) : null;
      const upcoming =
        fake.upcoming.length && typeof args.to_date === "string"
          ? `<upcoming_meetings>\n${fake.upcoming.map((m) => meetingXml(m, false)).join("\n")}\n</upcoming_meetings>\n`
          : "";
      const pagination = next ? `<pagination has_more="true" next_cursor="${next}" />` : `<pagination has_more="false" />`;
      return { text: `<meetings_data>\n${upcoming}${page.map((m) => meetingXml(m, false)).join("\n")}\n${pagination}\n</meetings_data>` };
    },
    get_meetings(args) {
      const ids = Array.isArray(args.meeting_ids) ? (args.meeting_ids as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 10) : [];
      const found = ids.map((id) => fake.meetings.find((m) => m.id === id && !m.noteless)).filter((m): m is FakeMeeting => m !== undefined);
      const keep = fake.notesPerResponse === null ? found : found.slice(0, fake.notesPerResponse);
      const omitted = found.slice(keep.length);
      const omittedXml = omitted.length ? `\n<omitted_meetings>\n${omitted.map((m) => `<meeting id="${escapeXml(m.id)}" title="${escapeXml(m.title)}" />`).join("\n")}\n</omitted_meetings>` : "";
      return { text: `<meetings_data>\n${keep.map((m) => meetingXml(m, true)).join("\n")}${omittedXml}\n</meetings_data>` };
    },
    list_meeting_folders() {
      return { text: `<folders>\n${fake.folders.map((f) => `<folder id="${escapeXml(f.id)}" name="${escapeXml(f.name)}" />`).join("\n")}\n</folders>` };
    },
    get_account_info() {
      return { text: JSON.stringify({ email: fake.account.email, plan: fake.account.plan }) };
    },
    get_meeting_transcript(args) {
      if (/free/i.test(fake.account.plan)) return { text: "Transcripts need a paid Granola plan.", isError: true };
      const meeting = fake.meetings.find((m) => m.id === args.meeting_id);
      if (!meeting?.transcript) return { text: JSON.stringify({ transcript: null, transcript_unavailable: { reason: "no_transcript" } }) };
      const maxChars = Math.max(1000, Number(args.max_chars ?? 40000) || 40000);
      const offset = Number(args.offset ?? 0) || 0;
      const slice = meeting.transcript.slice(offset, offset + maxChars);
      const next = offset + maxChars < meeting.transcript.length ? offset + maxChars : null;
      return { text: JSON.stringify({ transcript: slice, total_chars: meeting.transcript.length, truncated: next !== null, next_offset: next }) };
    },
  };

  // ─── MCP ────────────────────────────────────────────────────────────

  async function mcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (fake.mcpDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.mcpDelayMs));
    const auth = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
    if (!auth || !accessTokens.has(auth)) {
      response.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${fake.url}/.well-known/oauth-protected-resource/mcp"` });
      response.end();
      return;
    }
    const message = JSON.parse(await body(request)) as { id?: number; method: string; params?: Record<string, unknown> };
    fake.mcpRequests.push({
      method: message.method,
      protocolVersion: (request.headers["mcp-protocol-version"] as string | undefined) ?? null,
      sessionId: (request.headers["mcp-session-id"] as string | undefined) ?? null,
    });
    if (message.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    let result: unknown = null;
    let error: unknown = null;
    const headers: Record<string, string> = {};
    if (message.method === "initialize") {
      const sessionId = randomUUID();
      sessions.add(sessionId);
      headers["Mcp-Session-Id"] = sessionId;
      result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "granola-finto", version: "0.0.1" } };
    } else if (message.method === "tools/call") {
      const name = String(message.params?.name ?? "");
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      fake.toolCalls.push({ tool: name, args });
      if (fake.toolDelays[name]) await new Promise((resolve) => setTimeout(resolve, fake.toolDelays[name]));
      const failure = fake.failures.indexOf(name);
      if (failure >= 0) {
        fake.failures.splice(failure, 1);
        response.writeHead(500);
        response.end();
        return;
      }
      const limited = fake.rateLimits.findIndex((r) => r.tool === name || r.tool === "*");
      if (!(FAKE_READ_TOOLS as readonly string[]).includes(name)) {
        error = { code: -32602, message: `Unknown tool: ${name}` };
      } else if (limited >= 0) {
        const [limit] = fake.rateLimits.splice(limited, 1);
        result = { content: [{ type: "text", text: JSON.stringify({ error: "rate_limit", retry_after_seconds: limit.seconds, retryable: limit.retryable ?? true }) }], isError: true };
      } else {
        const out = tools[name](args);
        result = { content: [{ type: "text", text: out.text }], isError: out.isError === true };
      }
    } else {
      error = { code: -32601, message: "Method not found" };
    }
    const reply = error ? { jsonrpc: "2.0", id: message.id, error } : { jsonrpc: "2.0", id: message.id, result };
    if (fake.sse) {
      response.writeHead(200, { "Content-Type": "text/event-stream", ...headers });
      response.write(": in ascolto\n\n");
      response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "lavoro" } })}\n\n`);
      response.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      response.end();
      return;
    }
    json(response, 200, reply, headers);
  }

  // ─── OAuth ──────────────────────────────────────────────────────────

  async function token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (fake.tokenDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.tokenDelayMs));
    const form = new URLSearchParams(await body(request));
    const grantType = form.get("grant_type") ?? "";
    const clientId = form.get("client_id");
    fake.tokenRequests.push({ grantType, clientId, resource: form.get("resource"), withVerifier: form.has("code_verifier") });
    if (grantType === "authorization_code") {
      const entry = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const valid =
        entry &&
        !entry.used &&
        entry.clientId === clientId &&
        entry.redirectUri === form.get("redirect_uri") &&
        entry.resource === form.get("resource") &&
        challengeOf(verifier) === entry.challenge;
      if (entry) entry.used = true;
      if (!valid) return json(response, 400, { error: "invalid_grant", error_description: "codice o verifier sbagliati" });
      return json(response, 200, issue(clientId ?? ""));
    }
    if (grantType === "refresh_token") {
      const current = refreshTokens.get(form.get("refresh_token") ?? "");
      if (fake.invalidGrant || !current || current.clientId !== clientId) return json(response, 400, { error: "invalid_grant", error_description: "rinnovo rifiutato" });
      refreshTokens.delete(form.get("refresh_token") ?? "");
      return json(response, 200, issue(clientId ?? ""));
    }
    return json(response, 400, { error: "unsupported_grant_type" });
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    fake.requests.push({ method: request.method ?? "GET", path: url.pathname });
    const handle = async () => {
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return json(response, 200, {
          issuer: fake.url,
          authorization_endpoint: `${fake.url}/oauth2/authorize`,
          token_endpoint: `${fake.url}/oauth2/token`,
          revocation_endpoint: `${fake.url}/oauth2/revoke`,
          registration_endpoint: `${fake.url}/oauth2/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["openid", "email", "profile", "offline_access", ...(seed.resourceScopes ?? [])],
          client_id_metadata_document_supported: fake.metadataDocumentSupported,
        });
      }
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        if (!seed.resourceScopes?.length) return json(response, 404, { error: "not_found" });
        return json(response, 200, { resource: `${fake.url}/mcp`, authorization_servers: [fake.url], scopes_supported: seed.resourceScopes });
      }
      if (url.pathname === "/oauth2/register" && request.method === "POST") {
        const metadata = JSON.parse(await body(request)) as Record<string, unknown>;
        fake.registrations.push(metadata);
        return json(response, 201, { ...metadata, client_id: `dcr-${randomUUID()}` });
      }
      if (url.pathname === "/oauth2/authorize") {
        const p = url.searchParams;
        const redirect = new URL(p.get("redirect_uri") ?? "http://127.0.0.1/");
        if (p.get("state")) redirect.searchParams.set("state", p.get("state") ?? "");
        if (fake.denyConsent) {
          redirect.searchParams.set("error", "access_denied");
        } else {
          if (p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge") || !p.get("client_id")) {
            return json(response, 400, { error: "invalid_request" });
          }
          const code = `code-${randomBytes(8).toString("hex")}`;
          codes.set(code, { challenge: p.get("code_challenge") ?? "", clientId: p.get("client_id") ?? "", redirectUri: p.get("redirect_uri") ?? "", resource: p.get("resource"), used: false });
          redirect.searchParams.set("code", code);
        }
        response.writeHead(302, { Location: redirect.toString() });
        response.end();
        return;
      }
      if (url.pathname === "/oauth2/token" && request.method === "POST") return token(request, response);
      if (url.pathname === "/oauth2/revoke" && request.method === "POST") {
        const form = new URLSearchParams(await body(request));
        const revokedToken = form.get("token") ?? "";
        fake.revoked.push({ token: revokedToken, hint: form.get("token_type_hint"), clientId: form.get("client_id") });
        accessTokens.delete(revokedToken);
        refreshTokens.delete(revokedToken);
        response.writeHead(200);
        response.end();
        return;
      }
      if (url.pathname === "/mcp" && request.method === "POST") return mcp(request, response);
      json(response, 404, { error: "not_found" });
    };
    handle().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  fake.url = `http://127.0.0.1:${port}`;
  fake.endpoints = {
    resource: `${fake.url}/mcp`,
    issuer: fake.url,
    authorization: `${fake.url}/oauth2/authorize`,
    token: `${fake.url}/oauth2/token`,
    revocation: `${fake.url}/oauth2/revoke`,
    registration: `${fake.url}/oauth2/register`,
    metadataDocumentSupported: fake.metadataDocumentSupported,
    scopesSupported: ["openid", "email", "profile", "offline_access"],
  };
  return fake;
}
