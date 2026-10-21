/**
 * Controllo dei testi dell'area «Use case» (docs/use-case/DESIGN.md §14.1, §14.5;
 * PIANO-LAVORI H2d, §5.7).
 *
 * Due ambiti:
 * - **`area`**: i testi visibili dell'area (pagina `/use-cases`, scheda, pezzi comuni,
 *   Impostazioni › Valutazione). Vietati, senza distinguere maiuscole: «caso d'uso»,
 *   «Raccolta & ranking» (e «Raccolta e ranking»), «Quick Win», «Strategic Bet»,
 *   «Capability Builder», «Not Yet», «wave», «Effort», «Impact», «Feasibility». «Casi
 *   d'uso» resta: è il nome della sezione dei dossier («la sezione Casi d'uso è spenta», §14.3).
 * - **`vecchio_nome`**: i file che stanno fuori dall'area e citano il vecchio nome
 *   (`OLD_NAME_SOURCES`: `src/lib/slack/**`, la pagina di condivisione, `claude-mcp-card.tsx`,
 *   `scoring-model-form.tsx`). Lì si cerca solo «Raccolta & ranking» e «Raccolta e ranking»:
 *   le altre parole restano solo per l'area.
 *
 * Il controllo del vecchio nome fuori dall'area è pronto ma si accende in H7: fino ad allora
 * i file in `OLD_NAME_PENDING` (quelli che H2e, H3d, H3e e H6i cambiano) sono tollerati, e
 * il test lo segnala senza fallire. Si accende da solo, e resta acceso, quando nel repository
 * c'è `OLD_NAME_GUARD_MARKER` (`docs/use-case/RUNBOOK.md`, che crea solo H7): da lì in poi
 * `npm run check` li controlla come gli altri. `USE_CASE_OLD_NAME_GUARD=1` lo accende prima,
 * per provarlo. I file dell'elenco già puliti si controllano subito.
 *
 * Lo usano `copy-guard.test.ts` (etichette dell'area e testi dei componenti) e
 * `scripts/use-case-test/screens-hub.mjs` (testo delle pagine rese, §5.7).
 *
 * Modulo puro, senza import: lo importa anche uno script `.mjs`.
 */

export type HubCopyScope = "area" | "vecchio_nome";

export interface HubCopyRule {
  id: "caso_d_uso" | "vecchio_nome" | "quick_win" | "strategic_bet" | "capability_builder" | "not_yet" | "wave" | "effort" | "impact" | "feasibility";
  /** La parola vietata come la scrive §14.5. */
  word: string;
  /** Con `g` e `i`: tutte le occorrenze, senza distinguere maiuscole. */
  pattern: RegExp;
  scopes: readonly HubCopyScope[];
}

const AREA: readonly HubCopyScope[] = ["area"];
const EVERYWHERE: readonly HubCopyScope[] = ["area", "vecchio_nome"];

