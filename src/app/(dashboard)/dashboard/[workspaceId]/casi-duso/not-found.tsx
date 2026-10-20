"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";

/**
 * Il dossier non c'è o chi guarda non ne fa parte (DESIGN §3.14): il layout del
 * caso chiama `notFound()`. Riporta alla pagina Use case.
 */
export default function CaseNotFound() {
  const params = useParams<{ workspaceId: string }>();
  const useCases = params?.workspaceId ? `/dashboard/${params.workspaceId}/use-cases` : null;
  return (
    <PageContainer size="narrow">
      <div className="space-y-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="text-lg font-semibold">Dossier non trovato</h1>
        <p className="text-sm text-muted-foreground">Il dossier non esiste o non hai accesso. Chiedi a chi lo gestisce di aggiungerti.</p>
        {useCases && (
          <Button variant="outline" className="h-11 sm:h-8" render={<Link href={useCases} />} nativeButton={false}>
            Torna agli use case
          </Button>
        )}
      </div>
    </PageContainer>
  );
}
