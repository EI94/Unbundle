"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { retryDossierTransition } from "@/components/uc/shell/transition-retry";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { assignRoleQuestionsAction, previewRequestsAction, sendRequestsAction } from "@/lib/actions/uc-people";
import type { RequestPreviewGroup } from "@/lib/db/queries/uc-requests";
import { renderEmail } from "@/lib/uc/notify/email-templates";
import { formatCountIt } from "@/lib/uc/views/format";
import { EMAIL_OFF_TEXT, sendButtonText, sendGroupText } from "@/lib/uc/views/people";
import { cn } from "@/lib/utils";
import { AssignStep, suggestedChoice, type AssignContactOption, type AssignRole } from "./assign-step";

const FAILED = "Operazione non riuscita. Riprova tra poco.";
/** Un link finto ma valido per l'anteprima: nel testo diventa «‹il suo link personale›». */
const SAMPLE_LINK = `http://localhost/r/ucr_${"x".repeat(32)}`;
const DAY_MS = 86_400_000;

interface Preview {
  groups: RequestPreviewGroup[];
  notRequestable: number;
  /** Scadenza del link nell'anteprima del messaggio (30 giorni da adesso). */
  expiresAt: Date;
}

function StepTitle({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", active ? "font-medium text-foreground" : "text-muted-foreground")}>
      <span className={cn("inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums ring-1", active ? "bg-foreground text-background ring-foreground" : "ring-foreground/20")} aria-hidden>
        {n}
      </span>
      {label}
    </span>
  );
}

/**
 * Pannello «Invia le domande» (`?invia=1`, DESIGN §3.9.2). Si apre dal
 * primario, da Persone e dalla riga «Senza referente».
 *
 * 1. Chi risponde: per ogni ruolo con domande senza referente si sceglie la
 *    persona (proposta quella con lo stesso ruolo). Si salta se è tutto
 *    assegnato.
 * 2. Cosa parte: per ogni referente domande, minuti, durata del link e canale;
 *    l'anteprima del messaggio; «Invia a 2 referenti», oppure «Prepara 2 link»
 *    quando le email non partono.
 *
 * Usa le action di sempre: `assignRoleQuestionsAction` (le domande di un ruolo
 * in un colpo solo, come «Assegna per ruolo»), `previewRequestsAction` e
 * `sendRequestsAction`.
 */
export function SendSheet({
  workspaceId,
  caseId,
  roles,
  contacts,
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
  emailConfigured: boolean;
  clientName: string;
  caseTitle: string;
  /** «Riassegna anche quelle già assegnate» (solo il responsabile Lateral Space). */
  canReassign: boolean;
  addHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<1 | 2>(roles.length > 0 ? 1 : 2);
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

  // Senza domande da assegnare il pannello parte dal passo 2: l'elenco si chiede subito, una volta.
  const startsAtTwo = roles.length === 0;
  useEffect(() => {
    if (!startsAtTwo) return;
    startTransition(async () => {
      await loadPreview();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo all'apertura del pannello
  }, [startsAtTwo]);

  function next() {
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
  const first = groups.find((g) => chosen.has(g.contactId)) ?? null;
  const sample =
    first && preview
      ? renderEmail({ template: "richiesta_inviata", clientName: clientName || "Cliente", caseTitle, questions: first.items.length, minutes: first.minutes, expiresAt: preview.expiresAt, link: SAMPLE_LINK })
      : null;

  return (
    <DetailSheetFrame
      open
      onOpenChange={(open) => !open && close()}
      size="xl"
      title="Invia le domande"
      chips={
        <div className="flex flex-wrap items-center gap-3">
          <StepTitle n={1} label="Chi risponde" active={step === 1} />
          <StepTitle n={2} label="Cosa parte" active={step === 2} />
        </div>
      }
      footer={
        step === 1 ? (
          <div className="flex flex-wrap gap-2">
            <Button className="h-11 sm:h-8" disabled={pending} onClick={next}>
              {pending ? "Un momento…" : "Avanti"}
            </Button>
            <Button variant="ghost" className="h-11 sm:h-8" onClick={close}>
              Annulla
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {/* Il pulsante d'invio solo con l'elenco pronto e qualcosa da inviare: mai «Invia a 0 referenti». */}
            {preview && groups.length > 0 ? (
              <Button className="h-11 sm:h-8" disabled={pending || chosen.size === 0} onClick={send}>
                {sendButtonText(chosen.size, emailConfigured)}
              </Button>
            ) : (
              <Button variant="ghost" className="h-11 sm:h-8" onClick={close}>
                Chiudi
              </Button>
            )}
            {roles.length > 0 && (
              <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => setStep(1)}>
                Indietro
              </Button>
            )}
          </div>
        )
      }
    >
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
          Preparo l&apos;elenco…
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Non c&apos;è niente da inviare: le domande assegnate sono già partite o aspettano una risposta.</p>
      ) : (
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
          {preview.notRequestable > 0 && (
            <p className="text-xs text-muted-foreground">
              {preview.notRequestable === 1 ? "1 domanda non si può inviare adesso" : `${preview.notRequestable} domande non si possono inviare adesso`}: bloccate, già partite o senza referente.
            </p>
          )}
          {!emailConfigured && <p className="text-xs text-muted-foreground">{EMAIL_OFF_TEXT}</p>}
          {sample && (
            <details className="group min-w-0">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                Anteprima del messaggio
              </summary>
              <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
                <p className="font-medium break-words">{sample.subject}</p>
                <p className="break-words whitespace-pre-line text-muted-foreground">{sample.text.replace(SAMPLE_LINK, "‹il suo link personale›").split("\n--\n")[0].trim()}</p>
              </div>
            </details>
          )}
        </div>
      )}
    </DetailSheetFrame>
  );
}
