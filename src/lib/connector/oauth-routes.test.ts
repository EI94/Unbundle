import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CONNECTOR_PUBLIC_ORIGIN, resourceMetadataUrl } from "./auth.ts";

// Fase 2 (OAuth, prompt WP11, pacchetto K11): le rotte non si creano ora, ma niente nel
// proxy né in next.config.ts deve bloccarle (docs/connettore/OAUTH-FASE2.md §17). Il
// matcher del proxy e i redirect si valutano con le funzioni di Next stesso, come fa la
// build: nessuna rete, nessun database.

const root = new URL("../../../", import.meta.url);
const requireNext = createRequire(new URL("package.json", root));

type Matcher = { regexp: string };
type HasItem = { type: string; key?: string; value?: string };
type Redirect = { source: string; destination: string; permanent?: boolean; statusCode?: number; has?: HasItem[]; missing?: HasItem[] };
type HeaderRule = { source: string; headers: { key: string; value: string }[]; has?: HasItem[]; missing?: HasItem[] };

const { getMiddlewareMatchers } = requireNext("next/dist/build/analysis/get-page-static-info.js") as {
  getMiddlewareMatchers: (matchers: unknown, nextConfig: Record<string, unknown>) => Matcher[];
};
const { getPathMatch } = requireNext("next/dist/shared/lib/router/utils/path-match.js") as {
  getPathMatch: (source: string, opts: Record<string, unknown>) => (pathname: string) => false | Record<string, string | string[]>;
};
const { matchHas } = requireNext("next/dist/shared/lib/router/utils/prepare-destination.js") as {
  matchHas: (req: { headers: Record<string, string> }, query: Record<string, string>, has?: HasItem[], missing?: HasItem[]) => false | Record<string, string>;
};

const SLUG = "alfa-beta";
const WWW_HOST = new URL(CONNECTOR_PUBLIC_ORIGIN).host;
const APEX_HOST = WWW_HOST.replace(/^www\./, "");

/** I percorsi della fase 2 (OAUTH-FASE2.md §3), più la rotta del connettore che li annuncia. */
const OAUTH_PATHS = [
  new URL(resourceMetadataUrl(SLUG)).pathname,
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
  "/api/oauth/authorize",
  "/api/oauth/authorize/complete",
  "/api/oauth/token",
  "/api/oauth/register",
  "/connettore/accesso",
  `/api/mcp/connettore/${SLUG}`,
];

/** Il matcher di `src/proxy.ts`, letto dal sorgente come lo legge Next (un valore costante). */
function proxyMatchers(): unknown {
  const source = readFileSync(new URL("src/proxy.ts", root), "utf8");
  const found = /export const config = \{\s*matcher:\s*(\[[\s\S]*?\])\s*,?\s*\}/.exec(source);
  assert.ok(found, "src/proxy.ts: export const config = { matcher: [...] } non trovato; aggiorna la lettura in questo test");
  try {
    return JSON.parse(found[1].replace(/,\s*\]$/, "]"));
  } catch {
    assert.fail("src/proxy.ts: il matcher non è più un elenco di stringhe; aggiorna la lettura in questo test");
  }
}

async function nextConfig(): Promise<{ redirects: () => Promise<Redirect[]>; headers: () => Promise<HeaderRule[]>; rewrites?: unknown }> {
  const { default: config } = await import(new URL("next.config.ts", root).href);
  return config;
}

/** I redirect di next.config.ts che valgono per una richiesta a questo host e percorso. */
function applicableRedirects(redirects: Redirect[], host: string, pathname: string) {
  return redirects.flatMap((redirect) => {
    const params = getPathMatch(redirect.source, { removeUnnamedParams: true, strict: true })(pathname);
    if (!params) return [];
    const hasParams = matchHas({ headers: { host } }, {}, redirect.has, redirect.missing);
    if (!hasParams) return [];
    const all = { ...params, ...hasParams } as Record<string, string>;
    const destination = redirect.destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => all[name] ?? `:${name}`);
    return [{ redirect, destination }];
  });
}

test("il matcher del proxy non tocca i percorsi OAuth di fase 2", () => {
  const compiled = getMiddlewareMatchers(proxyMatchers(), {});
  const matches = (path: string) => compiled.some((m) => new RegExp(m.regexp).test(path));
  // Controllo: il matcher compilato funziona.
  assert.equal(matches("/dashboard/00000000-0000-0000-0000-000000000000"), true);
  assert.equal(matches("/login"), true);
  for (const path of OAUTH_PATHS) assert.equal(matches(path), false, path);
});

