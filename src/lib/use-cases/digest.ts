/**
 * Riepilogo settimanale dell'area «Use case» in campanella (docs/use-case/DESIGN.md §14.3,
 * tabella «Campanella»; decisione D8; PIANO-LAVORI H4d).
 *
 * Due segnali in `weekly_signals`, scritti dal cron `weekly-pulse` del lunedì per ogni
 * workspace con l'area accesa, **senza AI**:
 * - `use_case_digest`: «8 use case da decidere» · «3 sono da rivedere. Il più vecchio
 *   aspetta da 12 giorni.» · link `/use-cases?vista=da-decidere`;
 * - `use_case_quarter`, solo il primo lunedì del trimestre: «Nuovo trimestre: rivedi la
 *   roadmap» · «4 use case approvati non sono partiti.» · link `/use-cases?vista=panoramica`.
 *
 * I numeri sono quelli della pagina, con le stesse funzioni di `views.ts`:
 * - «da decidere» è il contatore «Da decidere N»: tutto tranne «Serve info» (§1.2 punto 2);
 * - «da rivedere» sono quelli del sotto-stato «Da rivedere», dentro lo stesso contatore;
 * - l'attesa del più vecchio è quella della prima riga di «Da decidere» (D8): dall'ultimo
 *   «Riapri», altrimenti da `coalesce(submitted_at, created_at)`; per «Da rivedere» dalla
 *   data di revisione. Mai dall'ultimo cambio di stato;
 * - «approvati non partiti» sono gli approvati con un trimestre già finito e senza avvio,
 *   cioè quelli con «Scaduto» in testa a «Questo trimestre» della Panoramica (§3.6: «se non
 *   è partito, il tag rosso Scaduto»). Se lo stato dei dossier non si legge, il numero non si
 *   sa e non si scrive: un dossier avviato sembrerebbe un approvato fermo.
 *
 * I segnali portano solo numeri: mai titoli, testi, codici o note delle schede, mai una
 * scheda collegata (`related_entity_*` vuoti), mai una persona. Lo zero non si mostra:
 * senza use case da decidere niente riepilogo, e le frasi a zero si tolgono. Il segnale
 * del trimestre parte ogni primo lunedì del trimestre (§14.3 non mette altre condizioni):
 * senza approvati fermi, o se il numero non si sa, resta il solo titolo. Chi li vede lo
 * decide `signals.ts` (H2e): solo i revisori.
 *
 * Un riepilogo vale fino al successivo: quando il passo gira, quelli dei giorni prima
 * passano a letti (`dueHubSignalTypes`), così il numero vecchio non resta da leggere.
 *
 * Modulo puro: solo import relativi `.ts` (tipi di `schema.ts` compresi), nessun
 * `server-only`, nessun modello.
 */
import type { UseCase } from "../db/schema.ts";
import { phaseOfUseCase } from "./phase.ts";
import { isQuarterCode, parseIsoDate } from "./quarter.ts";
import type { IsoDate } from "./types.ts";
import { isToDecide, phaseInputOf, roadmapGroupKey, romeDay, waitingDays, waitingLabel, waitingStart, type HubDossier } from "./views.ts";

// ═══ Tipi e link ═════════════════════════════════════════════════════

export const USE_CASE_DIGEST_SIGNAL = "use_case_digest";
export const USE_CASE_QUARTER_SIGNAL = "use_case_quarter";
export type HubSignalType = typeof USE_CASE_DIGEST_SIGNAL | typeof USE_CASE_QUARTER_SIGNAL;

/** Dove porta ogni segnale, sotto `/dashboard/<workspace>` (§14.3). Lo monta la campanella con H4i. */
export const HUB_SIGNAL_PATH: Readonly<Record<HubSignalType, string>> = Object.freeze({
  use_case_digest: "/use-cases?vista=da-decidere",
  use_case_quarter: "/use-cases?vista=panoramica",
});

/**
 * Il nome di ogni segnale nell'etichetta di Intelligence (`signals-feed.tsx`), al posto
 * della chiave. Lo monta chi possiede quel file (H4i).
 */
export const HUB_SIGNAL_LABEL: Readonly<Record<HubSignalType, string>> = Object.freeze({
  use_case_digest: "Use case",
  use_case_quarter: "Panoramica",
});

/** Il link di un segnale del riepilogo; null per ogni altro tipo. */
export function hubSignalHref(workspaceId: string, signalType: string): string | null {
  return Object.hasOwn(HUB_SIGNAL_PATH, signalType) ? `/dashboard/${workspaceId}${HUB_SIGNAL_PATH[signalType as HubSignalType]}` : null;
}

/** Un segnale da scrivere: tipo, titolo e descrizione, nient'altro. */
export interface HubSignal {
  signalType: HubSignalType;
  title: string;
  /** null quando non resta nessuna frase (tutte a zero). */
  description: string | null;
}

/**
 * Le colonne di una scheda che il riepilogo legge: quelle della fase, l'arrivo e l'ultimo
 * «Riapri» dalla Storia. Di `intake` bastano i tre campi tecnici del connettore.
 */
export type DigestRow = Parameters<typeof phaseInputOf>[0] &
  Pick<UseCase, "id" | "submittedAt" | "createdAt"> & {
    /** Giorno (Roma) dell'ultimo «Riapri», o null. */
    reopenedOn: string | null;
  };

/** Il dossier completo di una scheda (codice e stato), o null se non ne ha. */
export type DigestDossierLookup = (useCaseId: string) => Pick<HubDossier, "code" | "status"> | null;

