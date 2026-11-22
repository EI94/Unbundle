"use client";

import { useState, useTransition } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { BuilderFacts } from "@/components/agent-factory/builder-facts";
import { ChoiceSelect } from "@/components/uc/people/choice-select";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspaceInvitationAction } from "@/lib/actions/workspace-collaboration";
import { addBuilderAction, removeBuilderAction } from "@/lib/actions/use-case-workspace-team";
import type { BuilderRow } from "@/lib/db/queries/use-case-workspace-team";
import { ROLE_LABEL } from "@/lib/uc/views/labels";
import { builderCandidateGroups, builderStateText, builderWhereText, EXTERNAL_ROLE_HINT, externalRemoveConfirm, type BuilderCandidateView } from "@/lib/use-cases/factory/builders-text";
import { FACTORY_TEXT } from "./factory-text";

const T = FACTORY_TEXT.builders;

const LS_ROLES = [
  { value: "ls_sviluppatore", label: "Sviluppatore" },
  { value: "ls_analista", label: "Analista" },
  { value: "ls_lead", label: "Responsabile" },
] as const;
const EXTERNAL_ROLE = { value: "builder_esterno", label: "Sviluppatore esterno" } as const;
/** Nell'elenco di «Persona»: chi non è ancora nel workspace, da invitare con la sua e-mail. */
export const NEW_PERSON = "__nuova__";

export interface WhereChoice {
  useCaseId: string;
  code: string;
  title: string;
}

/** «Chi costruisce», come lo legge la pagina del manager di Lateral Space. */
export interface FactoryBuildersData {
  rows: BuilderRow[];
  /** Le persone tra cui scegliere; `blocked`: perché da fuori oggi non può costruire (si vede, non si sceglie). */
  candidates: BuilderCandidateView[];
  choices: WhereChoice[];
  /** (8.2b) I repository (in minuscolo) con una chiave della CI viva: la conferma di «Togli» chiede di ruotarla. */
  ciLive: string[];
  /** Chi guarda può invitare nel workspace: l'e-mail nuova crea l'invito (come Analista). */
  canInvite: boolean;
}

/**
 * Una persona di «Chi costruisce»: nome, da fuori o no, ruolo, dove, la CLI (o perché da fuori oggi non costruisce),
 * e «Togli» con la conferma (8.0c): per chi viene da fuori i casi e i repository di GitHub (da togliere a mano), e con
 * una chiave della CI viva sui suoi repository la richiesta di ruotarla (8.2b).
 */
export function BuilderLine({ workspaceId, m, ciLive }: { workspaceId: string; m: BuilderRow; ciLive: ReadonlySet<string> }) {
  const role = m.external ? "Sviluppatore" : ROLE_LABEL[m.role as keyof typeof ROLE_LABEL];
  const facts = [...(m.external ? ["esterno"] : []), role, builderWhereText(m.where, m.whereCodes), builderStateText(m)];
  const confirm = m.external
    ? externalRemoveConfirm({ name: m.name, openCases: m.openCases, repos: m.repos, ciRepos: m.repos.filter((repo) => ciLive.has(repo.toLowerCase())) })
    : {
        title: `Togliere ${m.name} da chi costruisce?`,
        text: `Esce da tutti i casi aperti dove è ${role.toLowerCase()} e non entra in quelli nuovi; i compiti che ha lì tornano da prendere. I ruoli dati caso per caso restano; l'unico responsabile di un caso non si toglie.`,
      };
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="font-medium break-words">{m.name}</span>
        <BuilderFacts email={m.external ? null : m.email} facts={facts} />
      </span>
      <RemoveBuilder workspaceId={workspaceId} userId={m.userId} name={m.name} title={confirm.title} text={confirm.text} />
    </li>
  );
}

/**
 * «Togli» da chi costruisce, con la conferma dell'app: per chi viene da fuori dice quanti casi e i repository di GitHub
 * (che si tolgono a mano); per Lateral Space i casi aperti dal ruolo del team. Fantasma nella riga, rosso nella finestra.
 */
export function RemoveBuilder({ workspaceId, userId, name, title, text }: { workspaceId: string; userId: string; name: string; title: string; text: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" className="min-h-11 shrink-0 sm:min-h-8" disabled={pending} aria-label={`Togli ${name} da chi costruisce`} onClick={() => setOpen(true)}>
        Togli
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={text}
        confirmLabel="Togli"
        destructive
        pending={pending}
        onConfirm={() => {
          setOpen(false);
          run(() => removeBuilderAction(workspaceId, userId));
        }}
      />
    </>
  );
}

