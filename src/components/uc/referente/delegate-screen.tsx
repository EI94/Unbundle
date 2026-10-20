"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import { checkDelegate, fieldIssues, type DelegateForm } from "@/lib/uc/views/referente-form";
import { referentHash } from "@/lib/uc/views/referente-plan";
import { CHOICE_ROW_CLASS, Field, FieldErrors, NATIVE_CHECK_CLASS, TextAreaControl, TextControl } from "./inputs/fields";
import { BackLink, CopyLink, Disclosure, Notice, PRIMARY_CLASS, ScreenTitle } from "./screen";
import { ActionBar } from "./step-bar";
import { formatCountIt } from "@/lib/uc/views/format";

/**
 * R5 · «Chiedi a un collega» (DESIGN §4.3, `#/collega/<id>`): nome, email di
 * lavoro, un messaggio facoltativo e cosa girargli: solo questa domanda, le
 * domande aperte dell'argomento, oppure «Scelgo io…» per argomento. Regge cento
 * e più domande in un invio. Il collega riceve un link suo; un dominio nuovo
 * per il caso lo controlla prima Lateral Space; senza email si copia il link.
 */
export interface DelegateOption {
  id: string;
  title: string;
}

export interface DelegateGroup {
  title: string;
  items: DelegateOption[];
}

export type DelegateResult = { ok: true; status: "inviata" | "da_approvare"; items: number; link: string | null } | { ok: false; message: string; issues: Issue[] };

type Scope = "questa" | "argomento" | "scelte";

function doneText(r: Extract<DelegateResult, { ok: true }>, name: string): string {
  if (r.status === "da_approvare") return `Prima di mandarlo, Lateral Space controlla l'indirizzo di ${name}. Intanto queste domande escono dalla tua lista.`;
  if (r.link) return `Copia il link e mandalo a ${name}. Lo vedi solo adesso.`;
  return r.items === 1 ? `Fatto: la domanda passa a ${name}. Non è più nella tua lista.` : `Fatto: ${r.items} domande passano a ${name}. Non sono più nella tua lista.`;
}

