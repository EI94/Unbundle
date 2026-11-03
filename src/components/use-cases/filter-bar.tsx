"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
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
import type { ReferentFilterMenu } from "@/lib/use-cases/referent/filter";
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
  /** (Rilascio 5, §11.2) Lo stato del referente, nella prima riga. */
  referent: "Referente",
  referentAll: "Tutti",
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
  /** (Rilascio 5, §11.2) Il filtro «Referente» nella prima riga, per tutti i ruoli; null senza la funzione. */
  referent?: ReferentFilterMenu | null;
}

export type { ReferentFilterMenu } from "@/lib/use-cases/referent/filter";

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

/**
 * «Altri filtri» resta sotto o sopra il suo bottone (o la barra, al telefono), mai di lato: base-ui
 * sposta un popover a sinistra o a destra quando né sotto né sopra c'è posto per intero (in
 * orizzontale a 844 × 390, in una finestra bassa come 1280 × 500 o 1024 × 600), e lì copriva la
 * ricerca. Come le tendine di base-ui (`DROPDOWN_COLLISION_AVOIDANCE`): sopra o sotto, dove c'è più
 * spazio, alto al più quello spazio (`--available-height`) e il resto scorre dentro.
 */
export const MORE_FILTERS_COLLISION = Object.freeze({ fallbackAxisSide: "none" as const });

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
 * (Rilascio 5, §11.2) La riga dei revisori va a capo: al telefono e con la pagina stretta i pulsanti
 * nella prima riga e la ricerca sotto, per intero (`SEARCH_REVIEWER`); dai 640 px con la pagina larga
 * almeno 42rem una riga sola. Quella dei contributori resta una riga al telefono e va a capo dal tablet.
 */
export const FILTER_ROW_REVIEWER = "flex-wrap";
export const FILTER_ROW_CONTRIBUTOR = "flex-nowrap sm:flex-wrap";
export const SEARCH_REVIEWER = "order-last basis-full sm:@2xl/hub:order-none sm:@2xl/hub:max-w-xs sm:@2xl/hub:basis-56";

/** Il valore «nessun filtro» dentro le scelte di «Altri filtri». */
const ANY = "__tutti__";

/** Quanto aspetta la ricerca dopo l'ultimo tasto. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * La barra dei filtri (docs/use-case/DESIGN.md §4.4, §4.7; rilascio 5, §11.2). Revisori: dai 640 px e
 * con la pagina larga almeno 42rem una riga sola, «Referente», «Area», «Cerca per titolo o codice»,
 * «Altri filtri», «Togli i filtri»; più stretta, i pulsanti nella prima riga e la ricerca sotto, per
 * intero. «Altri filtri» ha «Tipo», «Origine», «Canale», «Agente» (il prefisso del titolo, mai una
 * persona), «AI Lab», «Trimestre» e «Informazioni». Contributori: «Referente» (solo le parole, e solo
 * quando cambia qualcosa) e «Cerca per titolo». Ogni filtro è un parametro dell'indirizzo; con filtri
 * attivi compare «Togli i filtri». Filtri per persona non esistono (art. 15.4): `parseHubParams` li
 * scarterebbe comunque.
 */
