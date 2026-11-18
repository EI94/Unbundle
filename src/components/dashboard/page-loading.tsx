import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * (Ondata 0) Una pagina del workspace si carica: lo scheletro della testata e di qualche riga, dentro la cornice, al
 * posto di uno schermo fermo. Per le pagine senza un `loading.tsx` loro (Agent Factory, Impostazioni, Processi,
 * AI Readiness, Strategia).
 */
export function PageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <PageContainer>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div aria-hidden className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
