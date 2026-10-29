"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INFO_PROGRESS_TEXT } from "@/lib/use-cases/info-progress";
import { SEARCH_MAX, SEARCH_MIN, type HubParamKey } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { hubHref, withoutTransient, type HubQuery } from "./use-case-row";

/** Testi dei filtri (docs/use-case/DESIGN.md §4.7, §14.3). */
export const FILTER_TEXT = Object.freeze({
  originLabel: "Origine",
  originAll: "Tutte",
  kindLabel: "Tipo",
  kindAll: "Tutti",
  searchReviewer: "Cerca per titolo o codice",
  /** Al telefono, dove «Cerca per titolo o codice» non ci sta: la lente dice già «cerca». */
  searchReviewerShort: "Titolo o codice",
  searchContributor: "Cerca per titolo",
  more: "Altri filtri",
  channel: "Canale",
  area: "Area",
  agent: "Agente",
  lab: "AI Lab",
  quarter: "Trimestre",
  anyMasculine: "Tutti",
  anyFeminine: "Tutte",
  clear: "Togli i filtri",
});

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterBarProps {
  basePath: string;
  /** I parametri della pagina già letti da `parseHubParams` (vista compresa). */
  query: HubQuery;
  /** I contributori hanno solo «Cerca per titolo» (§4.7). */
  mode: "revisore" | "contributore";
  /**
   * «Tipo» è un filtro (Tutti, Da costruire, Da diffondere) in ogni vista; non c'è sulle due
   * matrici del menu «⋯», che sono solo «Da costruire».
   */
  kind: "filtro" | "nessuno";
  /**
   * Le voci di «Altri filtri», dagli use case del workspace e con il valore scelto (solo revisori).
   * `agents`: «Agente» (il prefisso del titolo, mai una persona), solo se un titolo lo ha; vuoto, il campo non c'è.
   * `infos`: «Informazioni» (Raccolta informazioni), solo gli stati che hanno una scheda; vuoto, il campo non c'è.
   */
  more?: { channels: FilterOption[]; areas: FilterOption[]; agents?: FilterOption[]; labs: FilterOption[]; quarters: FilterOption[]; infos?: FilterOption[] };
  /** Filtri attivi: compare «Togli i filtri». */
  active: boolean;
  clearHref: string;
}

const ORIGINS: FilterOption[] = [
  { value: "", label: FILTER_TEXT.originAll },
  { value: "adoption", label: "AI Adoption" },
  { value: "transformation", label: "AI Transformation" },
];

const KINDS: FilterOption[] = [
  { value: "", label: FILTER_TEXT.kindAll },
  { value: "costruire", label: "Da costruire" },
  { value: "diffondere", label: "Da diffondere" },
];

/** Larghezze del telefono: sotto `sm` di Tailwind (640 px). */
const PHONE_QUERY = "(max-width: 639.98px)";

