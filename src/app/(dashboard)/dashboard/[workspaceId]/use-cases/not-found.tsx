"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";

/** I testi della pagina «non trovato» dell'area (docs/use-case/DESIGN.md §4.9), come la scheda. */
const TEXT = Object.freeze({
  title: "Use case non trovato",
  body: "Forse è di un altro workspace, o il link è sbagliato.",
  back: "Torna agli use case",
});

/**
 * «Non trovato» delle pagine sotto `/use-cases` che non hanno un loro `not-found.tsx`: per
 * esempio `/use-cases/nuovo` con l'area spenta per il workspace (DESIGN §2.2: `notFound()`).
 * Resta dentro la barra del workspace invece della pagina di Next. Sotto `use-cases/loading.tsx`
 * la risposta è 200 e Next aggiunge `<meta name="robots" content="noindex">`: si riconosce dal
 * contenuto (PIANO-LAVORI §5.5). Nessun dato del workspace.
 */
export default function UseCasesNotFound() {
  const params = useParams<{ workspaceId: string }>();
  const list = params?.workspaceId ? `/dashboard/${params.workspaceId}/use-cases` : null;
  return (
    <PageContainer size="default">
      <div data-slot="use-cases-not-found" className="mx-auto w-full max-w-3xl space-y-3">
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
