"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { createContactAction, updateContactAction } from "@/lib/actions/uc-people";
import { CONTACT_CHANNEL_LABEL, PEOPLE_TEXT as T } from "@/lib/uc/views/people";
import { CONTACT_CHANNELS, type ContactChannel } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { ChoiceSelect } from "./choice-select";

/** I campi di un referente come li modifica il pannello. */
export interface ContactFormValue {
  displayName: string;
  templateRoleKey: string;
  roleLabel: string;
  email: string;
  phone: string;
  preferredChannel: ContactChannel | "";
  isActive: boolean;
}

export const EMPTY_CONTACT: ContactFormValue = { displayName: "", templateRoleKey: "", roleLabel: "", email: "", phone: "", preferredChannel: "", isActive: true };

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";

/**
 * Il modulo del referente (rilascio 10, §3.5; DESIGN §3.9.1): tre campi in vista, nome e cognome, email e «Per quali
 * domande» (il ruolo dello schema); il resto in «Altro», chiuso: come lo chiamate, telefono facoltativo, canale
 * preferito e, in modifica, «Referente attivo». Nessun campo si perde.
 */
function ContactFields({
  id,
  value,
  onChange,
  roles,
  withActive,
}: {
  id: string;
  value: ContactFormValue;
  onChange: (v: ContactFormValue) => void;
  roles: readonly { key: string; label: string }[];
  withActive: boolean;
}) {
  const [more, setMore] = useState(false);
  const set = (patch: Partial<ContactFormValue>) => onChange({ ...value, ...patch });
  return (
    <div className="grid min-w-0 gap-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>{T.contactName}</Label>
        <Input id={`${id}-name`} value={value.displayName} maxLength={255} autoComplete="off" onChange={(e) => set({ displayName: e.target.value })} className={FIELD} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-email`}>{T.contactEmail}</Label>
        <Input id={`${id}-email`} type="email" inputMode="email" autoComplete="off" value={value.email} maxLength={320} onChange={(e) => set({ email: e.target.value })} className={FIELD} aria-describedby={`${id}-email-hint`} />
        <p id={`${id}-email-hint`} className="text-xs text-muted-foreground">
          {T.contactEmailHint}
        </p>
      </div>
      {roles.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-role`}>{T.contactRole}</Label>
          <ChoiceSelect
            id={`${id}-role`}
            value={value.templateRoleKey}
            placeholder="Nessun ruolo in particolare"
            groups={[{ options: roles.map((r) => ({ value: r.key, label: r.label })) }]}
            onChange={(key) => set({ templateRoleKey: key })}
          />
          <p className="text-xs text-muted-foreground">{T.contactRoleHint}</p>
        </div>
      )}
      <div className="min-w-0">
        <button
          type="button"
          aria-expanded={more}
          aria-controls={`${id}-more`}
          onClick={() => setMore(!more)}
          className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", more && "rotate-90")} aria-hidden />
          {T.more}
        </button>
        <div id={`${id}-more`} hidden={!more} className="mt-3 grid min-w-0 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-label`}>{T.contactLabel}</Label>
            <Input id={`${id}-label`} value={value.roleLabel} maxLength={255} placeholder="Es. Controllo di gestione" onChange={(e) => set({ roleLabel: e.target.value })} className={FIELD} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-phone`}>{T.contactPhone}</Label>
            <Input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" value={value.phone} maxLength={40} placeholder="+39…" onChange={(e) => set({ phone: e.target.value })} className={FIELD} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-channel`}>{T.contactChannel}</Label>
            <ChoiceSelect
              id={`${id}-channel`}
              value={value.preferredChannel}
              placeholder="Lo sceglie Unbundle"
              groups={[{ options: CONTACT_CHANNELS.map((c) => ({ value: c, label: CONTACT_CHANNEL_LABEL[c] })) }]}
              onChange={(c) => set({ preferredChannel: (CONTACT_CHANNELS as readonly string[]).includes(c) ? (c as ContactChannel) : "" })}
            />
          </div>
          {withActive && (
            <label htmlFor={`${id}-active`} className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span>
                {T.contactActive}
                <span className="block text-xs text-muted-foreground">{T.contactActiveHint}</span>
              </span>
              <Switch id={`${id}-active`} checked={value.isActive} onCheckedChange={(checked) => set({ isActive: checked })} />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * «Aggiungi un referente» (`?nuovo=1`, DESIGN §3.9.1): il pannello si apre
 * dall'indirizzo e chiudendolo il parametro sparisce. Con `poi=invia` dopo il
 * salvataggio si torna al pannello «Invia le domande».
 */
export function AddContactSheet({ workspaceId, caseId, roles }: { workspaceId: string; caseId: string; roles: readonly { key: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pending, run } = useUcAction();
  const [value, setValue] = useState<ContactFormValue>(EMPTY_CONTACT);
  const backToSend = searchParams.get("poi") === "invia";

  function close(next?: "invia") {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("nuovo");
    params.delete("poi");
    if (next) params.set("invia", "1");
    const q = params.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  function submit() {
    run(
      () =>
        createContactAction(workspaceId, caseId, {
          displayName: value.displayName.trim(),
          roleLabel: value.roleLabel.trim() || null,
          templateRoleKey: value.templateRoleKey || null,
          email: value.email.trim() || null,
          phone: value.phone.trim() || null,
          preferredChannel: value.preferredChannel || null,
        }),
      { onSuccess: () => close(backToSend ? "invia" : undefined) },
    );
  }

  return (
    <DetailSheetFrame
      open
      onOpenChange={(open) => !open && close(backToSend ? "invia" : undefined)}
      title="Aggiungi un referente"
      description="Risponde alle sue domande da un link personale, anche dal telefono."
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="uc-contact-new" className="h-11 sm:h-8" disabled={pending || value.displayName.trim().length < 2}>
            Aggiungi il referente
          </Button>
          <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={() => close(backToSend ? "invia" : undefined)}>
            Annulla
          </Button>
        </div>
      }
    >
      <form
        id="uc-contact-new"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ContactFields id="uc-contact-new" value={value} onChange={setValue} roles={roles} withActive={false} />
      </form>
    </DetailSheetFrame>
  );
}

/** «Modifica» dal «⋯» di una riga: lo stesso modulo, con «Referente attivo». Un'email cambiata revoca i link già mandati. */
export function EditContactSheet({
  workspaceId,
  caseId,
  contactId,
  initial,
  roles,
  onClose,
}: {
  workspaceId: string;
  caseId: string;
  contactId: string;
  initial: ContactFormValue;
  roles: readonly { key: string; label: string }[];
  onClose: () => void;
}) {
  const { pending, run } = useUcAction();
  const [value, setValue] = useState<ContactFormValue>(initial);
  return (
    <DetailSheetFrame
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Modifica ${initial.displayName}`}
      description="Se cambi l'email, i link già mandati smettono di funzionare."
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="uc-contact-edit" className="h-11 sm:h-8" disabled={pending || value.displayName.trim().length < 2}>
            Salva
          </Button>
          <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={onClose}>
            Annulla
          </Button>
        </div>
      }
    >
      <form
        id="uc-contact-edit"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              updateContactAction(workspaceId, caseId, {
                contactId,
                displayName: value.displayName.trim(),
                roleLabel: value.roleLabel.trim() || null,
                templateRoleKey: value.templateRoleKey || null,
                email: value.email.trim() || null,
                phone: value.phone.trim() || null,
                ...(value.preferredChannel ? { preferredChannel: value.preferredChannel } : {}),
                isActive: value.isActive,
              }),
            { onSuccess: onClose },
          );
        }}
      >
        <ContactFields id="uc-contact-edit" value={value} onChange={setValue} roles={roles} withActive />
      </form>
    </DetailSheetFrame>
  );
}
