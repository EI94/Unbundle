/**
 * La CI delle famiglie nella pagina «Agent Factory» (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.5, §2.6):
 * dalle chiavi di ogni repository (`loadCiKeyOverview`) e dai repository di cui chi guarda gestisce le chiavi
 * (`ciKeyManagedRepos`) alla riga sotto i casi, a «Da fare per te» e ai repository con una chiave viva (la conferma di
 * «Togli» chiede di ruotarla).
 *
 * - **La riga** la vede chiunque veda la famiglia: chi costruisce, anche da fuori, e chi gestisce il workspace. Lo stato
 *   è un puntino del suo colore più una frase che lo dice (mai solo il colore).
 * - **I pulsanti** («Collega la CI», «Ruota la chiave», «Crea una chiave nuova» e il «⋯» con «Ruota» e «Revoca») solo a
 *   chi gestisce le chiavi del repository (D6): bordati, perché il pulsante pieno della pagina è il prossimo passo.
 *   «Ruota» solo quando il server la accetterebbe (`rotateRefusal`); «Revoca» quando c'è una chiave viva.
 * - **«Da fare per te»**, solo a chi gestisce le chiavi e solo per le famiglie della pagina (il link porta alla loro
 *   ancora): prima la chiave nuova da mettere su GitHub, poi quella in scadenza, poi la CI da collegare.
 * - Con la 0042 non pronta (o una lettura non riuscita) ogni riga dice «Non ancora disponibile», senza pulsanti né
 *   «Da fare per te».
 *
 * Mai la chiave, il suo prefisso o chi l'ha creata: solo date e stati. Modulo puro: import relativi `.ts`; sul server
 * (le regole della chiave usano `node:crypto`).
 */
import type { CiKeyRepoOverview } from "../../lib/db/queries/use-case-ci-keys.ts";
import { ciKeyTodo, ciRowState, liveCiKeys, rotateRefusal, type CiKeyRow, type CiRowState, type CiTodoKind } from "../../lib/use-cases/ci/keys.ts";
import { CI_TEXT, ciDay, ciLastSendText, ciRepoShortName, familyAnchor } from "./ci-text.ts";

/** I colori del semaforo che la riga usa (`--uc-*`): verde a posto, blu in corso, giallo da fare, rosso scaduta. */
export type CiTone = "verde" | "blu" | "giallo" | "rosso" | "grigio";
/** Il pulsante della riga: apre «Collega la CI» (anche «Crea una chiave nuova») o «Ruotare la chiave…?». */
export type CiPrimaryAction = "collega" | "ruota" | "crea";
/** Le voci del «⋯». */
export type CiMenuAction = "ruota" | "revoca";

/** Che cosa dice e offre la riga di uno stato, per chi gestisce le chiavi. */
export interface CiRowView {
  tone: CiTone;
  text: string;
  primary: CiPrimaryAction | null;
  menu: CiMenuAction[];
}

/** La riga della CI di una famiglia, per chi guarda. */
export interface CiFamilyRow extends CiRowView {
  /** `owner/nome`, come la famiglia. */
  repo: string;
  kind: CiRowState["kind"];
  /** Chi guarda gestisce le chiavi del repository (D6): i pulsanti. Senza, `primary` è null e `menu` vuoto. */
  manages: boolean;
}

/** Una riga di «Da fare per te» della CI. */
export interface CiTodo {
  kind: CiTodoKind;
  repo: string;
  text: string;
  /** L'ancora della famiglia nella pagina. */
  href: string;
}

export interface CiFamiliesView {
  /** La 0042 c'è e la lettura è riuscita. */
  ready: boolean;
  /** Le righe delle famiglie, per repository in minuscolo. */
  rows: ReadonlyMap<string, CiFamilyRow>;
  todos: CiTodo[];
  /** I repository (in minuscolo) con una chiave viva: la conferma di «Togli» chiede di ruotarla. */
  liveRepos: ReadonlySet<string>;
}

/** Chi gestisce le chiavi dei repository: tutti (`all`, chi gestisce il workspace) o quelli dei suoi casi (in minuscolo). */
export interface CiManagedRepos {
  all: boolean;
  repos: ReadonlySet<string>;
}

export const NO_CI_MANAGED: CiManagedRepos = Object.freeze({ all: false, repos: new Set<string>() });

