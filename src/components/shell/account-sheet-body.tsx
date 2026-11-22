"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Check, Copy, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { THEME_OPTIONS, type ThemeChoice } from "@/components/theme/theme-config";
import { TextAction } from "@/components/ui-10/row";
import type { CreateTeamMcpTokenData, TeamMcpActionState } from "@/lib/actions/team-mcp-tokens";
import { granolaFlashLine, type Line } from "@/lib/context/granola/view";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { CliTokenView } from "@/lib/db/queries/use-case-cli-auth";
import type { TeamMcpTokenView } from "@/lib/db/queries/team-mcp-tokens";
import { ACCESS_PLACEHOLDER, accountSectionId, claudeAiHeader, claudeCodeCommand, type AccountClaude, type AccountPart, type AccountSheetData } from "@/lib/shell/account";
import { SHELL_TEXT } from "@/lib/shell/text";
import { cn } from "@/lib/utils";

const T = SHELL_TEXT.account;
const C = T.claude;
const G = CONTEXT_TEXT.granola;

/** Le azioni del foglio, con il workspace già dentro (le passa `AccountSheet`; nei test, finte). */
export interface AccountActions {
  setEmailAlerts(on: boolean): Promise<{ ok: true; on: boolean } | { ok: false; message: string }>;
  createClaudeAccess(form: FormData): Promise<TeamMcpActionState<CreateTeamMcpTokenData>>;
  revokeClaudeAccess(tokenId: string): Promise<{ ok: boolean; message: string }>;
  revokeTerminalLink(tokenId: string): Promise<{ ok: boolean; message: string }>;
  connectGranola(): Promise<{ ok: true; url: string } | { ok: false; message: string }>;
  disconnectGranola(): Promise<{ ok: boolean; message: string }>;
}

/** Che cosa c'è da mostrare: niente da leggere (chi segue solo un corso), la lettura, un errore, i dati. */
export type AccountSheetState = { status: "none" } | { status: "loading" } | { status: "error" } | { status: "ready"; account: AccountSheetData };

const DAY = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
const day = (iso: string) => DAY.format(new Date(iso));

const SECTION = "space-y-3 scroll-mt-4 border-t px-4 py-5 first:border-t-0";
const H3 = "text-base font-semibold";

/** Una riga della lista degli accessi: Claude (il token del MCP del team) o Terminale (la CLI). */
export interface AccessRow {
  kind: "claude" | "terminal";
  id: string;
  label: string;
  facts: string[];
  exposed: boolean;
}

/** Gli accessi attivi di chi guarda, in una lista sola: prima Claude, poi il terminale. */
export function accessRows(claude: AccountClaude | null, terminal: { links: readonly CliTokenView[] } | null): AccessRow[] {
  const claudeRows = (claude?.tokens ?? [])
    .filter((token: TeamMcpTokenView) => token.active)
    .map((token): AccessRow => ({
      kind: "claude",
      id: token.id,
      label: token.label,
      facts: [
        token.readOnly ? C.readOnly : C.readWrite,
        // Un dato, un posto: la data nella riga; «tra N giorni» e l'esposizione negli avvisi sopra l'elenco.
        token.expiresOn ? C.expiresOn(token.expiresOn) : null,
        token.lastUsedOn ? C.usedOn(token.lastUsedOn) : C.neverUsed,
      ].filter((fact): fact is string => Boolean(fact)),
      exposed: token.exposed,
    }));
  const terminalRows = (terminal?.links ?? []).map((link): AccessRow => ({
    kind: "terminal",
    id: link.id,
    label: link.label,
    facts: [
      // (F-227) L'inizio del collegamento, per riconoscerlo dal computer: mai il resto.
      C.linkPrefix(link.prefix),
      link.caseCode ? C.onlyCase(link.caseCode) : C.allCases,
      link.lastUsedAt ? C.usedOn(day(link.lastUsedAt)) : C.neverUsed,
      link.expiresAt ? C.expiresOn(day(link.expiresAt)) : null,
    ].filter((fact): fact is string => Boolean(fact)),
    exposed: false,
  }));
  return [...claudeRows, ...terminalRows];
}

/**
 * L'accesso appena creato, da copiare: finché chi guarda non lo nasconde e finché è attivo. Revocato (da «Revoca» o da
 * «Revoca tutti» in Impostazioni) non si offre più; con l'elenco non ancora riletto resta, perché esiste.
 */