function subscribePhone(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Vero al telefono. Sul server e durante l'idratazione falso: poi il browser lo corregge. */
function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * Dove sta «Tutte · AI Adoption · AI Transformation»: nella barra solo dal tablet (`sm`) e con la
 * pagina (`@container/hub` di hub.tsx) larga almeno 42rem (672 px), dove «Tipo», l'origine e la
 * ricerca stanno in una riga e «Altri filtri» e «Togli i filtri» nella seconda; altrimenti dentro
 * «Altri filtri», come al telefono. Più stretta (accanto alla barra laterale da 768 a circa 975 px
 * di finestra) l'origine andava a capo da sola e i controlli finivano su tre righe
 * (120 px a 768). Il contenuto di «Altri filtri» si apre fuori dal riquadro (portale): lì decide
 * `originShown`.
 */
const ORIGIN_INLINE = "sm:@2xl/hub:block";

/** Il valore «nessun filtro» dentro le scelte di «Altri filtri». */
const ANY = "__tutti__";

/** Quanto aspetta la ricerca dopo l'ultimo tasto. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * La barra dei filtri (docs/use-case/DESIGN.md §4.4, §4.7), una riga sotto le viste che va a capo
 * solo se i controlli non ci stanno: al massimo due righe di controlli prima del contenuto. Revisori: «Tipo»
 * (un filtro in ogni vista; non sulle due matrici del menu «⋯»), «Tutte · AI Adoption · AI
 * Transformation» (dentro «Altri filtri» al telefono e quando la pagina è più stretta di
 * {@link ORIGIN_INLINE}), «Cerca per titolo o codice», «Altri
 * filtri» (Canale, Area, Agente, AI Lab, Trimestre, Informazioni; «Agente» è il prefisso del titolo,
 * mai una persona). Contributori: solo «Cerca per titolo». Ogni filtro è
 * un parametro dell'indirizzo; con filtri attivi compare «Togli i filtri». Filtri per proponente
 * non esistono (art. 15.4): `parseHubParams` li scarterebbe comunque.
 */
export function FilterBar({ basePath, query, mode, kind, more, active, clearHref }: FilterBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const base = withoutTransient(query);
  const address = hubHref(basePath, query);
  /**
   * Le scelte mandate e non ancora arrivate, per l'indirizzo a schermo: una scelta fatta mentre
   * l'altra è in viaggio (un'origine, poi la ricerca) le porta tutte, invece di toglierne una.
   */
  const inFlight = useRef<{ address: string; change: Partial<Record<HubParamKey, string | null>> }>({ address, change: {} });
  /** «Tutte · AI Adoption · AI Transformation» nella barra: a schermo solo con {@link ORIGIN_INLINE}. */
  const originNav = useRef<HTMLElement>(null);
  const originShown = () => (originNav.current ? getComputedStyle(originNav.current).display !== "none" : false);

  function go(change: Partial<Record<HubParamKey, string | null>>) {
    const merged = { ...(inFlight.current.address === address ? inFlight.current.change : {}), ...change };
    inFlight.current = { address, change: merged };
    startTransition(() => {
      router.replace(hubHref(basePath, base, merged), { scroll: false });
    });
  }

  const reviewer = mode === "revisore";
  const clear = active ? (
    <Button variant="ghost" className="min-h-11 shrink-0 text-muted-foreground sm:min-h-8" render={<Link href={clearHref} scroll={false} />} nativeButton={false}>
      {FILTER_TEXT.clear}
    </Button>
  ) : null;

  return (
    // Dal tablet va a capo quando i controlli non ci stanno: accanto alla barra laterale (da 768 px)
    // restano anche solo 460 px, e una riga che non va a capo faceva scorrere di lato tutta la pagina.
    // Al telefono resta una riga: i controlli sono icone e la ricerca si stringe.
    <div data-slot="filter-bar" aria-busy={pending || undefined} className="flex min-w-0 flex-nowrap items-center gap-2 sm:flex-wrap">
      {reviewer ? (
        <>
          {kind === "filtro" ? <KindMenu value={query.tipo ?? ""} onChange={(value) => go({ tipo: value || null })} /> : null}
          <nav ref={originNav} aria-label={FILTER_TEXT.originLabel} className={cn("hidden max-w-full min-w-0 shrink-0", ORIGIN_INLINE)}>
            <ul className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1 [scrollbar-width:none]">
              {ORIGINS.map((option) => {
                const current = (query.origine ?? "") === option.value;
                return (
                  <li key={option.value || "tutte"} className="shrink-0">
                    <Link
                      href={hubHref(basePath, base, { origine: option.value || null })}
                      scroll={false}
                      aria-current={current ? "true" : undefined}
                      onClick={(event) => {
                        // Il clic semplice passa da `go`, con le scelte in viaggio; gli altri (nuova scheda) restano del link.
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        go({ origine: option.value || null });
                      }}
                      className={cn(
                        "flex min-h-11 items-center rounded-lg px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-7",
                        current ? "bg-background text-foreground shadow-sm ring-1 ring-input" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      ) : null}
      <SearchField
        initial={query.q ?? ""}
        address={hubHref(basePath, query)}
        label={reviewer ? FILTER_TEXT.searchReviewer : FILTER_TEXT.searchContributor}
        phonePlaceholder={reviewer ? FILTER_TEXT.searchReviewerShort : FILTER_TEXT.searchContributor}
        onSearch={(text) => go({ q: text })}
      />
      {reviewer && more ? <MoreFilters query={query} options={more} onChange={go} clear={clear} originShown={originShown} /> : null}
      {/* Al telefono, per i revisori, «Togli i filtri» sta dentro «Altri filtri». */}
      {clear ? <span className={cn("shrink-0", reviewer && more && "hidden sm:inline-flex")}>{clear}</span> : null}
    </div>
  );
}

function KindMenu({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const label = KINDS.find((option) => option.value === value)?.label ?? FILTER_TEXT.kindAll;
  // La scelta di partenza è «Tutti».
  const chosen = value !== "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${FILTER_TEXT.kindLabel}: ${label}`}
        render={<Button variant="outline" className="min-h-11 shrink-0 gap-1 px-2.5 sm:min-h-8" />}
      >
        {/* Al telefono la parola «Tipo» (con «1» se la scelta non è quella di partenza, come «Altri filtri»); dal tablet in su anche la scelta. */}
        <span className="sm:hidden">{FILTER_TEXT.kindLabel}</span>
        {chosen ? <span className="text-xs text-muted-foreground tabular-nums sm:hidden">1</span> : null}
        <span className="hidden sm:inline">
          <span className="text-muted-foreground">{FILTER_TEXT.kindLabel}:</span> {label}
        </span>
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(typeof next === "string" ? next : "")}>
          {KINDS.map((option) => (
            <DropdownMenuRadioItem key={option.value || "tutti"} value={option.value} className="min-h-10 sm:min-h-8">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * La ricerca: parte da sola poco dopo l'ultimo tasto, o subito con Invio; da 2 a 100 caratteri
 * (§4.2). Quando arriva una pagina nuova (`address` cambia) il campo segue l'indirizzo solo se la
 * ricerca non è la sua («Togli i filtri», avanti e indietro, un'altra navigazione che l'ha
 * superata): quando arriva la sua ricerca, quello che si sta scrivendo resta.
 */
function SearchField({
  initial,
  address,
  label,
  phonePlaceholder,
  onSearch,
}: {
  initial: string;
  /** L'indirizzo della pagina a schermo: cambia quando arriva una navigazione. */
  address: string;
  /** Il nome del campo e il segnaposto dal tablet in su (§14.3). */
  label: string;
  /** Il segnaposto al telefono, che ci sta per intero. */
  phonePlaceholder: string;
  onSearch: (text: string | null) => void;
}) {
  const phone = useIsPhone();
  const placeholder = phone ? phonePlaceholder : label;
  const [text, setText] = useState(initial);
  const [shownAddress, setShownAddress] = useState(address);
  /** L'ultima ricerca chiesta dal campo, o quella dell'indirizzo se è cambiata senza di lui. */
  const [sent, setSent] = useState(initial);
  /** Cresce quando il campo segue l'indirizzo: una ricerca ancora in attesa non parte più. */
  const [epoch, setEpoch] = useState(0);
  if (address !== shownAddress) {
    setShownAddress(address);
    if (initial !== sent) {
      setSent(initial);
      setText(initial);
      setEpoch(epoch + 1);
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `send` dell'ultimo render: il timer usa l'indirizzo e i filtri di adesso, non quelli del tasto. */
  const latestSend = useRef<(value: string, from: number) => void>(() => {});

  function send(value: string, from: number) {
    if (timer.current) clearTimeout(timer.current);
    if (from !== epoch) return;
    const trimmed = value.trim();
    const next = [...trimmed].length >= SEARCH_MIN ? trimmed : "";
    // Niente da fare solo se l'indirizzo ha già questa ricerca e non ne è partita un'altra.
    if (next === initial && next === sent) return;
    setSent(next);
    onSearch(next || null);
  }

  useEffect(() => {
    latestSend.current = send;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="relative min-w-0 flex-1 basis-24 sm:max-w-xs sm:basis-56">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        maxLength={SEARCH_MAX}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(event) => {
          const value = event.target.value;
          const from = epoch;
          setText(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => latestSend.current(value, from), SEARCH_DEBOUNCE_MS);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send(text, epoch);
          }
        }}
        className="h-11 pl-8 sm:h-8"
      />
    </div>
  );
}

function MoreFilters({
  query,
  options,
  onChange,
  clear,
  originShown,
}: {
  query: HubQuery;
  options: NonNullable<FilterBarProps["more"]>;
  onChange: (change: Partial<Record<HubParamKey, string | null>>) => void;
  /** «Togli i filtri», al telefono qui dentro. */
  clear: ReactNode;
  /** L'origine è a schermo nella barra? Se no, sta qui dentro. */
  originShown: () => boolean;
}) {
  // Deciso all'apertura, dalla barra: il contenuto si apre in un portale, fuori dal riquadro della pagina.
  const [originInside, setOriginInside] = useState(true);
  const fields: Array<{ key: HubParamKey; label: string; any: string; list: FilterOption[] }> = [
    { key: "canale", label: FILTER_TEXT.channel, any: FILTER_TEXT.anyMasculine, list: options.channels },
    { key: "area", label: FILTER_TEXT.area, any: FILTER_TEXT.anyFeminine, list: options.areas },
    // «Agente»: il prefisso del titolo («LIBRA L1 · …»), mai una persona; senza prefissi il campo non c'è.
    ...(options.agents?.length ? [{ key: "agente" as const, label: FILTER_TEXT.agent, any: FILTER_TEXT.anyMasculine, list: options.agents }] : []),
    { key: "lab", label: FILTER_TEXT.lab, any: FILTER_TEXT.anyMasculine, list: options.labs },
    { key: "trimestre", label: FILTER_TEXT.quarter, any: FILTER_TEXT.anyMasculine, list: options.quarters },
    // «Informazioni»: lo stato della raccolta di ogni scheda, mai una persona; senza stati il campo non c'è.
    ...(options.infos?.length ? [{ key: "info" as const, label: INFO_PROGRESS_TEXT.filterLabel, any: INFO_PROGRESS_TEXT.filterAny, list: options.infos }] : []),
  ];
  const count = fields.filter((field) => query[field.key]).length;
  // Quando l'origine sta qui dentro (telefono, pagina stretta) conta anche lei: le classi del numero
  // sono le stesse di ORIGIN_INLINE, rovesciate, perché il bottone sta nel riquadro della pagina.
  const countWithOrigin = count + (query.origine ? 1 : 0);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setOriginInside(!originShown());
      }}
    >
      <PopoverTrigger aria-label={FILTER_TEXT.more} render={<Button variant="outline" className="min-h-11 shrink-0 gap-1 px-2.5 sm:min-h-8" />}>
        <SlidersHorizontal aria-hidden className="text-muted-foreground" />
        <span className="hidden sm:inline">{FILTER_TEXT.more}</span>
        {countWithOrigin > 0 ? <span className="text-xs text-muted-foreground tabular-nums sm:@2xl/hub:hidden">{countWithOrigin}</span> : null}
        {count > 0 ? <span className="hidden text-xs text-muted-foreground tabular-nums sm:@2xl/hub:inline">{count}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] gap-3 p-3">
        {originInside ? (
          <MoreField
            label={FILTER_TEXT.originLabel}
            any={FILTER_TEXT.originAll}
            value={query.origine ?? null}
            list={ORIGINS.filter((option) => option.value)}
            onChange={(value) => onChange({ origine: value })}
          />
        ) : null}
        {fields.map((field) => (
          <MoreField key={field.key} label={field.label} any={field.any} value={query[field.key] ?? null} list={field.list} onChange={(value) => onChange({ [field.key]: value })} />
        ))}
        {clear ? <div className="sm:hidden">{clear}</div> : null}
      </PopoverContent>
    </Popover>
  );
}

function MoreField({ label, any, value, list, onChange }: { label: string; any: string; value: string | null; list: FilterOption[]; onChange: (value: string | null) => void }) {
  const id = useId();
  const items = [{ value: ANY, label: any }, ...list];
  return (
    <div className="grid gap-1.5">
      <Label id={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select items={items} value={value ?? ANY} onValueChange={(next) => onChange(typeof next === "string" && next !== ANY ? next : null)}>
        <SelectTrigger aria-labelledby={id} className="min-h-11 w-full sm:min-h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
