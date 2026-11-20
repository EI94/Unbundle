"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";
import { CASE_NOT_FOUND_TEXT } from "@/lib/uc/views/case-shell";

/**
 * La realizzazione non c'è o chi guarda non ne fa parte (DESIGN §3.14): il layout del caso chiama `notFound()`.
 * (Rilascio 10, §3.5) Lo stesso titolo calmo delle pagine della realizzazione e la via d'uscita, «Torna agli use
 * case»: qui è il passo della schermata.
 */
export default function CaseNotFound() {
  const params = useParams<{ workspaceId: string }>();
  const useCases = params?.workspaceId ? `/dashboard/${params.workspaceId}/use-cases` : null;
  return (
    <PageContainer size="narrow">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{CASE_NOT_FOUND_TEXT.title}</h1>
        {useCases && (
          <Button className="min-h-11 sm:min-h-8" render={<Link href={useCases} />} nativeButton={false}>
            {CASE_NOT_FOUND_TEXT.toUseCases}
          </Button>
        )}
      </div>
    </PageContainer>
  );
}
