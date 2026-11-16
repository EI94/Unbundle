/**
 * Gli indirizzi di Granola (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.2). È l'unico file di `src/` dove
 * compare il dominio di Granola: lo controlla src/lib/context/source-rules.test.ts. I test non usano mai questi
 * indirizzi: passano quelli del server finto (`fake-granola.ts`, su 127.0.0.1).
 *
 * Granola pubblica i suoi dati OAuth (RFC 8414): `discoverGranola` li rilegge e aggiorna gli indirizzi, ma solo se
 * l'emittente è quello atteso e ogni indirizzo è https sullo stesso host (http solo in locale, per il server finto).
 * Altrimenti, o se la lettura non riesce, restano le costanti qui sotto.
 * Modulo puro (la `fetch` arriva da fuori).
 */

export interface GranolaEndpoints {
  /** La risorsa protetta: il server MCP. */
  resource: string;
  /** Il server di autorizzazione. */
  issuer: string;
  authorization: string;
  token: string;
  revocation: string;
  registration: string;
  /** Granola accetta un `client_id` che è l'indirizzo di un documento di metadati (`client_id_metadata_document_supported`). */
  metadataDocumentSupported: boolean;
  scopesSupported: string[];
  /** Gli scope che la risorsa protetta dichiara (RFC 9728), tra quelli che il server di autorizzazione elenca. */
  resourceScopes?: string[];
}

const ISSUER = "https://mcp-auth.granola.ai";

export const GRANOLA_ENDPOINTS: GranolaEndpoints = Object.freeze({
  resource: "https://mcp.granola.ai/mcp",
  issuer: ISSUER,
  authorization: `${ISSUER}/oauth2/authorize`,
  token: `${ISSUER}/oauth2/token`,
  revocation: `${ISSUER}/oauth2/revoke`,
  registration: `${ISSUER}/oauth2/register`,
  metadataDocumentSupported: true,
  scopesSupported: Object.freeze(["openid", "email", "profile", "offline_access"]) as unknown as string[],
});

const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const SCOPE = /^[A-Za-z0-9:._/-]{1,60}$/;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;

/** I dati letti, per emittente, per un'ora. */
const cache = new Map<string, { at: number; endpoints: GranolaEndpoints }>();

/** Dimentica i dati letti (per i test). */
export function forgetGranolaDiscovery(): void {
  cache.clear();
}

/** Un indirizzo valido sullo stesso host di `host`: https, o http in locale. */
function sameHostUrl(value: unknown, host: string): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.host !== host) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname))) return url.href;
    return null;
  } catch {
    return null;
  }
}

/** Una lista di scope dichiarata: solo stringhe con una forma sicura, al massimo 20. */
function scopeList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((s): s is string => typeof s === "string" && SCOPE.test(s)))].slice(0, 20);
}

async function readJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 100_000) return null;
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Gli scope della risorsa protetta (RFC 9728): `/.well-known/oauth-protected-resource` con il percorso della risorsa,
 * poi senza. Valgono solo se il documento parla di quella risorsa e di quell'emittente.
 */
async function readResourceScopes(fetchImpl: typeof fetch, base: GranolaEndpoints): Promise<string[]> {
  let resource: URL;
  try {
    resource = new URL(base.resource);
  } catch {
    return [];
  }
  const path = resource.pathname === "/" ? "" : resource.pathname.replace(/\/$/, "");
  for (const candidate of [`${resource.origin}/.well-known/oauth-protected-resource${path}`, `${resource.origin}/.well-known/oauth-protected-resource`]) {
    const json = await readJson(fetchImpl, candidate);
    if (!json) continue;
    const servers = Array.isArray(json.authorization_servers) ? json.authorization_servers : [];
    const sameResource = typeof json.resource === "string" && json.resource.replace(/\/$/, "") === base.resource.replace(/\/$/, "");
    if (!sameResource || !servers.some((s) => typeof s === "string" && s.replace(/\/$/, "") === base.issuer.replace(/\/$/, ""))) return [];
    return scopeList(json.scopes_supported) ?? [];
  }
  return [];
}

/**
 * Legge `issuer + "/.well-known/oauth-authorization-server"` (5 secondi, in memoria per un'ora) e aggiorna gli
 * indirizzi, `metadataDocumentSupported` e `scopesSupported`; in più gli scope della risorsa protetta. Vale solo se
 * `issuer` è quello atteso e ogni indirizzo è https sullo stesso host: altrimenti, o se la lettura non riesce,
 * restano le costanti.
 */
export async function discoverGranola(deps: { fetch: typeof fetch; base?: GranolaEndpoints; now?: () => number }): Promise<GranolaEndpoints> {
  const base = deps.base ?? GRANOLA_ENDPOINTS;
  const now = deps.now ?? Date.now;
  const cached = cache.get(base.issuer);
  if (cached && now() - cached.at < DISCOVERY_TTL_MS) return cached.endpoints;
  let host: string;
  try {
    host = new URL(base.issuer).host;
  } catch {
    return base;
  }
  const json = await readJson(deps.fetch, `${base.issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`);
  let found: GranolaEndpoints = base;
  if (json && typeof json.issuer === "string" && json.issuer.replace(/\/$/, "") === base.issuer.replace(/\/$/, "")) {
    const authorization = sameHostUrl(json.authorization_endpoint, host);
    const token = sameHostUrl(json.token_endpoint, host);
    const revocation = json.revocation_endpoint === undefined ? base.revocation : sameHostUrl(json.revocation_endpoint, host);
    const registration = json.registration_endpoint === undefined ? base.registration : sameHostUrl(json.registration_endpoint, host);
    const methods = Array.isArray(json.code_challenge_methods_supported) ? json.code_challenge_methods_supported : null;
    if (authorization && token && revocation && registration && (methods === null || methods.includes("S256"))) {
      found = {
        ...base,
        authorization,
        token,
        revocation,
        registration,
        metadataDocumentSupported: json.client_id_metadata_document_supported === true,
        scopesSupported: scopeList(json.scopes_supported) ?? base.scopesSupported,
      };
    }
  }
  const resourceScopes = await readResourceScopes(deps.fetch, found);
  const endpoints: GranolaEndpoints = resourceScopes.length > 0 ? { ...found, resourceScopes } : found;
  // Solo una lettura riuscita resta in memoria: se Granola non risponde si riprova alla prossima richiesta.
  if (found !== base) cache.set(base.issuer, { at: now(), endpoints });
  return endpoints;
}
