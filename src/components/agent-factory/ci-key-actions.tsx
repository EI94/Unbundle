"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { notifyDone } from "@/components/ui-10/toast";
import { createCiKeyAction, revokeCiKeyAction, rotateCiKeyAction, type CiKeyShown } from "@/lib/actions/ci-keys";
import type { UcActionResult } from "@/lib/actions/uc-action-context";
import { CI_SECRET, CI_TEXT, ciDay, ciRepoShortName } from "./ci-text";
import type { CiMenuAction, CiPrimaryAction } from "./ci-view";

/**
 * I pulsanti della CI di una famiglia (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.6), solo per chi gestisce
 * le chiavi del repository: il pulsante della riga («Collega la CI», «Ruota la chiave», «Crea una chiave nuova»), il
 * «⋯» con «Ruota la chiave» e «Revoca la chiave», le finestre di conferma dell'app (mai `window.confirm`) e la finestra
 * con la chiave.
 *
 * - **La chiave si vede una volta**: arriva solo nella risposta di «Crea» e «Ruota» e resta in questo componente finché
 *   non si tocca «Fatto». Non va mai nell'indirizzo, in un log o in un avviso; ricaricando la pagina non c'è più. Un
 *   tocco fuori dalla finestra non la chiude (si perderebbe la chiave): la chiudono «Fatto» ed Esc.
 * - Il componente resta montato quando l'azione aggiorna la riga (`revalidatePath`): la finestra con la chiave resta
 *   aperta anche se la riga cambia stato e pulsanti.
 * - Un rifiuto (`permesso_negato`, `gia_collegata`, `rotazione_in_corso`…) si legge nella finestra, vicino a dove si
 *   agisce, e la pagina si rilegge; un'azione riuscita lo dice con un avviso breve.
 * - Pulsanti bordati, alti 44 px al telefono: il pulsante pieno della pagina è il prossimo passo; le finestre hanno il
 *   loro. «Revoca» è rosso solo nella sua conferma.
 */

type Ask = "collega" | "ruota" | "revoca";
type Shown = CiKeyShown & { rotated: boolean };

