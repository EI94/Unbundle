import Link from "next/link";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { agentToneOf, titleAgent, type AgentPalette } from "@/lib/use-cases/agents";
import { ANSWER_TEXT } from "@/lib/use-cases/answers";
import { PHASE_LABEL, VALUED_PILL } from "@/lib/use-cases/phase";
import type { ContributorUseCase } from "@/lib/use-cases/permissions";
import { HUB_PARAM_KEYS, isContributorItem, waitingDays, waitingLabel, type AnyHubItem, type HubItem, type HubParamKey } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { AgentTag } from "./agent-tag";
import { OriginDot } from "./origin-chip";
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
 * (Rilascio 10, §3.4) Le righe stanno solo in «Da decidere». La riga dei revisori ha cinque cose: tag e titolo, il
 * codice piccolo, il sotto-stato (puntino e parola), il Valore in parole e i giorni di attesa; l'origine è un punto con
 * le parole per i lettori di schermo. In una riga sola quando il riquadro della pagina (`@container/hub` di hub.tsx) è
 * largo almeno 58rem (da circa 1250 px di finestra, accanto alla barra laterale), con il titolo largo almeno 14rem;
 * più stretto il titolo prende la sua riga e le altre quattro vanno sotto, a capo se non ci stanno (§4.6). Il costo
 * sta nel pannello, il chip del referente fuori da questa vista (anche ai contributori: lo stato resta nel pannello e
 * nella scheda, D7). Riga dei contributori: titolo e, se non la dice già la scheda «In valutazione», la pillola della
 * fase (con «Quando» se approvato); delle proprie proposte anche il codice, «Proposto da te» e la pillola, e in «Serve
 * info» «Rispondi» (D4, D13, D17). Un clic apre il pannello laterale (`?apri=<id>`).
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
  /** Oggi a Roma, per i giorni di attesa. */
  today: string;
  /** (Rilascio 10) I colori degli agenti del workspace, per il tag della riga. */
  agents?: AgentPalette | null;
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
  /**
   * (Rilascio 10, §3.4) La riga sulle proposte altrui del contributore, nel pannello: la stessa frase della scheda
   * («ad» davanti a un nome che comincia per «a»: «ad AI Builder»).
   */
  othersNote: "Dettagli visibili a chi l'ha proposto e a {team}.",
  othersNoteVowel: "Dettagli visibili a chi l'ha proposto e ad {team}.",
});

/**
 * La riga sulle proposte altrui del contributore (pannello e scheda; H7): perché vede solo titolo
 * e fase. Il nome del team da solo (§14.2).
 */
export function othersCardNote(teamName: string): string {
  const team = teamName.replace(/\s+/g, " ").trim();
  return (/^[aA]/.test(team) ? ROW_TEXT.othersNoteVowel : ROW_TEXT.othersNote).replace("{team}", () => team);
}

/** Una riga di «Da decidere» (§4.6). Il link è tutta la riga: dentro non ci sono altri controlli. */
export function UseCaseRow({ item, href, today, agents = null }: UseCaseRowProps) {
  if (isContributorItem(item)) return <ContributorRow item={item} href={href} />;
  return <DecideRow item={item} href={href} today={today} agents={agents} />;
}

const ROW_LINK =
  "group flex min-h-14 flex-col gap-1 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50";
/**
 * Una riga sola sulla larghezza del riquadro (`@container/hub`), non della finestra: i revisori da
 * 58rem (titolo, codice, sotto-stato, giorni e Valore), come le tre corsie della Panoramica, i
 * contributori da 42rem (titolo e pillola).
 */
const REVIEWER_ROW_LINK = `${ROW_LINK} @min-[58rem]/hub:flex-row @min-[58rem]/hub:items-center @min-[58rem]/hub:gap-4`;
/** Il titolo: due righe nel riquadro stretto, una con le colonne (le stesse larghezze di `REVIEWER_ROW_LINK`). */
const TITLE_CLAMP_REVIEWER = "line-clamp-2 break-words @min-[58rem]/hub:line-clamp-1";
const CONTRIBUTOR_ROW_LINK = `${ROW_LINK} @2xl/hub:flex-row @2xl/hub:items-center @2xl/hub:gap-4`;
const TITLE_CLAMP_CONTRIBUTOR = "line-clamp-2 break-words @2xl/hub:line-clamp-1";

/**
 * (Rilascio 10, §3.4) La riga di «Da decidere»: l'origine (un punto), tag e titolo (il prefisso dell'agente resta per i
 * lettori di schermo), poi il codice piccolo, il sotto-stato, i giorni di attesa e il Valore in parole. Dai 58rem del
 * riquadro una riga sola, con il titolo a sinistra e le altre quattro in colonne della stessa larghezza in ogni riga;
 * più stretto, sotto il titolo una seconda riga che va a capo se non ci sta. Il costo sta nel pannello.
 */
function DecideRow({ item, href, today, agents }: { item: HubItem; href: string; today: string; agents: AgentPalette | null }) {
  const agent = titleAgent(item.title);
  return (
    <li data-slot="use-case-row" data-id={item.id} data-variant="decide">
      <Link href={href} scroll={false} className={REVIEWER_ROW_LINK}>
        <span className="flex min-w-0 items-start gap-2 @min-[58rem]/hub:min-w-56 @min-[58rem]/hub:flex-1">
          <span className="flex h-6 shrink-0 items-center">
            <OriginDot origin={item.origin} />
          </span>
          {agent ? (
            <span className="flex h-6 shrink-0 items-center">
              <AgentTag label={agent.label} tone={agentToneOf(agents, agent.agent)} decorative />
            </span>
          ) : null}
          <span className={cn("min-w-0 flex-1 leading-6 font-semibold text-foreground", TITLE_CLAMP_REVIEWER)}>
            {agent ? (
              <>
                <span className="sr-only">{agent.prefix}</span>
                {agent.rest}
              </>
            ) : (
              item.title
            )}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @min-[58rem]/hub:shrink-0 @min-[58rem]/hub:flex-nowrap">
          <CodeLabel code={item.code} className="@min-[58rem]/hub:w-16" />
          <StatusDot tone={item.tone} label={reviewerSubStateText(item)} className="@min-[58rem]/hub:w-40" />
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground @min-[58rem]/hub:w-24">{waitingLabel(waitingDays(item.waitingSince, today))}</span>
          <ValueFigure value={item.value} withLabel className="@min-[58rem]/hub:w-44" />
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
  // sotto-stato, D13), e così si vedono. (Rilascio 10, §3.4) Lo stato del referente sta nel pannello e nella scheda.
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
            {item.own || item.phase !== "da_valutare" ? <PhasePill label={item.phaseLabel} phase={item.phase} subState={item.subState} /> : null}
            {asked ? <span className="text-xs font-medium text-primary underline underline-offset-4">{ROW_TEXT.answer}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
