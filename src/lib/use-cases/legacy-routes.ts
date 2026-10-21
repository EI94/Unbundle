/**
 * Vecchi indirizzi dell'area «Use case» e dove portano (docs/use-case/DESIGN.md §2.3, §2.4;
 * PIANO-LAVORI §5.5; D1).
 *
 * `hubRedirectFor(pathname, searchParams, opts)` dice dove reindirizzare un vecchio
 * indirizzo **con l'area accesa** per il workspace; `null` vuol dire «resta com'è». Il
 * controllo dell'interruttore (`isUseCaseHubWorkspace`) lo fa chi chiama, prima di ogni
 * lettura del database:
 *
 *   if (isUseCaseHubWorkspace(workspaceId)) {
 *     const to = hubRedirectFor(`/dashboard/${workspaceId}/portfolio`, await searchParams);
 *     if (to) redirect(to);   // 307, mai permanentRedirect: l'area si può spegnere (§12.3)
 *   }
 *
 * - `/portfolio` → `/use-cases?vista=da-decidere`, con `joined`, `thanks` e `created`
 *   (nell'ordine in cui arrivano); ogni altro parametro cade, anche `waveBudget` e
 *   `waveDurationMonths`.
 * - `/portfolio/review/<id>` → `/use-cases/<id>`; `/portfolio/submit` → `/use-cases/nuovo`;
 *   `/plan` → `/use-cases?vista=roadmap`. Senza query.
 * - `/casi-duso` → `/use-cases?vista=roadmap` solo con `dossierLinksReady` vero (§10.4).
 *   Il redirect sta nel layout del workspace: sotto `casi-duso/loading.tsx` una pagina
 *   risponderebbe 200 con una meta refresh.
 * - `/casi-duso/nuovo` senza `useCaseId` → `/use-cases?vista=priorita`, in `src/proxy.ts`.
 *   Come per la pagina, conta solo il primo `useCaseId` e solo se è un UUID: un valore
 *   vuoto, non valido o ripetuto dopo un vuoto porterebbe alla procedura senza scheda.
 * - Restano com'erano: `/portfolio/export` (la rotta ignora `waveBudget` e
 *   `waveDurationMonths`), `/use-cases/**`, `/casi-duso/nuovo?useCaseId=<uuid>`,
 *   `/casi-duso/<caseId>/**`, `/r/**`, `/api/r/**`, `/share/portfolio/**` e ogni altro
 *   indirizzo.
 *
 * Ogni redirect scrive una riga di log `stubLogEntry(from)`, senza id né query.
 *
 * Modulo puro: nessun import.
 */

/** I vecchi indirizzi, come compaiono nel log: senza id né query. */
export type LegacyRoute = "/portfolio" | "/portfolio/review" | "/portfolio/submit" | "/plan" | "/casi-duso" | "/casi-duso/nuovo";

export interface HubRedirect {
  from: LegacyRoute;
  /** Percorso assoluto dentro l'app, query compresa. */
  to: string;
}

export interface HubRedirectOptions {
  /** `dossierLinksReady(workspaceId)`: ogni dossier completo ha una scheda e l'indice unico esiste (§10.4). */
  dossierLinksReady?: boolean;
}

/**
 * Parametri come li dà Next: oggetto della pagina (`await searchParams`), `URLSearchParams`
 * di `src/proxy.ts`, oppure una query in testo.
 */
export type SearchParamsInput =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>
  | string
  | null
  | undefined;

/** Il parametro della vista (`parseHubParams`, §4.2) e i suoi valori usati dai redirect. */
export const HUB_VIEW_PARAM = "vista";
export const HUB_VIEWS = { daDecidere: "da-decidere", priorita: "priorita", roadmap: "roadmap" } as const;

/** I parametri di `/portfolio` che passano: benvenuto e ricevuta (§5.5). */
export const PORTFOLIO_PASS_THROUGH: readonly string[] = Object.freeze(["joined", "thanks", "created"]);

/** Il parametro che fa di `/casi-duso/nuovo` l'avvio di un dossier da uno use case. */
export const START_REALIZATION_PARAM = "useCaseId";