export function FilterBar({ basePath, query, mode, kind, more, active, clearHref, referent = null }: FilterBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const base = withoutTransient(query);
  const address = hubHref(basePath, query);
  /**
   * Le scelte mandate e non ancora arrivate, per l'indirizzo a schermo: una scelta fatta mentre
   * l'altra è in viaggio (un'area, poi la ricerca) le porta tutte, invece di toglierne una.
   */
  const inFlight = useRef<{ address: string; change: Partial<Record<HubParamKey, string | null>> }>({ address, change: {} });

  function go(change: Partial<Record<HubParamKey, string | null>>) {
    const merged = { ...(inFlight.current.address === address ? inFlight.current.change : {}), ...change };
    inFlight.current = { address, change: merged };
    startTransition(() => {
      router.replace(hubHref(basePath, base, merged), { scroll: false });
    });
  }

  const reviewer = mode === "revisore";
  /** La barra: al telefono «Altri filtri» si apre contro di lei, che con la ✕ non si sposta. */
  const bar = useRef<HTMLDivElement>(null);
  // Al telefono la prima riga dei revisori è piena: «Togli i filtri» è la sola ✕, 44 × 44 px, con il
  // nome per chi legge lo schermo; dal tablet in su la parola. Ai contributori la parola ci sta.
  const iconOnPhone = reviewer && Boolean(more);
  const clear = active ? (
    <Button
      variant="ghost"
      aria-label={iconOnPhone ? FILTER_TEXT.clear : undefined}
      className={cn("min-h-11 shrink-0 text-muted-foreground sm:min-h-8", iconOnPhone && "min-w-11 px-0 sm:min-w-0 sm:px-2.5")}
      render={<Link href={clearHref} scroll={false} />}
      nativeButton={false}
    >
      {iconOnPhone ? (
        <>
          <X aria-hidden className="sm:hidden" />
          <span className="hidden sm:inline">{FILTER_TEXT.clear}</span>
        </>
      ) : (
        FILTER_TEXT.clear
      )}
    </Button>
  ) : null;
  const areaOptions = reviewer ? (more?.areas ?? []) : [];

  return (
    // I revisori: al telefono (e con la pagina stretta) i pulsanti nella prima riga e la ricerca sotto,
    // per intero; dai 640 px con la pagina larga una riga. Mai di lato: nessuno scorrimento orizzontale.
    <div ref={bar} data-slot="filter-bar" aria-busy={pending || undefined} className={cn("flex min-w-0 items-center gap-2", reviewer ? FILTER_ROW_REVIEWER : FILTER_ROW_CONTRIBUTOR)}>
      {referent?.shown ? <ReferentMenu menu={referent} onChange={(value) => go({ referente: value || null })} /> : null}
      {reviewer && areaOptions.length ? <AreaMenu value={query.area ?? ""} options={areaOptions} onChange={(value) => go({ area: value || null })} /> : null}
      <SearchField
        initial={query.q ?? ""}
        address={hubHref(basePath, query)}
        label={reviewer ? FILTER_TEXT.searchReviewer : FILTER_TEXT.searchContributor}
        phonePlaceholder={reviewer ? FILTER_TEXT.searchReviewerShort : FILTER_TEXT.searchContributor}
        onSearch={(text) => go({ q: text })}
        className={reviewer ? SEARCH_REVIEWER : undefined}
      />
      {reviewer && more ? <MoreFilters query={query} options={more} kind={kind} onChange={go} anchor={bar} /> : null}
      {/* L'ultimo controllo della prima riga (al telefono, per i revisori, la ✕). */}
      {clear ? <span className="shrink-0">{clear}</span> : null}
    </div>
  );
}

/** Il pulsante di una tendina della prima riga: al telefono la parola (con «1» se c'è una scelta), dal tablet anche la scelta. */
function MenuTrigger({ name, chosen }: { name: string; chosen: string | null }) {
  return (
    <>
      <span className="sm:hidden">{name}</span>
      {chosen ? <span className="text-xs text-muted-foreground tabular-nums sm:hidden">1</span> : null}
      <span className="hidden max-w-56 truncate sm:inline">
        <span className="text-muted-foreground">{name}:</span> {chosen ?? FILTER_TEXT.referentAll}
      </span>
      <ChevronDown aria-hidden className="text-muted-foreground" />
    </>
  );
}

/** (Rilascio 5, §11.2) «Referente»: «Tutti» e gli stati, con il numero ai revisori (per stato, mai per persona). */
function ReferentMenu({ menu, onChange }: { menu: ReferentFilterMenu; onChange: (value: string) => void }) {
  const chosen = menu.options.find((option) => option.value === menu.selected) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${FILTER_TEXT.referent}: ${chosen?.word ?? FILTER_TEXT.referentAll}`}
        data-slot="filter-referent"
        render={<Button variant="outline" className="min-h-11 min-w-0 shrink gap-1 px-2.5 sm:min-h-8" />}
      >
        <MenuTrigger name={FILTER_TEXT.referent} chosen={chosen?.word ?? null} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56">
        <DropdownMenuRadioGroup value={menu.selected ?? ""} onValueChange={(next) => onChange(typeof next === "string" ? next : "")}>
          <DropdownMenuRadioItem value="" className="min-h-10 sm:min-h-8">
            {FILTER_TEXT.referentAll}
          </DropdownMenuRadioItem>
          {menu.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10 sm:min-h-8">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** (Rilascio 5, §11.2, D27) «Area»: «Tutte» e i titoli della guida delle aree usate; il valore resta l'id salvato. */
function AreaMenu({ value, options, onChange }: { value: string; options: FilterOption[]; onChange: (value: string) => void }) {
  const chosen = options.find((option) => option.value === value)?.label ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${FILTER_TEXT.area}: ${chosen ?? FILTER_TEXT.anyFeminine}`}
        data-slot="filter-area"
        render={<Button variant="outline" className="min-h-11 min-w-0 shrink gap-1 px-2.5 sm:min-h-8" />}
      >
        <span className="sm:hidden">{FILTER_TEXT.area}</span>
        {chosen ? <span className="text-xs text-muted-foreground tabular-nums sm:hidden">1</span> : null}
        <span className="hidden max-w-56 truncate sm:inline">
          <span className="text-muted-foreground">{FILTER_TEXT.area}:</span> {chosen ?? FILTER_TEXT.anyFeminine}
        </span>
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(typeof next === "string" ? next : "")}>
          <DropdownMenuRadioItem value="" className="min-h-10 sm:min-h-8">
            {FILTER_TEXT.anyFeminine}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10 sm:min-h-8">
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
  className,
}: {
  initial: string;
  /** L'indirizzo della pagina a schermo: cambia quando arriva una navigazione. */
  address: string;
  /** Il nome del campo e il segnaposto dal tablet in su (§14.3). */
  label: string;
  /** Il segnaposto al telefono, che ci sta per intero. */
  phonePlaceholder: string;
  onSearch: (text: string | null) => void;
  /** (Rilascio 5) Dove sta nella riga dei revisori: sotto i pulsanti al telefono. */
  className?: string;
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
    <div className={cn("relative min-w-0 flex-1 basis-24 sm:max-w-xs sm:basis-56", className)}>
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
        className="h-11 pl-8 text-ellipsis sm:h-8"
      />
    </div>
  );
}

