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
 * - **`esterno`** (rilascio 5.1, decisione del titolare del 04/11/2026): i testi che leggono le
 *   persone fuori dalla dashboard, cioè la pagina pubblica del referente `/rispondi` e le email
 *   dell'area. Lì si dice «caso d'uso» e mai «use case»; le altre parole vietate dell'area restano
 *   vietate. La dashboard resta `area` («use case»).
 * - **`vecchio_nome`**: i file che stanno fuori dall'area e citano il vecchio nome
 *   (`OLD_NAME_SOURCES`: `src/lib/slack/**`, `claude-mcp-card.tsx`, `scoring-model-form.tsx`). Lì si
 *   cerca solo «Raccolta & ranking» e «Raccolta e ranking»: le altre parole restano solo per l'area.
 *   (Rilascio 10) La pagina di condivisione è pubblica: è `esterno`.
 *
 * (Rilascio 10, §4.2) Tre pubblici, con le parole ritirate dal vocabolario unico (§4):
 * - **`area`**, la dashboard: in più «Casi d'uso», «dossier», «Sub-responsabili», «fabbrica», «requisito»,
 *   «esigenza», «ranking», «Goal», «OKR», «stream», «Activity mapping», «Discovery», «Privacy Policy», «Realizzati»,
 *   «Tocca anche», «Impatto» e «board» come titolo, «Non ce l'ho», «proposta» per uno use case. Le parole per i soli
 *   ruoli del cliente (token, PR, p95, commit…) stanno in `src/lib/uc/views/copy-guard.ts`.
 * - **`esterno`**, le pagine pubbliche e le email: in più «Survey», «Assessment», «respondent», «Retention»,
 *   «Controller», «JSON», «login», «reset», «Non ce l'ho», «Privacy Policy». I codici XX-0000 negli oggetti li
 *   controlla il test del modello delle email (`src/lib/uc/notify/email-model.test.ts`).
 * - **`cli`**, i messaggi della CLI e del pacchetto: «caso», mai «caso d'uso» né «use case».
 *
 * Il controllo del vecchio nome fuori dall'area è pronto ma si accende in H7: fino ad allora
 * i file in `OLD_NAME_PENDING` (quelli che H3d, H3e e H6i cambiano) sono tollerati, e
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

export type HubCopyScope = "area" | "vecchio_nome" | "esterno" | "cli";

export interface HubCopyRule {
  id:
    | "caso_d_uso"
    | "use_case"
    | "vecchio_nome"
    | "quick_win"
    | "strategic_bet"
    | "capability_builder"
    | "not_yet"
    | "wave"
    | "effort"
    | "impact"
    | "feasibility"
    // (Rilascio 10, §4.2) Le parole ritirate dal vocabolario unico.
    | "casi_d_uso"
    | "dossier"
    | "sub_responsabili"
    | "fabbrica"
    | "requisito"
    | "esigenza"
    | "ranking"
    | "goal"
    | "okr"
    | "stream"
    | "activity_mapping"
    | "discovery"
    | "privacy_policy"
    | "realizzati"
    | "tocca_anche"
    | "impatto_titolo"
    | "board_titolo"
    | "non_ce_lho"
    | "proposta"
    | "survey"
    | "assessment"
    | "respondent"
    | "retention"
    | "controller"
    | "json"
    | "login"
    | "reset";
  /** La parola vietata come la scrive §14.5. */
  word: string;
  /** Con `g` e `i`: tutte le occorrenze, senza distinguere maiuscole. */
  pattern: RegExp;
  scopes: readonly HubCopyScope[];
}

const AREA: readonly HubCopyScope[] = ["area"];
const OUTSIDE: readonly HubCopyScope[] = ["esterno"];
/** Le parole vietate sia nella dashboard sia fuori (pagina pubblica, email). */
const AREA_AND_OUTSIDE: readonly HubCopyScope[] = ["area", "esterno"];
const EVERYWHERE: readonly HubCopyScope[] = ["area", "vecchio_nome", "esterno"];
/** (Rilascio 10, §4.2) Nella CLI: «caso», mai «caso d'uso» né «use case». */
const AREA_AND_CLI: readonly HubCopyScope[] = ["area", "cli"];
const OUTSIDE_AND_CLI: readonly HubCopyScope[] = ["esterno", "cli"];