export function CiKeyActions({ workspaceId, repo, primary, menu }: { workspaceId: string; repo: string; primary: CiPrimaryAction | null; menu: readonly CiMenuAction[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const name = ciRepoShortName(repo);

  function open(next: Ask) {
    setError(null);
    setAsk(next);
  }

  function confirm(kind: Ask) {
    setError(null);
    start(async () => {
      let result: UcActionResult<CiKeyShown> | UcActionResult<{ repo: string; revoked: number }>;
      try {
        result = kind === "revoca" ? await revokeCiKeyAction(workspaceId, { repo }) : kind === "ruota" ? await rotateCiKeyAction(workspaceId, { repo }) : await createCiKeyAction(workspaceId, { repo });
      } catch {
        setError(CI_TEXT.failed);
        return;
      }
      if (!result.ok) {
        setError(result.message);
        // La riga può essere vecchia (un'altra persona ha appena agito): la pagina si rilegge.
        router.refresh();
        return;
      }
      setAsk(null);
      notifyDone(result.message ?? (kind === "revoca" ? CI_TEXT.done.revoked : CI_TEXT.done.created));
      if (kind !== "revoca") setShown({ ...(result.data as CiKeyShown), rotated: kind === "ruota" });
    });
  }

  const items: ActionMenuItem[] = menu.map((action) =>
    action === "ruota" ? { label: CI_TEXT.action.rotate, onSelect: () => open("ruota") } : { label: CI_TEXT.action.revoke, onSelect: () => open("revoca") },
  );
  const primaryLabel = primary === "collega" ? CI_TEXT.action.connect : primary === "crea" ? CI_TEXT.action.createNew : primary === "ruota" ? CI_TEXT.action.rotate : null;
  const failure = error ? (
    <p role="alert" data-slot="ci-error" className="rounded-md border border-uc-rosso bg-uc-rosso-bg px-3 py-2 text-sm break-words">
      {error}
    </p>
  ) : null;
  const onOpenChange = (next: boolean) => {
    if (!next) {
      setAsk(null);
      setError(null);
    }
  };

  return (
    <div data-slot="ci-actions" className="flex shrink-0 items-center gap-2">
      {primary && primaryLabel ? (
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => open(primary === "ruota" ? "ruota" : "collega")}>
          {primaryLabel}
        </Button>
      ) : null}
      <ActionMenu items={items} label={CI_TEXT.action.menu(name)} />

      <ConfirmDialog
        open={ask === "collega"}
        onOpenChange={onOpenChange}
        title={CI_TEXT.connect.title(name)}
        description={CI_TEXT.connect.body}
        confirmLabel={CI_TEXT.connect.confirm}
        pending={pending}
        onConfirm={() => confirm("collega")}
      >
        {failure}
      </ConfirmDialog>
      <ConfirmDialog
        open={ask === "ruota"}
        onOpenChange={onOpenChange}
        title={CI_TEXT.rotate.title(name)}
        description={CI_TEXT.rotate.body}
        confirmLabel={CI_TEXT.rotate.confirm}
        pending={pending}
        onConfirm={() => confirm("ruota")}
      >
        {failure}
      </ConfirmDialog>
      <ConfirmDialog
        open={ask === "revoca"}
        onOpenChange={onOpenChange}
        title={CI_TEXT.revoke.title(name)}
        description={CI_TEXT.revoke.body}
        confirmLabel={CI_TEXT.revoke.confirm}
        destructive
        pending={pending}
        onConfirm={() => confirm("revoca")}
      >
        {failure}
      </ConfirmDialog>

      <Dialog
        open={shown !== null}
        disablePointerDismissal
        onOpenChange={(next) => {
          // Chiusa la finestra, la chiave non resta da nessuna parte.
          if (!next) setShown(null);
        }}
      >
        {shown ? (
          <DialogContent showCloseButton={false} data-ci-key-dialog="" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
            <CiKeyShownBody repo={shown.repo} keyValue={shown.key} expiresAt={shown.expiresAt} rotated={shown.rotated} />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

/** «UNBUNDLE_CI_TOKEN» come codice dentro la frase dei passi. */
function withSecret(text: string) {
  const at = text.indexOf(CI_SECRET);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] break-all text-foreground">{CI_SECRET}</code>
      {text.slice(at + CI_SECRET.length)}
    </>
  );
}

/**
 * Il contenuto della finestra con la chiave, dentro un `Dialog` aperto (si prova da solo: la finestra si apre solo nel
 * browser). Il titolo; «Copiala adesso: dopo non si vede più.»; il campo con «Copia»; i passi su GitHub con il nome del
 * segreto; in piccolo fino a quando vale; «Fatto», il pulsante della finestra.
 */
export function CiKeyShownBody({ repo, keyValue, expiresAt, rotated }: { repo: string; keyValue: string; expiresAt: string; rotated: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const name = ciRepoShortName(repo);

  async function copy() {
    try {
      await navigator.clipboard.writeText(keyValue);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div data-slot="ci-key-shown" className="grid min-w-0 gap-4">
      <DialogHeader>
        <DialogTitle>{rotated ? CI_TEXT.key.titleRotated(name) : CI_TEXT.key.title(name)}</DialogTitle>
        <DialogDescription>{CI_TEXT.key.copyNow}</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          value={keyValue}
          aria-label={CI_TEXT.key.field}
          autoComplete="off"
          spellCheck={false}
          data-slot="ci-key-field"
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 w-full min-w-0 rounded-md border bg-muted px-2 font-mono text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9 sm:text-sm"
        />
        <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-9" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? CI_TEXT.key.copied : CI_TEXT.key.copy}
        </Button>
      </div>
      {copyFailed ? (
        <p role="alert" className="text-sm">
          {CI_TEXT.key.copyFailed}
        </p>
      ) : null}
      <p data-slot="ci-key-steps" className="text-sm break-words">
        {withSecret(rotated ? CI_TEXT.key.stepsRotated(repo) : CI_TEXT.key.steps(repo))}
      </p>
      <p className="text-xs text-muted-foreground">{CI_TEXT.key.validity(ciDay(expiresAt))}</p>
      <DialogFooter>
        <DialogClose render={<Button type="button" className="min-h-11 sm:min-h-9" />}>{CI_TEXT.key.done}</DialogClose>
      </DialogFooter>
    </div>
  );
}
