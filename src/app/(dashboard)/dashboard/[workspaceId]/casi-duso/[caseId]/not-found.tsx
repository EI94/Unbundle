"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";
import { CASE_NOT_FOUND_TEXT } from "@/lib/uc/views/case-shell";

/**
 * Una parte della realizzazione che non c'è o non è per il ruolo di chi guarda (DESIGN §3.14). Dentro il layout del
 * caso: testata e schede restano. (Rilascio 10, §3.5) Un titolo calmo e la via d'uscita, «Torna alla Panoramica»;
 * mai «Riprova», che non può riuscire. Bordato: il pulsante pieno della schermata è quello della testata.
 */
export default function CasePageNotFound() {
  const params = useParams<{ workspaceId: string; caseId: string }>();
  const overview = params?.workspaceId && params?.caseId ? `/dashboard/${params.workspaceId}/casi-duso/${params.caseId}` : null;
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold">{CASE_NOT_FOUND_TEXT.title}</h2>
        {overview && (
          <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={overview} />} nativeButton={false}>
            {CASE_NOT_FOUND_TEXT.toOverview}
          </Button>
        )}
      </div>
    </PageContainer>
  );
}
