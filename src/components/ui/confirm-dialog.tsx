"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import { cn } from "@/lib/utils";

/**
 * (Rilascio 10, ondata 1 · docs/ui-10/PROPOSTA-10.md §1 regola 7, §5.4, §5.5) La finestra di conferma dell'app, al
 * posto di `window.confirm` e `window.prompt`: la domanda come titolo, una frase, eventuali campi, «Annulla» e il
 * verbo. Il verbo è rosso (`destructive`) solo quando toglie o revoca qualcosa; fuori dalla finestra, nelle righe,
 * le stesse azioni restano bordate o fantasma. Al telefono i due pulsanti sono alti 44 px.
 *
 * La finestra non chiama le azioni: `onConfirm` lo fa chi la apre. Con `cancelLabel={null}` resta un pulsante solo
 * (un avviso, «Ho capito»).
 */
export interface ConfirmDialogBodyProps {
  title: string;
  /** Una frase, la conseguenza. */
  description?: ReactNode;
  confirmLabel: string;
  /** Predefinito «Annulla»; null: nessun secondo pulsante. */
  cancelLabel?: string | null;
  /** Toglie o revoca qualcosa: il verbo è rosso. */
  destructive?: boolean;
  /** L'azione sta partendo: la conferma non riparte. */
  pending?: boolean;
  /** Manca ancora qualcosa (per esempio la parola da scrivere): la conferma è spenta. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  /** Campi in più, tra la frase e i pulsanti. */
  children?: ReactNode;
}

export interface ConfirmDialogProps extends ConfirmDialogBodyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

/** Il contenuto della finestra, dentro un `Dialog`: si prova da solo, perché la finestra si apre solo nel browser. */
export function ConfirmDialogBody({
  title,
  description,
  confirmLabel,
  cancelLabel = CONFIRM_TEXT.cancel,
  destructive = false,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  children,
}: ConfirmDialogBodyProps) {
  const blocked = pending || confirmDisabled;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        // La finestra vive in un portale, ma per React sta dentro la pagina che la apre: l'invio non risale al
        // modulo di quella pagina.
        event.preventDefault();
        event.stopPropagation();
        if (!blocked) onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {children}
      <DialogFooter>
        {cancelLabel === null ? null : (
          <DialogClose render={<Button type="button" variant="outline" className="h-11 sm:h-8" />}>{cancelLabel}</DialogClose>
        )}
        <Button type="submit" variant={destructive ? "destructive" : "default"} className="h-11 sm:h-8" disabled={blocked} aria-busy={pending || undefined}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** La finestra di conferma, controllata da chi la apre. */
export function ConfirmDialog({ open, onOpenChange, className, ...body }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      {open ? (
        <DialogContent showCloseButton={false} data-confirm-dialog="" className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto", className)}>
          <ConfirmDialogBody {...body} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type SubmitRequest<T> = { form: HTMLFormElement; submitter: HTMLElement | null; target: T };

/** Il pulsante che aveva mandato il modulo, se è ancora suo: il secondo invio parte dallo stesso. */
function submitterOf(form: HTMLFormElement, submitter: HTMLElement | null): HTMLElement | undefined {
  return (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) && submitter.form === form ? submitter : undefined;
}

/**
 * Un modulo che chiede prima di partire. In `onSubmit`: `if (!confirmation.ask(event, target)) return;`. Il primo invio
 * si ferma e apre la finestra con `target`; la conferma rimanda lo stesso modulo (`requestSubmit`, con lo stesso
 * pulsante) e questa volta `ask` lo lascia passare: l'azione del modulo riceve gli stessi dati di prima.
 */
export function useSubmitConfirmation<T = true>() {
  const [request, setRequest] = useState<SubmitRequest<T> | null>(null);
  const confirmed = useRef(false);

  function ask(event: FormEvent<HTMLFormElement>, target: T): boolean {
    if (confirmed.current) {
      confirmed.current = false;
      return true;
    }
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    setRequest({ form: event.currentTarget, submitter: submitter ?? null, target });
    return false;
  }

  function confirm() {
    if (!request) return;
    const { form, submitter } = request;
    setRequest(null);
    confirmed.current = true;
    try {
      form.requestSubmit(submitterOf(form, submitter));
    } finally {
      // Un modulo che non parte (un campo non valido) non lascia passare il prossimo invio senza chiedere.
      confirmed.current = false;
    }
  }

  return {
    open: request !== null,
    target: request ? request.target : null,
    ask,
    confirm,
    onOpenChange: (open: boolean) => {
      if (!open) setRequest(null);
    },
  };
}
