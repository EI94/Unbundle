"use client";

import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { PAGE_ERROR_TEXT } from "@/components/dashboard/page-load-error";
import { Button } from "@/components/ui/button";

/**
 * La sezione è accesa ma le sue tabelle non sono pronte (self-heal uc non riuscito): il resto dell'app funziona.
 * (Rilascio 10, §3.5) Le parole di ogni pagina che non si carica, «Questa pagina non si è caricata.» e «Riprova», che
 * rilegge la pagina dal server. Al posto del guscio: il titolo è l'H1 della pagina, e «Riprova» il suo passo.
 */
export function SectionUnavailable() {
  const router = useRouter();
  return (
    <PageContainer size="narrow">
      <div role="alert" className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{PAGE_ERROR_TEXT.title}</h1>
        <p className="text-sm text-muted-foreground">{PAGE_ERROR_TEXT.body}</p>
        <Button type="button" className="min-h-11 sm:min-h-8" onClick={() => router.refresh()}>
          {PAGE_ERROR_TEXT.retry}
        </Button>
      </div>
    </PageContainer>
  );
}