export function DelegateScreen({
  itemId,
  topicTitle,
  topicItems,
  groups,
  emailConfigured,
  wholeTopic,
  backHref,
  onDelegate,
}: {
  itemId: string;
  topicTitle: string;
  /** Domande aperte e delegabili dell'argomento della domanda (lei compresa). */
  topicItems: readonly DelegateOption[];
  /** Tutte le domande delegabili, per argomento («Scelgo io…»). */
  groups: readonly DelegateGroup[];
  emailConfigured: boolean;
  wholeTopic: boolean;
  backHref: string;
  onDelegate: (form: DelegateForm) => Promise<DelegateResult>;
}) {
  const [form, setForm] = useState({ nome: "", email: "", messaggio: "" });
  const [scope, setScope] = useState<Scope>(wholeTopic && topicItems.length > 1 ? "argomento" : "questa");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set([itemId]));
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Extract<DelegateResult, { ok: true }> | null>(null);
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const voci = scope === "questa" ? [itemId] : scope === "argomento" ? topicItems.map((i) => i.id) : allIds.filter((id) => chosen.has(id));
  const name = form.nome.trim();

  async function submit() {
    const body: DelegateForm = { nome: form.nome, email: form.email, messaggio: form.messaggio, voci };
    const check = checkDelegate(body, allIds);
    if (!check.ok) {
      setIssues(check.errors);
      setMessage("Controlla i campi segnati.");
      return;
    }
    setBusy(true);
    setIssues([]);
    setMessage(null);
    const r = await onDelegate(body);
    setBusy(false);
    if (r.ok) setDone(r);
    else {
      setIssues(r.issues);
      setMessage(r.message);
    }
  }

  if (done) {
    return (
      <section aria-labelledby="uc-r-titolo" className="mt-6 space-y-5">
        <ScreenTitle>Chiedi a un collega</ScreenTitle>
        <Notice tone={done.status === "da_approvare" ? "info" : "ok"}>
          <p>{doneText(done, name)}</p>
          {done.link ? <CopyLink link={done.link} name={name} /> : null}
        </Notice>
        <Button className={PRIMARY_CLASS} render={<a href={referentHash({ screen: "home" })} />} nativeButton={false}>
          Torna agli argomenti
        </Button>
      </section>
    );
  }

  const toggle = (id: string, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <section aria-labelledby="uc-r-titolo" className="mt-2 space-y-5">
      <BackLink href={backHref}>Indietro</BackLink>
      <div className="space-y-1">
        <ScreenTitle>Chiedi a un collega</ScreenTitle>
        <p className="text-base text-muted-foreground">
          {emailConfigured ? "Gli mandiamo noi un link suo, solo per le domande che scegli." : "Ti diamo un link suo da mandargli, solo per le domande che scegli."}
        </p>
      </div>
      <Field label="Nome e cognome" htmlFor="uc-del-nome" issues={fieldIssues(issues, "nome")}>
        <TextControl id="uc-del-nome" value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} disabled={busy} invalid={fieldIssues(issues, "nome").length > 0} autoCapitalize="sentences" />
      </Field>
      <Field label="Email di lavoro" htmlFor="uc-del-email" issues={fieldIssues(issues, "email")}>
        <TextControl id="uc-del-email" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={(v) => setForm({ ...form, email: v })} disabled={busy} invalid={fieldIssues(issues, "email").length > 0} />
      </Field>
      <Field label="Un messaggio per lui (facoltativo)" htmlFor="uc-del-msg" issues={fieldIssues(issues, "messaggio")}>
        <TextAreaControl id="uc-del-msg" value={form.messaggio} onChange={(v) => setForm({ ...form, messaggio: v })} disabled={busy} rows={2} />
      </Field>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-base font-medium">Cosa gli giri</legend>
        <label className={CHOICE_ROW_CLASS}>
          <input type="radio" name="uc-del-scope" className={NATIVE_CHECK_CLASS} checked={scope === "questa"} onChange={() => setScope("questa")} disabled={busy} />
          <span className="min-w-0 break-words">Solo questa domanda</span>
        </label>
        {topicItems.length > 1 ? (
          <label className={CHOICE_ROW_CLASS}>
            <input type="radio" name="uc-del-scope" className={NATIVE_CHECK_CLASS} checked={scope === "argomento"} onChange={() => setScope("argomento")} disabled={busy} />
            <span className="min-w-0 break-words">
              Le {formatCountIt(topicItems.length)} domande aperte di «{topicTitle}»
            </span>
          </label>
        ) : null}
        {allIds.length > 1 ? (
          <label className={CHOICE_ROW_CLASS}>
            <input type="radio" name="uc-del-scope" className={NATIVE_CHECK_CLASS} checked={scope === "scelte"} onChange={() => setScope("scelte")} disabled={busy} />
            <span className="min-w-0 break-words">Scelgo io…</span>
          </label>
        ) : null}
        {scope === "scelte" ? (
          <div className="space-y-1 pt-1">
            {groups.map((g) => (
              <Disclosure key={g.title} summary={`${g.title} (${g.items.filter((i) => chosen.has(i.id)).length} di ${g.items.length})`}>
                <div className="grid gap-2 pt-1">
                  {g.items.map((o) => (
                    <label key={o.id} className={CHOICE_ROW_CLASS}>
                      <input type="checkbox" className={NATIVE_CHECK_CLASS} checked={chosen.has(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} disabled={busy} />
                      <span className="min-w-0 break-words">{o.title}</span>
                    </label>
                  ))}
                </div>
              </Disclosure>
            ))}
          </div>
        ) : null}
        <FieldErrors issues={fieldIssues(issues, "voci")} />
      </fieldset>
      {message ? <Notice tone="errore">{message}</Notice> : null}
      <ActionBar>
        <Button type="button" className={PRIMARY_CLASS} disabled={busy || voci.length === 0} onClick={() => void submit()}>
          {emailConfigured ? "Manda il link" : "Crea il link"}
        </Button>
      </ActionBar>
    </section>
  );
}