export interface DigestCounts {
  /** «Da decidere N»: tutto tranne «Serve info». */
  toDecide: number;
  /** Quanti di quelli da decidere sono «Da rivedere». */
  toReview: number;
  /** Giorni di attesa del più vecchio da decidere (D8); null se non ce n'è nessuno. */
  oldestWaitingDays: number | null;
  /** Approvati con il trimestre già finito e senza avvio («Scaduti»); null se i dossier non si leggono. */
  notStarted: number | null;
}

// ═══ Conteggi ════════════════════════════════════════════════════════

/**
 * I numeri del riepilogo, con la fase e l'attesa calcolate come nella pagina. `dossiers`
 * null vuol dire che lo stato dei dossier non si è letto: i conteggi di «Da decidere»
 * restano (come nella pagina, senza dossier), «approvati non partiti» diventa null.
 */
export function digestCounts(rows: readonly DigestRow[], today: string, dossiers: DigestDossierLookup | null): DigestCounts {
  let toDecide = 0;
  let toReview = 0;
  let oldest: number | null = null;
  let notStarted = 0;
  for (const row of rows) {
    const phase = phaseOfUseCase(phaseInputOf(row, dossiers ? dossiers(row.id) : null, today));
    if (isToDecide(phase) && phase.subState !== "serve_info") {
      toDecide += 1;
      if (phase.subState === "da_rivedere") toReview += 1;
      const arrivedOn = romeDay(row.submittedAt ?? row.createdAt) ?? (today as IsoDate);
      const since = waitingStart({ subState: phase.subState, reviewBy: row.reviewBy, reopenedOn: row.reopenedOn, arrivedOn });
      const days = waitingDays(since, today);
      oldest = oldest === null ? days : Math.max(oldest, days);
    }
    if (phase.phase === "approvato" && roadmapGroupKey(isQuarterCode(row.targetQuarter) ? row.targetQuarter : null, today) === "scaduti") {
      notStarted += 1;
    }
  }
  return { toDecide, toReview, oldestWaitingDays: oldest, notStarted: dossiers ? notStarted : null };
}

// ═══ Calendario ══════════════════════════════════════════════════════

/** Vero se `today` (`AAAA-MM-GG`, Roma) è il primo lunedì di gennaio, aprile, luglio o ottobre. */
export function isFirstMondayOfQuarter(today: string): boolean {
  const parsed = parseIsoDate(today);
  if (!parsed) return false;
  if ((parsed.month - 1) % 3 !== 0 || parsed.day > 7) return false;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay() === 1;
}

// ═══ Testi (§14.3) ═══════════════════════════════════════════════════

function sentences(parts: ReadonlyArray<string | null>): string | null {
  const text = parts.filter((part): part is string => part !== null).join(" ");
  return text === "" ? null : text;
}

/** «8 use case da decidere» · «3 sono da rivedere. Il più vecchio aspetta da 12 giorni.»; null senza use case da decidere. */
export function digestSignal(counts: Pick<DigestCounts, "toDecide" | "toReview" | "oldestWaitingDays">): HubSignal | null {
  const { toDecide, toReview, oldestWaitingDays } = counts;
  if (toDecide <= 0) return null;
  const review = toReview <= 0 ? null : toReview === 1 ? "1 è da rivedere." : `${toReview} sono da rivedere.`;
  const days = oldestWaitingDays ?? 0;
  const oldest = days <= 0 ? null : toDecide === 1 ? `Aspetta ${waitingLabel(days)}.` : `Il più vecchio aspetta ${waitingLabel(days)}.`;
  return { signalType: USE_CASE_DIGEST_SIGNAL, title: `${toDecide} use case da decidere`, description: sentences([review, oldest]) };
}

/**
 * «Nuovo trimestre: rivedi la roadmap» · «4 use case approvati non sono partiti.», ogni
 * primo lunedì del trimestre; altrimenti null. La frase solo con almeno un approvato fermo:
 * a zero, o se i dossier non si leggono (`notStarted` null), il segnale ha il solo titolo.
 */
export function quarterSignal(counts: Pick<DigestCounts, "notStarted">, today: string): HubSignal | null {
  if (!isFirstMondayOfQuarter(today)) return null;
  const { notStarted } = counts;
  const description =
    notStarted === null || notStarted <= 0
      ? null
      : notStarted === 1
        ? "1 use case approvato non è partito."
        : `${notStarted} use case approvati non sono partiti.`;
  return { signalType: USE_CASE_QUARTER_SIGNAL, title: "Nuovo trimestre: rivedi la roadmap", description };
}

/** I segnali della settimana per un workspace acceso, nell'ordine in cui si scrivono. */
export function hubWeeklySignals(counts: DigestCounts, today: string): HubSignal[] {
  return [digestSignal(counts), quarterSignal(counts, today)].filter((signal): signal is HubSignal => signal !== null);
}

/**
 * I tipi che il passo di `today` rinnova, anche quando non scrive niente: il riepilogo a
 * ogni giro, il trimestre il primo lunedì del trimestre. Di questi tipi i segnali dei
 * giorni prima passano a letti: il numero vecchio non è più vero (con zero da decidere il
 * riepilogo nuovo non c'è, e quello vecchio direbbe ancora «3 use case da decidere»).
 */
export function dueHubSignalTypes(today: string): HubSignalType[] {
  return isFirstMondayOfQuarter(today) ? [USE_CASE_DIGEST_SIGNAL, USE_CASE_QUARTER_SIGNAL] : [USE_CASE_DIGEST_SIGNAL];
}
