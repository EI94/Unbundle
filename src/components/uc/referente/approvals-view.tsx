"use client";

import { ApprovalRunner } from "@/components/uc/approvals/approval-runner";
import { asApprovalStep, linkOutcomeText, type ApprovalDecision } from "@/components/uc/approvals/approval-texts";
import type { ApprovalView } from "@/lib/uc/public-view";
import type { ApprovalStep } from "@/lib/uc/views/approvals";
import { approvalBody } from "@/lib/uc/views/referente-form";

/**
 * Link di approvazione (`purpose = 'approvazioni'`, DESIGN §4.5): involucro con
 * le props di sempre, così `referente-page.tsx` non cambia. Dentro c'è lo stesso
 * `ApprovalRunner` della pagina `/firme` del dossier: elenco, una decisione alla
 * volta, «Ho letto e approvo». All'API va lo stesso corpo di sempre
 * (`approvalBody`: `read: true` e l'impronta del testo mostrato).
 */

export interface ApprovalOutcome {
  ok: boolean;
  message: string;
  /** Facoltativo: `complete` dell'API. Senza, vale il messaggio della pagina (`linkOutcomeText`). */
  complete?: boolean;
  /** Facoltativo: la via aspetta solo la prova scritta (`waitingFor: 'prova_scritta'` del comando). */
  waitingForEvidence?: boolean;
}

export function ApprovalsView({ approvals, disabled, onDecide }: { approvals: ApprovalView[]; disabled: boolean; onDecide: (body: Record<string, unknown>) => Promise<ApprovalOutcome> }) {
  async function decide(approval: ApprovalStep, decision: ApprovalDecision, reason?: string): Promise<ApprovalOutcome> {
    const outcome = await onDecide(approvalBody(approval, decision, reason ?? ""));
    // L'esito con le frasi di `/firme`, anche dopo un «Non approvo» (la pagina del link scrive sempre «Firmato…»).
    return outcome.ok ? { ok: true, message: linkOutcomeText(approval, decision, outcome) } : outcome;
  }
  return (
    <div className="mt-6">
      <ApprovalRunner approvals={approvals.map(asApprovalStep)} onDecide={decide} disabled={disabled} variant="cliente" headingLevel={2} />
    </div>
  );
}
