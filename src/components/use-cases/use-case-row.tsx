import Link from "next/link";
import { ANSWER_TEXT } from "@/lib/use-cases/answers";
import { hasValueText } from "@/lib/use-cases/format";
import { VALUE_COST_NOT_ESTIMATED_LABEL } from "@/lib/use-cases/labels";
import { PHASE_LABEL, VALUED_PILL } from "@/lib/use-cases/phase";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import { HUB_PARAM_KEYS, isContributorItem, waitingDays, waitingLabel, type AnyHubItem, type HubItem, type HubParamKey } from "@/lib/use-cases/views";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { cn } from "@/lib/utils";
import { CostFigure } from "./cost-figure";
import { InfoChip } from "./info-chip";
import { KindLabel } from "./kind-label";
import { OriginChip } from "./origin-chip";
import { PhasePill } from "./phase-pill";
import { ValueFigure } from "./value-figure";

/**
 * La riga di uno use case nella pagina «Use case» (docs/use-case/DESIGN.md §4.6) e gli
 * indirizzi della pagina (§4.2).
 *
 * Indirizzi: la pagina tiene tutto nei parametri (`?vista=`, i filtri, `?apri=`). `HubQuery`
 * sono i parametri già letti da `parseHubParams`, riscritti come testo; `hubHref` ne cambia
 * qualcuno e restituisce l'indirizzo, con le chiavi nell'ordine di §4.2. Modulo senza
 * direttiva: lo usano i pezzi del server e quelli del browser (la barra dei filtri).
 *
 * Riga dei revisori (circa 56 px): codice, titolo, origine, il tipo solo se «Da diffondere»
 * (il tipo di quasi tutte è «Da costruire»: ripeterlo su ogni riga è rumore), il Valore (gli
 * euro all'anno se ci sono, altrimenti in parola) e Costo con la fonte, oppure un solo «da
 * stimare» grigio; in «Da decidere» anche il sotto-stato e i giorni di attesa. In una riga sola quando il riquadro della pagina
 * (`@container/hub` di hub.tsx) è largo almeno 58rem (da circa 1250 px di finestra, accanto alla
 * barra laterale), con il titolo largo almeno 14rem insieme al codice: se le cifre non ci stanno,
 * Valore e Costo vanno a capo dentro la riga. Più stretto (telefono, e da 768 a circa 1250 px
 * di finestra) prima riga codice, titolo e giorni, poi il
 * resto, che va a capo se non ci sta (§4.6): il costo non si accorcia mai e la sua fonte resta
 * a schermo (D5). Riga dei contributori: titolo e, se non la dice già la scheda «In
 * valutazione», la pillola della fase (con «Quando» se approvato); delle proprie proposte anche
 * il codice, «Proposto da te» e la pillola, e in «Serve info» «Rispondi» (D4, D13, D17). Un
 * clic apre il pannello laterale (`?apri=<id>`).
 */

/** I parametri della pagina come testo (solo chiavi di `HUB_PARAM_KEYS`). */
export type HubQuery = Partial<Record<HubParamKey, string>>;

/** I parametri che non passano da una vista all'altra: pannelli e ricevute. */
export const TRANSIENT_KEYS: readonly HubParamKey[] = ["apri", "nuovo", "thanks", "created", "joined"];

