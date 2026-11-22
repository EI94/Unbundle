/**
 * «Per partire» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.3, prototipo S1b): la lista che prende il posto del
 * «Percorso» dell'Overview. La vedono solo i revisori, in un workspace nuovo, al posto del numero grande: cinque
 * righe con la spunta, e la prima riga aperta che tocca a chi guarda è il pulsante pieno della Home.
 *
 * - **Nuovo** vuol dire: nessuno use case ancora deciso (approvato, in realizzazione o realizzato). Appena il
 *   programma parte la lista sparisce, anche con una riga aperta: un workspace che lavora da mesi senza Discovery
 *   non torna all'elenco di partenza (era il difetto OV-1 dell'Overview).
 * - **Le righe**: Racconta l'azienda (la Discovery ha scritto il perimetro) · Aggiungi gli appunti delle prime call
 *   (un appunto o una trascrizione nel Contesto; gli appunti li aggiunge Lateral Space) · Mappa i processi di una
 *   funzione (un'unità mappata) · Scrivi gli obiettivi · Decidi i primi use case.
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { StepView } from "./next-step.ts";
import { workspaceBase } from "./next-step.ts";
import { HOME_TEXT } from "./text.ts";

export const START_KEYS = ["racconta", "appunti", "processi", "obiettivi", "decidi"] as const;
export type StartKey = (typeof START_KEYS)[number];

/** Che cosa c'è già nel workspace, letto sul server (`loadHomeFacts`). */
export interface StartFacts {
  /** La Discovery ha scritto il perimetro (`workspaces.system_boundary`). */
  discovery: boolean;
  /** Almeno un appunto o una trascrizione nel Contesto, chiunque li possa vedere. */
  notes: boolean;
  /** Le unità mappate o validate. */
  mappedUnits: number;
  /** Gli obiettivi scritti (`strategic_goals`, di ogni tipo). */
  goals: number;
  /** Gli use case approvati, in realizzazione o realizzati. */
  decided: number;
  /** Gli use case che aspettano una decisione (`decideCount`). */
  toDecide: number;
}

export interface StartRow {
  key: StartKey;
  label: string;
  done: boolean;
  /** Tocca a chi guarda: gli appunti li aggiunge Lateral Space, il resto ogni revisore. */
  mine: boolean;
  href: string;
}

export interface StartChecklist {
  rows: StartRow[];
  done: number;
  total: number;
  /** Il passo della Home: la prima riga aperta di chi guarda. */
  next: StepView | null;
}

export interface StartContext {
  workspaceId: string;
  isLateralSpace: boolean;
  /** La parola delle unità è quella di oggi («funzione»): la riga la nomina; con un'altra parola no. */
  defaultUnitTerm: boolean;
}

const ICON = { racconta: "racconta", appunti: "appunti", processi: "processi", obiettivi: "obiettivi", decidi: "decidi" } as const;

/**
 * La lista per chi guarda (un revisore), o null quando il workspace non è più nuovo: allora sparisce, e la Home mostra
 * il numero grande.
 */
export function startChecklist(facts: StartFacts, ctx: StartContext): StartChecklist | null {
  if (facts.decided > 0) return null;
  const base = workspaceBase(ctx.workspaceId);
  const t = HOME_TEXT.start;
  const rows: StartRow[] = [
    { key: "racconta", label: t.rows.racconta, done: facts.discovery, mine: true, href: `${base}/setup/leadership` },
    { key: "appunti", label: t.rows.appunti, done: facts.notes, mine: ctx.isLateralSpace, href: `${base}/contesto?vista=fonti` },
    { key: "processi", label: ctx.defaultUnitTerm ? t.rows.processi : t.rows.processiOther, done: facts.mappedUnits > 0, mine: true, href: `${base}/contesto?vista=processi` },
    { key: "obiettivi", label: t.rows.obiettivi, done: facts.goals > 0, mine: true, href: `${base}/strategy` },
    { key: "decidi", label: t.rows.decidi, done: false, mine: true, href: facts.toDecide > 0 ? `${base}/use-cases?vista=da-decidere` : `${base}/use-cases` },
  ];
  const done = rows.filter((row) => row.done).length;
  const mineIndex = rows.findIndex((row) => !row.done && row.mine);
  const index = mineIndex >= 0 ? mineIndex : rows.findIndex((row) => !row.done);
  const row = index >= 0 ? rows[index] : null;
  const next: StepView | null = row
    ? {
        key: `per-partire-${row.key}`,
        icon: ICON[row.key],
        label: row.mine ? (row.key === "decidi" && facts.toDecide > 0 ? t.cta.decidiCount(facts.toDecide) : t.cta[row.key]) : row.label,
        why: t.why(index),
        mine: row.mine,
        turn: row.mine ? null : t.lateralSpaceTurn,
        href: row.href,
        panel: null,
      }
    : null;
  return { rows, done, total: rows.length, next };
}
