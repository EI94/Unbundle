"use client";

import { useId } from "react";
import { RotateCcw, Send } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { Button } from "@/components/ui/button";
import { remindReferentRequestAction, retryReferentRequestEmailAction } from "@/lib/actions/use-case-referents";
import type { ReferentRequestView } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import type { ReferentDialog } from "./dialogs";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_UI_TEXT;
const ACTION = "min-h-11 sm:min-h-7";

/** Una voce di «Altro» di una richiesta: si sceglie, oppure è spenta con il suo motivo. */
export type RequestMenuKey = "remind" | "add" | "revoke" | "correct" | "erase";

/**
 * (Rilascio 4, §11) Cosa si vede su una richiesta: al massimo un pulsante («Riprova l'invio» quando
 * l'email non è partita, altrimenti «Chiedi di nuovo» quando la richiesta è senza risposta e chi guarda
 * può arrivare in fondo ai passi) e il resto in «Altro», secondo lo stato. Puro, per i test.
 */
export function requestActionsShown(
  request: Pick<ReferentRequestView, "status" | "silent" | "actions">,
  canAsk: boolean,
  canAskAgain: boolean,
): { primary: "retry" | "askAgain" | null; menu: { key: RequestMenuKey; allowed: boolean; reason: string | null }[] } {
  if (!canAsk) return { primary: null, menu: [] };
  const a = request.actions;
  const primary = a.retry ? "retry" : a.askAgain && canAskAgain ? "askAgain" : null;
  const live = request.status === "inviata";
  const correct = { key: "correct" as const, allowed: a.correctEmail, reason: a.correctEmail ? null : T.correctEmailInDossier };
  const erase = { key: "erase" as const, allowed: true, reason: null };
  const menu: { key: RequestMenuKey; allowed: boolean; reason: string | null }[] = [];
  if (live) {
    menu.push({ key: "remind", allowed: a.remind.allowed, reason: a.remind.allowed ? null : a.remind.reason });
    menu.push({ key: "add", allowed: a.add.allowed, reason: a.add.allowed ? null : a.add.reason });
    if (a.revoke) menu.push({ key: "revoke", allowed: true, reason: null });
    menu.push(correct);
  } else if (request.status === "scaduta" && a.askAgain) {
    // Scaduta con domande aperte («Nessuna risposta»).
    menu.push(correct);
  } else if (request.status === "completata" && a.revoke) {
    menu.push({ key: "revoke", allowed: true, reason: null });
  }
  if (a.erase) menu.push(erase);
  return { primary, menu };
}

/**
 * Il blocco «Richieste» del capitolo «Cosa serve» (SPEC §5.2, §P2.10.7; rilascio 4 §11): per ogni
 * richiesta di questo use case, dalla più recente, il referente, una parola sola calcolata dal server
 * («In attesa», «Nessuna risposta», «Risposte ricevute», «Chiusa»), le righe già scritte dal server,
 * gli avvisi, al massimo un pulsante e «Altro». Nessun tempo di risposta, nessun «aperto», nessun
 * confronto tra persone (art. 15.4).
 */
export function RequestsList({
  bare = false,
  workspaceId,
  useCaseId,
  requests,
  canAsk,
  canAskAgain = false,
  onOpen,
}: {
  /**
   * Solo le righe, senza titolo né sezione: le mette nella sua piega chi le mostra («Richieste
   * inviate · N» di «Cosa serve», rilascio 3), che ha il titolo e l'ancora.
   */
  bare?: boolean;
  workspaceId: string;
  useCaseId: string;
  requests: readonly ReferentRequestView[];
  canAsk: boolean;
  /** (Rilascio 4) `askDialogEntry(panel).canAskAgain`: «Chiedi di nuovo» solo a chi può arrivare in fondo ai passi. */
  canAskAgain?: boolean;
  onOpen: (dialog: ReferentDialog) => void;
}) {
  const headingId = useId();
  if (requests.length === 0) return null;
  const rows = (
    <ul data-slot={bare ? "referent-requests" : undefined} className="divide-y rounded-lg border">
      {requests.map((request) => (
        <RequestRow key={request.id} workspaceId={workspaceId} useCaseId={useCaseId} request={request} canAsk={canAsk} canAskAgain={canAskAgain} onOpen={onOpen} />
      ))}
    </ul>
  );
  if (bare) return rows;
  return (
    <section aria-labelledby={headingId} data-slot="referent-requests" className="space-y-2">
      <h3 id={headingId} className="text-sm font-medium">
        {T.requestsHeading}
      </h3>
      {rows}
    </section>
  );
}