/** Il link d'invito appena creato, con «Copia il link»: si vede una volta, come in Impostazioni › Team. */
function InviteReady({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div role="status" data-slot="builder-invite-ready" className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">{T.inviteReady}</p>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Input readOnly value={url} aria-label={T.copyLink} onFocus={(event) => event.currentTarget.select()} className="min-h-11 min-w-0 font-mono text-base sm:min-h-9 sm:text-xs" />
        <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-9" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? T.copied : T.copyLink}
        </Button>
      </div>
      {failed ? <p className="text-xs text-muted-foreground">{T.copyFailed}</p> : null}
    </div>
  );
}

/**
 * I gruppi di «Persona»: «Lateral Space» ed «Esterni» e, a chi può invitare nel workspace, «Una persona nuova, per
 * e-mail». Senza `canInvite` quella voce non c'è: l'invito lo rifiuterebbe il server.
 */
export function builderPersonGroups(data: Pick<FactoryBuildersData, "candidates" | "canInvite">) {
  return [...builderCandidateGroups(data.candidates), ...(data.canInvite ? [{ options: [{ value: NEW_PERSON, label: T.newEmail }] }] : [])];
}

/** L'azione dell'invito, come la chiama il modulo (nei test, finta). */
export type InviteAction = typeof createWorkspaceInvitationAction;

/**
 * (Revisione 6b) L'invito di una persona nuova: il link d'invito del workspace per la sua e-mail, sempre come Analista
 * (il ruolo che serve per costruire). Unbundle non lo manda: lo manda chi aggiunge. Il server rifà i suoi controlli.
 */
export async function inviteNewBuilder(workspaceId: string, email: string, create: InviteAction = createWorkspaceInvitationAction): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const form = new FormData();
  form.set("email", email.trim());
  form.set("role", "analyst");
  try {
    const result = await create(workspaceId, { ok: true }, form);
    if (result.ok && result.data) return { ok: true, url: result.data.inviteUrl };
    return { ok: false, error: result.fieldErrors?.email ?? result.message ?? T.inviteFailed };
  } catch {
    return { ok: false, error: T.inviteFailed };
  }
}

/**
 * (8.0c, rilascio 10 §3.6) «Aggiungi» a chi costruisce: la persona tra i collaboratori del workspace, in due gruppi
 * («Lateral Space» ed «Esterni»), il ruolo, e per chi viene da fuori il «Dove». Per una persona già presente da fuori
 * cambia il «Dove». (Ondata 6b) A chi può invitare nel workspace anche «Una persona nuova, per e-mail»: crea l'invito
 * come Analista (il link si manda a mano); quando la persona entra, si aggiunge da qui.
 */