export function newTokenToShow(
  created: CreateTeamMcpTokenData | null | undefined,
  hiddenTokenId: string | null,
  tokens: readonly Pick<TeamMcpTokenView, "id" | "active">[],
): CreateTeamMcpTokenData | null {
  if (!created || created.tokenId === hiddenTokenId) return null;
  return tokens.some((token) => token.id === created.tokenId && !token.active) ? null : created;
}

function Section({ part, title, children }: { part: AccountPart; title: string; children: ReactNode }) {
  const id = accountSectionId(part);
  return (
    <section id={id} aria-labelledby={`${id}-title`} tabIndex={-1} className={cn(SECTION, "outline-none")}>
      <h3 id={`${id}-title`} className={H3}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function CopyLine({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(C.copyFailed);
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <code className="min-w-0 flex-1 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-xs break-all">{value}</code>
      <Button type="button" variant="outline" className="self-start" onClick={() => void copy()}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? C.copied : label}
      </Button>
    </div>
  );
}

/** «Notifiche via email»: l'interruttore che prima stava in fondo alla campanella. */
function EmailSection({ on: initial, actions }: { on: boolean; actions: AccountActions }) {
  const [on, setOn] = useState(initial);
  // Un valore nuovo dal server (il foglio si è riletto) vince su quello di prima, come nel pannello degli use case.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setOn(initial);
  }
  const [pending, start] = useTransition();
  const id = useId();
  const change = (next: boolean) => {
    setOn(next);
    start(async () => {
      const result = await actions.setEmailAlerts(next).catch(() => ({ ok: false as const, message: T.email.saveFailed }));
      if (result.ok) setOn(result.on);
      else {
        setOn(!next);
        toast.error(result.message || T.email.saveFailed);
      }
    });
  };
  return (
    <Section part="email" title={T.email.title}>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor={id} className="font-normal leading-snug">
          {T.email.toggle}
        </Label>
        <Switch id={id} checked={on} disabled={pending} onCheckedChange={(checked) => change(checked === true)} />
      </div>
    </Section>
  );
}

