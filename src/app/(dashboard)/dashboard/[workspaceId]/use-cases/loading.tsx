import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * La pagina «Use case» si carica (docs/use-case/DESIGN.md §4.9): lo scheletro della testata
 * (titolo, sottotitolo, viste e filtri) e 6 righe.
 *
 * Copre anche la scheda e `/use-cases/nuovo`: sotto questo confine la risposta parte in
 * streaming, quindi un `notFound()` risponde 200 con `noindex` e un `redirect()` con una meta
 * refresh (guida di Next `03-file-conventions/loading.md`, «Status Codes»). I redirect dei
 * vecchi indirizzi stanno fuori da qui (DESIGN §2.4).
 */
export default function UseCasesLoading() {
  return (
    <PageContainer size="default">
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div aria-hidden className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-8 w-36" />
        </div>
        <Skeleton className="h-10 w-full max-w-md rounded-2xl" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-8 w-56 max-w-full" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
