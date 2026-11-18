import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/** La Home si carica: lo scheletro riserva la testata, il prossimo passo, il numero grande e le quattro righe. */
export function HomeSkeleton() {
  return (
    <PageContainer size="narrow">
      <div className="space-y-8">
        <p role="status" className="sr-only">
          Caricamento…
        </p>
        <Skeleton className="h-8 w-28" aria-hidden />
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-11 w-full rounded-lg sm:h-9 sm:w-52" />
        </div>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl" aria-hidden />
      </div>
    </PageContainer>
  );
}