/** Le parole vietate di §14.5. Gli spazi possono essere anche trattini o a capo. */
export const HUB_COPY_RULES: readonly HubCopyRule[] = [
  { id: "caso_d_uso", word: "caso d'uso", pattern: /\bcaso\s+d['’]\s*uso\b/gi, scopes: AREA_AND_CLI },
  { id: "use_case", word: "use case", pattern: /\buse[\s-]*cases?\b/gi, scopes: OUTSIDE_AND_CLI },
  { id: "vecchio_nome", word: "Raccolta & ranking", pattern: /\braccolta\s*(?:&amp;|&|\be\b)\s*ranking\b/gi, scopes: EVERYWHERE },
  { id: "quick_win", word: "Quick Win", pattern: /\bquick[\s-]*wins?\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "strategic_bet", word: "Strategic Bet", pattern: /\bstrategic[\s-]*bets?\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "capability_builder", word: "Capability Builder", pattern: /\bcapability[\s-]*builders?\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "not_yet", word: "Not Yet", pattern: /\bnot[\s-]*yet\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "wave", word: "wave", pattern: /\bwaves?\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "effort", word: "Effort", pattern: /\beffort\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "impact", word: "Impact", pattern: /\bimpact\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "feasibility", word: "Feasibility", pattern: /\bfeasibility\b/gi, scopes: AREA_AND_OUTSIDE },
  // (Rilascio 10, §4.2) La dashboard.
  { id: "casi_d_uso", word: "Casi d'uso", pattern: /\bcasi\s+d['’]\s*uso\b/gi, scopes: AREA_AND_CLI },
  { id: "dossier", word: "dossier", pattern: /\bdossier\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "sub_responsabili", word: "Sub-responsabili", pattern: /\bsub[\s-]*responsabil[ie]\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "fabbrica", word: "fabbrica", pattern: /\bfabbric(?:a|he)\b/gi, scopes: AREA },
  { id: "requisito", word: "requisito", pattern: /\brequisit[oi]\b/gi, scopes: AREA },
  { id: "esigenza", word: "esigenza", pattern: /\besigenz[ae]\b/gi, scopes: AREA },
  { id: "ranking", word: "ranking", pattern: /\branking\b/gi, scopes: AREA },
  { id: "goal", word: "Goal", pattern: /\bgoals?\b/gi, scopes: AREA },
  { id: "okr", word: "OKR", pattern: /\bOKR\b/g, scopes: AREA },
  { id: "stream", word: "stream", pattern: /\bstreams?\b/gi, scopes: AREA },
  { id: "activity_mapping", word: "Activity mapping", pattern: /\bactivity[\s-]*mapping\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "discovery", word: "Discovery", pattern: /\bdiscovery\b/gi, scopes: AREA },
  { id: "privacy_policy", word: "Privacy Policy", pattern: /\bprivacy\s+policy\b/gi, scopes: AREA_AND_OUTSIDE },
  { id: "realizzati", word: "Realizzati", pattern: /\brealizzat[io]\b/gi, scopes: AREA },
  { id: "tocca_anche", word: "Tocca anche", pattern: /\btocca\s+anche\b/gi, scopes: AREA },
  // «Impatto» e «board» come titolo: un testo che comincia così. «Impatto ambientale e sociale» (ESG) passa.
  { id: "impatto_titolo", word: "Impatto (titolo)", pattern: /^\s*impatto\b(?!\s+ambientale)/gi, scopes: AREA },
  { id: "board_titolo", word: "board (titolo)", pattern: /^\s*board\b/gi, scopes: AREA },
  { id: "non_ce_lho", word: "Non ce l'ho", pattern: /\bnon\s+ce\s+l['’]\s*ho\b/gi, scopes: AREA_AND_OUTSIDE },
  // «proposta» per uno use case (§4: «use case»): «Invia come proposta», «La tua proposta», «Le tue proposte», «proposte
  // altrui», «proposte di use case», «Le proposte sono in «In valutazione»». Le altre proposte restano, perché nominano
  // altro: la scadenza «Proposta» e la data «(proposta)», una domanda proposta, una proposta di compito, i fatti del
  // Contesto da confermare, «non si applica», le categorie dei processi.
  {
    id: "proposta",
    word: "proposta (uno use case)",
    pattern: /\binvi\w*\s+come\s+propost[ae]\b|\btu[ae]\s+propost[ae]\b|\bpropost[ae]\s+(?:altrui\b|d[ie]\s+use[\s-]*cases?\b|(?:sono|è|stanno)\s+in\s+«)/gi,
    scopes: AREA,
  },
  // (Rilascio 10, §4.2) Fuori dalla dashboard: le pagine pubbliche e le email.
  { id: "survey", word: "Survey", pattern: /\bsurveys?\b/gi, scopes: OUTSIDE },
  { id: "assessment", word: "Assessment", pattern: /\bassessments?\b/gi, scopes: OUTSIDE },
  { id: "respondent", word: "respondent", pattern: /\brespondents?\b/gi, scopes: OUTSIDE },
  { id: "retention", word: "Retention", pattern: /\bretention\b/gi, scopes: OUTSIDE },
  { id: "controller", word: "Controller", pattern: /\bcontroller\b/gi, scopes: OUTSIDE },
  { id: "json", word: "JSON", pattern: /\bjson\b/gi, scopes: OUTSIDE },
  { id: "login", word: "login", pattern: /\blog[\s-]?in\b/gi, scopes: OUTSIDE },
  { id: "reset", word: "reset", pattern: /\breset\b/gi, scopes: OUTSIDE },
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

/**
 * Le cartelle dei componenti della dashboard: i loro testi (`.ts` e `.tsx`) si controllano con l'ambito `area`.
 * (Rilascio 10, §4.2) Non più solo l'area «Use case»: anche la realizzazione, l'Agent Factory, il Contesto, i
 * Processi e le loro pagine.
 */
export const AREA_SOURCE_DIRS: readonly string[] = [
  "src/components/use-cases/",
  "src/components/uc/",
  "src/components/agent-factory/",
  "src/components/context/",
  "src/components/mappatura/",
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases/",
  "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/",
  "src/app/(dashboard)/dashboard/[workspaceId]/agent-factory/",
  "src/app/(dashboard)/dashboard/[workspaceId]/contesto/",
  "src/app/(dashboard)/dashboard/[workspaceId]/mapping/",
  // (Rilascio 10, ondata 6a) L'«Intervista iniziale» (`/setup/leadership`, prima «Discovery») e il vecchio indirizzo di «Contesto».
  "src/app/(dashboard)/dashboard/[workspaceId]/setup/",
];

/**
 * (Rilascio 5.1) La pagina pubblica del referente: i suoi testi si controllano con l'ambito `esterno`
 * («caso d'uso», mai «use case»), anche se la cartella dei componenti sta dentro l'area. (Rilascio 10, §4.2)
 * Anche la pagina del link della realizzazione (`/r`), l'invito, le pagine del questionario AI Readiness per chi
 * risponde (`/a`, il link personale, e `/s`, il link aperto: «questionario», mai «Survey» né «Assessment») e la
 * pagina del link di condivisione (`/share`, D14), che apre chi non è membro del workspace. (Ondata 4) E il guscio unico
 * delle pagine pubbliche con i suoi testi, il corso, l'informativa del questionario, l'accesso e i loro pezzi.
 */
export const OUTSIDE_SOURCE_DIRS: readonly string[] = [
  "src/components/use-cases/referent-public/",
  "src/app/rispondi/",
  "src/components/uc/referente/",
  "src/app/r/",
  "src/app/invite/",
  "src/app/a/",
  "src/app/s/",
  "src/app/share/",
  // (Rilascio 10, ondata 4 «Fuori») Il guscio unico delle pagine pubbliche e i suoi testi, il corso `/c`, l'informativa del
  // questionario, l'accesso, e i pezzi di queste pagine che stanno fra i componenti.
  "src/components/public/",
  "src/lib/public/",
  "src/app/c/",
  "src/app/privacy/",
  "src/app/(auth)/",
  "src/components/learning/join-course-form.tsx",
  "src/components/ai-readiness/open-survey-start-form.tsx",
  "src/components/ai-readiness/respondent-survey-form.tsx",
  "src/components/ai-readiness/use-case-expert-form.tsx",
  "src/components/ai-readiness/respondent-privacy-controls.tsx",
  "src/components/auth/login-form.tsx",
  "src/components/workspace/workspace-invite-accept-form.tsx",
  "src/components/workspace/verify-invite-email.tsx",
];

/**
 * (Rilascio 10) Le pagine che hanno ancora il ramo «area spenta» (la scheda e la lista di prima, con i quadranti
 * inglesi): non si controllano finché la pulizia (ondata 8) non toglie quel ramo.
 */
export const AREA_LEGACY_FILES: readonly string[] = [
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx",
];

/**
 * (Rilascio 10, §4.2) I messaggi della CLI e del pacchetto: ambito `cli` («caso»). (Ondata 4) Anche la pagina «Collega la
 * CLI» (`/cli/collega`), che parla a chi usa la CLI e scrive i suoi comandi («unbundle login») come sono.
 */
export const CLI_SOURCE_DIRS: readonly string[] = ["src/lib/use-cases/cli/", "src/app/cli/"];

/**
 * I file fuori dall'area che citano il vecchio nome (DESIGN §14.5): una cartella finisce con
 * «/», un file è il percorso intero. Ambito `vecchio_nome`.
 */
export const OLD_NAME_SOURCES: readonly string[] = [
  "src/lib/slack/",
  "src/components/workspace/claude-mcp-card.tsx",
  "src/components/portfolio/scoring-model-form.tsx",
];

/**
 * I file in cui il vecchio nome resta finché il loro pacchetto non cambia il testo (DESIGN
 * §14.5, PIANO-LAVORI H3d, H3e, H6i). Fino a H7 si tollerano; da H7
 * (`OLD_NAME_GUARD_MARKER`), o con `USE_CASE_OLD_NAME_GUARD=1`, no.
 */
export const OLD_NAME_PENDING: Readonly<Record<string, string>> = Object.freeze({
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
  if (inList(normalized, OUTSIDE_SOURCE_DIRS)) return "esterno";
  if (inList(normalized, CLI_SOURCE_DIRS)) return "cli";
  if (inList(normalized, AREA_LEGACY_FILES)) return null;
  if (inList(normalized, AREA_SOURCE_DIRS)) return "area";
  if (inList(normalized, OLD_NAME_SOURCES)) return "vecchio_nome";
  return null;
}
