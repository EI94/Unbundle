/**
 * La pagina «Agent Factory» in dati pronti da disegnare (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.6,
 * prototipo S5, audit AUDIT-REALIZZAZIONE.md §3.25 e F-135…F-144): dalla lettura della linea (`loadFactoryOverview`) e
 * della CI delle famiglie (`readCiFamilies`, 8.2b) a quello che la schermata mostra.
 *
 * - **Il prossimo passo** è la prima voce di «Da fare per te»: un verbo di 2-4 parole, il codice del caso in grigio e il
 *   perché nel «?». Sotto, al massimo 3 righe, poi «Altre N» (un pannello con tutte). I comandi della CLI stanno dove si
 *   agisce: «Il tuo account» per collegare la CLI, il pannello del caso per creare il repository.
 * - **Le voci della CI (8.2b)** restano con le loro frasi (`CI_TEXT.todo`) e il link alla famiglia; nel pulsante pieno
 *   il verbo breve della stessa azione.
 * - **«La linea»** è un filtro: un chip per ogni stazione con almeno un caso (lo zero non si vede), `?stazione=`.
 * - **Le famiglie** hanno un nome di parole (il repository senza l'organizzazione, senza trattini); il repository, la
 *   versione del modello e del comune stanno nei loro «Dettagli». L'ancora `#famiglia-<nome>` resta (la CI).
 * - **Una riga per caso:** il tag dell'agente, il codice, il titolo, la stazione, il prossimo passo in grigio e la
 *   qualità delle evals come puntino più parola. I fatti tecnici (compiti, modifiche, sessioni, costi, banco) stanno nel
 *   pannello del caso, `?apri=<codice>`.
 *
 * Mai una cifra per persona: tutto si conta per caso. Modulo puro: import relativi `.ts`, i tipi del server solo come
 * tipi.
 */
import type { FactoryCaseRow, FactoryOverview, FactoryTodo } from "../../lib/db/queries/use-case-factory-line.ts";
import { agentToneOf, titleAgent, type AgentPalette, type AgentTone } from "../../lib/use-cases/agents.ts";
import { formatCost, formatQuality } from "../../lib/use-cases/factory/benchmark.ts";
import { AGENT_FACTORY_TEMPLATE_VERSION, STATIONS, STATION_LABEL, benchFacts, compareVersions, evalsFact, type Station } from "../../lib/use-cases/factory/line.ts";
import { accountHref } from "../../lib/shell/account.ts";
import { CI_TEXT, ciRepoShortName, familyAnchor } from "./ci-text.ts";
import type { CiTodo } from "./ci-view.ts";
import { FACTORY_TEXT } from "./factory-text.ts";

const T = FACTORY_TEXT;

/** Le righe di «Da fare per te» in vista sotto il pulsante pieno (§1, regola 4). */
export const FACTORY_TODO_ROWS = 3;

/** I pannelli della pagina che non sono un caso (`?apri=`). */
export const FACTORY_PANELS = Object.freeze({ builders: "chi-costruisce", queue: "repository", todos: "da-fare" } as const);

/** Le stazioni nell'indirizzo (`?stazione=`), a parole. */
export const STATION_PARAM: Readonly<Record<Station, string>> = Object.freeze({
  dossier: "da-impostare",
  impostazione: "in-impostazione",
  approvato: "da-costruire",
  costruzione: "in-costruzione",
  collaudo: "in-prova",
  esercizio: "in-uso",
});

/** La stazione di `?stazione=`; null per un valore che non c'è (nessun filtro). */
export function stationOfParam(raw: string | null | undefined): Station | null {
  if (!raw) return null;
  return STATIONS.find((s) => STATION_PARAM[s] === raw) ?? null;
}

