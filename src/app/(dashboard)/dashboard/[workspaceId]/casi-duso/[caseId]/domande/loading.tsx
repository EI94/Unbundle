import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Domande si carica (DESIGN §3.14; rilascio 10, §3.5): testata e schede restano, sotto i segmenti, la barra e gli
 * argomenti chiusi (righe da 48 px). Cambiare filtro o ricerca non passa da qui: la lista resta e si attenua.
 */
export default function QuestionsLoading() {
  return (
    <PageContainer>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-10 w-full max-w-md rounded-2xl" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="space-y-2 pt-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
