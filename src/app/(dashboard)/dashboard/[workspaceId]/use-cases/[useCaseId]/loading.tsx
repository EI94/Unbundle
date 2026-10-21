import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * La scheda si carica (docs/use-case/DESIGN.md §4.9, §6.1): lo scheletro della testata, delle
 * ancore e dei capitoli, nella colonna di lettura della scheda.
 */
export default function UseCaseDetailLoading() {
  return (
    <PageContainer size="default">
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6" aria-hidden>
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-36 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-11 w-full" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