export interface FactoryTodoView {
  key: string;
  /** `FactoryTodo["kind"]`, oppure `ci-<tipo>` per le voci della CI. */
  kind: string;
  /** Il testo della riga. */
  row: string;
  /** Il verbo del pulsante pieno, quando la voce è la prima. */
  button: string;
  /** Il grigio della voce: il codice del caso e, se c'è, il compito («XX-0007 · T-3»); vuoto per le voci del workspace. */
  code: string;
  /** Il perché, nel «?». */
  why: string;
  href: string;
  /** Una modifica su GitHub: si apre in una nuova scheda, e lo si dice. */
  external: boolean;
  /**
   * (Revisione 6b) Porta a un punto di questa stessa pagina (la famiglia di una voce della CI): da un pannello, il
   * pannello si chiude prima, sostituendo il suo passo della cronologia invece di tornare indietro.
   */
  samePage: boolean;
  /** (8.0d) Apre un pannello di questa pagina (`?apri=`) invece di un link: «Togli …» apre «Chi costruisce». */
  panel: string | null;
}

/** Il numero all'inizio di un testo («3 domande…»), 1 se non c'è. */
function leadingCount(text: string): number {
  const match = /^(\d+)\s/.exec(text);
  return match ? Number(match[1]) : 1;
}

/** Il compito (`T-3`) nominato da un testo di «Da fare per te»; vuoto se non c'è. */
function taskRefOf(text: string): string {
  return /\bT-\d+\b/.exec(text)?.[0] ?? "";
}

/**
 * Dove porta una voce che non è della CI (la stessa regola di prima, `todoHref`). (8.0d) `caseOnly`: «Solo questo use
 * case» non apre «Il tuo account» dalla Home, fuori dal suo perimetro: il testo dice già come si collega la CLI.
 */
export function factoryTodoHref(workspaceId: string, t: FactoryTodo, caseOnly = false): string {
  if (t.href) return t.href;
  if (t.kind === "collega") return caseOnly ? `/dashboard/${workspaceId}/agent-factory` : accountHref(workspaceId, "claude");
  // (8.0d) «Togli …» apre «Chi costruisce» (il pannello del «⋯»); «Aggiungi … al team» porta al team del dossier.
  if (t.kind === "togli_esterno") return `/dashboard/${workspaceId}/agent-factory?apri=${FACTORY_PANELS.builders}`;
  if (t.kind === "aggiungi_esterno") return `/dashboard/${workspaceId}/casi-duso/${t.caseId}/persone`;
  if (t.kind === "domande") return `/dashboard/${workspaceId}/use-cases/${t.useCaseId}/proposte`;
  // (Rilascio 10) Dritti alla Costruzione: passando dal 308 di `/progetto` la navigazione nell'app perderebbe l'ancora.
  if (t.kind === "banco" || t.kind === "evals") return `/dashboard/${workspaceId}/casi-duso/${t.caseId}/costruzione#banco`;
  return `/dashboard/${workspaceId}/casi-duso/${t.caseId}/costruzione${t.kind === "approva" ? "" : "#compiti"}`;
}

