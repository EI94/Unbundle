import { PageContainer } from "@/components/dashboard/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/** Una pagina del dossier si carica (DESIGN §3.14): testata e schede restano, sotto solo lo scheletro. */
export default function CasePageLoading() {
  return (
    <PageContainer>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
      <div className="max-w-3xl space-y-3" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </PageContainer>
  );
}
