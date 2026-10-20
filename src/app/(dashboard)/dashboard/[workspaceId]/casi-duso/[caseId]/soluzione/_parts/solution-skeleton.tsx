import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Caricamento delle pagine di Soluzione (DESIGN §3.14): solo `Skeleton`, il
 * controllo segmentato e 8 righe `h-14`, con «Caricamento…» per i lettori di
 * schermo. Testata e schede del dossier restano sopra.
 */
export function SolutionSkeleton({ wide = false, column = false }: { wide?: boolean; column?: boolean }) {
  return (
    <PageContainer size={wide ? "wide" : "default"}>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div aria-hidden className={column ? "max-w-3xl" : undefined}>
        <Skeleton className="mb-6 h-11 w-full max-w-92 rounded-2xl sm:h-10" />
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