/** Una voce di «Da fare per te» della linea: verbo breve nella riga e nel pulsante, la frase di prima nel «?». */
export function factoryTodoView(workspaceId: string, t: FactoryTodo, index: number, clientName: string, caseOnly = false): FactoryTodoView {
  const ref = t.ref ?? taskRefOf(t.text);
  const n = t.count ?? leadingCount(t.text);
  const href = factoryTodoHref(workspaceId, t, caseOnly);
  // Il verbo nel pulsante e nella riga; il compito accanto al codice del caso, in grigio.
  const withRef = t.kind === "chiesto" || t.kind === "fermo" || t.kind === "rivedi";
  const base = {
    key: `${t.kind}-${t.useCaseId || "ws"}-${index}`,
    kind: t.kind,
    code: T.todo.grey(t.code, withRef ? ref || null : null),
    href,
    external: Boolean(t.href),
    samePage: false,
    panel: t.kind === "togli_esterno" ? FACTORY_PANELS.builders : null,
  };
  switch (t.kind) {
    case "collega":
      return { ...base, row: T.todo.collega, button: T.todo.collega, why: T.todo.collegaWhy(clientName || T.todo.thisWorkspace) };
    case "chiesto":
      return { ...base, row: T.todo.chiesto, button: T.todo.chiesto, why: t.text };
    case "fermo":
      // Il comando resta nella pagina del progetto: qui la frase senza.
      return { ...base, row: T.todo.fermo, button: T.todo.fermo, why: ref ? T.todo.fermoWhy(ref) : t.text };
    case "approva":
      return { ...base, row: T.todo.approva, button: T.todo.approva, why: t.text };
    case "domande":
      return { ...base, row: T.todo.domande(n), button: T.todo.domande(n), why: t.text };
    case "proposte":
      return { ...base, row: T.todo.proposte(n), button: T.todo.proposte(n), why: t.text };
    case "rivedi":
      return { ...base, row: T.todo.rivedi, button: T.todo.rivedi, why: T.todo.rivediWhy(t.text.replace(/\bPR\b/g, "modifica")) };
    case "banco":
      return { ...base, row: T.todo.banco, button: T.todo.banco, why: t.text };
    case "evals":
      return { ...base, row: T.todo.evals, button: T.todo.evals, why: t.text };
    case "togli_esterno":
      return { ...base, row: T.todo.togliEsterno(t.person ?? ""), button: T.todo.togliEsterno(t.person ?? ""), why: t.text };
    case "aggiungi_esterno":
      return { ...base, row: T.todo.aggiungiEsterno(t.person ?? ""), button: T.todo.aggiungiEsterno(t.person ?? ""), why: t.text };
  }
}

/** Il verbo breve di una voce della CI, per il pulsante pieno (la frase della 8.2b resta nella riga e nel «?»). */
const CI_BUTTON: Readonly<Record<CiTodo["kind"], string>> = { metti: T.todo.ciPut, ruota: CI_TEXT.action.rotate, collega: CI_TEXT.action.connect };

/** Una voce della CI (8.2b): la sua frase nella riga, il link alla famiglia nella pagina (anche con un filtro acceso). */
export function ciTodoView(workspaceId: string, t: CiTodo): FactoryTodoView {
  return {
    key: `ci-${t.kind}-${t.repo}`,
    kind: `ci-${t.kind}`,
    row: t.text,
    button: CI_BUTTON[t.kind],
    code: "",
    why: t.text,
    href: `/dashboard/${workspaceId}/agent-factory${t.href}`,
    external: false,
    samePage: true,
    panel: null,
  };
}

/**
 * (Revisione 6b) L'urgenza di una voce di «Da fare per te», per l'ordine: 0 qualcosa è fermo o qualcuno aspetta (la
 * chiave nuova della CI da mettere su GitHub, quella in scadenza, Claude Code da collegare, una richiesta, il progetto da
 * approvare, una modifica da rivedere); 1 da decidere (domande, proposte, un compito fermo); 2 da migliorare (evals,
 * banco, la CI da collegare).
 */
const TODO_URGENCY: Readonly<Record<string, number>> = {
  "ci-metti": 0,
  "ci-ruota": 0,
  collega: 0,
  // (8.0d) Chi costruisce da fuori un caso chiuso ha ancora l'accesso; chi è stato invitato aspetta la riga del team.
  togli_esterno: 0,
  aggiungi_esterno: 0,
  chiesto: 0,
  approva: 0,
  rivedi: 0,
  domande: 1,
  proposte: 1,
  fermo: 1,
  evals: 2,
  banco: 2,
  "ci-collega": 2,
};

/**
 * Le voci di «Da fare per te» in ordine: prima le più urgenti; a parità d'urgenza prima quelle della CI (8.2b), poi
 * nell'ordine della lettura. Così la chiave nuova o in scadenza non finisce mai in fondo, dentro «Altre N».
 */
export function orderTodos(todos: readonly FactoryTodoView[]): FactoryTodoView[] {
  return todos
    .map((todo, index) => ({ todo, index }))
    .sort(
      (a, b) =>
        (TODO_URGENCY[a.todo.kind] ?? 1) - (TODO_URGENCY[b.todo.kind] ?? 1) ||
        Number(!a.todo.kind.startsWith("ci-")) - Number(!b.todo.kind.startsWith("ci-")) ||
        a.index - b.index,
    )
    .map(({ todo }) => todo);
}

