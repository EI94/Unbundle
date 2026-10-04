import { cn } from "@/lib/utils";

/**
 * Contenitore delle pagine del workspace: centrato, con la stessa larghezza
 * massima e gli stessi margini ovunque, così nessuna pagina resta schiacciata
 * a sinistra sugli schermi larghi.
 * - narrow: flussi di testo e moduli (Overview, Strategia, Contesto)
 * - default: pagine con schede e liste (Impostazioni, dettagli)
 * - wide: matrici e piani
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
