"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { setOwnerContactAction, setPrivacyApproverContactAction } from "@/lib/actions/uc-cases";
import { DESIGNATION_LABEL } from "@/lib/uc/views/people";
import { ChoiceSelect } from "./choice-select";

export interface SignerContactOption {
  id: string;
  name: string;
  roleLabel: string | null;
}

export interface SignerSlot {
  designation: "owner" | "privacy";
  /** Referente designato adesso, se c'è. */
  current: SignerContactOption | null;
  /** «Prova: <file> · indicato il 3 ott», già in testo di Roma. */
  evidenceText: string | null;
}

/** Che cosa firma, in una frase (§3.9.1): il link di approvazione parte solo per email. */
const HELP: Readonly<Record<"owner" | "privacy", string>> = {
  owner: "Firma per il cliente il via allo sviluppo, dal link che arriva per email.",
  privacy: "Firma la scheda privacy e l'accesso ai dati personali, dal link che arriva per email.",
};

/**
 * Dialogo per indicare chi firma per il cliente (via allo sviluppo o privacy),
 * con la prova scritta caricata nel dossier (l'email del cliente che indica la
 * persona). Con `fixedContact` la persona è già scelta (dal «⋯» di una riga di
 * Persone, «Firma per il cliente…») e si sceglie che cosa firma; con
 * `designation` si sceglie la persona («Cambia chi firma…», «Indica» della riga
 * che dice chi manca). Lo apre il responsabile Lateral Space o del cliente; solo
 * Lateral Space ha «Togli». Cambiare persona annulla le firme in attesa della
 * persona di prima: lo ricontrolla il server.
 */
export function SignerDialog({
  workspaceId,
  caseId,
  open,
  onOpenChange,
  designation: fixedDesignation,
  fixedContact,
  current,
  evidence = null,
  candidates,
  files,
  canClear,
  documentsHref,
}: {
  workspaceId: string;
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Che cosa firma; senza, si sceglie nel dialogo. */
  designation?: "owner" | "privacy";
  fixedContact?: SignerContactOption;
  current?: SignerContactOption | null;
  /** La prova scritta di chi firma adesso («Prova: … · indicato il 3 ott»). */
  evidence?: string | null;
  candidates: readonly SignerContactOption[];
  files: readonly { id: string; name: string }[];
  canClear: boolean;
  /** Dove si caricano i documenti (il pannello «File» di Domande), per la prova che manca. */
  documentsHref: string | null;
}) {
  const { pending, run } = useUcAction();
  const [designation, setDesignation] = useState<"owner" | "privacy" | "">(fixedDesignation ?? "");
  const [contactId, setContactId] = useState(fixedContact?.id ?? "");
  const [fileId, setFileId] = useState("");
  const target = fixedDesignation ?? (designation || null);

  function save(next: string | null) {
    if (!target) return;
    const action = target === "owner" ? setOwnerContactAction : setPrivacyApproverContactAction;
    run(() => action(workspaceId, caseId, { contactId: next, evidenceFileId: next ? fileId || null : null }), {
      success: next ? "Firmatario indicato." : "Firmatario tolto.",
      onSuccess: () => onOpenChange(false),
    });
  }

  const title = fixedContact ? `${fixedContact.name} firma per il cliente` : target ? `Chi firma: ${DESIGNATION_LABEL[target].toLowerCase()}` : "Chi firma per il cliente";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{target ? HELP[target] : "Scegli che cosa firma e la prova scritta del cliente."}</DialogDescription>
        </DialogHeader>
        <form
          id="uc-signer-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (contactId && fileId && target) save(contactId);
          }}
        >
          {!fixedDesignation && (
            <div className="space-y-1.5">
              <Label htmlFor="uc-signer-what">Che cosa firma</Label>
              <ChoiceSelect
                id="uc-signer-what"
                value={designation}
                onChange={(v) => setDesignation(v === "owner" || v === "privacy" ? v : "")}
                placeholder="Scegli"
                groups={[{ options: (["owner", "privacy"] as const).map((d) => ({ value: d, label: DESIGNATION_LABEL[d] })) }]}
              />
            </div>
          )}
          {!fixedContact && (
            <div className="space-y-1.5">
              <Label htmlFor="uc-signer-who">Referente</Label>
              <ChoiceSelect
                id="uc-signer-who"
                value={contactId}
                onChange={setContactId}
                placeholder="Scegli"
                groups={[{ options: candidates.map((c) => ({ value: c.id, label: c.roleLabel ? `${c.name} · ${c.roleLabel}` : c.name })) }]}
              />
              {candidates.length === 0 && <p className="text-xs text-muted-foreground">Serve un referente attivo con l&apos;email.</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="uc-signer-file">Prova scritta del cliente</Label>
            {files.length > 0 ? (
              <ChoiceSelect id="uc-signer-file" value={fileId} onChange={setFileId} placeholder="Scegli il file" groups={[{ options: files.map((f) => ({ value: f.id, label: f.name })) }]} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Carica prima il file in{" "}
                {documentsHref ? (
                  <Link href={documentsHref} className="underline underline-offset-4">
                    Domande › File
                  </Link>
                ) : (
                  "Domande › File"
                )}
                : l&apos;email del cliente che indica la persona.
              </p>
            )}
          </div>
          {current && (
            <p className="text-xs text-muted-foreground">
              Adesso firma {current.name}
              {evidence ? ` (${evidence})` : ""}. Con un cambio le sue firme ancora in attesa si annullano.
            </p>
          )}
        </form>
        <DialogFooter>
          {canClear && current && !fixedContact && (
            <Button type="button" variant="ghost" className="h-11 sm:mr-auto sm:h-8" disabled={pending} onClick={() => save(null)}>
              Togli
            </Button>
          )}
          <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button type="submit" form="uc-signer-form" className="h-11 sm:h-8" disabled={pending || !contactId || !fileId || !target}>
            Conferma
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
