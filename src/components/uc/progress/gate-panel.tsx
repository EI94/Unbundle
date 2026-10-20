"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { EvidenceFileSelect } from "@/components/uc/overview/evidence-file-select";
import { proposeGateAction, rejectGateAction, signGateAction } from "@/lib/actions/uc-gates";
import { requestApprovalAction } from "@/lib/actions/uc-people";
import type { ViaAction } from "@/lib/uc/views/progress";

export interface GatePanelProps {
  workspaceId: string;
  caseId: string;
  /** L'azione della pagina per chi guarda (`viaAction`, tabella di DESIGN §3.5). */
  action: ViaAction;
  /**
   * Il pulsante della pagina è pieno solo se la testata non ne mostra già uno
   * (DESIGN §1, principio 2): sulla pagina in cui porta, il primario della
   * testata si nasconde e qui c'è il suo.
   */
  filled: boolean;
  /** La proposta aperta, per firmarla, allegare la prova scritta o rispondere. */
  reviewId: string | null;
  /** Caso a contratto: la prova scritta (email o verbale) serve prima dell'approvazione. */
  contractCase: boolean;
  /**
   * Dove si firma il via (`/firme`, DESIGN §3.5 «Primario per stato»). Null se
   * il pulsante della testata porta già lì con lo stesso testo: la pagina non
   * lo ripete.
   */
  signHref: string | null;
  /** «Non approvo» (responsabile del cliente) o «Ritira la proposta» (responsabile Lateral Space), con il motivo. */
  reject: "non_approvo" | "ritira" | null;
  files: readonly { id: string; name: string }[];
}

/**
 * L'azione di «Via allo sviluppo» (DESIGN §3.5, «Primario per stato»):
 * proporre il via (spento finché non è pronto, con il motivo sotto), firmarlo,
 * mandare il link per firmare al responsabile del cliente, allegare la prova
 * scritta, oppure «Non approvo». Ogni firma la ricontrolla il server: quattro
 * occhi, regola confermata, prova scritta, domande invariate dalla proposta.
 *
 * La firma si dà in `/firme`, con «Ho letto e approvo» sul testo del via: qui
 * c'è il link, se la testata non lo mostra già con lo stesso testo.
 *
 * Prova scritta (casi a contratto): il selettore c'è quando si propone, mentre
 * si aspetta la firma del cliente e quando le due firme ci sono ma la prova
 * manca. Chi ha già firmato manda solo il file (`signGateAction` con
 * `evidenceFileId`): la firma non si ripete.
 */
export function GatePanel(p: GatePanelProps) {
  const { pending, run } = useUcAction();
  const [evidence, setEvidence] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const variant = p.filled ? "default" : "outline";
  const size = "h-11 w-full sm:h-8 sm:w-auto";
  const a = p.action;
  const signing = a.kind === "firma_ls" || a.kind === "firma_cliente";
  // Allegare la prova senza firmare: il primario quando le due firme ci sono, accanto a «Manda il link» mentre si aspetta il cliente.
  const attaching = a.kind === "allega_prova" || (a.kind === "manda_link" && a.attachEvidence);
  const attachVariant = a.kind === "manda_link" && a.canSend ? "outline" : variant;

  if (a.kind === "nessuna" && !p.reject) {
    return a.note ? <p className="text-sm text-muted-foreground">{a.note}</p> : null;
  }

  return (
    <div className="min-w-0 space-y-3" data-slot="via-actions">
      {a.kind === "proponi" && (
        <>
          {p.contractCase && !a.disabled && (
            <EvidenceFileSelect id="uc-via-propose-evidence" label="Prova scritta (email o verbale), se ce l'hai già" files={p.files} value={evidence} onChange={setEvidence} />
          )}
          <Button
            variant={variant}
            className={size}
            disabled={a.disabled || pending}
            onClick={() =>
              run(() => proposeGateAction(p.workspaceId, p.caseId, { gate: "G1", evidenceFileId: evidence || null }), {
                success: "Via allo sviluppo proposto: ora servono le firme.",
                onSuccess: () => setEvidence(""),
              })
            }
          >
            Proponi il via allo sviluppo
          </Button>
          {a.note && <p className="text-sm text-muted-foreground">{a.note}</p>}
        </>
      )}

      {signing && p.signHref && (
        <Button variant={variant} className={size} render={<Link href={p.signHref} />} nativeButton={false}>
          Firma il via allo sviluppo
        </Button>
      )}

      {a.kind === "manda_link" && (
        <>
          <p className="text-sm text-muted-foreground">{a.note}</p>
          {a.canSend && (
            <Button
              variant={variant}
              className={size}
              disabled={pending}
              onClick={() => run(() => requestApprovalAction(p.workspaceId, p.caseId, { designation: "owner" }), { success: "Link per firmare in partenza per email." })}
            >
              <Mail aria-hidden />
              Manda il link per firmare
            </Button>
          )}
        </>
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

      {a.kind === "nessuna" && a.note && <p className="text-sm text-muted-foreground">{a.note}</p>}

      {p.reject && p.reviewId && !rejecting && (
        <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => setRejecting(true)}>
          {p.reject === "non_approvo" ? "Non approvo" : "Ritira la proposta"}
        </Button>
      )}
      {p.reject && p.reviewId && rejecting && (
        <form
          className="space-y-2 rounded-lg p-3 ring-1 ring-foreground/10"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => rejectGateAction(p.workspaceId, p.caseId, { reviewId: p.reviewId, reason: reason.trim() }), {
              success: p.reject === "non_approvo" ? "Risposta registrata: la proposta non è approvata." : "Proposta ritirata.",
              onSuccess: () => {
                setRejecting(false);
                setReason("");
              },
            });
          }}
        >
          <Label htmlFor="uc-via-reject">{p.reject === "non_approvo" ? "Perché non approvi" : "Perché la ritiri"}</Label>
          <Textarea id="uc-via-reject" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" className="h-11 sm:h-8" disabled={pending || reason.trim().length < 3}>
              Conferma
            </Button>
            <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={() => setRejecting(false)}>
              Annulla
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
