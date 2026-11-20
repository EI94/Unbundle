"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/dashboard/page-container";
import { PAGE_ERROR_TEXT } from "@/components/dashboard/page-load-error";

/**
 * Una parte della realizzazione che non c'è o non è per il ruolo di chi guarda (DESIGN §3.14). Dentro il layout del
 * caso: testata e schede restano, e portano dove serve. (Rilascio 10, §3.5) Un testo solo per ogni pagina che non si
 * apre, «Questa pagina non si è caricata.», con «Riprova»: niente codici, niente «caso».
 */
export default function CasePageNotFound() {
  const router = useRouter();
  return (
    <PageContainer>
      <div role="alert" className="max-w-3xl space-y-3">
        <h2 className="text-lg font-semibold">{PAGE_ERROR_TEXT.title}</h2>
        <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={() => router.refresh()}>
          {PAGE_ERROR_TEXT.retry}
        </Button>
      </div>
    </PageContainer>
  );
}
