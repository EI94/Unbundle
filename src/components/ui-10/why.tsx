"use client";

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UI10_TEXT } from "./text";

/**
 * Il «?» accanto a un pulsante (rilascio 6, B.1; rilascio 10, §5.4): la spiegazione si apre con un tocco, con Invio o
 * al passaggio del mouse. Il pulsante che spiega la fa leggere anche ai lettori di schermo con
 * `aria-describedby={id}`: la copia nascosta sta qui, con quell'`id`. Bersaglio di 44 px al telefono, 32 px da 640 px.
 * Senza testo non c'è.
 */
export function Why({ id, text, label = UI10_TEXT.nextStep.why }: { id: string; text: string; label?: string }) {
  if (!text) return null;
  return (
    <>
      <span id={id} className="sr-only">
        {text}
      </span>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={250}
          data-slot="why"
          render={<Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground sm:size-9" aria-label={label} />}
        >
          <CircleHelp aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" data-slot="why-text" className="w-[min(20rem,calc(100vw-2rem))] text-sm">
          <p className="break-words">{text}</p>
        </PopoverContent>
      </Popover>
    </>
  );
}
