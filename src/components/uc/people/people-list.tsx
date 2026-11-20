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
  DESIGNATION_LABEL,
  DESIGNATION_SUFFIX,
  LS_PERSON_STATUS,
  PEOPLE_ROWS_SHOWN,
  PEOPLE_TEXT,
  REQUEST_STATUS_TONE,
  missingDesignation,
  personLineText,
  personPendingText,
  requestDetailLines,
  shownRows,
  signersMissingText,
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
import { SignerDialog, type SignerContactOption, type SignerSlot } from "./signers-panel";

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
  /** Chi firma per il cliente adesso, con la prova scritta («Prova: …, indicato il 3 ott»). */
  signers: readonly SignerSlot[];
  files: readonly { id: string; name: string }[];
  templateRoles: readonly { key: string; label: string }[];
  can: PeopleCan;
  emailConfigured: boolean;
  /** Oggi e il massimo della scadenza (`YYYY-MM-DD`, Roma). */
  today: string;
  maxExpiry: string;
  /** Domande del dossier per chi le vede (`?referente=<id>` le filtra). */
  catalogBase: string | null;
  /** Il pannello «File» di Domande, per la prova scritta che manca. */
  documentsHref: string | null;
  /** Il pannello «Invia le domande» (`?invia=1`). */
  sendHref: string;
}

type DialogState =
  | { kind: "link"; name: string; url: string }
  | { kind: "scadenza"; row: LsPersonRowView; request: PersonRequestView }
  | { kind: "revoca"; row: LsPersonRowView; request: PersonRequestView }
  | { kind: "anonimizza"; row: LsPersonRowView }
  | { kind: "firmatario"; contact: SignerContactOption | null; designation: "owner" | "privacy" | null }
  | { kind: "modifica"; row: LsPersonRowView }
  | { kind: "affida"; row: ClientPersonRow }
  | { kind: "assegna"; role: UnassignedRoleRow };

interface RowAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

const WAITING: readonly RequestStatus[] = ["inviata", "aperta", "in_corso"];
const BTN = "min-h-11 sm:min-h-7";
const day = (iso: string | null) => formatDayIt(iso);
const T = PEOPLE_TEXT;