function MoreFilters({
  query,
  options,
  kind,
  onChange,
  anchor,
}: {
  query: HubQuery;
  options: NonNullable<FilterBarProps["more"]>;
  /** «Tipo» è un filtro tranne sulle due matrici del menu «⋯». */
  kind: FilterBarProps["kind"];
  onChange: (change: Partial<Record<HubParamKey, string | null>>) => void;
  /** La barra dei filtri: al telefono il riquadro si apre contro di lei. */
  anchor: RefObject<HTMLDivElement | null>;
}) {
  const phone = useIsPhone();
  // (Rilascio 5, D25) «Tipo» e «Origine» stanno qui dentro; «Area» è nella prima riga.
  const fields: Array<{ key: HubParamKey; label: string; any: string; list: FilterOption[] }> = [
    ...(kind === "filtro" ? [{ key: "tipo" as const, label: FILTER_TEXT.kindLabel, any: FILTER_TEXT.kindAll, list: KINDS.filter((option) => option.value) }] : []),
    { key: "origine", label: FILTER_TEXT.originLabel, any: FILTER_TEXT.originAll, list: ORIGINS.filter((option) => option.value) },
    { key: "canale", label: FILTER_TEXT.channel, any: FILTER_TEXT.anyMasculine, list: options.channels },
    // «Agente»: il prefisso del titolo («LIBRA L1 · …»), mai una persona; senza prefissi il campo non c'è.
    ...(options.agents?.length ? [{ key: "agente" as const, label: FILTER_TEXT.agent, any: FILTER_TEXT.anyMasculine, list: options.agents }] : []),
    { key: "lab", label: FILTER_TEXT.lab, any: FILTER_TEXT.anyMasculine, list: options.labs },
    { key: "trimestre", label: FILTER_TEXT.quarter, any: FILTER_TEXT.anyMasculine, list: options.quarters },
    // «Informazioni»: lo stato della raccolta di ogni scheda, mai una persona; senza stati il campo non c'è.
    ...(options.infos?.length ? [{ key: "info" as const, label: INFO_PROGRESS_TEXT.filterLabel, any: INFO_PROGRESS_TEXT.filterAny, list: options.infos }] : []),
  ];
  const count = fields.filter((field) => query[field.key]).length;
  return (
    <Popover>
      <PopoverTrigger aria-label={FILTER_TEXT.more} render={<Button variant="outline" className="min-h-11 min-w-11 shrink-0 gap-1 px-2.5 sm:min-h-8 sm:min-w-0" />}>
        <SlidersHorizontal aria-hidden className="text-muted-foreground" />
        <span className="hidden sm:inline">{FILTER_TEXT.more}</span>
        {count > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
      </PopoverTrigger>
      {/*
        Al telefono si apre sotto (o sopra) tutta la barra, non accanto al bottone: con la ✕ in fondo
        alla riga accanto al bottone non ci sta più, e sopra o sotto di lui usciva dallo schermo. Alto
        al più lo spazio che resta, come le tendine: il resto scorre dentro. A ogni larghezza mai di
        lato (`MORE_FILTERS_COLLISION`), dove copriva la ricerca.
      */}
      <PopoverContent
        align="end"
        anchor={phone ? anchor : undefined}
        collisionAvoidance={MORE_FILTERS_COLLISION}
        className="max-h-(--available-height) w-72 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto overscroll-contain p-3"
      >
        {fields.map((field) => (
          <MoreField key={field.key} label={field.label} any={field.any} value={query[field.key] ?? null} list={field.list} onChange={(value) => onChange({ [field.key]: value })} />
        ))}
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
