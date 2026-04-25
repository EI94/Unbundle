"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  deleteWorkspaceAction,
  type WorkspaceActionState,
} from "@/lib/actions/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL_STATE: WorkspaceActionState = {
  ok: true,
  message: null,
  fieldErrors: {},
};

export function DeleteWorkspaceForm({
  workspaceId,
  workspaceName,
  canDelete,
}: {
  workspaceId: string;
  workspaceName: string;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const boundAction = useMemo(
    () => deleteWorkspaceAction.bind(null, workspaceId),
    [workspaceId]
  );
  const [state, formAction, pending] = useActionState(
    boundAction,
    INITIAL_STATE
  );
  const fieldErrors = state.fieldErrors ?? {};
  const canSubmit =
    canDelete &&
    confirmationName === workspaceName &&
    acknowledged &&
    !pending;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold">Elimina workspace</h3>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            Cancella in modo permanente discovery, activity map, use case,
            documenti, ranking, Slack drafts, notifiche, report e simulazioni
            collegati a questo workspace.
          </p>
          {!canDelete && (
            <p className="text-xs text-muted-foreground">
              Serve un ruolo Executive Sponsor o Transformation Lead per usare
              questa azione.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
          disabled={!canDelete}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Elimina
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form action={formAction} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Elimina definitivamente il workspace</DialogTitle>
              <DialogDescription>
                Questa operazione rimuove il workspace e tutti i dati collegati
                dal database. I file caricati su Blob vengono rimossi dopo la
                cancellazione DB.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600">
              Workspace: <span className="font-medium">{workspaceName}</span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmationName">
                Digita il nome del workspace per confermare
              </Label>
              <Input
                id="confirmationName"
                name="confirmationName"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                autoComplete="off"
                aria-invalid={!!fieldErrors.confirmationName}
              />
              {fieldErrors.confirmationName && (
                <p className="text-xs text-red-500">
                  {fieldErrors.confirmationName}
                </p>
              )}
            </div>

            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                name="acknowledged"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 rounded border-input accent-red-600"
              />
              <span>
                Confermo che questa operazione è permanente e non può essere
                annullata dall&apos;interfaccia.
              </span>
            </label>
            {fieldErrors.acknowledged && (
              <p className="-mt-3 text-xs text-red-500">
                {fieldErrors.acknowledged}
              </p>
            )}

            {state.message && !state.ok && (
              <div
                className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500"
                role="alert"
              >
                {state.message}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Annulla
              </Button>
              <Button type="submit" variant="destructive" disabled={!canSubmit}>
                <Trash2 className="mr-1 h-4 w-4" />
                {pending ? "Eliminazione..." : "Elimina workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