/** Un nome di parole per una famiglia: il repository senza l'organizzazione, senza trattini, con la maiuscola. */
export function familyName(repo: string | null): string {
  if (!repo) return T.family.noRepo;
  const words = ciRepoShortName(repo).replace(/\.git$/i, "").replace(/[-_.]+/g, " ").trim();
  return words ? words.charAt(0).toLocaleUpperCase("it-IT") + words.slice(1) : repo;
}

export interface FactoryHealth {
  tone: "verde" | "giallo";
  label: string;
}

/** La qualità delle evals del caso, come puntino più parola; null senza evals. */
export function caseHealth(evals: FactoryCaseRow["evals"]): FactoryHealth | null {
  if (!evals) return null;
  const q = formatQuality(evals.quality);
  return evals.thresholdsMet ? { tone: "verde", label: T.quality.ok(q) } : { tone: "giallo", label: T.quality.below(q) };
}

/** «oggi», «ieri», «3 giorni fa». */
export function sinceText(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? T.since.today : days === 1 ? T.since.yesterday : T.since.daysAgo(days);
}

const COUNT = new Intl.NumberFormat("it-IT", { useGrouping: "always" });
const DAYS = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

export interface FactoryFact {
  label: string;
  value: string;
}

export interface FactoryCaseView {
  /** Il valore di `?apri=`: il codice del caso, o il suo id senza codice. */
  key: string;
  caseId: string;
  code: string;
  /** Il titolo senza il prefisso dell'agente (che è nel tag); il titolo intero resta per i lettori di schermo. */
  title: string;
  fullTitle: string;
  tag: { label: string; tone: AgentTone | null } | null;
  station: Station;
  stationLabel: string;
  next: string;
  health: FactoryHealth | null;
  /** La Costruzione del caso (rilascio 10, ondata 5b): dritti, senza il 308 di `/progetto`. */
  href: string;
  /** Il pannello del caso: i fatti, e dove serve il comando da usare. */
  facts: FactoryFact[];
  how: string[];
}

/**
 * Il caso per la riga e per il suo pannello. (Revisione 6b) Il costo totale delle sessioni del caso lo vede solo il
 * manager (prototipo S5): con una persona sola che costruisce sarebbe la spesa di quella persona. Agli altri la media per
 * modifica unita, che la lettura dà solo da 3 modifiche unite in su.
 */