function ClaudeGuide({ claude, actions, onChanged }: { claude: AccountClaude; actions: AccountActions; onChanged: () => void }) {
  const [created, setCreated] = useState<CreateTeamMcpTokenData | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [pending, start] = useTransition();
  const nameId = useId();
  const readOnlyId = useId();
  const submit = (form: FormData) =>
    start(async () => {
      if (readOnly) form.set("readOnly", "on");
      const result = await actions.createClaudeAccess(form).catch(() => ({ ok: false, message: C.failed }) as TeamMcpActionState<CreateTeamMcpTokenData>);
      if (result.ok && result.data) {
        setCreated(result.data);
        setError(null);
        setReadOnly(false);
        onChanged();
      } else setError(result.fieldErrors?.label ?? result.message ?? C.failed);
    });
  if (claude.status === "errore") return <p className="text-sm text-muted-foreground">{C.claudeLoadFailed}</p>;
  const shown = newTokenToShow(created, hidden, claude.tokens);
  const hasActive = claude.tokens.some((token) => token.active);
  const form = (
    <form action={submit} className="space-y-3" data-slot="account-create-access">
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>{C.nameLabel}</Label>
        <Input id={nameId} name="label" defaultValue={claude.defaultLabel} maxLength={80} className="h-11 text-base sm:h-9 sm:text-sm" aria-describedby={`${nameId}-hint`} />
        <p id={`${nameId}-hint`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? C.nameHint}
        </p>
      </div>
      <div className="flex min-h-11 items-start gap-2.5">
        <Checkbox id={readOnlyId} className="mt-0.5" checked={readOnly} onCheckedChange={(checked) => setReadOnly(checked === true)} />
        <div className="min-w-0">
          <Label htmlFor={readOnlyId}>{C.readOnlyLabel}</Label>
          <p className="text-xs text-muted-foreground">{C.readOnlyHint}</p>
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? C.creating : C.create}
      </Button>
    </form>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {C.claudeLead(claude.ttlDays)} {C.expiringHint(claude.warningDays)}
      </p>
      {!claude.routeEnabled ? <p className="text-sm text-muted-foreground">{C.claudeOff}</p> : null}
      {shown ? (
        <div className="space-y-3 rounded-lg border p-3" data-slot="account-new-access">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">{C.createdTitle}</p>
            <Button type="button" variant="ghost" className="-mt-1 shrink-0" onClick={() => setHidden(shown.tokenId)}>
              {C.hide}
            </Button>
          </div>
          <CopyLine value={shown.token} label={C.copy} />
          <p className="text-xs text-muted-foreground">{C.claudeCode}</p>
          <CopyLine value={claudeCodeCommand(claude, shown.token)} label={C.copyCommand} />
          <p className="text-xs text-muted-foreground">{C.claudeAi(claude.connectorName, claude.url)}</p>
          <CopyLine value={claudeAiHeader(shown.token)} label={C.copy} />
          <p className="text-xs text-muted-foreground">{C.secret}</p>
        </div>
      ) : hasActive ? (
        // Con un accesso già attivo il modulo resta chiuso: di solito ne basta uno.
        <details className="group rounded-lg border" data-slot="account-create-more">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium sm:min-h-9">{C.createAnother}</summary>
          <div className="border-t p-3">{form}</div>
        </details>
      ) : (
        form
      )}
      <details className="group rounded-lg border" data-slot="account-connect-guide">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium sm:min-h-9">{C.guide}</summary>
        <div className="space-y-3 border-t p-3">
          <p className="text-xs text-muted-foreground">{C.guideClaudeCode}</p>
          <CopyLine value={claudeCodeCommand(claude, ACCESS_PLACEHOLDER)} label={C.copyCommand} />
          <p className="text-xs text-muted-foreground">{C.guideClaudeAi(claude.connectorName, claude.url)}</p>
          <CopyLine value={claudeAiHeader(ACCESS_PLACEHOLDER)} label={C.copy} />
          <p className="text-xs text-muted-foreground">{C.guideOnlyYou}</p>
        </div>
      </details>
      {claude.skillName ? (
        <p className="text-xs text-muted-foreground" data-slot="account-skill">
          {C.skill(claude.skillName)}
        </p>
      ) : null}
    </div>
  );
}

