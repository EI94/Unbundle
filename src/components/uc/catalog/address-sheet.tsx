"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SideSheet, SHEET_PARAM } from "@/components/ui-10/side-sheet";

/** L'indirizzo di adesso senza il pannello: gli altri parametri (filtri, pagina) restano. */
export function withoutSheet(pathname: string, search: string, param: string = SHEET_PARAM): string {
  const next = new URLSearchParams(search);
  next.delete(param);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Un pannello di Domande con il suo indirizzo (rilascio 10, §5.4, §8.2 regola 6): il pezzo comune `SideSheet`, reso
 * dal server solo con `?apri=` (la domanda `?apri=<id>`, l'archivio `?apri=file`), già con il contenuto. Chiuderlo
 * torna allo stesso indirizzo senza `apri`, senza scorrere: filtri e pagina della lista restano; «Indietro» lo chiude.
 */
export function AddressSheet({ title, description, footer, children }: { title: string; description?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <SideSheet open onClose={() => router.push(withoutSheet(pathname, searchParams.toString()), { scroll: false })} title={title} description={description} footer={footer}>
      {children}
    </SideSheet>
  );
}
