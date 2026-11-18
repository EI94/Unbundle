import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Contenitore delle pagine del workspace: centrato, con la stessa larghezza
 * massima e gli stessi margini ovunque, così nessuna pagina resta schiacciata
 * a sinistra sugli schermi larghi. (Rilascio 10, docs/ui-10/PROPOSTA-10.md §5.3)
 * Su ogni pagina della dashboard; lo prova `page-shell.source.test.ts`.
 * - narrow (768 px): Home, Contesto, Obiettivi, moduli
 * - default (1152 px): Use case, Realizzazione, Agent Factory, Persone, Impostazioni
 * - wide (1280 px): board e grafici
 */
const SIZES = { narrow: "max-w-3xl", default: "max-w-6xl", wide: "max-w-7xl" } as const;

export function PageContainer({
  size = "default",
  className,
  children,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8", SIZES[size], className)}>
      {children}
    </div>
  );
}

/**
 * Il titolo della pagina, uno solo per pagina (rilascio 10, PROPOSTA-10 §5.2): 24/32, semibold, senza occhiello
 * maiuscolo sopra. Le pagine che scrivono l'H1 a mano usano la stessa classe.
 */
export const PAGE_TITLE_CLASS = "text-2xl font-semibold tracking-tight";

export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn(PAGE_TITLE_CLASS, className)} {...props} />;
}