test("next.config.ts: nessun redirect sull'host con www; senza www un solo 308 verso lo stesso percorso su www", async () => {
  const config = await nextConfig();
  assert.equal(config.rewrites, undefined, "un rewrite va controllato contro i percorsi OAuth (OAUTH-FASE2.md §17)");
  const redirects = await config.redirects();
  for (const path of OAUTH_PATHS) {
    assert.deepEqual(applicableRedirects(redirects, WWW_HOST, path), [], `${WWW_HOST}${path}`);
    const apex = applicableRedirects(redirects, APEX_HOST, path);
    assert.equal(apex.length, 1, `${APEX_HOST}${path}`);
    assert.equal(apex[0].redirect.permanent, true, `${APEX_HOST}${path}: 308, che mantiene metodo e corpo delle POST`);
    assert.equal(apex[0].redirect.statusCode, undefined);
    assert.equal(apex[0].destination, `${CONNECTOR_PUBLIC_ORIGIN}${path}`, `${APEX_HOST}${path}`);
  }
});

// ─── Content-Security-Policy compatibile con la pagina di accesso ───────────
//
// Una CSP sui percorsi OAuth non è un problema in sé: sulle risposte JSON (metadati, token,
// registrazione, rotta MCP) non governa nulla, e sulla pagina di accesso è un rinforzo
// previsto (OAUTH-FASE2.md §9.6). Il test controlla solo che, se una CSP arriva alla
// pagina, lasci passare ciò che l'SDK di Firebase Auth carica da altri siti.

/** Pagina di accesso (OAUTH-FASE2.md §3.4, §9). */
const ACCESS_PAGE = "/connettore/accesso";
/**
 * Dominio di autenticazione del progetto Firebase del connettore: un segnaposto finché il
 * progetto non c'è (§9.4). Con un dominio vero nella CSP, va scritto qui (non è un segreto).
 */
const FIREBASE_AUTH_DOMAIN = "esempio-connettore.firebaseapp.com";

/** Cosa l'SDK di Firebase Auth installato (`@firebase/auth` 1.13) chiede alla pagina, per direttiva. */
const ACCESS_PAGE_NEEDS: { directive: "connect-src" | "script-src-elem" | "frame-src"; url: string }[] = [
  { directive: "connect-src", url: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp" },
  { directive: "connect-src", url: "https://securetoken.googleapis.com/v1/token" },
  { directive: "script-src-elem", url: "https://apis.google.com/js/api.js" },
  { directive: "frame-src", url: `https://${FIREBASE_AUTH_DOMAIN}/__/auth/iframe` },
];

/** Direttive di ripiego (CSP livello 3): la prima presente decide. */
const FALLBACKS: Record<string, string[]> = {
  "connect-src": ["connect-src", "default-src"],
  "script-src-elem": ["script-src-elem", "script-src", "default-src"],
  "frame-src": ["frame-src", "child-src", "default-src"],
};

function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" };

/** Vero se una sorgente della CSP lascia passare l'URL (sottoinsieme di CSP 3 che basta qui). */
function sourceAllows(source: string, url: URL, self: URL, directive: string): boolean {
  const lower = source.toLowerCase();
  if (lower === "*") return ["http:", "https:", "ws:", "wss:"].includes(url.protocol);
  if (lower === "'self'") return url.origin === self.origin;
  // Con 'strict-dynamic' uno script inserito da uno script già ammesso passa: l'SDK di Firebase
  // carica così il suo script.
  if (lower === "'strict-dynamic'") return directive === "script-src-elem";
  if (lower.startsWith("'")) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):$/.exec(lower);
  if (scheme) return url.protocol === lower || (lower === "http:" && url.protocol === "https:");
  const host = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^:/]+|[^:/*]+)(?::(\d+|\*))?(\/.*)?$/.exec(lower);
  if (!host) return false;
  const [, sourceScheme, sourceHost, sourcePort, sourcePath] = host;
  const protocol = sourceScheme ? `${sourceScheme}:` : self.protocol;
  if (!(url.protocol === protocol || (protocol === "http:" && url.protocol === "https:"))) return false;
  const urlHost = url.hostname.toLowerCase();
  if (sourceHost === "*") {
    // qualsiasi host
  } else if (sourceHost.startsWith("*.")) {
    if (!urlHost.endsWith(sourceHost.slice(1))) return false;
  } else if (urlHost !== sourceHost) return false;
  const urlPort = url.port || DEFAULT_PORT[url.protocol];
  if (sourcePort !== "*" && urlPort !== (sourcePort ?? DEFAULT_PORT[url.protocol])) return false;
  if (sourcePath) return sourcePath.endsWith("/") ? url.pathname.startsWith(sourcePath) : url.pathname === sourcePath;
  return true;
}

/** Ciò che la CSP blocca fra le necessità della pagina di accesso (vuoto = compatibile). */
function blockedAccessPageNeeds(policy: string): string[] {
  const directives = parsePolicy(policy);
  const self = new URL(CONNECTOR_PUBLIC_ORIGIN);
  return ACCESS_PAGE_NEEDS.flatMap(({ directive, url }) => {
    const governing = FALLBACKS[directive].find((name) => directives.has(name));
    if (!governing) return [];
    const sources = directives.get(governing) ?? [];
    return sources.some((source) => sourceAllows(source, new URL(url), self, directive)) ? [] : [`${governing} → ${url}`];
  });
}

/** Le intestazioni di next.config.ts per questo percorso sull'host con www (l'ultima regola vince). */
function headersFor(rules: HeaderRule[], path: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const rule of rules) {
    if (!getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(path)) continue;
    if (!matchHas({ headers: { host: WWW_HOST } }, {}, rule.has, rule.missing)) continue;
    for (const h of rule.headers) headers.set(h.key.toLowerCase(), h.value);
  }
  return headers;
}

