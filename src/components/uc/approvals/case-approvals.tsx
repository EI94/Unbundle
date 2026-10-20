"use client";

import { useState } from "react";
import { decideApprovalAction, loadApprovalsAction } from "@/lib/actions/uc-approvals";
import type { ApprovalStep } from "@/lib/uc/views/approvals";
import { approvalBody } from "@/lib/uc/views/referente-form";
import type { CaseRole } from "@/lib/uc/vocab";
import { retryDossierTransition } from "@/components/uc/shell/transition-retry";
import { ApprovalRunner, type ApprovalOutcome } from "./approval-runner";
import { APPROVAL_TEXT, approvalNeedsReload, approvalVariantFor, outcomeText, type ApprovalDecision } from "./approval-texts";

/**
 * Le firme della pagina `/firme` del dossier (DESIGN §3.11): lo stesso
 * `ApprovalRunner` del link di approvazione, con la server action al posto
 * dell'API del link. Il corpo è lo stesso (`approvalBody`): `read: true` e
 * l'impronta del testo mostrato. Dopo una firma l'azione aggiorna la pagina e la
 * firma sparisce dall'elenco. Dopo «testo cambiato» o «non aspetta più»
 * l'elenco si rilegge con `loadApprovalsAction`, come `refresh()` sul link: il
 * passo aperto mostra il testo di adesso e la sua impronta, e una decisione
 * presa altrove esce dall'elenco. Si rilegge con un'azione che restituisce i
 * dati, non con `router.refresh()`: nel guscio del dossier l'aggiornamento del
 * router oggi può restare sospeso e la pagina resterebbe com'era. Il cliente
 * legge con le misure del link (A1 e A2 identici).
 */
export function CaseApprovals({ workspaceId, caseId, approvals, roles }: { workspaceId: string; caseId: string; approvals: ApprovalStep[]; roles: readonly CaseRole[] }) {
  // L'elenco del server; un elenco nuovo dalla pagina lo sostituisce, una rilettura dopo un rifiuto pure.
  const [list, setList] = useState(approvals);
  const [fromPage, setFromPage] = useState(approvals);
  if (approvals !== fromPage) {
    setFromPage(approvals);
    setList(approvals);
  }

  async function reload() {
    try {
      const r = await loadApprovalsAction(workspaceId, caseId);
      if (r.ok) setList(r.data);
    } catch {
      // Resta l'elenco di prima: il messaggio del rifiuto dice già di aggiornare la pagina.
    }
  }

  async function decide(approval: ApprovalStep, decision: ApprovalDecision, reason?: string): Promise<ApprovalOutcome> {
    try {
      const r = await decideApprovalAction(workspaceId, caseId, approvalBody(approval, decision, reason ?? ""));
      retryDossierTransition();
      if (!r.ok) {
        if (approvalNeedsReload(r.code)) await reload();
        return { ok: false, message: r.message };
      }
      return { ok: true, message: outcomeText({ side: r.data.side, decision, complete: r.data.complete, waitingForEvidence: r.data.waitingForEvidence }) };
    } catch {
      return { ok: false, message: APPROVAL_TEXT.failed };
    }
  }
  return (
    <ApprovalRunner approvals={list} onDecide={decide} variant={approvalVariantFor(roles)} headingLevel={3} empty={APPROVAL_TEXT.emptyApp} technicalRoles={roles} />
  );
}
