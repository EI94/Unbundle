import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/** `/valore/kpi` si carica (DESIGN §3.14): testata e schede restano; sotto il controllo e 8 righe di scheletro. */
export default function KpiLoading() {
  return (
    <PageContainer>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="max-w-4xl space-y-6" aria-hidden>
        <Skeleton className="h-5 w-20" />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Skeleton className="h-11 w-64 rounded-2xl" />
          <Skeleton className="h-11 w-full sm:h-8 sm:w-64" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
