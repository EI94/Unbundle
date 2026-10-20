"use client";

import { useState } from "react";
import { CheckCircle2, ChevronRight, Circle, Mail, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { reactivateBlockerAction } from "@/lib/actions/uc-gates";
import { requestApprovalAction } from "@/lib/actions/uc-people";
import type { A8FormInput, BlockerView, SignatureLine } from "@/lib/uc/views/privacy";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { A8Form } from "./a8-form";

export interface PrivacyCardViewer {
  /** Responsabile Lateral Space che può scrivere adesso (non in sola lettura, caso né chiuso né in pausa). */
  lead: boolean;
  /** Il cliente ha indicato chi firma la privacy: gli si può mandare il link per firmare. */
  privacyDesignated: boolean;
  emailConfigured: boolean;
}

function Reactivate({ workspaceId, caseId, blockerId }: { workspaceId: string; caseId: string; blockerId: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        Riattiva il blocco
      </Button>
    );
  }
  return (
    <form
      className="w-full space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reactivateBlockerAction(workspaceId, caseId, { blockerId, reason: reason.trim() }), {
          success: "Blocco riattivato: le domande personali tornano col lucchetto.",
          onSuccess: () => setOpen(false),
        });
      }}
    >
      <Label htmlFor="uc-privacy-riattiva">Perché si riattiva</Label>
      <Input id="uc-privacy-riattiva" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="Es. scheda ritirata dal cliente" className="h-11 text-base sm:h-9 sm:text-sm" />
      <p className="text-xs text-muted-foreground">Le domande personali tornano col lucchetto, i loro link si chiudono e la zona dei dati personali si richiude per tutti.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending || reason.trim().length < 3}>
          Riattiva
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setOpen(false)}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

/**
 * Il riquadro «Scheda privacy» (DESIGN §3.10): cosa manca, le due firme
 * («Lateral Space ✓ firmata il 3 ott · Cliente ○ da firmare») e «Cosa
 * approvi», chiuso. Le azioni sono `outline`.
 *
 * - Firmare non si fa da qui: il primario della testata, «Firma la scheda
 *   privacy», porta a Firme, dove la firma viaggia con l'impronta del testo letto.
 * - Prima della registrazione il responsabile Lateral Space vede «Registra la
 *   scheda privacy», che apre il modulo in un pannello (registrare vale come
 *   sua firma).
 * - Con la scheda registrata Lateral Space può mandare il link per firmare
 *   all'approvatore privacy o correggere la scheda.
 * - Firmata da tutti e due: Lateral Space può riattivare il blocco, con il motivo.
 */
export function PrivacyCard({
  workspaceId,
  caseId,
  view,
  status,
  signatures,
  prefill,
  viewer,
  roles,
  files,
  lsMembers,
}: {
  workspaceId: string;
  caseId: string;
  view: BlockerView;
  status: { text: string; tone: SemaforoColor };
  signatures: readonly SignatureLine[];
  prefill: A8FormInput;
  viewer: PrivacyCardViewer;
  roles: readonly { key: string; label: string }[];
  files: readonly { id: string; name: string }[];
  lsMembers: readonly { userId: string; name: string }[];
}) {
  const { pending, run } = useUcAction();
  const [form, setForm] = useState<null | "registra" | "correggi">(null);
  const a8 = view.a8;
  const active = view.status === "attivo";
  const complete = a8?.evidenceComplete === true;
  const lsSigned = a8?.ls != null;
  const clientSigned = a8?.cliente != null;

  const actions: React.ReactNode[] = [];
  if (viewer.lead && active) {
    if (!complete) {
      actions.push(
        <Button key="registra" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setForm("registra")}>
          Registra la scheda privacy
        </Button>,
      );
    } else {
      if (lsSigned && !clientSigned && viewer.privacyDesignated && viewer.emailConfigured) {
        actions.push(
          <Button key="link" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => run(() => requestApprovalAction(workspaceId, caseId, { designation: "privacy" }))}>
            <Mail aria-hidden />
            Manda il link per firmare
          </Button>,
        );
      }
      actions.push(
        <Button key="correggi" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setForm("correggi")}>
          Correggi la scheda
        </Button>,
      );
    }
  }

  return (
    <section aria-labelledby="uc-scheda-privacy" className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <h3 id="uc-scheda-privacy" className="text-sm font-semibold">
        Scheda privacy
      </h3>
      <p className="mt-1 flex items-start gap-2 text-sm">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEMAFORO_TONE[status.tone].fill)} aria-hidden />
        <span className="min-w-0 break-words">{status.text}</span>
      </p>

      {signatures.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {signatures.map((s) => (
            <div key={s.role} className="flex min-w-0 items-center gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">{s.label}</dt>
              <dd className="flex min-w-0 items-center gap-1.5">
                {s.signed ? <CheckCircle2 className="size-4 shrink-0 text-uc-verde" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 break-words">{s.text}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {view.evidence.length > 0 && (
        <details className="group mt-3 min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 text-sm select-none sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
              Cosa approvi
            </span>
            <span className="text-muted-foreground">documento, versione, regioni dei dati, chi accede</span>
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 pl-5.5 text-sm sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
            {view.evidence.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {(actions.length > 0 || (viewer.lead && view.status === "sciolto")) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions}
          {viewer.lead && view.status === "sciolto" && <Reactivate workspaceId={workspaceId} caseId={caseId} blockerId={view.id} />}
        </div>
      )}

      {viewer.lead && (
        <DetailSheetFrame
          open={form !== null}
          onOpenChange={(open) => !open && setForm(null)}
          title={form === "correggi" ? "Correggi la scheda privacy" : "Registra la scheda privacy"}
          description="Registrare vale come tua firma. Poi firma l'approvatore privacy del cliente."
          size="xl"
        >
          {form !== null && (
            <A8Form
              workspaceId={workspaceId}
              caseId={caseId}
              blockerId={view.id}
              initial={prefill}
              roles={roles}
              files={files}
              lsMembers={lsMembers}
              correcting={form === "correggi"}
              onDone={() => setForm(null)}
            />
          )}
        </DetailSheetFrame>
      )}
    </section>
  );
}