export function factoryCaseView(workspaceId: string, c: FactoryCaseRow, palette: AgentPalette | null, now: Date, manager = false): FactoryCaseView {
  const agent = titleAgent(c.title);
  const live = c.tasks.total - c.tasks.cancelled;
  const going = c.tasks.inProgress + c.tasks.inReview;
  const changes = T.panel.changesLine(c.prs.open, c.prs.merged);
  const timing =
    c.prs.medianDays === null ? null : c.prs.medianDays < 1 ? T.panel.timingUnderDay : T.panel.timingDays(DAYS.format(c.prs.medianDays));
  const perChange =
    c.prs.costPerPrUsd !== null || c.prs.tokensPerPr !== null
      ? T.panel.perChange([c.prs.costPerPrUsd !== null ? formatCost(c.prs.costPerPrUsd) : null, c.prs.tokensPerPr !== null ? T.panel.tokens(COUNT.format(c.prs.tokensPerPr)) : null].filter((p): p is string => Boolean(p)))
      : null;
  const facts: FactoryFact[] = [
    { label: T.panel.station, value: STATION_LABEL[c.station] },
    { label: T.panel.next, value: c.nextStep },
    { label: T.panel.tasks, value: live > 0 ? T.panel.tasksLine(c.tasks.done, live, going) : T.panel.noTasks },
    ...(changes ? [{ label: T.panel.changes, value: [changes, timing].filter(Boolean).join(", ") }] : []),
    ...(c.sessions.count ? [{ label: T.panel.sessions, value: T.panel.sessionsLine(c.sessions.count, sinceText(c.sessions.lastAt, now)) }] : []),
    ...((manager && c.sessions.costUsd > 0) || perChange
      ? [{ label: T.panel.cost, value: [manager && c.sessions.costUsd > 0 ? T.panel.total(formatCost(c.sessions.costUsd), COUNT.format(c.sessions.tokens)) : null, perChange].filter(Boolean).join(" · ") }]
      : []),
    ...(c.evals ? [{ label: T.panel.quality, value: evalsFact(c.evals) ?? "" }] : []),
    ...benchFacts(c.benches).map((value) => ({ label: T.panel.bench, value })),
    ...(c.repo ? [{ label: T.panel.repo, value: c.repo }] : []),
  ];
  const how = [!c.repo && c.code ? T.panel.noRepoHow(c.code) : null, c.station === "approvato" && c.code ? T.panel.importHow(c.code) : null].filter((s): s is string => Boolean(s));
  return {
    key: c.code || c.caseId,
    caseId: c.caseId,
    code: c.code,
    title: agent ? agent.rest : c.title,
    fullTitle: c.title,
    tag: agent ? { label: agent.label, tone: agentToneOf(palette, agent.agent) } : null,
    station: c.station,
    stationLabel: STATION_LABEL[c.station],
    next: c.nextStep,
    health: caseHealth(c.evals),
    href: `/dashboard/${workspaceId}/casi-duso/${c.caseId}/costruzione`,
    facts,
    how,
  };
}

export interface FactoryFamilyView {
  key: string;
  /** L'ancora della famiglia: `famiglia-<nome>` (la CI vi porta), `da-avviare` senza repository. */
  anchor: string;
  name: string;
  repo: string | null;
  /** I «Dettagli»: repository, modello (e se è indietro), comune. Vuoti senza repository. */
  details: FactoryFact[];
  repoUrl: string | null;
  cases: FactoryCaseView[];
}

export interface FactoryChip {
  station: Station;
  label: string;
  count: number;
  /** L'indirizzo del chip: accende il filtro, o lo toglie se è già acceso. */
  href: string;
  active: boolean;
}

export interface FactoryScreenModel {
  workspaceId: string;
  /** Il manager di Lateral Space: vede tutti i casi, «Chi costruisce» e «Repository da aggiornare». */
  manager: boolean;
  /** (8.0d) «Solo questo use case»: i suoi casi, mai un link fuori dal suo perimetro. */
  caseOnly: boolean;
  todos: FactoryTodoView[];
  chips: FactoryChip[];
  /** Il filtro acceso, a parole («2 casi · In costruzione»); null senza. */
  filter: { station: Station; label: string } | null;
  families: FactoryFamilyView[];
  /** Tutti i casi della pagina, anche quelli che il filtro nasconde: i loro pannelli si aprono comunque. */
  cases: FactoryCaseView[];
  totalCases: number;
  queue: { repo: string; text: string }[];
}

/**
 * La pagina per chi guarda. `palette`: i toni degli agenti del workspace (gli stessi delle card degli use case);
 * `station`: il filtro di `?stazione=`; `ciTodos`: le voci della CI, solo a chi gestisce le chiavi.
 */
