"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { CopyButton } from "@/components/uc/ui/copy-button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import {
  anonymizeContactAction,
  approveDelegationAction,
  assignRoleQuestionsAction,
  copyRequestLinkAction,
  extendExpiryAction,
  reassignContactQuestionsAction,
  revokeRequestAction,
  sendRequestAction,
  sendRequestsAction,
} from "@/lib/actions/uc-people";
import { formatCountIt, formatDayIt } from "@/lib/uc/views/format";
import {
  CLIENT_PERSON_STATUS,
  DESIGNATION_SUFFIX,
  LS_PERSON_STATUS,
  REQUEST_STATUS_TONE,
  personPendingText,
  requestDetailLines,
  type ClientPersonRow,
  type LsPersonRow,
  type PersonRequestLike,
  type UnassignedRoleRow,
} from "@/lib/uc/views/people";
import { CONTACT_CHANNELS, type ContactChannel, type RequestStatus } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { contactGroupsFor, suggestedChoice, type AssignContactOption } from "./assign-step";
import { ChoiceSelect } from "./choice-select";
import { EditContactSheet, type ContactFormValue } from "./contact-sheet";
import { SignerDialog, type SignerContactOption } from "./signers-panel";

/** Una richiesta nella riga, come la manda la pagina (con l'etichetta dello stato già pronta). */
export type PersonRequestView = PersonRequestLike & { statusLabel: string };
export type LsPersonRowView = LsPersonRow<PersonRequestView>;

export interface PeopleCan {
  /** Responsabile Lateral Space, dossier modificabile e non in pausa: modifica, revoca, anonimizza. */
  manage: boolean;
  /** Come `manage`, e gli invii sono ammessi (non in pausa). */
  send: boolean;
  /** Responsabile del cliente, dossier modificabile e non in pausa: «Assegna» e «Affida…». */
  clientAssign: boolean;
  /** Indicare i firmatari (responsabile Lateral Space o del cliente). */
  designate: boolean;
  /** Togliere un firmatario (solo Lateral Space). */
  clearSigner: boolean;
}

export interface PeopleListProps {
  workspaceId: string;
  caseId: string;
  view: { audience: "lateral_space"; rows: LsPersonRowView[] } | { audience: "cliente"; rows: ClientPersonRow[] };
  unassigned: readonly UnassignedRoleRow[];
  /** Referenti a cui si possono dare domande: attivi e non anonimizzati. */
  contactOptions: readonly AssignContactOption[];
  signerOptions: readonly SignerContactOption[];
  files: readonly { id: string; name: string }[];
  templateRoles: readonly { key: string; label: string }[];
  can: PeopleCan;
  emailConfigured: boolean;
  /** Oggi e il massimo della scadenza (`YYYY-MM-DD`, Roma). */
  today: string;
  maxExpiry: string;
  /** Domande del dossier per chi le vede (`?referente=<id>` le filtra). */
  catalogBase: string | null;
  documentsHref: string | null;
  /** Il pannello «Invia le domande» (`?invia=1`). */
  sendHref: string;
}

type DialogState =
  | { kind: "link"; name: string; url: string }
  | { kind: "scadenza"; row: LsPersonRowView; request: PersonRequestView }
  | { kind: "revoca"; row: LsPersonRowView; request: PersonRequestView }
  | { kind: "anonimizza"; row: LsPersonRowView }
  | { kind: "firmatario"; row: LsPersonRowView }
  | { kind: "modifica"; row: LsPersonRowView }
  | { kind: "affida"; row: ClientPersonRow }
  | { kind: "assegna"; role: UnassignedRoleRow };

const WAITING: readonly RequestStatus[] = ["inviata", "aperta", "in_corso"];
const BTN = "min-h-11 sm:min-h-7";
const day = (iso: string | null) => formatDayIt(iso);

function signsText(signs: readonly ("owner" | "privacy")[]): string | null {
  return signs.length ? signs.map((s) => DESIGNATION_SUFFIX[s]).join(" e ") : null;
}

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} className="size-11 sm:size-7" />}>
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52 max-w-[min(20rem,calc(100vw-2rem))]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ITEM = "min-h-11 sm:min-h-8";

