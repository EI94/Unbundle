"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * «(i)» accanto a un valore (DESIGN §3.10, «Modalità dei dati»): la spiegazione
 * si apre con un tocco, anche al telefono, dove un suggerimento al passaggio
 * del mouse non c'è.
 */
export function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground sm:size-7" aria-label={label} />}>
        <Info aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] text-sm">
        {children}
      </PopoverContent>
    </Popover>
  );
}