/** L'indirizzo della pagina con alcuni parametri cambiati (`null` lo toglie). */
export function hubHref(basePath: string, query: HubQuery, change: Partial<Record<HubParamKey, string | null>> = {}): string {
  const merged: HubQuery = { ...query };
  for (const [key, value] of Object.entries(change) as Array<[HubParamKey, string | null | undefined]>) {
    if (value === null || value === undefined || value === "") delete merged[key];
    else merged[key] = value;
  }
  const search = new URLSearchParams();
  for (const key of HUB_PARAM_KEYS) {
    const value = merged[key];
    if (typeof value === "string" && value !== "") search.set(key, value);
  }
  const text = search.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** Le chiavi da togliere passando a un'altra vista o chiudendo un pannello. */
export function withoutTransient(query: HubQuery): HubQuery {
  const out: HubQuery = { ...query };
  for (const key of TRANSIENT_KEYS) delete out[key];
  return out;
}

/** Apre il pannello laterale di uno use case, restando dove si è. */
export function panelHref(basePath: string, query: HubQuery, id: string): string {
  return hubHref(basePath, withoutTransient(query), { apri: id });
}

/**
 * Il sotto-stato senza il nome della fase: «Da valutare · Nuova» → «Nuova». «Valutata, da
 * decidere» resta intera: una sola parola per la fase valutata, ovunque (pillola, riga, dialogo
 * «Rimanda», H7).
 */
export function subStateText(item: Pick<AnyHubItem, "phase" | "phaseLabel">): string {
  if (item.phaseLabel === VALUED_PILL) return VALUED_PILL;
  const prefix = `${PHASE_LABEL[item.phase]} · `;
  return item.phaseLabel.startsWith(prefix) ? item.phaseLabel.slice(prefix.length) : item.phaseLabel;
}

/**
 * Il sotto-stato nella riga dei revisori in «Da decidere»: dopo una risposta a «Serve info» non
 * ancora decisa «Risposta ricevuta» al posto di «Nuova» (D17), che direbbe un'idea appena arrivata.
 */
export function reviewerSubStateText(item: Pick<HubItem, "phase" | "phaseLabel" | "subState" | "answered">): string {
  return item.answered && item.subState === "nuova" ? ANSWER_TEXT.received : subStateText(item);
}

/**
 * La pillola da mostrare. Senza la parte del dossier (lettura in errore, §4.9) «In
 * realizzazione» resta senza sotto-stato: «Senza dossier» non sarebbe vero.
 */
export function shownPhaseLabel(item: Pick<AnyHubItem, "phase" | "phaseLabel">, dossierDown: boolean): string {
  return dossierDown && item.phase === "in_realizzazione" ? PHASE_LABEL.in_realizzazione : item.phaseLabel;
}

/** Il codice di uno use case, se chi guarda lo vede: i revisori sempre, i contributori solo delle proprie (D13). */
export function visibleCode(item: AnyHubItem): string | null {
  if (isContributorItem(item)) return item.own ? item.code : null;
  return item.code;
}

export function CodeLabel({ code, className }: { code: string | null; className?: string }) {
  if (!code) return null;
  return <span className={cn("shrink-0 font-mono text-xs text-muted-foreground tabular-nums", className)}>{code}</span>;
}

export interface UseCaseRowProps {
  item: AnyHubItem;
  href: string;
  /** «Da decidere»: sotto-stato e giorni di attesa. */
  variant?: "decide" | "plain";
  /** Oggi a Roma, per i giorni di attesa. */
  today: string;
  /** Le fasce del costo del workspace (D15). */
  bands?: readonly CostBandInfo[];
  /**
   * «Raccolta informazioni» della scheda (solo revisori): il chip corto, solo per gli stati che
   * chiedono a qualcuno di fare qualcosa («Info: da verificare», «Info: senza risposta»).
   */
  info?: InfoProgressView | null;
}

/** Testi della riga (§4.6, §14.3; D17). */
export const ROW_TEXT = Object.freeze({
  /**
   * Le proprie proposte del contributore (D13). Non «La tua proposta»: il glossario (§14.1) non
   * chiama «proposta» uno use case; «chi ha proposto» sì.
   */
  own: "Proposto da te",
  /** Una propria proposta in «Serve info»: si risponde dal pannello (D17). */
  answer: "Rispondi",
});

/**
 * La riga sulle proposte altrui del contributore (pannello e scheda; H7): perché vede solo titolo
 * e fase. Il nome del team da solo (§14.2).
 */
export function othersCardNote(teamName: string): string {
  return `Vedi titolo e fase: i dettagli li vedono chi l'ha proposto e ${teamName}.`;
}

/** Una riga della lista (§4.6). Il link è tutta la riga: dentro non ci sono altri controlli. */
export function UseCaseRow({ item, href, variant = "plain", today, bands, info = null }: UseCaseRowProps) {
  if (isContributorItem(item)) return <ContributorRow item={item} href={href} />;
  return <ReviewerRow item={item} href={href} variant={variant} today={today} bands={bands} info={info} />;
}

const ROW_LINK =
  "group flex min-h-14 flex-col gap-1 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50";
/**
 * Una riga sola sulla larghezza del riquadro (`@container/hub`), non della finestra: i revisori da
 * 58rem (codice, titolo, origine, sotto-stato, Valore e Costo con la fonte, giorni), come le
 * colonne della lista di «Priorità», i contributori da 42rem (titolo e pillola).
 */
const REVIEWER_ROW_LINK = `${ROW_LINK} @min-[58rem]/hub:flex-row @min-[58rem]/hub:items-center @min-[58rem]/hub:gap-4`;
/** Il titolo: due righe nel riquadro stretto, una con le colonne (le stesse larghezze di `REVIEWER_ROW_LINK`). */
const TITLE_CLAMP_REVIEWER = "line-clamp-2 break-words @min-[58rem]/hub:line-clamp-1";
const CONTRIBUTOR_ROW_LINK = `${ROW_LINK} @2xl/hub:flex-row @2xl/hub:items-center @2xl/hub:gap-4`;
const TITLE_CLAMP_CONTRIBUTOR = "line-clamp-2 break-words @2xl/hub:line-clamp-1";

/**
 * Valore e Costo nella riga (§4.6, §7.1, §7.2). Senza l'uno e senza l'altro una sola frase
 * grigia, «Valore e costo: da stimare», invece di «Valore: da stimare · Costo: da stimare» (e non
 * «da stimare» da solo, che non dice che cosa); senza uno dei due,
 * «Costo: da stimare» (o «Valore: da stimare») anche sul telefono. Il costo ha sempre la sua
 * fonte, intera: non si accorcia mai, va a capo (D5, §4.6).
 */
export function RowFigures({ item, bands }: { item: Pick<HubItem, "value" | "cost">; bands?: readonly CostBandInfo[] }) {
  if (!hasValueText(item.value) && !item.cost) {
    return (
      <span data-figure="stima" data-estimated="true" className="shrink-0 text-sm whitespace-nowrap text-muted-foreground">
        {VALUE_COST_NOT_ESTIMATED_LABEL}
      </span>
    );
  }
  return (
    <>
      {/* «Valore:» e «Costo:» a ogni larghezza: la stessa riga dice sempre quale cifra è quale (H7). Se
          la riga è stretta tutte e due vanno a capo, il Valore solo dopo «·». */}
      <ValueFigure value={item.value} withLabel wrap />
      <CostFigure cost={item.cost} bands={bands} withLabel className="min-w-0" />
    </>
  );
}

function ReviewerRow({
  item,
  href,
  variant,
  today,
  bands,
  info,
}: {
  item: HubItem;
  href: string;
  variant: "decide" | "plain";
  today: string;
  bands?: readonly CostBandInfo[];
  info: InfoProgressView | null;
}) {
  const days = variant === "decide" ? waitingLabel(waitingDays(item.waitingSince, today)) : null;
  return (
    <li data-slot="use-case-row" data-id={item.id}>
      <Link href={href} scroll={false} className={REVIEWER_ROW_LINK}>
        {/*
          Prima riga: codice, titolo e, nel riquadro stretto, i giorni di attesa. In una riga sola almeno
          14rem. Nel riquadro stretto il titolo va su due righe: con i prefissi di TopJet («LIBRA L1 · …»)
          una riga sola tagliava proprio la parte che dice che cosa fa.
        */}
        <span className="flex min-w-0 items-baseline gap-3 @min-[58rem]/hub:min-w-56 @min-[58rem]/hub:flex-1">
          <CodeLabel code={item.code} className="@min-[58rem]/hub:w-20" />
          <span className={cn("min-w-0 flex-1 font-semibold text-foreground", TITLE_CLAMP_REVIEWER)}>{item.title}</span>
          {days ? <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground @min-[58rem]/hub:hidden">{days}</span> : null}
        </span>
        {/*
          Seconda riga: origine, tipo solo se «Da diffondere», sotto-stato, cifre; nel riquadro stretto va a
          capo se non ci sta. In una riga sola si stringe accanto al titolo: Valore e Costo vanno a capo.
        */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @min-[58rem]/hub:flex-nowrap @min-[58rem]/hub:gap-x-3">
          <OriginChip origin={item.origin} className="shrink-0" />
          {item.kind === "da_diffondere" ? <KindLabel kind={item.kind} className="shrink-0" /> : null}
          {variant === "decide" ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap @min-[58rem]/hub:order-last">
              {reviewerSubStateText(item)}
            </span>
          ) : null}
          <InfoChip view={info} variant="short" className="shrink-0 @min-[58rem]/hub:order-last" />
          <RowFigures item={item} bands={bands} />
          {days ? <span className="hidden shrink-0 text-xs whitespace-nowrap text-muted-foreground @min-[58rem]/hub:order-last @min-[58rem]/hub:inline @min-[58rem]/hub:w-20 @min-[58rem]/hub:text-right">{days}</span> : null}
        </span>
      </Link>
    </li>
  );
}

/** «Proposto da te»: le proprie proposte del contributore (D13), in riga, nel pannello e nella card. */
export function OwnMarker({ className }: { className?: string }) {
  return (
    <span data-slot="own-marker" className={cn("inline-flex shrink-0 items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-sky-200", className)}>
      {ROW_TEXT.own}
    </span>
  );
}

/** Una propria proposta in «Serve info»: chi l'ha proposta risponde (D17). */
export function isAskedOfViewer(item: ContributorUseCase): item is Extract<ContributorUseCase, { own: true }> {
  return item.own && item.phase === "da_valutare" && item.subState === "serve_info";
}

function ContributorRow({ item, href }: { item: ContributorUseCase; href: string }) {
  const asked = isAskedOfViewer(item);
  // La scheda «In valutazione» dice già la fase: delle proposte altrui in «Da valutare» la
  // pillola ripeterebbe il nome della scheda su ogni riga. Le proprie la tengono (con il
  // sotto-stato, D13), e così si vedono.
  const showPhase = item.own || item.phase !== "da_valutare";
  return (
    <li data-slot="use-case-row" data-id={item.id} data-own={item.own ? "true" : undefined}>
      <Link href={href} scroll={false} className={CONTRIBUTOR_ROW_LINK}>
        <span className="flex min-w-0 items-baseline gap-3 @2xl/hub:flex-1">
          <CodeLabel code={item.own ? item.code : null} />
          <span className={cn("min-w-0 font-semibold text-foreground", TITLE_CLAMP_CONTRIBUTOR)}>{item.title}</span>
        </span>
        {showPhase ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2 @2xl/hub:shrink-0">
            {item.own ? <OwnMarker /> : null}
            <PhasePill label={item.phaseLabel} phase={item.phase} subState={item.subState} />
            {asked ? <span className="text-xs font-medium text-primary underline underline-offset-4">{ROW_TEXT.answer}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