export function AddBuilder({ workspaceId, data, onDone }: { workspaceId: string; data: FactoryBuildersData; onDone?: () => void }) {
  const { pending, run } = useUcAction();
  const [inviting, startInvite] = useTransition();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [where, setWhere] = useState<"tutti" | "alcuni">("tutti");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const { candidates, choices } = data;
  const newPerson = data.canInvite && userId === NEW_PERSON;
  const candidate = candidates.find((c) => c.userId === userId && !c.blocked) ?? null;
  const external = candidate !== null && !candidate.isLateralSpace;
  const roles = external ? [EXTERNAL_ROLE] : LS_ROLES;
  const ready = Boolean(candidate && role && (!external || where === "tutti" || picked.size > 0));
  const groups = builderPersonGroups(data);

  const invite = () => {
    setEmailError(null);
    startInvite(async () => {
      const result = await inviteNewBuilder(workspaceId, email);
      if (result.ok) {
        setInviteUrl(result.url);
        setEmail("");
      } else setEmailError(result.error);
    });
  };

  return (
    <form
      className="space-y-3"
      data-slot="builder-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (newPerson) {
          if (email.trim()) invite();
          return;
        }
        if (!ready) return;
        run(() => addBuilderAction(workspaceId, { userId, role, where: external ? (where === "tutti" ? "tutti" : [...picked]) : "tutti" }), {
          onSuccess: () => {
            setUserId("");
            setRole("");
            setWhere("tutti");
            setPicked(new Set());
            onDone?.();
          },
        });
      }}
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="builder-person" className="text-xs">
            {T.person}
          </Label>
          <ChoiceSelect
            id="builder-person"
            value={userId}
            placeholder={T.choose}
            onChange={(v) => {
              setInviteUrl(null);
              if (v === NEW_PERSON && data.canInvite) {
                setUserId(NEW_PERSON);
                setRole("");
                return;
              }
              const next = candidates.find((c) => c.userId === v && !c.blocked);
              setUserId(next ? v : "");
              setRole(next ? (next.isLateralSpace ? "ls_sviluppatore" : EXTERNAL_ROLE.value) : "");
            }}
            groups={groups}
          />
          {newPerson ? null : <p className="text-xs text-muted-foreground">{data.canInvite ? T.notFound : T.notFoundNoInvite}</p>}
        </div>
        {newPerson ? (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="builder-email" className="text-xs">
              {T.emailLabel}
            </Label>
            <Input
              id="builder-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby="builder-email-hint"
              className="min-h-11 text-base sm:min-h-9 sm:text-sm"
            />
            <p id="builder-email-hint" className={emailError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {emailError ?? T.emailHint}
            </p>
          </div>
        ) : (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="builder-role" className="text-xs">
              {T.role}
            </Label>
            <ChoiceSelect id="builder-role" value={role} placeholder={T.choose} disabled={!candidate} onChange={setRole} groups={[{ options: roles.map((r) => ({ value: r.value, label: r.label })) }]} />
          </div>
        )}
      </div>

      {external ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{EXTERNAL_ROLE_HINT}</p>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">{T.where}</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
              <input type="radio" name="builder-where" value="tutti" checked={where === "tutti"} onChange={() => setWhere("tutti")} />
              {T.whereAll}
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
              <input type="radio" name="builder-where" value="alcuni" checked={where === "alcuni"} onChange={() => setWhere("alcuni")} />
              {T.whereSome}
            </label>
          </fieldset>
          {where === "alcuni" ? (
            choices.length ? (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2" aria-label={T.whereLabel}>
                {choices.map((c) => (
                  <li key={c.useCaseId}>
                    <label className="flex min-h-11 items-start gap-2 py-1 text-sm sm:min-h-8">
                      <Checkbox
                        className="mt-0.5"
                        checked={picked.has(c.useCaseId)}
                        onCheckedChange={(checked) => {
                          const next = new Set(picked);
                          if (checked) next.add(c.useCaseId);
                          else next.delete(c.useCaseId);
                          setPicked(next);
                        }}
                      />
                      <span className="min-w-0">
                        {c.code ? <span className="font-medium tabular-nums">{c.code}</span> : null}
                        {c.code ? " · " : ""}
                        {c.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{T.noChoices}</p>
            )
          ) : null}
        </div>
      ) : null}

      {/* (Rilascio 10, §3.6) Bordato: il pulsante pieno della pagina è il prossimo passo. */}
      {newPerson ? (
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={inviting || !email.trim()}>
          <UserPlus aria-hidden />
          {T.invite}
        </Button>
      ) : (
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending || !ready}>
          {T.add}
        </Button>
      )}
      {inviteUrl ? <InviteReady url={inviteUrl} /> : null}
    </form>
  );
}

/** Il corpo del pannello «Chi costruisce»: l'elenco con «Togli», poi «Aggiungi» (bordato) che apre il modulo. */
export function BuildersPanelBody({ workspaceId, data }: { workspaceId: string; data: FactoryBuildersData }) {
  const [adding, setAdding] = useState(false);
  const ciLive = new Set(data.ciLive);
  return (
    <div className="space-y-4" data-slot="factory-builders">
      <p className="text-sm text-muted-foreground">{T.lead}</p>
      {data.rows.length ? (
        <ul className="divide-y">
          {data.rows.map((m) => (
            <BuilderLine key={m.userId} workspaceId={workspaceId} m={m} ciLive={ciLive} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{T.empty}</p>
      )}
      {adding ? (
        <div className="border-t pt-4">
          <AddBuilder workspaceId={workspaceId} data={data} />
        </div>
      ) : (
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setAdding(true)}>
          <UserPlus aria-hidden />
          {T.add}
        </Button>
      )}
    </div>
  );
}
