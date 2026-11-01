import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * La scheda si carica (docs/use-case/DESIGN.md §4.9, §6.1; rilascio 3): lo scheletro neutro della
 * testata e di due blocchi, nella larghezza della scheda. Né percorso né «Prossimo passo»: lo vede
 * anche il contributore, la cui scheda non li ha.
 */
export default function UseCaseDetailLoading() {
  return (
    <PageContainer size="default">
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="mx-auto w-full max-w-5xl min-w-0 space-y-8" aria-hidden>
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-3/4" />
        </div>
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
