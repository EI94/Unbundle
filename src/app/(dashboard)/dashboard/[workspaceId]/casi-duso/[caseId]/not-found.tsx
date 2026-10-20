"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";

/**
 * Una parte del dossier che non c'è o non è per il ruolo di chi guarda
 * (DESIGN §3.14). Dentro il layout del caso: testata e schede restano.
 */
export default function CasePageNotFound() {
  const params = useParams<{ workspaceId: string; caseId: string }>();
  const overview = params?.workspaceId && params?.caseId ? `/dashboard/${params.workspaceId}/casi-duso/${params.caseId}` : null;
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold">Pagina non trovata</h2>
        <p className="text-sm text-muted-foreground">Questa parte del caso non c&apos;è o non è per il tuo ruolo.</p>
        {overview && (
          <Button variant="outline" className="h-11 sm:h-8" render={<Link href={overview} />} nativeButton={false}>
            Torna alla Panoramica
          </Button>
        )}
      </div>
    </PageContainer>
  );
}