/** «Claude e terminale»: gli accessi personali in una lista, «Revoca» con conferma, e la guida a due scelte. */
function ClaudeSection({
  claude,
  terminal,
  actions,
  onChanged,
}: {
  claude: AccountClaude | null;
  terminal: { links: readonly CliTokenView[] } | null;
  actions: AccountActions;
  onChanged: () => void;
}) {
  const rows = accessRows(claude, terminal);
  const choices = [...(claude ? (["claude"] as const) : []), ...(terminal ? (["terminal"] as const) : [])];
  const [choice, setChoice] = useState<"claude" | "terminal">(choices[0] ?? "claude");
  const [revoking, setRevoking] = useState<AccessRow | null>(null);
  const [pending, start] = useTransition();
  const revoke = (row: AccessRow) =>
    start(async () => {
      const run = row.kind === "claude" ? actions.revokeClaudeAccess : actions.revokeTerminalLink;
      const result = await run(row.id).catch(() => ({ ok: false, message: C.failed }));
      if (result.ok) {
        toast.success(C.revoked);
        onChanged();
      } else toast.error(result.message || C.failed);
      setRevoking(null);
    });
  const shown = choices.includes(choice) ? choice : choices[0];
  const activeClaude = (claude?.tokens ?? []).filter((token) => token.active);
  const inactive = (claude?.tokens ?? []).filter((token) => !token.active);
  const exposed = activeClaude.filter((token) => token.exposed);
  const expiring = activeClaude.filter((token) => token.state === "in_scadenza" && token.expiresIn);

  return (
    <Section part="claude" title={C.title}>
      {exposed.map((token) => (
        <p key={`exposed-${token.id}`} role="alert" className="text-sm text-destructive" data-slot="account-exposed">
          {C.exposedNotice(token.label, token.exposedOn ?? "")}
        </p>
      ))}
      {expiring.map((token) => (
        <p key={`expiring-${token.id}`} role="status" className="text-sm" data-slot="account-expiring">
          {C.expiringNotice(token.label, token.expiresIn ?? "")}
        </p>
      ))}
      {rows.length > 0 ? (
        <ul aria-label={C.listLabel} className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={`${row.kind}:${row.id}`} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  <span className="font-medium">{row.kind === "claude" ? C.kindClaude : C.kindTerminal}</span>
                  <span className="text-muted-foreground"> · </span>
                  {row.label}
                </p>
                <p className="text-xs text-muted-foreground">{row.facts.join(" · ")}</p>
              </div>
              <Button type="button" variant="ghost" className="shrink-0" disabled={pending} onClick={() => setRevoking(row)}>
                {C.revoke}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {inactive.length > 0 ? (
        <details className="group rounded-lg border" data-slot="account-inactive">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted-foreground sm:min-h-9">{C.inactive(inactive.length)}</summary>
          <ul className="divide-y border-t">
            {inactive.map((token) => (
              <li key={token.id} className="px-3 py-2 text-sm">
                <span className="font-medium">{token.label}</span>
                <span className="text-xs text-muted-foreground">
                  {" · "}
                  {token.state === "revocato" ? C.revokedState : C.expiredState}
                  {token.state === "revocato" && token.revokedOn ? ` il ${token.revokedOn}` : token.expiresOn ? ` il ${token.expiresOn}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {choices.length > 1 ? (
        <div role="group" aria-label={C.connectLabel} className="inline-flex gap-1 rounded-xl border bg-muted/60 p-1">
          {choices.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={shown === value}
              onClick={() => setChoice(value)}
              className={cn(
                "min-h-11 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8",
                shown === value ? "bg-background text-foreground shadow-sm ring-1 ring-input" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "claude" ? C.choiceClaude : C.choiceTerminal}
            </button>
          ))}
        </div>
      ) : null}
      {shown === "claude" && claude ? <ClaudeGuide claude={claude} actions={actions} onChanged={onChanged} /> : null}
      {shown === "terminal" && terminal ? <p className="text-sm text-muted-foreground">{C.terminalLead}</p> : null}

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        {revoking ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{C.revokeTitle(revoking.label)}</DialogTitle>
              <DialogDescription>{revoking.kind === "claude" ? C.revokeClaude : C.revokeTerminal}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevoking(null)}>
                {C.cancel}
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => revoke(revoking)}>
                {C.revoke}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Section>
  );
}

/** I toni della riga che dice com'è andato il ritorno da Granola. */
const LINE_TONE: Record<Line["tone"], string> = { ok: "text-uc-verde", info: "text-muted-foreground", error: "text-destructive" };

/**
 * «Granola» (Lateral Space): collegare, scollegare, il piano. Dopo il ritorno da Granola (`?granola=…`) la riga che dice
 * com'è andata (`granolaFlashLine`). Le regole delle call stanno in Contesto › Fonti (ondata 6b): con un collegamento,
 * «Regole delle call ›» ci porta, anche chi non gestisce il workspace.
 */
function GranolaSection({
  granola,
  flash,
  rulesHref,
  actions,
  onChanged,
}: {
  granola: NonNullable<AccountSheetData["granola"]>;
  flash: string | null;
  rulesHref: string | null;
  actions: AccountActions;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const connect = () =>
    start(async () => {
      const result = await actions.connectGranola().catch(() => ({ ok: false as const, message: C.failed }));
      if (result.ok) window.location.assign(result.url);
      else toast.error(result.message || C.failed);
    });
  const disconnect = () =>
    start(async () => {
      const result = await actions.disconnectGranola().catch(() => ({ ok: false, message: C.failed }));
      setConfirming(false);
      if (result.ok) {
        toast.success(G.disconnected);
        onChanged();
      } else toast.error(result.message || C.failed);
    });
  const line = granolaFlashLine(flash, granola.state);
  return (
    <Section part="granola" title={T.granola.title}>
      {line ? (
        <p role={line.tone === "error" ? "alert" : "status"} data-slot="granola-outcome" className={cn("text-sm", LINE_TONE[line.tone])}>
          {line.text}
        </p>
      ) : null}
      {granola.state === "non_disponibile" ? <p className="text-sm text-muted-foreground">{G.unavailable}</p> : null}
      {granola.state === "non_collegato" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{G.readOnly}</p>
          <Button variant="outline" disabled={pending} onClick={connect}>
            {G.connect}
          </Button>
        </div>
      ) : null}
      {granola.state === "da_ricollegare" ? (
        <div className="space-y-3">
          <p className="text-sm">{G.expired}</p>
          <Button variant="outline" disabled={pending} onClick={connect}>
            {G.reconnect}
          </Button>
        </div>
      ) : null}
      {granola.state === "collegato" ? (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="min-w-0">
            {granola.accountEmail ? <p className="truncate text-sm font-medium">{G.connectedAs(granola.accountEmail)}</p> : null}
            {granola.plan ? <p className="text-xs text-muted-foreground">{G.plan(granola.plan)}</p> : null}
          </div>
          <Button variant="ghost" className="shrink-0" disabled={pending} onClick={() => setConfirming(true)}>
            {G.disconnect}
          </Button>
        </div>
      ) : null}
      {granola.state === "collegato" && rulesHref ? <TextAction href={rulesHref}>{T.granola.rules}</TextAction> : null}
      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        {confirming ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{G.disconnectConfirm}</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {C.cancel}
              </Button>
              <Button variant="destructive" disabled={pending} onClick={disconnect}>
                {G.disconnect}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Section>
  );
}

const THEME_ICONS: Record<ThemeChoice, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };
const isThemeChoice = (value: unknown): value is ThemeChoice => THEME_OPTIONS.some((option) => option.value === value);

/** «Tema»: Scuro · Chiaro · Come il sistema, la stessa scelta del menu sotto il nome. */
function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const value: ThemeChoice = isThemeChoice(theme) ? theme : "dark";
  const name = useId();
  return (
    <Section part="tema" title={T.theme.title}>
      <fieldset>
        <legend className="sr-only">{T.theme.title}</legend>
        <div className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/60 p-1">
          {THEME_OPTIONS.map((option) => {
            const Icon = THEME_ICONS[option.value];
            return (
              <label
                key={option.value}
                className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-center text-sm text-muted-foreground transition-colors has-checked:bg-background has-checked:font-medium has-checked:text-foreground has-checked:shadow-sm has-checked:ring-1 has-checked:ring-input has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:min-h-9"
              >
                <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => setTheme(option.value)} className="sr-only" />
                <Icon aria-hidden className="size-4 shrink-0" />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    </Section>
  );
}

/**
 * Il contenuto del foglio «Il tuo account» (rilascio 10, PROPOSTA-10 §3.10): chi sei, poi le parti che ti riguardano,
 * nell'ordine del foglio. Una parte che non ti riguarda non c'è (lo zero non si vede); il tema c'è sempre.
 */
export function AccountSheetBody({
  user,
  state,
  actions,
  onRetry,
  onChanged,
  granola,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null };
  state: AccountSheetState;
  actions: AccountActions;
  onRetry: () => void;
  onChanged: () => void;
  /** Per «Granola»: `?granola=` dell'indirizzo (il ritorno da Granola) e il link alle regole delle call. */
  granola?: { flash: string | null; rulesHref: string | null };
}) {
  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? "U";
  const account = state.status === "ready" ? state.account : null;
  return (
    <div data-slot="account-sheet-body">
      <div className="flex items-center gap-3 px-4 py-4">
        <Avatar className="size-10">
          <AvatarImage src={user.image ?? undefined} />
          <AvatarFallback className="text-sm">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name ?? SHELL_TEXT.user.fallbackName}</p>
          {user.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
        </div>
      </div>
      <div className="border-t">
        {state.status === "loading" ? (
          <p role="status" className="px-4 py-5 text-sm text-muted-foreground">
            {T.loading}
          </p>
        ) : null}
        {state.status === "error" ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-5">
            <p className="text-sm">{T.loadFailed}</p>
            <Button variant="outline" onClick={onRetry}>
              {T.retry}
            </Button>
          </div>
        ) : null}
        {account?.email ? <EmailSection on={account.email.on} actions={actions} /> : null}
        {account && (account.claude || account.terminal) ? <ClaudeSection claude={account.claude} terminal={account.terminal} actions={actions} onChanged={onChanged} /> : null}
        {account?.granola ? (
          <GranolaSection granola={account.granola} flash={granola?.flash ?? null} rulesHref={granola?.rulesHref ?? null} actions={actions} onChanged={onChanged} />
        ) : null}
        <ThemeSection />
      </div>
    </div>
  );
}
