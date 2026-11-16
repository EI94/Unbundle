import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTEXT_TEXT } from "@/lib/context/text";

/** «Contesto» si carica: lo scheletro riserva il titolo, il campo della domanda, sei righe e tre blocchi. */
export default function ContextLoading() {
  return (
    <PageContainer size="narrow" className="space-y-8">
      <div role="status" aria-busy="true" aria-label={CONTEXT_TEXT.page.title} className="space-y-8">
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-11 w-full rounded-lg" aria-hidden />
        <div className="space-y-2 rounded-xl border p-4" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${92 - i * 9}%` }} />
          ))}
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2" aria-hidden>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
