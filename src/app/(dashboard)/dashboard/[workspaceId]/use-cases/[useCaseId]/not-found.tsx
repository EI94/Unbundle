"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";

/** I testi esatti (docs/use-case/DESIGN.md §4.9). */
const TEXT = Object.freeze({
  title: "Use case non trovato",
  body: "Forse è di un altro workspace, o il link è sbagliato.",
  back: "Torna agli use case",
});

/**
 * «Use case non trovato» (docs/use-case/DESIGN.md §4.9, §6.9): una scheda che non c'è, di un altro
 * workspace, oppure nascosta alla ricerca e non sua per un contributore. Sotto `loading.tsx` la
 * risposta è 200 e Next aggiunge `<meta name="robots" content="noindex">`: si riconosce dal
 * contenuto. Nessun dato della scheda.
 */
export default function UseCaseNotFound() {
  const params = useParams<{ workspaceId: string }>();
  const list = params?.workspaceId ? `/dashboard/${params.workspaceId}/use-cases` : null;
  return (
    <PageContainer size="default">
      <div data-slot="use-case-not-found" className="mx-auto w-full max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{TEXT.title}</h1>
        <p className="text-muted-foreground">{TEXT.body}</p>
        {list ? (
          <Button render={<Link href={list} />} nativeButton={false} className="min-h-11 sm:min-h-8">
            {TEXT.back}
          </Button>
        ) : null}
      </div>
    </PageContainer>
  );
}