export function factoryScreenModel(input: {
  workspaceId: string;
  manager: boolean;
  /** (8.0d) «Solo questo use case» (mai insieme a `manager`). */
  caseOnly?: boolean;
  overview: Pick<FactoryOverview, "cases" | "families" | "todos" | "queue">;
  ciTodos: readonly CiTodo[];
  palette: AgentPalette | null;
  station: Station | null;
  clientName: string;
  now: Date;
}): FactoryScreenModel {
  const { workspaceId, overview, now } = input;
  const base = `/dashboard/${workspaceId}/agent-factory`;
  const cases = overview.cases.map((c) => factoryCaseView(workspaceId, c, input.palette, now, input.manager));
  const byId = new Map(cases.map((c) => [c.caseId, c]));
  const counts = STATIONS.map((station) => ({ station, count: overview.cases.filter((c) => c.station === station).length })).filter((s) => s.count > 0);
  const station = input.station && counts.some((s) => s.station === input.station) ? input.station : null;
  const chips: FactoryChip[] = counts.map(({ station: s, count }) => ({
    station: s,
    label: STATION_LABEL[s],
    count,
    href: s === station ? base : `${base}?stazione=${STATION_PARAM[s]}`,
    active: s === station,
  }));
  const families: FactoryFamilyView[] = overview.families
    .map((f) => {
      const behind = f.templateVersion ? compareVersions(f.templateVersion, AGENT_FACTORY_TEMPLATE_VERSION) < 0 : false;
      const details: FactoryFact[] = f.repo
        ? [
            { label: T.family.repo, value: f.repo },
            { label: T.family.template, value: f.templateVersion ? `${f.templateVersion}${behind ? ` · ${T.family.behind(AGENT_FACTORY_TEMPLATE_VERSION)}` : ""}` : T.family.unknownVersion },
            ...(f.commonVersion ? [{ label: T.family.common, value: f.commonVersion }] : []),
            // (Revisione 6b) Come si aggiorna, per chi ci lavora: «Repository da aggiornare» è solo del manager.
            ...(behind ? [{ label: T.family.update, value: T.family.updateHow }] : f.templateVersion ? [] : [{ label: T.family.update, value: T.family.unknownHow }]),
          ]
        : [];
      return {
        key: f.repo ? f.repo.toLowerCase() : "senza",
        anchor: f.repo ? familyAnchor(f.repo) : "da-avviare",
        name: familyName(f.repo),
        repo: f.repo,
        details,
        repoUrl: f.repo ? `https://github.com/${f.repo}` : null,
        cases: f.cases.flatMap((c) => {
          const view = byId.get(c.caseId);
          return view && (!station || view.station === station) ? [view] : [];
        }),
      };
    })
    .filter((f) => f.cases.length > 0);
  const todos = orderTodos([
    ...overview.todos.map((t, i) => factoryTodoView(workspaceId, t, i, input.clientName, input.caseOnly === true)),
    ...input.ciTodos.map((t) => ciTodoView(workspaceId, t)),
  ]);
  const shown = station ? cases.filter((c) => c.station === station).length : cases.length;
  return {
    workspaceId,
    manager: input.manager,
    caseOnly: input.caseOnly === true,
    todos,
    chips,
    filter: station ? { station, label: T.line.filtered(shown, STATION_LABEL[station]) } : null,
    families,
    cases,
    totalCases: cases.length,
    queue: input.manager ? [...overview.queue] : [],
  };
}

/** Le chiavi dei pannelli che la pagina sa aprire (`?apri=`): i casi, e per il manager «Chi costruisce» e la coda. */
export function factoryPanelKeys(model: Pick<FactoryScreenModel, "cases" | "manager" | "queue" | "todos">): string[] {
  return [
    ...model.cases.map((c) => c.key),
    ...(model.todos.length > FACTORY_TODO_ROWS + 1 ? [FACTORY_PANELS.todos] : []),
    ...(model.manager ? [FACTORY_PANELS.builders] : []),
    ...(model.manager && model.queue.length ? [FACTORY_PANELS.queue] : []),
  ];
}

/** Il pannello di un valore di `?apri=` (anche il codice in minuscolo), o null. */
export function factoryPanelOf(keys: readonly string[], raw: string | null | undefined): string | null {
  if (!raw) return null;
  return keys.find((k) => k === raw) ?? keys.find((k) => k.toLowerCase() === raw.toLowerCase()) ?? null;
}

/** (Prima della 6b) Le ancore della pagina di prima che ora aprono un pannello: `#team` e `#coda`. */
export const FACTORY_OLD_ANCHORS: Readonly<Record<string, string>> = Object.freeze({ team: FACTORY_PANELS.builders, coda: FACTORY_PANELS.queue });