function RowMenu({ label, items }: { label: string; items: readonly RowAction[] }) {
  if (items.length === 0) return null;
  const plain = items.filter((i) => !i.destructive);
  const danger = items.filter((i) => i.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} className="size-11 sm:size-7" />}>
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52 max-w-[min(20rem,calc(100vw-2rem))]">
        {plain.map((i) => (
          <DropdownMenuItem key={i.label} className={ITEM} onClick={i.onClick}>
            {i.label}
          </DropdownMenuItem>
        ))}
        {danger.length > 0 && plain.length > 0 && <DropdownMenuSeparator />}
        {danger.map((i) => (
          <DropdownMenuItem key={i.label} variant="destructive" className={ITEM} onClick={i.onClick}>
            {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ITEM = "min-h-11 sm:min-h-8";

/** I firmatari come chip sulla riga: «firma il via», «firma la privacy» (§3.5). */
function SignerChips({ signs }: { signs: readonly ("owner" | "privacy")[] }) {
  if (signs.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {signs.map((s) => (
        <span key={s} data-slot="signer-chip" className="inline-flex h-6 items-center rounded-full px-2 text-xs font-normal text-muted-foreground ring-1 ring-foreground/15">
          {DESIGNATION_SUFFIX[s]}
        </span>
      ))}
    </span>
  );
}

/**
 * «Rispondono per il cliente» (rilascio 10, §3.5; DESIGN §3.9): chi risponde per il cliente, in ordine alfabetico,
 * poi le righe «Senza referente»; al massimo tre righe in vista, poi «Vedi tutti (N)». I firmatari sono chip sulla
 * riga («firma il via», «firma la privacy»); sotto, una riga sola se manca qualcuno, con «Indica».
 *
 * - Lateral Space: il ruolo e «8 aperte», lo stato e, sulla riga, solo «Copia link» o «Approva la delega». Il «⋯»
 *   della riga ha l'invio di quella persona («Invia le sue domande», «Reinvia», «Invia le nuove domande»), «Cambia
 *   scadenza», «Revoca il link», «Modifica», «Firma per il cliente…», «Cambia chi firma…» e «Anonimizza…». Il clic
 *   sul nome apre i dettagli: recapiti, invio, scadenza, promemoria, deleghe, la prova di chi firma. Per inviare a
 *   tutti c'è un solo «Invia le domande», in testa al gruppo.
 * - L'analista vede la stessa lista senza azioni.
 * - Il cliente (art. 15.4): nome, ruolo, firma e stato; nessun conteggio, nessuna data. Il responsabile del cliente
 *   affida le domande di una persona a un'altra, indica chi firma e assegna le domande senza referente.
 */
export function PeopleList(props: PeopleListProps) {
  const { workspaceId, caseId, view, unassigned, contactOptions, can, emailConfigured } = props;
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = () => setDialog(null);
  const designated = { owner: props.signers.find((s) => s.designation === "owner")?.current?.id ?? null, privacy: props.signers.find((s) => s.designation === "privacy")?.current?.id ?? null };

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

  /** Sulla riga solo «Copia link» o «Approva la delega» (§3.17 dell'audit); l'invio di una persona va nel suo «⋯». */
  function visibleAction(row: LsPersonRowView): RowAction | null {
    const reqs = row.requests;
    if (row.status === "delega") {
      const r = reqs.find((x) => x.detail?.needsApproval && x.actions.approveDelegation);
      return r ? { label: "Approva la delega", onClick: () => run(() => approveDelegationAction(workspaceId, caseId, { requestId: r.id })) } : null;
    }
    if (row.status === "link_attivo") {
      const r = reqs.find((x) => WAITING.includes(x.status) && x.actions.copyLink);
      return r ? { label: "Copia link", onClick: () => copyLink(row, r) } : null;
    }
    if (can.send && row.status === "da_inviare" && !(emailConfigured && row.hasEmail)) {
      const draft = reqs.find((x) => x.status === "bozza" && !x.detail?.needsApproval && x.actions.send);
      if (draft) return { label: "Copia link", onClick: () => copyLink(row, draft) };
    }
    return null;
  }

  /** L'invio di una sola persona, nel «⋯» della riga. */
  function sendAction(row: LsPersonRowView): RowAction | null {
    if (!can.send || !row.isActive || row.anonymized) return null;
    const viaEmail = emailConfigured && row.hasEmail;
    const sendAll = (label: string): RowAction => ({ label, onClick: () => run(() => sendRequestsAction(workspaceId, caseId, { contactIds: [row.id] })) });
    if (row.status === "link_attivo" && row.unsent > 0) return sendAll(viaEmail ? T.sendNew : T.sendNewLink);
    if (row.status === "link_scaduto" && row.unsent > 0) return sendAll(viaEmail ? T.resend : T.sendOneLink);
    if (row.status === "da_inviare") {
      const draft = row.requests.find((x) => x.status === "bozza" && !x.detail?.needsApproval && x.actions.send);
      if (draft) return viaEmail ? { label: T.sendOne, onClick: () => run(() => sendRequestAction(workspaceId, caseId, { requestId: draft.id })) } : null;
      if (row.unsent > 0) return sendAll(viaEmail ? T.sendOne : T.sendOneLink);
    }
    return null;
  }

  const isCandidate = (id: string) => props.signerOptions.some((c) => c.id === id);
  const signerActions = (id: string, name: string, roleLabel: string | null, signs: readonly ("owner" | "privacy")[]): RowAction[] => {
    if (!can.designate) return [];
    const out: RowAction[] = [];
    if (signs.length < 2 && isCandidate(id)) out.push({ label: T.designate, onClick: () => setDialog({ kind: "firmatario", contact: { id, name, roleLabel }, designation: null }) });
    for (const d of signs) out.push({ label: T.changeSigner[d], onClick: () => setDialog({ kind: "firmatario", contact: null, designation: d }) });
    return out;
  };

  function lsMenu(row: LsPersonRowView): RowAction[] {
    if (!can.manage) return [];
    const extend = row.requests.find((x) => (WAITING.includes(x.status) || x.status === "completata") && x.actions.extend);
    const revoke = row.requests.find((x) => x.actions.revoke && x.status !== "bozza") ?? row.requests.find((x) => x.actions.revoke);
    const out: RowAction[] = [];
    const send = sendAction(row);
    if (send) out.push(send);
    if (extend) out.push({ label: "Cambia scadenza", onClick: () => setDialog({ kind: "scadenza", row, request: extend }) });
    if (revoke) out.push({ label: "Revoca il link", onClick: () => setDialog({ kind: "revoca", row, request: revoke }) });
    if (!row.anonymized) out.push({ label: "Modifica", onClick: () => setDialog({ kind: "modifica", row }) });
    if (row.isActive && !row.anonymized && row.hasEmail) out.push(...signerActions(row.id, row.name, row.roleText, row.signs));
    if (!row.anonymized) out.push({ label: "Anonimizza…", onClick: () => setDialog({ kind: "anonimizza", row }), destructive: true });
    return out;
  }

  const others = (id: string) => contactOptions.filter((c) => c.id !== id);

  const lsItems = (view.audience === "lateral_space" ? view.rows : []).map((row) => {
    const status = LS_PERSON_STATUS[row.status];
    const primary = can.manage || can.send ? visibleAction(row) : null;
    const expanded = open.has(row.id);
    const line = personLineText(row);
    const evidence = props.signers.filter((s) => s.current?.id === row.id && s.evidenceText).map((s) => `${DESIGNATION_LABEL[s.designation]}: ${s.evidenceText}`);
    const pendingText = personPendingText(row);
    return (
      <li key={row.id} className={cn("px-4 py-3", row.anonymized && "text-muted-foreground")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
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
              <SignerChips signs={row.signs} />
            </div>
            {line && <p className="pl-5 text-xs break-words text-muted-foreground tabular-nums">{line}</p>}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {row.status === "nessuno" ? null : <StatusDot tone={status.tone} label={status.label} className="sm:w-36" />}
            {primary && (
              <Button size="sm" variant="outline" className={BTN} disabled={pending} onClick={primary.onClick}>
                {primary.label}
              </Button>
            )}
            <RowMenu label={`Altre azioni per ${row.name}`} items={lsMenu(row)} />
          </div>
        </div>
        {expanded && (
          <div id={`uc-person-${row.id}`} className="mt-2 space-y-3 pl-5 text-xs text-muted-foreground">
            {(row.email || row.phone) && <p className="break-all">{[row.email, row.phone].filter(Boolean).join(" · ")}</p>}
            {!row.hasEmail && !row.anonymized && <p>Senza email: il link si copia e si manda a mano.</p>}
            {row.countsText && <p className="tabular-nums">{[row.countsText, pendingText].filter(Boolean).join(" · ")}</p>}
            {evidence.map((e) => (
              <p key={e} className="break-words">
                {e}
              </p>
            ))}
            {row.requests.length === 0 ? (
              <p>Nessuna domanda ancora partita.</p>
            ) : (
              <ul className="space-y-2">
                {row.requests.slice(0, 5).map((r) => (
                  <li key={r.id} className="space-y-0.5">
                    <StatusDot tone={REQUEST_STATUS_TONE[r.status]} label={r.statusLabel} />
                    {r.detail && r.status !== "revocata" && (
                      <ul className="space-y-0.5">
                        {requestDetailLines(r.detail, day).map((text) => (
                          <li key={text} className="break-words">
                            {text}
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
  });

  const clientItems = (view.audience === "cliente" ? view.rows : []).map((row) => {
    const status = CLIENT_PERSON_STATUS[row.status];
    const menu: RowAction[] = [];
    if (can.clientAssign && others(row.id).length > 0) menu.push({ label: T.affida, onClick: () => setDialog({ kind: "affida", row }) });
    menu.push(...signerActions(row.id, row.name, row.roleText, row.signs));
    return (
      <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium break-words">{row.name}</p>
            <SignerChips signs={row.signs} />
          </div>
          {row.roleText && <p className="text-xs break-words text-muted-foreground">{row.roleText}</p>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusDot tone={status.tone} label={status.label} className="sm:w-28" />
          <RowMenu label={`Altre azioni per ${row.name}`} items={menu} />
        </div>
      </li>
    );
  });

  const unassignedItems = unassigned.map((u) => (
    <li key={`ruolo-${u.roleKey}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm text-muted-foreground">{T.unassigned}</p>
        <p className="text-xs break-words text-muted-foreground tabular-nums">
          {u.roleLabel} · {formatCountIt(u.questions)} {u.questions === 1 ? "domanda" : "domande"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {can.send ? (
          <Button size="sm" variant="outline" className={BTN} render={<Link href={props.sendHref} scroll={false} />} nativeButton={false}>
            {T.assign}
          </Button>
        ) : can.clientAssign && contactOptions.length > 0 ? (
          <Button size="sm" variant="outline" className={BTN} onClick={() => setDialog({ kind: "assegna", role: u })}>
            {T.assign}
          </Button>
        ) : null}
      </div>
    </li>
  ));

  // Le righe che chiedono un'azione a chi guarda («Approva la delega», «Affida a…») vengono prima: mai dietro «Vedi
  // tutti». Le altre restano in ordine alfabetico (art. 15.4: mai per domande aperte).
  const lsRows = view.audience === "lateral_space" ? view.rows : [];
  const delegation = (i: number) => (can.manage || can.send) && lsRows[i].status === "delega" && visibleAction(lsRows[i]) !== null;
  const canAssign = can.send || (can.clientAssign && contactOptions.length > 0);
  const items = [
    ...lsItems.filter((_, i) => delegation(i)),
    ...(canAssign ? unassignedItems : []),
    ...lsItems.filter((_, i) => !delegation(i)),
    ...clientItems,
    ...(canAssign ? [] : unassignedItems),
  ];
  const missing = signersMissingText(designated);
  const signerSlot = dialog?.kind === "firmatario" && dialog.designation ? (props.signers.find((s) => s.designation === dialog.designation) ?? null) : null;

  return (
    <>
      <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10" aria-label={T.clientGroup}>
        {shownRows(items, all)}
      </ul>
      {items.length > PEOPLE_ROWS_SHOWN && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
        >
          {all ? T.showFewer : T.showAll(items.length)}
          <ChevronRight className={cn("size-3.5 transition-transform", all && "-rotate-90")} aria-hidden />
        </button>
      )}
      {missing && (
        <p data-slot="signers-missing" className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>{missing}</span>
          {can.designate && props.signerOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog({ kind: "firmatario", contact: null, designation: missingDesignation(designated) })}
              className="inline-flex min-h-11 items-center gap-0.5 rounded-md font-medium text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
            >
              {T.indicate}
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          )}
        </p>
      )}

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
                Il nome e i recapiti di {dialog.row.name} spariscono dalla realizzazione. Le risposte restano. Non si può annullare.
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
          designation={dialog.designation ?? undefined}
          fixedContact={dialog.contact ?? undefined}
          current={signerSlot?.current ?? null}
          evidence={signerSlot?.evidenceText ?? null}
          candidates={props.signerOptions}
          files={props.files}
          canClear={can.clearSigner}
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
          title={T.affidaTitle(dialog.row.name)}
          description={T.affidaBody}
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
          title={T.assignTitle(dialog.role.roleLabel)}
          description={T.assignBody}
          confirm="Affida"
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
          <Label htmlFor="uc-choose-contact">{T.choosePerson}</Label>
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