function RequestRow({
  workspaceId,
  useCaseId,
  request,
  canAsk,
  canAskAgain,
  onOpen,
}: {
  workspaceId: string;
  useCaseId: string;
  request: ReferentRequestView;
  canAsk: boolean;
  canAskAgain: boolean;
  onOpen: (dialog: ReferentDialog) => void;
}) {
  const { pending, run } = useReferentRunner();
  const shown = requestActionsShown(request, canAsk, canAskAgain);
  const contact = { id: request.contact.id, name: request.contact.name };
  const remind = () => {
    if (!pending) void run(() => remindReferentRequestAction(workspaceId, useCaseId, request.id, request.version), { inDialog: false });
  };
  const LABEL: Record<RequestMenuKey, string> = { remind: T.remind, add: T.add, revoke: T.revoke, correct: T.correctEmail, erase: T.erase };
  const ACT: Record<RequestMenuKey, () => void> = {
    remind,
    add: () => onOpen({ kind: "add", request }),
    revoke: () => onOpen({ kind: "revoke", request }),
    correct: () => onOpen({ kind: "correct", contact }),
    erase: () => onOpen({ kind: "erase", contact }),
  };
  const more: ActionMenuItem[] = shown.menu.map((item) =>
    item.allowed
      ? { label: LABEL[item.key], onSelect: ACT[item.key], ...(item.key === "erase" ? { destructive: true } : {}) }
      : { label: LABEL[item.key], disabled: true, ...(item.reason ? { hint: item.reason } : {}) },
  );

  return (
    <li data-slot="referent-request" data-status={request.status} data-id={request.id} className="space-y-2 px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium break-words">
            {request.contact.name}
            {request.contact.roleLabel ? <span className="font-normal text-muted-foreground"> · {request.contact.roleLabel}</span> : null}
          </p>
          {/* Una parola sola, senza puntino: i cinque colori restano quelli dei gruppi di «Cosa serve». */}
          <p data-slot="referent-request-word" className="text-xs font-medium">
            {request.statusLabel}
          </p>
        </div>
        {more.length ? <ActionMenu items={more} trigger="altro" label={T.more} className="shrink-0" /> : null}
      </div>
      {request.lines.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {request.lines.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {request.notices.length ? (
        <div role="status" className="space-y-0.5 text-xs text-uc-giallo">
          {request.notices.map((notice) => (
            <p key={notice} className="break-words">
              {notice}
            </p>
          ))}
        </div>
      ) : null}
      {request.email.state !== "partita" && request.email.label ? <p className="text-xs break-words text-muted-foreground">{request.email.label}</p> : null}
      {shown.primary === "retry" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ACTION}
          aria-busy={pending || undefined}
          onClick={() => {
            if (!pending) void run(() => retryReferentRequestEmailAction(workspaceId, useCaseId, request.id, request.version), { inDialog: false });
          }}
        >
          <RotateCcw aria-hidden />
          {T.retry}
        </Button>
      ) : shown.primary === "askAgain" ? (
        <Button type="button" variant="outline" size="sm" className={ACTION} onClick={() => onOpen({ kind: "again", request })}>
          <Send aria-hidden />
          {T.askAgain}
        </Button>
      ) : null}
    </li>
  );
}
