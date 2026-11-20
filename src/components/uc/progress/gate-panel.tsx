"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { EvidenceFileSelect } from "@/components/uc/overview/evidence-file-select";
import { ActionMenu } from "@/components/uc/ui/action-menu";
import { proposeGateAction, rejectGateAction, signGateAction } from "@/lib/actions/uc-gates";
import { requestApprovalAction } from "@/lib/actions/uc-people";
import type { ViaAction } from "@/lib/uc/views/progress";

export interface GatePanelProps {
  workspaceId: string;
  caseId: string;
  /** L'azione della sezione per chi guarda (`viaAction`, tabella di DESIGN §3.5). */
  action: ViaAction;
  /**
   * Il pulsante della sezione è pieno solo se la testata non ne mostra già uno
   * (DESIGN §1, principio 2): sulla Panoramica il primario della testata si
   * nasconde quando il suo comando sta qui (`stepHasPageCommand`).
   */
  filled: boolean;
  /** La proposta aperta, per firmarla o allegare la prova scritta. */
  reviewId: string | null;
  /** Caso a contratto: la prova scritta (email o verbale) serve prima dell'approvazione. */
  contractCase: boolean;
  /**
   * Dove si firma il via (`/firme`, il pannello delle firme). Null se il
   * pulsante della testata porta già lì con lo stesso testo: la sezione non lo
   * ripete.
   */
  signHref: string | null;
  files: readonly { id: string; name: string }[];
}

/**
 * I comandi della sezione «Via allo sviluppo» della Panoramica (DESIGN §3.5,
 * «Primario per stato»; rilascio 10, §3.5): proporre il via, il link per
 * firmarlo, mandare il link per firmare al responsabile del cliente, allegare la
 * prova scritta. Ogni firma la ricontrolla il server: quattro occhi, regola
 * confermata, prova scritta, domande invariate dalla proposta.
 *
 * (Rilascio 10, §3.5) Niente pulsante spento: finché il via non è pronto la
 * sezione dice «Si propone quando …» (F-036). «Non approvo» sta nel pannello
 * delle firme, con «Firma» (F-037); «Ritira la proposta» nel «⋯» della sezione
 * (`ViaWithdraw`, F-038).
 *
 * Prova scritta (casi a contratto): il selettore c'è quando si propone, mentre
 * si aspetta la firma del cliente e quando le due firme ci sono ma la prova
 * manca. Chi ha già firmato manda solo il file (`signGateAction` con
 * `evidenceFileId`): la firma non si ripete.
 */
export function GatePanel(p: GatePanelProps) {
  const { pending, run } = useUcAction();
  const [evidence, setEvidence] = useState("");
  const variant = p.filled ? "default" : "outline";
  const size = "w-full sm:w-auto";
  const a = p.action;
  const signing = a.kind === "firma_ls" || a.kind === "firma_cliente";
  const proposing = a.kind === "proponi" && !a.disabled;
  const sending = a.kind === "manda_link" && a.canSend;
  // Allegare la prova senza firmare: il primario quando le due firme ci sono, accanto a «Manda il link» mentre si aspetta il cliente.
  const attaching = a.kind === "allega_prova" || (a.kind === "manda_link" && a.attachEvidence);
  const attachVariant = sending ? "outline" : variant;

  if (!proposing && !(signing && p.signHref) && !sending && !(attaching && p.reviewId)) return null;

  return (
    <div className="min-w-0 space-y-3" data-slot="via-actions">
      {proposing && (
        <>
          {p.contractCase && (
            <EvidenceFileSelect id="uc-via-propose-evidence" label="Prova scritta (email o verbale), se ce l'hai già" files={p.files} value={evidence} onChange={setEvidence} />
          )}
          <Button
            variant={variant}
            className={size}
            disabled={pending}
            onClick={() =>
              run(() => proposeGateAction(p.workspaceId, p.caseId, { gate: "G1", evidenceFileId: evidence || null }), {
                success: "Via allo sviluppo proposto: ora servono le firme.",
                onSuccess: () => setEvidence(""),
              })
            }
          >
            Proponi il via allo sviluppo
          </Button>
        </>
      )}

      {signing && p.signHref && (
        <Button variant={variant} className={size} render={<Link href={p.signHref} />} nativeButton={false}>
          Firma il via allo sviluppo
        </Button>
      )}

      {sending && (
        <Button
          variant={variant}
          className={size}
          disabled={pending}
          onClick={() => run(() => requestApprovalAction(p.workspaceId, p.caseId, { designation: "owner" }), { success: "Link per firmare in partenza per email." })}
        >
          <Mail aria-hidden data-icon="inline-start" />
          Manda il link per firmare
        </Button>
      )}

      {a.kind === "allega_prova" && <p className="text-sm text-muted-foreground">{a.note}</p>}

      {attaching && p.reviewId && (
        <div className="min-w-0 space-y-3">
          <EvidenceFileSelect id="uc-via-attach-evidence" label="Prova scritta da allegare (email o verbale)" files={p.files} value={evidence} onChange={setEvidence} />
          {p.files.length > 0 && (
            <Button
              variant={attachVariant}
              className={size}
              disabled={pending || !evidence}
              onClick={() =>
                run(() => signGateAction(p.workspaceId, p.caseId, { reviewId: p.reviewId, evidenceFileId: evidence }), {
                  success: "Prova scritta allegata.",
                  onSuccess: () => setEvidence(""),
                })
              }
            >
              Allega la prova scritta
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Il «⋯» della sezione «Via allo sviluppo» (rilascio 10, §3.5, F-038): «Ritira
 * la proposta», solo per il responsabile Lateral Space con la proposta aperta.
 * Il motivo si scrive in una finestra dell'app, mai `window.prompt`; il server
 * ricontrolla chi può ritirare.
 */
export function ViaWithdraw({ workspaceId, caseId, reviewId }: { workspaceId: string; caseId: string; reviewId: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const close = () => {
    setOpen(false);
    setReason("");
  };
  return (
    <>
      <ActionMenu items={[{ label: "Ritira la proposta…", onSelect: () => setOpen(true) }]} label="Altre azioni sul via allo sviluppo" />
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : !pending && close())}>
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => rejectGateAction(workspaceId, caseId, { reviewId, reason: reason.trim() }), { success: "Proposta ritirata.", onSuccess: close });
            }}
          >
            <DialogHeader>
              <DialogTitle>Ritirare la proposta?</DialogTitle>
              <DialogDescription>Le firme già date si perdono: il via si propone di nuovo quando serve.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="uc-via-withdraw">Perché la ritiri</Label>
              <Textarea id="uc-via-withdraw" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} className="text-base sm:text-sm" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={close} disabled={pending}>
                Annulla
              </Button>
              <Button type="submit" variant="destructive" className="min-h-11 sm:min-h-9" disabled={pending || reason.trim().length < 3}>
                Ritira
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
