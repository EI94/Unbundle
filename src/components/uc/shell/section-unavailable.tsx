import { PageContainer } from "@/components/dashboard/page-container";

/** La sezione è accesa ma le sue tabelle non sono pronte (self-heal uc non riuscito): il resto dell'app funziona. */
export function SectionUnavailable() {
  return (
    <PageContainer size="narrow">
      <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="text-lg font-semibold">Sezione non disponibile</h1>
        <p className="mt-2 text-sm text-muted-foreground">I dossier non sono raggiungibili in questo momento. Riprova tra poco: il resto di Unbundle funziona come sempre.</p>
      </div>
    </PageContainer>
  );
}
