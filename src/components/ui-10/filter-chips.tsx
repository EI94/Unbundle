"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { UI10_TEXT } from "./text";

export interface FilterOption {
  value: string;
  label: string;
  /** Il testo del chip, se diverso dalla voce del foglio (la voce con un conteggio, un nome lungo); senza, la voce. */
  chip?: string;
}

export interface FilterField {
  /** Il parametro dell'indirizzo («area», «referente»). */
  key: string;
  label: string;
  options: readonly FilterOption[];
  /** Il valore di adesso; null: «Tutti». */
  value: string | null;
}

export interface FilterChipsProps {
  /** L'indirizzo della pagina, senza query: `/dashboard/<ws>/use-cases`. */
  basePath: string;
  /** I parametri di adesso da tenere (la vista, i filtri, la ricerca). */
  query: Readonly<Record<string, string>>;
  /** La ricerca, con il suo parametro (`q`); null: niente «Cerca». */
  search?: { param: string } | null;
  fields: readonly FilterField[];
  className?: string;
}

/** L'indirizzo con i cambi (`null` toglie il parametro), nell'ordine di `query`, poi i nuovi. */
export function filterHref(basePath: string, query: Readonly<Record<string, string>>, changes: Readonly<Record<string, string | null>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const next = Object.hasOwn(changes, key) ? changes[key] : value;
    if (next) params.set(key, next);
  }
  for (const [key, value] of Object.entries(changes)) if (value && !Object.hasOwn(query, key)) params.set(key, value);
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

/** I chip dei filtri attivi: «Area: Amministrazione», con l'indirizzo che toglie quel filtro. */
export function activeChips(p: Pick<FilterChipsProps, "basePath" | "query" | "fields">): Array<{ key: string; text: string; removeHref: string }> {
  return p.fields.flatMap((field) => {
    if (!field.value) return [];
    const option = field.options.find((o) => o.value === field.value);
    return [{ key: field.key, text: `${field.label}: ${option?.chip ?? option?.label ?? field.value}`, removeHref: filterHref(p.basePath, p.query, { [field.key]: null }) }];
  });
}

/** «Togli tutti»: l'indirizzo senza i filtri e senza la ricerca. */
export function clearAllHref(p: Pick<FilterChipsProps, "basePath" | "query" | "fields" | "search">): string {
  const changes: Record<string, null> = Object.fromEntries(p.fields.map((field) => [field.key, null]));
  if (p.search) changes[p.search.param] = null;
  return filterHref(p.basePath, p.query, changes);
}

/** I campi nascosti di un modulo GET: i parametri da tenere, tranne quelli che il modulo scrive. */
function Hidden({ query, except }: { query: Readonly<Record<string, string>>; except: ReadonlySet<string> }) {
  return (
    <>
      {Object.entries(query).map(([key, value]) => (except.has(key) || !value ? null : <input key={key} type="hidden" name={key} value={value} />))}
    </>
  );
}

/** Un modulo GET non manda i campi vuoti: «Tutti» non scrive niente nell'indirizzo. */
function dropEmpty(event: FormEvent<HTMLFormElement>) {
  for (const element of Array.from(event.currentTarget.elements)) {
    if ((element instanceof HTMLSelectElement || element instanceof HTMLInputElement) && element.name && element.value === "") element.disabled = true;
  }
}

/**
 * `FilterChips` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4, §8.3): «Cerca» (al telefono un'icona che apre il campo),
 * «Filtri (n)» che apre un foglio con tutti i filtri, sotto i chip dei filtri attivi con ✕ e «Togli tutti». I filtri
 * stanno sempre nell'indirizzo: i chip e «Togli tutti» sono link, la ricerca e il foglio moduli GET (si condivide un
 * link e si torna indietro). Sostituisce `use-cases/filter-bar.tsx`, i chip del catalogo e `uc/ui/filter-popover.tsx`.
 */
export function FilterChips({ basePath, query, search = null, fields, className }: FilterChipsProps) {
  const [sheet, setSheet] = useState(false);
  const searched = search ? (query[search.param] ?? "") : "";
  const [searching, setSearching] = useState(searched !== "");
  const chips = activeChips({ basePath, query, fields });
  const t = UI10_TEXT.filters;
  const fieldKeys = new Set(fields.map((field) => field.key));
  return (
    <div data-slot="filter-chips" className={cn("space-y-2", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {search ? (
          <>
            <Button type="button" variant="outline" size="icon" aria-label={t.search} className={cn("size-11 sm:hidden", searching && "hidden")} onClick={() => setSearching(true)}>
              <Search aria-hidden />
            </Button>
            <form role="search" method="get" action={basePath} onSubmit={dropEmpty} className={cn("min-w-0 flex-1 items-center sm:flex sm:max-w-sm", searching ? "flex" : "hidden")}>
              <Hidden query={query} except={new Set([search.param])} />
              <label className="relative block w-full">
                <span className="sr-only">{t.search}</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  name={search.param}
                  defaultValue={searched}
                  placeholder={t.search}
                  className="h-11 w-full min-w-0 rounded-lg border border-input bg-transparent pr-3 pl-9 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 sm:text-sm"
                />
              </label>
            </form>
          </>
        ) : null}
        {/* Senza filtri da scegliere niente «Filtri»: un foglio vuoto non serve (resta la ricerca). */}
        {fields.length ? (
          <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-9" onClick={() => setSheet(true)} aria-haspopup="dialog">
            <SlidersHorizontal aria-hidden data-icon="inline-start" />
            {t.open(chips.length)}
          </Button>
        ) : null}
      </div>
      {chips.length ? (
        <ul data-slot="filter-chips-active" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={chip.key} className="inline-flex min-h-8 items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-3 text-xs font-medium">
              <span>{chip.text}</span>
              {/* Il ✕ è piccolo nel chip, ma il bersaglio arriva a 44 px. */}
              <Link
                href={chip.removeHref}
                aria-label={t.remove(chip.text)}
                className="relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-1.5 after:content-[''] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon aria-hidden className="size-3.5" />
              </Link>
            </li>
          ))}
          <li>
            <Link href={clearAllHref({ basePath, query, fields, search })} className="inline-flex min-h-11 items-center rounded-md px-1 text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8">
              {t.clear}
            </Link>
          </li>
        </ul>
      ) : null}
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="right" showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          <form method="get" action={basePath} onSubmit={dropEmpty} className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="flex-row items-start gap-3 border-b px-4 py-2 sm:px-6">
              <SheetTitle className="min-w-0 flex-1 py-2.5 text-base font-semibold">{t.title}</SheetTitle>
              <SheetClose render={<Button type="button" variant="ghost" size="icon" className="-mr-2 size-11 shrink-0 sm:size-9" />}>
                <XIcon aria-hidden />
                <span className="sr-only">{UI10_TEXT.sheet.close}</span>
              </SheetClose>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
              <Hidden query={query} except={fieldKeys} />
              {fields.map((field) => (
                <label key={field.key} className="block space-y-1.5">
                  <span className="block text-sm font-medium">{field.label}</span>
                  <select
                    name={field.key}
                    defaultValue={field.value ?? ""}
                    className="h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 sm:text-sm"
                  >
                    <option value="">{t.all}</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <SheetFooter className="mt-0 border-t px-4 py-3 sm:px-6">
              <Button type="submit" className="min-h-11 w-full sm:min-h-9">
                {t.apply}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
