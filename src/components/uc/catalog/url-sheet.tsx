"use client";

import { useRouter } from "next/navigation";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";

/**
 * Scheda laterale aperta da un parametro dell'URL (es. `?entita=`): il
 * contenuto arriva già pronto dal server; chiudendola si torna all'URL senza
 * il parametro. Usa la cornice di `DetailSheet` (DESIGN §5.1), che la
 * sostituirà con il parametro unico `?apri=`.
 */
export function UrlSheet({ closeHref, title, description, chips, children }: { closeHref: string; title: string; description?: string; chips?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <DetailSheetFrame
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
      title={title}
      description={description ? <span className="font-mono text-xs break-all">{description}</span> : undefined}
      chips={chips}
      size="2xl"
    >
      {children}
    </DetailSheetFrame>
  );
}