/** Lo stato in parole, con il colore e le azioni per chi gestisce le chiavi. `keys`: tutte quelle del repository. */
export function ciRowView(state: CiRowState, keys: readonly CiKeyRow[], now: Date): CiRowView {
  const canRotate = rotateRefusal(keys, now) === null;
  const withLive = (): CiMenuAction[] => (canRotate ? ["ruota", "revoca"] : ["revoca"]);
  switch (state.kind) {
    case "non_disponibile":
      return { tone: "grigio", text: CI_TEXT.row.notReady, primary: null, menu: [] };
    case "non_collegata":
      return { tone: "grigio", text: CI_TEXT.row.notConnected, primary: "collega", menu: [] };
    case "mai_usata":
      return { tone: "blu", text: CI_TEXT.row.neverUsed(ciDay(state.key.createdAt)), primary: null, menu: withLive() };
    case "usata":
      return {
        tone: "verde",
        text: CI_TEXT.row.used(ciLastSendText(state.key.lastUsedAt ?? state.key.createdAt, now), ciDay(state.key.expiresAt)),
        primary: null,
        menu: withLive(),
      };
    case "in_scadenza":
      // «Ruota la chiave» è il pulsante della riga: nel «⋯» resta «Revoca».
      return { tone: "giallo", text: CI_TEXT.row.expiring(ciDay(state.key.expiresAt)), primary: canRotate ? "ruota" : null, menu: ["revoca"] };
    case "rotazione":
      return { tone: "giallo", text: CI_TEXT.row.rotation(ciDay(state.old.expiresAt)), primary: null, menu: ["revoca"] };
    case "scaduta":
      return { tone: "rosso", text: CI_TEXT.row.expired(ciDay(state.key.expiresAt)), primary: "crea", menu: [] };
  }
}

/** Il testo di «Da fare per te» di un repository, dallo stato. */
export function ciTodoText(kind: CiTodoKind, repo: string, state: CiRowState): string {
  const name = ciRepoShortName(repo);
  if (kind === "ruota") return CI_TEXT.todo.rotate(name, state.kind === "in_scadenza" ? ciDay(state.key.expiresAt) : "");
  if (kind === "metti") return CI_TEXT.todo.put(name);
  return CI_TEXT.todo.connect(name);
}

const TODO_ORDER: Readonly<Record<CiTodoKind, number>> = { metti: 0, ruota: 1, collega: 2 };

/**
 * La CI delle famiglie della pagina (`families`: i loro repository, `owner/nome`) per chi guarda. `managed`: i repository
 * di cui gestisce le chiavi (null: nessuno, per chi non è di Lateral Space).
 */
export function ciFamiliesView(input: {
  ready: boolean;
  repos: ReadonlyMap<string, CiKeyRepoOverview>;
  managed: CiManagedRepos | null;
  families: readonly string[];
  now: Date;
}): CiFamiliesView {
  const { ready, now } = input;
  const managed = ready ? (input.managed ?? NO_CI_MANAGED) : NO_CI_MANAGED;
  const rows = new Map<string, CiFamilyRow>();
  const todos: CiTodo[] = [];
  for (const repo of input.families) {
    const lower = repo.toLowerCase();
    if (rows.has(lower)) continue;
    const overview = input.repos.get(lower);
    const keys = ready ? (overview?.keys ?? []) : [];
    const state = ciRowState(keys, now, ready);
    const view = ciRowView(state, keys, now);
    const manages = ready && (managed.all || managed.repos.has(lower));
    rows.set(lower, { repo, kind: state.kind, manages, tone: view.tone, text: view.text, primary: manages ? view.primary : null, menu: manages ? view.menu : [] });
    const todo = manages ? ciKeyTodo(state, { approvedCases: overview?.approvedCases ?? 0 }, now) : null;
    if (todo) todos.push({ kind: todo, repo, text: ciTodoText(todo, repo, state), href: `#${familyAnchor(repo)}` });
  }
  todos.sort((a, b) => TODO_ORDER[a.kind] - TODO_ORDER[b.kind] || a.repo.localeCompare(b.repo, "it"));
  const liveRepos = new Set<string>();
  if (ready) for (const [lower, overview] of input.repos) if (liveCiKeys(overview.keys, now).length > 0) liveRepos.add(lower);
  return { ready, rows, todos, liveRepos };
}
