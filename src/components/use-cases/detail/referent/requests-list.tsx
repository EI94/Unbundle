"use client";

import { useId } from "react";
import { BellRing, ListPlus, RotateCcw, Send, Unlink } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Button } from "@/components/ui/button";
import { remindReferentRequestAction, retryReferentRequestEmailAction } from "@/lib/actions/use-case-referents";
import type { ReferentRequestView } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import type { ReferentDialog } from "./dialogs";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_UI_TEXT;
const ACTION = "min-h-11 sm:min-h-7";

/** Le azioni che si vedono su una richiesta: le altre stanno in «Altro». Pure, per i test. */
export function requestActionsShown(request: Pick<ReferentRequestView, "status" | "actions">, canAsk: boolean) {
  const live = request.status === "inviata";
  return {
    remind: canAsk && live,
    add: canAsk && live,
    revoke: canAsk && live && request.actions.revoke,
    askAgain: canAsk && request.actions.askAgain,
    retry: canAsk && request.actions.retry,
  };
}

/**
 * Il blocco «Richieste» del capitolo «Cosa serve» (SPEC §5.2, §P2.10.7): per ogni richiesta di
 * questo use case, dalla più recente, il referente, lo stato (puntino più parola), le righe già
 * scritte dal server, gli avvisi e le azioni. Nessun tempo di risposta, nessun «aperto», nessun
 * confronto tra persone (art. 15.4).
 */
export function RequestsList({
  workspaceId,
  useCaseId,
  requests,
  canAsk,
  onOpen,
}: {
  workspaceId: string;
  useCaseId: string;
  requests: readonly ReferentRequestView[];
  canAsk: boolean;
  onOpen: (dialog: ReferentDialog) => void;
}) {
  const headingId = useId();
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-slot="referent-requests" className="space-y-2">
      <h3 id={headingId} className="text-sm font-medium">
        {T.requestsHeading}
      </h3>
      <ul className="divide-y rounded-lg border">
        {requests.map((request) => (
          <RequestRow key={request.id} workspaceId={workspaceId} useCaseId={useCaseId} request={request} canAsk={canAsk} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  workspaceId,
  useCaseId,
  request,
  canAsk,
  onOpen,
}: {
  workspaceId: string;
  useCaseId: string;
  request: ReferentRequestView;
  canAsk: boolean;
  onOpen: (dialog: ReferentDialog) => void;
}) {
  const hintId = useId();
  const { pending, run } = useReferentRunner();
  const shown = requestActionsShown(request, canAsk);
  const contact = { id: request.contact.id, name: request.contact.name };
  const remindReason = shown.remind && !request.actions.remind.allowed ? request.actions.remind.reason : null;
  const addReason = shown.add && !request.actions.add.allowed ? request.actions.add.reason : null;
  const hints = [...new Set([remindReason, addReason].filter((hint): hint is string => Boolean(hint)))];
  const more: ActionMenuItem[] = canAsk
    ? [
        request.actions.correctEmail
          ? { label: T.correctEmail, onSelect: () => onOpen({ kind: "correct", contact }) }
          : { label: T.correctEmail, disabled: true, hint: T.correctEmailInDossier },
        ...(request.actions.erase ? [{ label: T.erase, destructive: true, onSelect: () => onOpen({ kind: "erase", contact }) }] : []),
      ]
    : [];

  return (
    <li data-slot="referent-request" data-status={request.status} data-id={request.id} className="space-y-2 px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium break-words">
            {request.contact.name}
            {request.contact.roleLabel ? <span className="font-normal text-muted-foreground"> · {request.contact.roleLabel}</span> : null}
          </p>
          <StatusDot tone={request.tone} label={request.statusLabel} />
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
        <div role="status" className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
          {request.notices.map((notice) => (
            <p key={notice} className="break-words">
              {notice}
            </p>
          ))}
        </div>
      ) : null}
      {request.email.state !== "partita" && request.email.label ? <p className="text-xs break-words text-muted-foreground">{request.email.label}</p> : null}
      {shown.askAgain || shown.retry || shown.remind || shown.add || shown.revoke ? (
        <div className="flex flex-wrap items-center gap-1">
          {shown.askAgain ? (
            <Button type="button" variant="outline" size="sm" className={ACTION} onClick={() => onOpen({ kind: "again", request })}>
              <Send aria-hidden />
              {T.askAgain}
            </Button>
          ) : null}
          {shown.retry ? (
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
          ) : null}
          {shown.remind ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ACTION}
              disabled={!request.actions.remind.allowed}
              aria-busy={pending || undefined}
              aria-describedby={remindReason ? hintId : undefined}
              onClick={() => {
                if (!pending) void run(() => remindReferentRequestAction(workspaceId, useCaseId, request.id, request.version), { inDialog: false });
              }}
            >
              <BellRing aria-hidden />
              {T.remind}
            </Button>
          ) : null}
          {shown.add ? (
            <Button type="button" variant="ghost" size="sm" className={ACTION} disabled={!request.actions.add.allowed} onClick={() => onOpen({ kind: "add", request })}>
              <ListPlus aria-hidden />
              {T.add}
            </Button>
          ) : null}
          {shown.revoke ? (
            <Button type="button" variant="ghost" size="sm" className={`${ACTION} text-muted-foreground`} onClick={() => onOpen({ kind: "revoke", request })}>
              <Unlink aria-hidden />
              {T.revoke}
            </Button>
          ) : null}
        </div>
      ) : null}
      {hints.length ? (
        <p id={hintId} className="text-xs break-words text-muted-foreground">
          {hints.join(" ")}
        </p>
      ) : null}
    </li>
  );
}
