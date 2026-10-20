import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Domande si carica (DESIGN §3.14): testata e schede restano, sotto la riga
 * dei segmenti e 8 righe di scheletro. Cambiare filtro o ricerca non passa da
 * qui: la lista resta e si attenua.
 */
export default function QuestionsLoading() {
  return (
    <PageContainer>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-10 w-full max-w-xl rounded-2xl" />
        <Skeleton className="h-8 w-full rounded-lg" />
        <div className="space-y-2 pt-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