/**
 * Persone (DESIGN §3.9): una lista sola di chi risponde per il cliente, in
 * ordine alfabetico, poi le righe «Senza referente».
 *
 * - Lateral Space: ruolo con il suffisso del firmatario, «8 domande · 8
 *   aperte» (più «3 da inviare» se lo stato non lo dice), stato e un'azione
 *   `outline` («Invia», «Copia link», «Reinvia», «Approva la delega»); il «⋯»
 *   con «Invia le nuove domande» (link attivo e domande assegnate dopo),
 *   «Cambia scadenza», «Revoca il link», «Modifica», «Designa come
 *   firmatario» e «Anonimizza…». Il clic sul nome apre i dettagli: invio,
 *   scadenza, promemoria, deleghe.
 * - L'analista vede la stessa lista senza azioni.
 * - Il cliente (art. 15.4): nome, ruolo e stato («Da invitare», «Invitato», «Ha
 *   finito», «Link scaduto»); nessun conteggio, nessuna data. Il responsabile
 *   del cliente assegna le domande senza referente e affida quelle di una
 *   persona a un collega.
 */
export function PeopleList(props: PeopleListProps) {
  const { workspaceId, caseId, view, unassigned, contactOptions, can, emailConfigured } = props;
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = () => setDialog(null);

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  }

  function copyLink(row: LsPersonRowView, request: PersonRequestView) {
    run(() => copyRequestLinkAction(workspaceId, caseId, { requestId: request.id }), {
      onSuccess: (data) => setDialog({ kind: "link", name: row.name, url: `${window.location.origin}${data.path}` }),
    });
  }

  /** L'azione `outline` della riga, una sola, dallo stato (§3.9.1). */
  function primaryFor(row: LsPersonRowView): { label: string; onClick: () => void } | null {
    const reqs = row.requests;
    if (row.status === "delega") {
      const r = reqs.find((x) => x.detail?.needsApproval && x.actions.approveDelegation);
      return r ? { label: "Approva la delega", onClick: () => run(() => approveDelegationAction(workspaceId, caseId, { requestId: r.id })) } : null;
    }
    if (row.status === "link_attivo") {
      const r = reqs.find((x) => WAITING.includes(x.status) && x.actions.copyLink);
      return r ? { label: "Copia link", onClick: () => copyLink(row, r) } : null;
    }
    if (!can.send) return null;
    const viaEmail = emailConfigured && row.hasEmail;
    if (row.status === "link_scaduto" && row.unsent > 0) {
      return { label: viaEmail ? "Reinvia" : "Prepara il link", onClick: () => run(() => sendRequestsAction(workspaceId, caseId, { contactIds: [row.id] })) };
    }
    if (row.status === "da_inviare") {
      const draft = reqs.find((x) => x.status === "bozza" && !x.detail?.needsApproval && x.actions.send);
      if (draft) {
        return viaEmail
          ? { label: "Invia", onClick: () => run(() => sendRequestAction(workspaceId, caseId, { requestId: draft.id })) }
          : { label: "Copia link", onClick: () => copyLink(row, draft) };
      }
      if (row.unsent > 0) return { label: viaEmail ? "Invia" : "Prepara il link", onClick: () => run(() => sendRequestsAction(workspaceId, caseId, { contactIds: [row.id] })) };
    }
    return null;
  }

  function lsMenu(row: LsPersonRowView) {
    if (!can.manage) return null;
    const extend = row.requests.find((x) => (WAITING.includes(x.status) || x.status === "completata") && x.actions.extend);
    const revoke = row.requests.find((x) => x.actions.revoke && x.status !== "bozza") ?? row.requests.find((x) => x.actions.revoke);
    const signer = can.designate && row.isActive && !row.anonymized && row.hasEmail;
    // Domande assegnate dopo il link ancora aperto: il link non le contiene, partono con una richiesta loro.
    const sendNew = can.send && row.status === "link_attivo" && row.unsent > 0 && row.isActive && !row.anonymized;
    // Senza voci il menu non c'è (una persona anonimizzata senza link aperti).
    if (!extend && !revoke && row.anonymized) return null;
    return (
      <RowMenu label={`Altre azioni per ${row.name}`}>
        {sendNew && (
          <DropdownMenuItem className={ITEM} onClick={() => run(() => sendRequestsAction(workspaceId, caseId, { contactIds: [row.id] }))}>
            {emailConfigured && row.hasEmail ? "Invia le nuove domande" : "Prepara il link delle nuove domande"}
          </DropdownMenuItem>
        )}
        {extend && (
          <DropdownMenuItem className={ITEM} onClick={() => setDialog({ kind: "scadenza", row, request: extend })}>
            Cambia scadenza
          </DropdownMenuItem>
        )}
        {revoke && (
          <DropdownMenuItem className={ITEM} onClick={() => setDialog({ kind: "revoca", row, request: revoke })}>
            Revoca il link
          </DropdownMenuItem>
        )}
        {!row.anonymized && (
          <DropdownMenuItem className={ITEM} onClick={() => setDialog({ kind: "modifica", row })}>
            Modifica
          </DropdownMenuItem>
        )}
        {signer && (
          <DropdownMenuItem className={ITEM} onClick={() => setDialog({ kind: "firmatario", row })}>
            Designa come firmatario
          </DropdownMenuItem>
        )}
        {!row.anonymized && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className={ITEM} onClick={() => setDialog({ kind: "anonimizza", row })}>
              Anonimizza…
            </DropdownMenuItem>
          </>
        )}
      </RowMenu>
    );
  }

  const lsRows = view.audience === "lateral_space" ? view.rows : [];
  const clientRows = view.audience === "cliente" ? view.rows : [];
  const others = (id: string) => contactOptions.filter((c) => c.id !== id);

  return (
    <>
      <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10" aria-label="Chi risponde per il cliente">
        {lsRows.map((row) => {
          const status = LS_PERSON_STATUS[row.status];
          const primary = can.manage || can.send ? primaryFor(row) : null;
          const expanded = open.has(row.id);
          const meta = [row.roleText, signsText(row.signs), row.countsText, personPendingText(row)].filter(Boolean).join(" · ");
          return (
            <li key={row.id} className={cn("px-4 py-3", row.anonymized && "text-muted-foreground")}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <button
                    type="button"
                    className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-sm text-left text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-6"
                    aria-expanded={expanded}
                    aria-controls={`uc-person-${row.id}`}
                    onClick={() => toggle(row.id)}
                  >
                    <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden />
                    <span className="break-words">{row.name}</span>
                    {row.anonymized && <span className="ml-1 text-xs font-normal">anonimizzato</span>}
                    {!row.isActive && !row.anonymized && <span className="ml-1 text-xs font-normal text-muted-foreground">non attivo</span>}
                  </button>
                  {meta && <p className="pl-5 text-xs break-words text-muted-foreground tabular-nums">{meta}</p>}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {row.status === "nessuno" ? <span className="text-xs text-muted-foreground sm:w-36">–</span> : <StatusDot tone={status.tone} label={status.label} className="sm:w-36" />}
                  {primary && (
                    <Button size="sm" variant="outline" className={BTN} disabled={pending} onClick={primary.onClick}>
                      {primary.label}
                    </Button>
                  )}
                  {lsMenu(row)}
                </div>
              </div>
              {expanded && (
                <div id={`uc-person-${row.id}`} className="mt-2 space-y-3 pl-5 text-xs text-muted-foreground">
                  {(row.email || row.phone) && <p className="break-all">{[row.email, row.phone].filter(Boolean).join(" · ")}</p>}
                  {!row.hasEmail && !row.anonymized && <p>Senza email: il link si copia e si manda a mano.</p>}
                  {row.requests.length === 0 ? (
                    <p>Nessuna domanda ancora partita.</p>
                  ) : (
                    <ul className="space-y-2">
                      {row.requests.slice(0, 5).map((r) => (
                        <li key={r.id} className="space-y-0.5">
                          <StatusDot tone={REQUEST_STATUS_TONE[r.status]} label={r.statusLabel} />
                          {r.detail && r.status !== "revocata" && (
                            <ul className="space-y-0.5">
                              {requestDetailLines(r.detail, day).map((line) => (
                                <li key={line} className="break-words">
                                  {line}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {props.catalogBase && row.countsText && (
                    <Link href={`${props.catalogBase}?referente=${row.id}`} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
                      Vedi le sue domande
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}

        {clientRows.map((row) => {
          const status = CLIENT_PERSON_STATUS[row.status];
          const meta = [row.roleText, signsText(row.signs)].filter(Boolean).join(" · ");
          return (
            <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-medium break-words">{row.name}</p>
                {meta && <p className="text-xs break-words text-muted-foreground">{meta}</p>}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusDot tone={status.tone} label={status.label} className="sm:w-28" />
                {can.clientAssign && others(row.id).length > 0 && (
                  <RowMenu label={`Altre azioni per ${row.name}`}>
                    <DropdownMenuItem className={ITEM} onClick={() => setDialog({ kind: "affida", row })}>
                      Affida le sue domande a un altro collega
                    </DropdownMenuItem>
                  </RowMenu>
                )}
              </div>
            </li>
          );
        })}

        {unassigned.map((u) => (
          <li key={`ruolo-${u.roleKey}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm text-muted-foreground">Senza referente</p>
              <p className="text-xs break-words text-muted-foreground tabular-nums">
                {u.roleLabel} · {formatCountIt(u.questions)} {u.questions === 1 ? "domanda" : "domande"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {can.send ? (
                <Button size="sm" variant="outline" className={BTN} render={<Link href={props.sendHref} scroll={false} />} nativeButton={false}>
                  Assegna
                </Button>
              ) : can.clientAssign && contactOptions.length > 0 ? (
                <Button size="sm" variant="outline" className={BTN} onClick={() => setDialog({ kind: "assegna", role: u })}>
                  Assegna
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {dialog?.kind === "link" && (
        <Dialog open onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Il link di {dialog.name}</DialogTitle>
              <DialogDescription>Copialo adesso: poi non si vede più. Mandalo solo a questa persona, per esempio su WhatsApp.</DialogDescription>
            </DialogHeader>
            <Input readOnly value={dialog.url} aria-label="Link personale" className="h-11 font-mono text-xs sm:h-9" onFocus={(e) => e.currentTarget.select()} />
            <p className="text-xs text-muted-foreground">Chi copia un link non può verificare le risposte che arrivano da lì.</p>
            <DialogFooter>
              <CopyButton value={dialog.url} label="Copia il link" />
              <Button variant="outline" className="h-11 sm:h-8" onClick={close}>
                Chiudi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {dialog?.kind === "scadenza" && <ExtendDialog key={dialog.request.id} {...{ workspaceId, caseId }} request={dialog.request} name={dialog.row.name} today={props.today} maxExpiry={props.maxExpiry} onClose={close} />}

      {dialog?.kind === "revoca" && <RevokeDialog key={dialog.request.id} {...{ workspaceId, caseId }} request={dialog.request} name={dialog.row.name} onClose={close} />}

      {dialog?.kind === "anonimizza" && (
        <Dialog open onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Anonimizzare {dialog.row.name}?</DialogTitle>
              <DialogDescription>
                Il nome e i recapiti di {dialog.row.name} spariscono dal caso. Le risposte restano. Non si può annullare.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:h-8" onClick={close}>
                Annulla
              </Button>
              <Button
                variant="destructive"
                className="h-11 sm:h-8"
                disabled={pending}
                onClick={() => run(() => anonymizeContactAction(workspaceId, caseId, { contactId: dialog.row.id }), { onSuccess: close })}
              >
                Anonimizza
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {dialog?.kind === "firmatario" && (
        <SignerDialog
          workspaceId={workspaceId}
          caseId={caseId}
          open
          onOpenChange={(o) => !o && close()}
          fixedContact={{ id: dialog.row.id, name: dialog.row.name, roleLabel: dialog.row.roleText }}
          candidates={props.signerOptions}
          files={props.files}
          canClear={false}
          documentsHref={props.documentsHref}
        />
      )}

      {dialog?.kind === "modifica" && (
        <EditContactSheet
          workspaceId={workspaceId}
          caseId={caseId}
          contactId={dialog.row.id}
          roles={props.templateRoles}
          onClose={close}
          initial={
            {
              displayName: dialog.row.name,
              templateRoleKey: dialog.row.templateRoleKey ?? "",
              roleLabel: dialog.row.roleLabel ?? "",
              email: dialog.row.email ?? "",
              phone: dialog.row.phone ?? "",
              preferredChannel: (CONTACT_CHANNELS as readonly string[]).includes(dialog.row.preferredChannel ?? "") ? (dialog.row.preferredChannel as ContactChannel) : "",
              isActive: dialog.row.isActive,
            } satisfies ContactFormValue
          }
        />
      )}

      {dialog?.kind === "affida" && (
        <ChooseContactDialog
          title={`Affida le domande di ${dialog.row.name}`}
          description="Le sue domande ancora aperte passano al collega che scegli. Quelle in un link ancora aperto restano a lei o a lui."
          confirm="Affida"
          contacts={others(dialog.row.id)}
          suggestedIds={[]}
          onClose={close}
          onConfirm={(toContactId, done) => run(() => reassignContactQuestionsAction(workspaceId, caseId, { fromContactId: dialog.row.id, toContactId }), { onSuccess: done })}
          pending={pending}
        />
      )}

      {dialog?.kind === "assegna" && (
        <ChooseContactDialog
          title={`Chi risponde per ${dialog.role.roleLabel}`}
          description="Le domande di questo ruolo ancora senza referente vanno alla persona che scegli. Le invia Lateral Space."
          confirm="Assegna"
          contacts={contactOptions}
          suggestedIds={dialog.role.suggestedContactIds}
          onClose={close}
          onConfirm={(contactId, done) => run(() => assignRoleQuestionsAction(workspaceId, caseId, { roleKey: dialog.role.roleKey, contactId }), { onSuccess: done })}
          pending={pending}
        />
      )}
    </>
  );
}

function ExtendDialog({
  workspaceId,
  caseId,
  request,
  name,
  today,
  maxExpiry,
  onClose,
}: {
  workspaceId: string;
  caseId: string;
  request: PersonRequestView;
  name: string;
  today: string;
  maxExpiry: string;
  onClose: () => void;
}) {
  const { pending, run } = useUcAction();
  const [expiry, setExpiry] = useState(maxExpiry);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambia la scadenza del link di {name}</DialogTitle>
          <DialogDescription>Al massimo 30 giorni da oggi.</DialogDescription>
        </DialogHeader>
        <form
          id="uc-extend"
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => extendExpiryAction(workspaceId, caseId, { requestId: request.id, expiresAt: expiry }), { onSuccess: onClose });
          }}
        >
          <Label htmlFor="uc-extend-date">Valido fino al</Label>
          <Input id="uc-extend-date" type="date" min={today} max={maxExpiry} value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-11 w-48 text-base sm:h-9 sm:text-sm" />
        </form>
        <DialogFooter>
          <Button variant="outline" className="h-11 sm:h-8" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" form="uc-extend" className="h-11 sm:h-8" disabled={pending || !expiry}>
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ workspaceId, caseId, request, name, onClose }: { workspaceId: string; caseId: string; request: PersonRequestView; name: string; onClose: () => void }) {
  const { pending, run } = useUcAction();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revocare il link di {name}?</DialogTitle>
          <DialogDescription>Il link smette di funzionare subito. Le domande senza risposta tornano da inviare.</DialogDescription>
        </DialogHeader>
        <form
          id="uc-revoke"
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => revokeRequestAction(workspaceId, caseId, { requestId: request.id, reason: reason.trim() || null }), { onSuccess: onClose });
          }}
        >
          <Label htmlFor="uc-revoke-reason">Motivo (facoltativo)</Label>
          <Textarea id="uc-revoke-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Es. referente sbagliato" className="text-base sm:text-sm" />
        </form>
        <DialogFooter>
          <Button variant="outline" className="h-11 sm:h-8" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" form="uc-revoke" variant="destructive" className="h-11 sm:h-8" disabled={pending}>
            Revoca il link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChooseContactDialog({
  title,
  description,
  confirm,
  contacts,
  suggestedIds,
  onClose,
  onConfirm,
  pending,
}: {
  title: string;
  description: string;
  confirm: string;
  contacts: readonly AssignContactOption[];
  suggestedIds: readonly string[];
  onClose: () => void;
  onConfirm: (contactId: string, done: () => void) => void;
  pending: boolean;
}) {
  const [contactId, setContactId] = useState(() => suggestedChoice({ suggestedContactIds: suggestedIds }, contacts));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="uc-choose-contact">Collega</Label>
          <ChoiceSelect id="uc-choose-contact" value={contactId} onChange={setContactId} placeholder="Scegli" groups={contactGroupsFor(suggestedIds, contacts)} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 sm:h-8" onClick={onClose}>
            Annulla
          </Button>
          <Button className="h-11 sm:h-8" disabled={pending || !contactId} onClick={() => onConfirm(contactId, onClose)}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