/** Un id di use case come lo accetta `casi-duso/nuovo/page.tsx`: altrimenti la procedura parte senza scheda. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entriesOf(input: SearchParamsInput): Array<[string, string]> {
  if (input === null || input === undefined) return [];
  if (typeof input === "string") return [...new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)];
  if (input instanceof URLSearchParams) return [...input];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") out.push([key, value]);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") out.push([key, v]);
  }
  return out;
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Un segmento ricodificato: un id con `?` o `#` non diventa una query. */
function encodeSegment(segment: string): string | null {
  const decoded = safeDecode(segment);
  if (decoded === null || decoded === "" || decoded === "." || decoded === ".." || decoded.includes("/")) return null;
  return encodeURIComponent(decoded);
}

function withQuery(path: string, params: Array<[string, string]>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Il redirect di un vecchio indirizzo, con il nome da scrivere nel log, oppure null se
 * l'indirizzo resta com'è. `pathname` è il percorso intero (`/dashboard/<ws>/portfolio`);
 * una query attaccata al percorso vale solo se `searchParams` non c'è.
 */
export function legacyRouteRedirect(pathname: string, searchParams?: SearchParamsInput, opts: HubRedirectOptions = {}): HubRedirect | null {
  if (typeof pathname !== "string") return null;
  const cut = pathname.search(/[?#]/);
  const path = (cut === -1 ? pathname : pathname.slice(0, cut)).replace(/\/+$/, "");
  const attached = cut !== -1 && pathname[cut] === "?" ? pathname.slice(cut + 1).split("#")[0] : null;
  const params = entriesOf(searchParams ?? attached);

  const match = /^\/dashboard\/([^/]+)((?:\/[^/]+)*)$/.exec(path);
  if (!match) return null;
  const workspace = encodeSegment(match[1]);
  if (workspace === null) return null;
  const hub = `/dashboard/${workspace}/use-cases`;
  const rest = match[2].split("/").slice(1);

  switch (rest.join("/")) {
    case "portfolio":
      return {
        from: "/portfolio",
        to: withQuery(hub, [[HUB_VIEW_PARAM, HUB_VIEWS.daDecidere], ...params.filter(([key]) => PORTFOLIO_PASS_THROUGH.includes(key))]),
      };
    case "portfolio/submit":
      return { from: "/portfolio/submit", to: `${hub}/nuovo` };
    case "plan":
      return { from: "/plan", to: withQuery(hub, [[HUB_VIEW_PARAM, HUB_VIEWS.roadmap]]) };
    case "casi-duso":
      return opts.dossierLinksReady === true ? { from: "/casi-duso", to: withQuery(hub, [[HUB_VIEW_PARAM, HUB_VIEWS.roadmap]]) } : null;
    case "casi-duso/nuovo": {
      // La stessa regola della pagina: conta solo il primo `useCaseId`, e solo se è un UUID.
      const first = params.find(([key]) => key === START_REALIZATION_PARAM)?.[1];
      const startsFromUseCase = first !== undefined && UUID_PATTERN.test(first);
      return startsFromUseCase ? null : { from: "/casi-duso/nuovo", to: withQuery(hub, [[HUB_VIEW_PARAM, HUB_VIEWS.priorita]]) };
    }
  }
  if (rest.length === 3 && rest[0] === "portfolio" && rest[1] === "review") {
    const id = encodeSegment(rest[2]);
    return id === null ? null : { from: "/portfolio/review", to: `${hub}/${id}` };
  }
  return null;
}

/** Solo la destinazione di `legacyRouteRedirect`, oppure null. */
export function hubRedirectFor(pathname: string, searchParams?: SearchParamsInput, opts: HubRedirectOptions = {}): string | null {
  return legacyRouteRedirect(pathname, searchParams, opts)?.to ?? null;
}

/** La riga di log di un redirect: conta le visite prima della pulizia, senza id né query (§2.4). */
export function stubLogEntry(from: LegacyRoute): { area: "use-case-hub"; op: "stub"; from: LegacyRoute } {
  return { area: "use-case-hub", op: "stub", from };
}
