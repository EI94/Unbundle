import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTEXT_TEXT } from "@/lib/context/text";

/**
 * «Contesto» si carica (rilascio 10, §3.7): lo scheletro riserva la testata (il titolo, «Aggiungi», le tre viste), il
 * campo della domanda, «In breve» e le sezioni chiuse.
 */
export default function ContextLoading() {
  return (
    <PageContainer size="narrow" className="space-y-6">
      <div role="status" aria-busy="true" aria-label={CONTEXT_TEXT.page.title} className="space-y-6">
        <div className="flex items-center justify-between gap-4" aria-hidden>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-11 w-28 rounded-lg sm:h-8" />
        </div>
        <Skeleton className="h-11 w-72 max-w-full rounded-2xl" aria-hidden />
        <Skeleton className="h-11 w-full rounded-lg" aria-hidden />
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${92 - i * 12}%` }} />
          ))}
        </div>
        <div className="space-y-0" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="mt-2 h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
