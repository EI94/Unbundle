"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { periodDateInput } from "@/lib/uc/views/activity-period";

/**
 * «Filtra» di Attività (DESIGN §3.12): un `Popover` con Tipo, Chi e Periodo.
 * I valori vivono nell'URL (`tipo`, `chi`, `dal`, `al`): ogni cambio porta alla
 * prima pagina con i filtri nuovi, senza scorrere e senza aggiungere voci alla
 * cronologia (`router.replace`). Le scelte ammesse per chi guarda arrivano dal
 * server (il cliente non filtra per referente).
 *
 * Tipo e Chi valgono subito. Le date si scrivono a pezzi (scrivendo l'anno,
 * «0002-10-14» è già una data valida): restano nei campi e si applicano con
 * Invio, uscendo dal campo o chiudendo «Filtra» (`periodDateInput`).
 */
export interface ActivityFilterValues {
  tipo: string | null;
  chi: string | null;
  /** Vecchio parametro dei link del Registro: resta finché non si sceglie «Chi». */
  attore: string | null;
  dal: string | null;
  al: string | null;
}

const ALL = "__tutti__";

export function ActivityFilter({
  basePath,
  families,
  who,
  values,
}: {
  basePath: string;
  families: readonly { key: string; label: string }[];
  who: readonly { key: string; label: string }[];
  values: ActivityFilterValues;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = (values.tipo ? 1 : 0) + (values.chi || values.attore ? 1 : 0) + (values.dal || values.al ? 1 : 0);
  // Le date scritte nei campi, non ancora applicate.
  const [dates, setDates] = useState({ dal: values.dal ?? "", al: values.al ?? "" });
  // Le date dell'URL viste l'ultima volta: quando cambiano (filtri applicati, «Togli i filtri», indietro) il campo cambiato le segue.
  const [seen, setSeen] = useState({ dal: values.dal, al: values.al });
  if (seen.dal !== values.dal || seen.al !== values.al) {
    setSeen({ dal: values.dal, al: values.al });
    setDates((d) => ({ dal: seen.dal !== values.dal ? (values.dal ?? "") : d.dal, al: seen.al !== values.al ? (values.al ?? "") : d.al }));
  }

  const go = (patch: Partial<ActivityFilterValues>) => {
    const next = { ...values, ...patch };
    const p = new URLSearchParams();
    if (next.tipo) p.set("tipo", next.tipo);
    if (next.chi) p.set("chi", next.chi);
    else if (next.attore) p.set("attore", next.attore);
    if (next.dal) p.set("dal", next.dal);
    if (next.al) p.set("al", next.al);
    const query = p.toString();
    startTransition(() => router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false }));
  };

  /** Applica le date dei campi, se sono cambiate: vuoto = nessun limite; una data a metà lascia quella di prima. */
  const applyDates = () => {
    const dal = periodDateInput(dates.dal, values.dal);
    const al = periodDateInput(dates.al, values.al);
    if (dal !== values.dal || al !== values.al) go({ dal, al });
  };

  const select = (id: string, label: string, options: readonly { key: string; label: string }[], value: string | null, onChange: (v: string | null) => void) => {
    const items = [{ value: ALL, label: "Tutti" }, ...options.map((o) => ({ value: o.key, label: o.label }))];
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <Select items={items} value={value ?? ALL} onValueChange={(v) => onChange(v && v !== ALL ? String(v) : null)}>
          <SelectTrigger id={id} className="min-h-11 w-full sm:min-h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const date = (id: string, label: string, key: "dal" | "al") => (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="date"
        min="2000-01-01"
        value={dates[key]}
        onChange={(e) => {
          const v = e.target.value;
          setDates((d) => ({ ...d, [key]: v }));
        }}
        onBlur={applyDates}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          applyDates();
        }}
        className="h-11 text-base sm:h-8 sm:text-sm"
      />
    </div>
  );

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) applyDates();
      }}
    >
      <PopoverTrigger render={<Button variant="outline" className="min-h-11 sm:min-h-8" aria-busy={pending || undefined} />}>
        Filtra
        {active > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums" aria-label={`${active} attivi`}>
            {active}
          </span>
        )}
        <ChevronDown aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] gap-3 p-3">
        {select("filtro-tipo", "Tipo", families, values.tipo, (v) => go({ tipo: v }))}
        {select("filtro-chi", "Chi", who, values.chi, (v) => go({ chi: v, attore: null }))}
        <fieldset className="min-w-0 space-y-1">
          <legend className="text-xs text-muted-foreground">Periodo</legend>
          <div className="grid grid-cols-2 gap-2">
            {date("filtro-dal", "Dal", "dal")}
            {date("filtro-al", "Al", "al")}
          </div>
        </fieldset>
        {active > 0 && (
          <Button type="button" variant="ghost" className="min-h-11 justify-start sm:min-h-8" onClick={() => go({ tipo: null, chi: null, attore: null, dal: null, al: null })}>
            Togli i filtri
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
