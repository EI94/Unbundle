"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * «Vista di analisi» (DESIGN §3.7.2), per Lateral Space e lo sviluppatore:
 * accesa, la Mappa mostra il grafo della soluzione al posto dell'elenco dei
 * passi. Vive nell'indirizzo (`?analisi=1`), così il link si condivide e il
 * tasto «indietro» funziona.
 */
export function AnalysisSwitch({ checked, className }: { checked: boolean; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm select-none sm:min-h-8", className)} aria-busy={pending}>
      <Switch
        checked={checked}
        onCheckedChange={(on) => {
          const next = new URLSearchParams(searchParams.toString());
          if (on) next.set("analisi", "1");
          else next.delete("analisi");
          const query = next.toString();
          startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
        }}
      />
      Vista di analisi
    </label>
  );
}
