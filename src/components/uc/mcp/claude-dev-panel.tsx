"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { refreshDossier } from "@/components/uc/shell/transition-retry";
import { CopyButton } from "@/components/uc/ui/copy-button";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { createCaseReadTokenAction, proposedCaseAccessLabelAction, revokeCaseReadTokenAction, type CaseReadTokenCreated } from "@/lib/actions/uc-integrations";
import type { CaseReadTokenItem } from "@/lib/db/queries/uc-mcp";
import { CASES_READ_SCOPE, CASES_READ_VALIDATED_SCOPE, GRANTABLE_CASE_SCOPES, buildCasiInstallCommand, type GrantableCaseScope } from "@/lib/uc/mcp-access";
import { formatDayIt } from "@/lib/uc/views/format";

/**
 * «Sviluppo con Claude» (DESIGN §3.13.2): un pannello, solo per Lateral Space e
 * solo dopo il via allo sviluppo. Il menu «⋯» porta a `…/via#sviluppo-con-claude`:
 * con quell'ancora il pannello si apre da solo; sulla pagina resta una riga
 * con «Apri».
 *
 * - Responsabile Lateral Space: «Crea un accesso» (letture e nome, proposto
 *   «Dossier · XX-0012 · sola lettura» con il codice dello use case), il
 *   comando con «Copia», la «Prima richiesta a Claude», l'elenco degli accessi
 *   con «Revoca». Il nome proposto lo dà il server con la stessa regola del
 *   salvataggio (`proposedCaseAccessLabelAction`): il segnaposto è il nome
 *   che resta se il campo è vuoto.
 * - Sviluppatore e analista: il comando (senza la chiave, che dà il
 *   responsabile) e lo stato degli accessi, in lettura.
 *
 * La pagina passa gli accessi già letti con `listCaseReadTokens` (mai il
 * segreto): la chiave si vede una volta sola, subito dopo la creazione.
 */
export interface ClaudeDevPanelProps {
  workspaceId: string;
  caseId: string;
  /** Codice del dossier: è quello che conosce il server `unbundle-casi` (comando e prima richiesta). */
  caseCode: string;
  /** Responsabile Lateral Space: crea e revoca gli accessi. */
  canManage: boolean;
  /** Versione congelata del catalogo (0 = via allo sviluppo non ancora approvato). */
  catalogVersion: number;
  caseClosed?: boolean;
  tokens: CaseReadTokenItem[];
}

/** L'ancora del menu «⋯» (`caseMenuFor`, voce «Sviluppo con Claude»). */
export const CLAUDE_PANEL_ANCHOR = "sviluppo-con-claude";

const SCOPE_TEXT: Readonly<Record<GrantableCaseScope, { label: string; hint: string }>> = {
  [CASES_READ_VALIDATED_SCOPE]: { label: "Catalogo validato", hint: "Solo le domande a posto della versione congelata." },
  [CASES_READ_SCOPE]: { label: "Stato del dossier", hint: "Domande che mancano, dizionario dei dati e stato del via allo sviluppo." },
};

const KEY_PLACEHOLDER = "<la chiave che ti dà il responsabile>";

/**
 * L'ancora nell'indirizzo. Un link della stessa pagina (il menu «⋯» aperto su
 * `/via`) cambia l'indirizzo con `pushState`, che non manda `hashchange`: per
 * questo si guarda anche il clic su un link con l'ancora, un attimo dopo.
 */
function subscribeHash(onChange: () => void): () => void {
  const onClick = (e: MouseEvent) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (a && a.getAttribute("href")?.endsWith(`#${CLAUDE_PANEL_ANCHOR}`)) window.setTimeout(onChange, 60);
  };
  window.addEventListener("hashchange", onChange);
  document.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("hashchange", onChange);
    document.removeEventListener("click", onClick, true);
  };
}

function noSubscribe(): () => void {
  return () => undefined;
}

function dateText(value: string | null): string {
  return value ? (formatDayIt(value) ?? "–") : "mai";
}

function tokenState(t: CaseReadTokenItem): { tone: "verde" | "grigio"; label: string } {
  if (t.active) return { tone: "verde", label: "Attivo" };
  return { tone: "grigio", label: t.revokedAt ? "Revocato" : "Scaduto" };
}

function fromCreated(d: CaseReadTokenCreated): CaseReadTokenItem {
  return { id: d.tokenId, label: d.label, tokenPrefix: d.tokenPrefix, scopes: d.scopes, createdAt: d.createdAt, expiresAt: d.expiresAt, lastUsedAt: null, revokedAt: null, active: true };
}

