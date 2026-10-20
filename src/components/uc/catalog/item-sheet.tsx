"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { itemPath } from "./paths";

/**
 * Scheda laterale di una voce (regole, KPI, modello dati) aperta da uno stato
 * locale. Usa la cornice di `DetailSheet` (DESIGN §5.1): a destra da `sm`,
 * dal basso sul telefono, «Chiudi» in italiano. In fondo il collegamento al
 * dettaglio, se chi guarda lo può aprire.
 */
export function ItemSheet({
  open,
  onOpenChange,
  title,
  description,
  chips,
  workspaceId,
  caseId,
  itemId,
  canOpen,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  chips?: React.ReactNode;
  workspaceId: string;
  caseId: string;
  itemId: string | null;
  canOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <DetailSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description ? <span className="font-mono text-xs break-all">{description}</span> : undefined}
      chips={chips}
      size="xl"
      footer={
        canOpen && itemId ? (
          <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={itemPath(workspaceId, caseId, itemId)} />} nativeButton={false}>
            Apri il dettaglio
            <ArrowRight aria-hidden />
          </Button>
        ) : undefined
      }
    >
      {children}
    </DetailSheetFrame>
  );
}
