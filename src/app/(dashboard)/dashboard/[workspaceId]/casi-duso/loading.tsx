import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Il dossier (o la lista di ripiego) si carica (DESIGN §3.14): lo scheletro
 * riserva l'altezza della testata e delle schede, poi 8 righe.
 */
export default function CasesLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="border-b border-border" aria-hidden>
        <div className="mx-auto w-full max-w-6xl min-w-0 space-y-3 px-4 pt-6 pb-3 sm:px-6 lg:px-8">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-2 w-full max-w-xl" />
          <div className="flex gap-3 pt-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-20" />
            ))}
          </div>
        </div>
      </div>
      <PageContainer>
        <div className="max-w-3xl space-y-3" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </PageContainer>
    </div>
  );
}