/** Le parole vietate di §14.5. Gli spazi possono essere anche trattini o a capo. */
export const HUB_COPY_RULES: readonly HubCopyRule[] = [
  { id: "caso_d_uso", word: "caso d'uso", pattern: /\bcaso\s+d['’]\s*uso\b/gi, scopes: AREA },
  { id: "vecchio_nome", word: "Raccolta & ranking", pattern: /\braccolta\s*(?:&amp;|&|\be\b)\s*ranking\b/gi, scopes: EVERYWHERE },
  { id: "quick_win", word: "Quick Win", pattern: /\bquick[\s-]*wins?\b/gi, scopes: AREA },
  { id: "strategic_bet", word: "Strategic Bet", pattern: /\bstrategic[\s-]*bets?\b/gi, scopes: AREA },
  { id: "capability_builder", word: "Capability Builder", pattern: /\bcapability[\s-]*builders?\b/gi, scopes: AREA },
  { id: "not_yet", word: "Not Yet", pattern: /\bnot[\s-]*yet\b/gi, scopes: AREA },
  { id: "wave", word: "wave", pattern: /\bwaves?\b/gi, scopes: AREA },
  { id: "effort", word: "Effort", pattern: /\beffort\b/gi, scopes: AREA },
  { id: "impact", word: "Impact", pattern: /\bimpact\b/gi, scopes: AREA },
  { id: "feasibility", word: "Feasibility", pattern: /\bfeasibility\b/gi, scopes: AREA },
];

export interface HubCopyMatch {
  rule: HubCopyRule["id"];
  word: string;
  /** Il testo trovato. */
  match: string;
  index: number;
}

/** Le parole vietate in un testo, per l'ambito dato, nell'ordine del testo. */
export function findHubForbidden(text: string, scope: HubCopyScope): HubCopyMatch[] {
  if (!text) return [];
  const out: HubCopyMatch[] = [];
  for (const rule of HUB_COPY_RULES) {
    if (!rule.scopes.includes(scope)) continue;
    for (const m of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
      out.push({ rule: rule.id, word: rule.word, match: m[0], index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Tutte le corrispondenze in un insieme di testi (etichette, testi di un file, righe di una pagina). */
export function findHubForbiddenIn(texts: Iterable<string>, scope: HubCopyScope): (HubCopyMatch & { text: string })[] {
  const out: (HubCopyMatch & { text: string })[] = [];
  for (const text of texts) for (const m of findHubForbidden(text, scope)) out.push({ ...m, text });
  return out;
}

// ─── Dove si controlla ───────────────────────────────────────────────

/** Le cartelle dei componenti dell'area: i loro testi (`.ts` e `.tsx`) si controllano con l'ambito `area`. */
export const AREA_SOURCE_DIRS: readonly string[] = ["src/components/use-cases/"];

/**
 * I file fuori dall'area che citano il vecchio nome (DESIGN §14.5): una cartella finisce con
 * «/», un file è il percorso intero. Ambito `vecchio_nome`.
 */
export const OLD_NAME_SOURCES: readonly string[] = [
  "src/lib/slack/",
  "src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx",
  "src/components/workspace/claude-mcp-card.tsx",
  "src/components/portfolio/scoring-model-form.tsx",
];

/**
 * I file in cui il vecchio nome resta finché il loro pacchetto non cambia il testo (DESIGN
 * §14.5, PIANO-LAVORI H2e, H3d, H3e, H6i). Fino a H7 si tollerano; da H7
 * (`OLD_NAME_GUARD_MARKER`), o con `USE_CASE_OLD_NAME_GUARD=1`, no.
 */
export const OLD_NAME_PENDING: Readonly<Record<string, string>> = Object.freeze({
  "src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx": "H2e",
  "src/components/portfolio/scoring-model-form.tsx": "H3d",
  "src/lib/slack/use-case-agent.ts": "H3e",
  "src/components/workspace/claude-mcp-card.tsx": "H6i",
});

/**
 * Il file che accende per sempre il controllo del vecchio nome anche sui file in
 * `OLD_NAME_PENDING`: lo crea solo H7 (PIANO-LAVORI H7 e §4, «da qui in poi il controllo del
 * vecchio nome»), quindi il controllo non dipende da una variabile che qualcuno deve ricordarsi
 * di impostare. Percorso relativo alla radice del repository.
 */
export const OLD_NAME_GUARD_MARKER = "docs/use-case/RUNBOOK.md";

/** La variabile che accende il controllo del vecchio nome prima di H7, per provarlo (`=1`). */
export const OLD_NAME_GUARD_ENV = "USE_CASE_OLD_NAME_GUARD";

const SOURCE_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;

function inList(path: string, list: readonly string[]): boolean {
  return list.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

/**
 * L'ambito di un file del repository (percorso relativo con «/»), oppure `null` se il file non
 * si controlla. I test non si controllano: non sono testi visibili.
 */
export function copyScopeOfFile(path: string): HubCopyScope | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!SOURCE_FILE.test(normalized) || TEST_FILE.test(normalized)) return null;
  if (inList(normalized, AREA_SOURCE_DIRS)) return "area";
  if (inList(normalized, OLD_NAME_SOURCES)) return "vecchio_nome";
  return null;
}