test("il controllo della CSP riconosce una CSP che blocca Firebase Auth e una che lo lascia passare", () => {
  // La CSP prevista per la pagina di accesso (OAUTH-FASE2.md §9.6).
  const planned = [
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    `frame-src https://${FIREBASE_AUTH_DOMAIN}`,
  ].join("; ");
  assert.deepEqual(blockedAccessPageNeeds(planned), []);
  assert.deepEqual(blockedAccessPageNeeds("connect-src https:; frame-src https://*.firebaseapp.com; script-src 'nonce-abc' 'strict-dynamic'"), []);
  assert.deepEqual(blockedAccessPageNeeds("frame-ancestors 'none'"), []);
  // Una CSP stretta senza le sorgenti di Firebase: tutto bloccato.
  assert.equal(blockedAccessPageNeeds("default-src 'self'").length, ACCESS_PAGE_NEEDS.length);
  // La CSP dei link personali dei Casi d'uso non va bene per la pagina di accesso.
  assert.deepEqual(blockedAccessPageNeeds("connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com"), [
    "connect-src → https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp",
    "connect-src → https://securetoken.googleapis.com/v1/token",
  ]);
  assert.deepEqual(blockedAccessPageNeeds("connect-src *.googleapis.com; frame-src 'none'; script-src-elem https://apis.google.com:8443"), [
    "script-src-elem → https://apis.google.com/js/api.js",
    `frame-src → https://${FIREBASE_AUTH_DOMAIN}/__/auth/iframe`,
  ]);
  assert.equal(blockedAccessPageNeeds("connect-src https://googleapis.com").length, 2, "*.dominio non è il dominio stesso");
  // Le regole di next.config: una CSP globale arriva alla pagina; una regola della pagina, dopo, la sostituisce.
  const global: HeaderRule = { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'" }] };
  const page: HeaderRule = { source: ACCESS_PAGE, headers: [{ key: "Content-Security-Policy", value: planned }] };
  assert.equal(headersFor([global], ACCESS_PAGE).get("content-security-policy"), "default-src 'self'");
  assert.equal(headersFor([global, page], ACCESS_PAGE).get("content-security-policy"), planned);
});

test("next.config.ts: le intestazioni globali arrivano ai percorsi OAuth e una CSP non blocca la pagina di accesso", async () => {
  const rules = await (await nextConfig()).headers();
  assert.ok(OAUTH_PATHS.includes(ACCESS_PAGE));
  for (const path of OAUTH_PATHS) {
    const headers = headersFor(rules, path);
    assert.ok(headers.has("strict-transport-security"), `${path}: le intestazioni globali arrivano`);
    const policy = headers.get("content-security-policy");
    // Sulle risposte JSON una CSP non governa nulla: si controlla solo la pagina.
    if (path === ACCESS_PAGE && policy) {
      assert.deepEqual(blockedAccessPageNeeds(policy), [], `${path}: la CSP blocca l'SDK di Firebase Auth (OAUTH-FASE2.md §9.6)`);
    }
  }
});