export function ClaudeDevPanel({ workspaceId, caseId, caseCode, canManage, catalogVersion, caseClosed = false, tokens }: ClaudeDevPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [list, setList] = useState(tokens);
  const [serverTokens, setServerTokens] = useState(tokens);
  const [manualOpen, setManualOpen] = useState(false);
  const [scopes, setScopes] = useState<GrantableCaseScope[]>([...GRANTABLE_CASE_SCOPES]);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<CaseReadTokenCreated | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [revoking, setRevoking] = useState<CaseReadTokenItem | null>(null);
  const [proposedLabel, setProposedLabel] = useState<string | null>(null);
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  // Nuovi accessi dal server (dopo `refreshDossier`): l'elenco locale li riprende.
  if (serverTokens !== tokens) {
    setServerTokens(tokens);
    setList(tokens);
  }

  const open = manualOpen || hash === `#${CLAUDE_PANEL_ANCHOR}`;
  const frozen = catalogVersion >= 1;
  const canCreate = canManage && frozen && !caseClosed;
  const active = list.filter((t) => t.active).length;
  const readOnlyCommand = origin ? buildCasiInstallCommand({ apiUrl: origin, token: KEY_PLACEHOLDER, caseCode }) : null;

  // Il nome proposto si chiede al server una volta, quando il modulo «Crea un accesso» è in vista.
  const wantsLabel = open && canCreate && !created && proposedLabel === null;
  useEffect(() => {
    if (!wantsLabel) return;
    let current = true;
    proposedCaseAccessLabelAction(workspaceId, caseId)
      .then((r) => {
        if (current && r.ok) setProposedLabel(r.data.label);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [wantsLabel, workspaceId, caseId]);

  function close() {
    setManualOpen(false);
    if (window.location.hash === `#${CLAUDE_PANEL_ANCHOR}`) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }

  function toggle(scope: GrantableCaseScope, checked: boolean) {
    setScopes((current) => (checked ? GRANTABLE_CASE_SCOPES.filter((s) => s === scope || current.includes(s)) : current.filter((s) => s !== scope)));
  }

  function create() {
    setFeedback(null);
    startTransition(async () => {
      const r = await createCaseReadTokenAction(workspaceId, caseId, { scopes, label: label.trim() || undefined });
      if (!r.ok) {
        setFeedback({ ok: false, text: r.message });
        return;
      }
      setCreated(r.data);
      setList((current) => [fromCreated(r.data), ...current.filter((t) => t.id !== r.data.tokenId)]);
      setFeedback({ ok: true, text: r.message ?? "Accesso creato." });
      refreshDossier(router);
    });
  }

  function revoke(tokenId: string) {
    setFeedback(null);
    startTransition(async () => {
      const r = await revokeCaseReadTokenAction(workspaceId, caseId, { tokenId });
      setRevoking(null);
      if (!r.ok) {
        setFeedback({ ok: false, text: r.message });
        return;
      }
      setList((current) => current.map((t) => (t.id === tokenId ? { ...t, active: false, revokedAt: new Date().toISOString() } : t)));
      if (created?.tokenId === tokenId) setCreated(null);
      setFeedback({ ok: true, text: r.message ?? "Accesso revocato." });
      refreshDossier(router);
    });
  }

  return (
    <>
      <section aria-labelledby="uc-claude-title" className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex min-w-0 items-start gap-3">
          <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h2 id="uc-claude-title" className="text-base font-semibold">
              Sviluppo con Claude
            </h2>
            <p className="text-sm text-muted-foreground">{active > 0 ? (active === 1 ? "1 accesso attivo" : `${active} accessi attivi`) : "Nessun accesso attivo"}</p>
          </div>
        </div>
        <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setManualOpen(true)}>
          Apri
        </Button>
      </section>

      <DetailSheetFrame open={open} onOpenChange={(o) => (o ? setManualOpen(true) : close())} size="xl" title="Sviluppo con Claude" description="Claude Code legge il catalogo validato. Ogni lettura resta in Attività.">
        {!frozen ? (
          <p className="text-sm text-muted-foreground">Si attiva dopo il via allo sviluppo: prima non c&apos;è un catalogo congelato da leggere.</p>
        ) : caseClosed ? (
          <p className="text-sm text-muted-foreground">Il dossier è chiuso: gli accessi sono revocati.</p>
        ) : null}

        {canCreate && !created && (
          <section aria-labelledby="uc-claude-create" className="space-y-4">
            <h3 id="uc-claude-create" className="text-sm font-semibold">
              Crea un accesso
            </h3>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs text-muted-foreground">Che cosa può leggere Claude</legend>
              {GRANTABLE_CASE_SCOPES.map((scope) => (
                <div key={scope} className="flex min-h-11 items-start gap-3">
                  <Checkbox id={`scope-${scope}`} className="mt-0.5" checked={scopes.includes(scope)} onCheckedChange={(checked) => toggle(scope, checked === true)} />
                  <Label htmlFor={`scope-${scope}`} className="block min-w-0 flex-1 leading-snug">
                    <span className="block text-sm font-medium">{SCOPE_TEXT[scope].label}</span>
                    <span className="block text-xs font-normal break-words text-muted-foreground">{SCOPE_TEXT[scope].hint}</span>
                  </Label>
                </div>
              ))}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="claude-access-label">Nome dell&apos;accesso</Label>
              <Input id="claude-access-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={proposedLabel ?? undefined} className="h-11 text-base sm:h-9 sm:text-sm" />
            </div>
            <Button type="button" className="h-11 w-full sm:h-8 sm:w-auto" disabled={pending || scopes.length === 0} onClick={create}>
              {pending ? "Creo l'accesso…" : "Crea un accesso"}
            </Button>
          </section>
        )}

        {feedback && (
          <p role="status" className="text-sm text-muted-foreground">
            {feedback.text}
          </p>
        )}

        {created ? (
          <section aria-labelledby="uc-claude-command" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="uc-claude-command" className="text-sm font-semibold">
                Comando per Claude Code
              </h3>
              <CopyButton value={created.installCommand} />
            </div>
            <Textarea readOnly value={created.installCommand} className="min-h-32 resize-none font-mono text-xs break-all" aria-label="Comando di installazione" />
            <p className="text-xs text-muted-foreground">Contiene una chiave: dallo solo a chi sviluppa questo dossier. Dopo questa schermata non si vede più. Scade {dateText(created.expiresAt)}.</p>
            <div className="space-y-1 rounded-lg bg-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">Prima richiesta a Claude</span>
                <CopyButton value={created.starterPrompt} />
              </div>
              <p className="text-sm break-words">{created.starterPrompt}</p>
            </div>
          </section>
        ) : (
          frozen &&
          !caseClosed &&
          !canManage &&
          readOnlyCommand && (
            <section aria-labelledby="uc-claude-readonly" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="uc-claude-readonly" className="text-sm font-semibold">
                  Comando per Claude Code
                </h3>
                <CopyButton value={readOnlyCommand} />
              </div>
              <Textarea readOnly value={readOnlyCommand} className="min-h-32 resize-none font-mono text-xs break-all" aria-label="Comando di installazione" />
              <p className="text-xs text-muted-foreground">La chiave la crea il responsabile Lateral Space: mettila al posto del segnaposto.</p>
            </section>
          )
        )}

        <section aria-labelledby="uc-claude-list" className="space-y-2">
          <h3 id="uc-claude-list" className="text-sm font-semibold">
            Accessi
          </h3>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun accesso per questo dossier.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg ring-1 ring-foreground/10">
              {list.map((t) => {
                const s = tokenState(t);
                return (
                  <li key={t.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 text-sm font-medium break-words">{t.label}</span>
                        <StatusDot tone={s.tone} label={s.label} />
                      </div>
                      <p className="text-xs break-words text-muted-foreground">{t.scopes.map((scope) => SCOPE_TEXT[scope]?.label ?? scope).join(" · ")}</p>
                      <p className="text-xs break-words text-muted-foreground">
                        Creato {dateText(t.createdAt)} · scade {dateText(t.expiresAt)} · ultimo uso {dateText(t.lastUsedAt)}
                      </p>
                    </div>
                    {canManage && t.active && (
                      <Button type="button" variant="outline" size="sm" className="min-h-11 text-destructive hover:text-destructive sm:min-h-7" disabled={pending} onClick={() => setRevoking(t)}>
                        Revoca
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </DetailSheetFrame>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        {revoking && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revocare «{revoking.label}»?</DialogTitle>
              <DialogDescription>Claude non legge più il dossier con questa chiave.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:h-8" onClick={() => setRevoking(null)}>
                Annulla
              </Button>
              <Button variant="destructive" className="h-11 sm:h-8" disabled={pending} onClick={() => revoke(revoking.id)}>
                Revoca
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
