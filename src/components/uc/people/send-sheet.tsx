"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { retryDossierTransition } from "@/components/uc/shell/transition-retry";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { EmailPreview } from "@/components/use-cases/detail/referent/ask-preview";
import { assignRoleQuestionsAction, previewRequestsAction, sendRequestsAction } from "@/lib/actions/uc-people";
import type { RequestPreviewGroup } from "@/lib/db/queries/uc-requests";
import { renderEmail } from "@/lib/uc/notify/email-templates";
import { formatCountIt } from "@/lib/uc/views/format";
import { EMAIL_OFF_TEXT, SEND_TEXT, emailPreviewParts, sendButtonText, sendGroupText } from "@/lib/uc/views/people";
import { REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { cn } from "@/lib/utils";
import { AssignStep, suggestedChoice, type AssignContactOption, type AssignRole } from "./assign-step";

const FAILED = "Operazione non riuscita. Riprova tra poco.";
/** Le domande in vista sotto l'email: le prime; le altre le trova aprendo il link. */
const SEND_PREVIEW_QUESTIONS = 10;
/** Un link finto ma valido per l'anteprima: a schermo resta solo l'etichetta del pulsante («Apri le domande»). */
const SAMPLE_LINK = `http://localhost/r/ucr_${"x".repeat(32)}`;
const DAY_MS = 86_400_000;

interface Preview {
  groups: RequestPreviewGroup[];
  notRequestable: number;
  /** Scadenza del link nell'anteprima del messaggio (30 giorni da adesso). */
  expiresAt: Date;
}

type Step = 1 | 2 | 3;
const STEPS = REFERENT_UI_TEXT.askDialog.steps;

/**
 * I passi di «Invia le domande», come quelli di «Chiedi al referente» (rilascio 10, §3.5): «A chi», «Cosa chiedi»,
 * «Controlla e invia», con gli stessi nomi e lo stesso disegno (fatto: la spunta; adesso: il bordo pieno). Lo stato si
 * legge anche senza colore; non si clicca, si torna indietro con «Indietro».
 */
function SendStepBar({ step }: { step: Step }) {
  const labels: Record<Step, string> = { 1: STEPS.who, 2: STEPS.what, 3: STEPS.check };
  return (
    <ol aria-label={STEPS.label} data-slot="send-steps" className="grid grid-cols-3 gap-2">
      {([1, 2, 3] as const).map((n) => {
        const state = n < step ? "fatto" : n === step ? "adesso" : "dopo";
        return (
          <li key={n} data-state={state} aria-current={state === "adesso" ? "step" : undefined} className="flex min-w-0 items-start gap-2">
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
                state === "fatto" && "bg-foreground text-background",
                state === "adesso" && "border-2 border-foreground font-medium",
                state === "dopo" && "border border-input text-muted-foreground",
              )}
            >
              {state === "fatto" ? <Check className="size-3.5" /> : n}
            </span>
            <span className={cn("min-w-0 pt-1 text-xs break-words", state === "adesso" ? "font-medium" : "text-muted-foreground")}>
              {labels[n]}
              <span className="sr-only">{state === "fatto" ? STEPS.done : state === "adesso" ? STEPS.now : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Pannello «Invia le domande» (`?invia=1`; rilascio 10, §3.5: come «Chiedi al referente»). Si apre dal pulsante pieno,
 * da Persone e dalla riga «Senza referente».
 *
 * 1. «A chi»: per ogni ruolo con domande senza referente si sceglie la persona (proposta quella con lo stesso ruolo).
 *    Si salta se è tutto assegnato.
 * 2. «Cosa chiedi»: per ogni referente domande, minuti, durata del link e canale; si tolgono le persone che non devono
 *    ricevere niente adesso.
 * 3. «Controlla e invia»: l'email vera che riceve la prima persona scelta (oggetto e testo dello stesso modello
 *    dell'invio, con il link solo come etichetta), poi «Invia a 2 referenti», oppure «Prepara 2 link» quando le email
 *    non partono.
 *
 * Usa le action di sempre: `assignRoleQuestionsAction` (le domande di un ruolo in un colpo solo),
 * `previewRequestsAction` e `sendRequestsAction`.
 */
export function SendSheet({
  workspaceId,
  caseId,
  roles,
  contacts,
  emails,
  emailConfigured,
  clientName,
  caseTitle,
  canReassign,
  addHref,
}: {
  workspaceId: string;
  caseId: string;
  roles: readonly AssignRole[];
  contacts: readonly AssignContactOption[];
  /** L'email di ogni referente, per la riga «A» dell'anteprima (solo Lateral Space apre il pannello). */
  emails: Readonly<Record<string, string | null>>;
  emailConfigured: boolean;
  clientName: string;
  caseTitle: string;
  /** «Affida anche quelle già affidate» (solo il responsabile Lateral Space). */
  canReassign: boolean;
  addHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(roles.length > 0 ? 1 : 2);
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(roles.map((r) => [r.roleKey, suggestedChoice(r, contacts)])));
  const [includeAssigned, setIncludeAssigned] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("invia");
    const q = params.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  async function loadPreview(): Promise<boolean> {
    const r = await previewRequestsAction(workspaceId, caseId, {});
    if (!r.ok) {
      toast.error(r.message);
      return false;
    }
    setPreview({ groups: r.data.groups, notRequestable: r.data.notRequestable, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    setChosen(new Set(r.data.groups.filter((g) => !g.blockedReason && g.items.length > 0).map((g) => g.contactId)));
    return true;
  }

  // Senza domande da assegnare il pannello parte da «Cosa chiedi»: l'elenco si chiede subito, una volta.
  const startsAtTwo = roles.length === 0;
  useEffect(() => {
    if (!startsAtTwo) return;
    startTransition(async () => {
      await loadPreview();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo all'apertura del pannello
  }, [startsAtTwo]);

  function assignAndContinue() {
    startTransition(async () => {
      try {
        let assigned = 0;
        // Un ruolo che si ferma a metà o ha più domande del massimo: il suo esito resta in vista.
        const partial: string[] = [];
        for (const r of roles) {
          const contactId = choices[r.roleKey];
          if (!contactId) continue;
          const done = await assignRoleQuestionsAction(workspaceId, caseId, { roleKey: r.roleKey, contactId, includeAssigned: canReassign && includeAssigned });
          retryDossierTransition();
          if (!done.ok) {
            toast.error(done.message);
            return;
          }
          assigned += done.data.assigned;
          if ((done.data.interrupted || done.data.truncated) && done.message) partial.push(`${r.roleLabel}: ${done.message}`);
        }
        if (assigned > 0) toast.success(assigned === 1 ? "1 domanda assegnata." : `${formatCountIt(assigned)} domande assegnate.`);
        for (const text of partial) toast.warning(text);
        // Il passo 2 si apre con l'elenco già pronto. Nessuno stato prima della prima attesa: un
        // aggiornamento della transizione prima della server action la lasciava appesa (nessuna
        // assegnazione nel passo 1, «Un momento…» per sempre).
        if (await loadPreview()) setStep(2);
      } catch {
        toast.error(FAILED);
      }
    });
  }

  function send() {
    startTransition(async () => {
      try {
        const r = await sendRequestsAction(workspaceId, caseId, { contactIds: [...chosen] });
        retryDossierTransition();
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        toast.success(r.message ?? "Fatto.");
        close();
      } catch {
        toast.error(FAILED);
      }
    });
  }

  const groups = preview?.groups ?? [];
  const picked = groups.filter((g) => chosen.has(g.contactId));
  // L'anteprima è l'email della prima persona scelta che la riceve davvero (chi non ha l'email riceve il link a mano).
  const mailed = emailConfigured ? (picked.find((g) => g.channel === "email") ?? null) : null;
  const othersMailed = mailed ? picked.filter((g) => g.channel === "email" && g.contactId !== mailed.contactId).length : 0;
  const sample =
    mailed && preview
      ? renderEmail({ template: "richiesta_inviata", clientName: clientName || "Cliente", caseTitle, questions: mailed.items.length, minutes: mailed.minutes, expiresAt: preview.expiresAt, link: SAMPLE_LINK })
      : null;
  const ready = preview !== null && groups.length > 0;
  const T = REFERENT_UI_TEXT.askDialog;

  const footer =
    step === 1 ? (
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 sm:h-8" disabled={pending} onClick={assignAndContinue}>
          {pending ? "Un momento…" : T.next}
        </Button>
        <Button variant="ghost" className="h-11 sm:h-8" onClick={close}>
          {T.cancel}
        </Button>
      </div>
    ) : step === 2 ? (
      <div className="flex flex-wrap gap-2">
        {/* Avanti solo con l'elenco pronto e qualcuno da raggiungere: mai «Invia a 0 referenti». */}
        {ready ? (
          <Button className="h-11 sm:h-8" disabled={pending || chosen.size === 0} onClick={() => setStep(3)}>
            {T.next}
          </Button>
        ) : (
          <Button variant="ghost" className="h-11 sm:h-8" onClick={close}>
            {T.close}
          </Button>
        )}
        {roles.length > 0 && (
          <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => setStep(1)}>
            {T.back}
          </Button>
        )}
      </div>
    ) : (
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 sm:h-8" disabled={pending || chosen.size === 0} onClick={send}>
          {sendButtonText(chosen.size, emailConfigured)}
        </Button>
        <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => setStep(2)}>
          {T.back}
        </Button>
      </div>
    );

  return (
    <DetailSheetFrame open onOpenChange={(open) => !open && close()} size="xl" title={SEND_TEXT.title} chips={<SendStepBar step={step} />} footer={footer}>
      {step === 1 ? (
        <AssignStep
          roles={roles}
          contacts={contacts}
          choices={choices}
          onChoose={(roleKey, contactId) => setChoices((c) => ({ ...c, [roleKey]: contactId }))}
          includeAssigned={includeAssigned}
          onIncludeAssigned={canReassign ? setIncludeAssigned : () => undefined}
          addHref={addHref}
        />
      ) : !preview ? (
        <p role="status" className="text-sm text-muted-foreground">
          {SEND_TEXT.loading}
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{SEND_TEXT.nothing}</p>
      ) : step === 2 ? (
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
            {groups.map((g) => {
              const blocked = !!g.blockedReason || g.items.length === 0;
              return (
                <li key={g.contactId} className="flex min-w-0 items-start gap-3 px-3 py-3">
                  <Switch
                    size="sm"
                    className="mt-1"
                    aria-label={`Invia a ${g.displayName}`}
                    disabled={blocked}
                    checked={chosen.has(g.contactId)}
                    onCheckedChange={(on) => {
                      const nextSet = new Set(chosen);
                      if (on) nextSet.add(g.contactId);
                      else nextSet.delete(g.contactId);
                      setChosen(nextSet);
                    }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{g.displayName}</p>
                    <p className="text-xs break-words text-muted-foreground tabular-nums">{sendGroupText({ questions: g.items.length, minutes: g.minutes, channel: g.channel }, emailConfigured)}</p>
                    {g.blockedReason && <p className="text-xs break-words text-uc-rosso">{g.blockedReason}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {preview.notRequestable > 0 && <p className="text-xs text-muted-foreground">{SEND_TEXT.notRequestable(preview.notRequestable)}</p>}
          {!emailConfigured && <p className="text-xs text-muted-foreground">{EMAIL_OFF_TEXT}</p>}
        </div>
      ) : (
        <div data-slot="send-check" className="space-y-4">
          {mailed && sample ? (
            <>
              <h3 className="text-sm font-medium break-words">{fillText(T.checkHeading, { Nome: mailed.displayName })}</h3>
              <EmailPreview
                to={emails[mailed.contactId] ? fillText(T.toValue, { Nome: mailed.displayName, email: emails[mailed.contactId] ?? "" }) : mailed.displayName}
                parts={emailPreviewParts(sample)}
              />
              <div className="space-y-1.5">
                <p className="text-sm">{T.questionsOnLink}</p>
                <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                  {mailed.items.slice(0, SEND_PREVIEW_QUESTIONS).map((item) => (
                    <li key={item.itemId} className="break-words">
                      {item.title}
                    </li>
                  ))}
                </ol>
                {mailed.items.length > SEND_PREVIEW_QUESTIONS && <p className="text-xs text-muted-foreground">{SEND_TEXT.moreQuestions(mailed.items.length - SEND_PREVIEW_QUESTIONS)}</p>}
              </div>
              {/* Solo chi riceve davvero l'email: chi non ce l'ha riceve il link a mano. */}
              {othersMailed > 0 && <p className="text-xs text-muted-foreground">{SEND_TEXT.others(othersMailed)}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{emailConfigured ? SEND_TEXT.noEmail : EMAIL_OFF_TEXT}</p>
          )}
        </div>
      )}
    </DetailSheetFrame>
  );
}
