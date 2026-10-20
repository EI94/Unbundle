"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * «Cerca un KPI» (DESIGN §3.8): la ricerca la fa il server (`?q=`), qui si
 * aggiorna solo l'indirizzo, mezzo secondo dopo l'ultima lettera o con Invio,
 * tenendo la vista chiesta (`vista`). Il pannello aperto si chiude. Se
 * l'indirizzo cambia da fuori («Togli la ricerca», indietro), il campo lo segue.
 */
export function KpiSearch({ q, baseHref, vista }: { q: string | null; baseHref: string; vista: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(q ?? "");
  const [pushed, setPushed] = useState(q ?? "");
  const [seenQ, setSeenQ] = useState(q);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (q !== seenQ) {
    setSeenQ(q);
    if ((q ?? "") !== pushed) {
      setPushed(q ?? "");
      setValue(q ?? "");
    }
  }

  const go = (text: string) => {
    const next = text.replace(/\s+/g, " ").trim();
    if (next === pushed) return;
    setPushed(next);
    const sp = new URLSearchParams();
    if (vista) sp.set("vista", vista);
    if (next) sp.set("q", next);
    const query = sp.toString();
    startTransition(() => router.replace(query ? `${baseHref}?${query}` : baseHref, { scroll: false }));
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form
      role="search"
      className="relative w-full min-w-0 sm:w-64"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        go(value);
      }}
    >
      <label htmlFor="cerca-kpi" className="sr-only">
        Cerca un KPI
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id="cerca-kpi"
        type="search"
        value={value}
        maxLength={100}
        placeholder="Cerca un KPI"
        aria-busy={pending || undefined}
        className="min-h-11 pr-10 pl-8 sm:min-h-8 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => {
          const text = e.target.value;
          setValue(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go(text), 500);
        }}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-0.5 size-10 -translate-y-1/2 sm:size-7"
          aria-label="Togli la ricerca"
          onClick={() => {
            setValue("");
            if (timer.current) clearTimeout(timer.current);
            go("");
          }}
        >
          <X aria-hidden />
        </Button>
      )}
    </form>
  );
}
