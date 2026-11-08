"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { SECONDARY_CLASS, TEXT_BUTTON_CLASS } from "@/components/uc/referente/screen";
import { cn } from "@/lib/utils";
import { REFERENT_LIMITS, type ReferentThreadMessageView } from "@/lib/use-cases/referent/contract";
import { REFERENT_PUBLIC_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { REFERENT_THREAD_RULES } from "@/lib/use-cases/referent/thread";
import { postAddition, postDoubt, postEdit } from "./api";
import { threadLineOf, threadTargetOf, type NewsEntry, type ThreadAction } from "./public-view-render";

/**
 * (Rilascio 6) «Il filo con il team» sulla pagina del referente:
 * - sotto ogni risposta già inviata (una domanda, una voce dell'impatto, il caso d'uso) le righe del filo, in
 *   ordine di tempo, e «Modifica» (finché il team non la segna «A posto», poi «Aggiungi qualcosa») con
 *   «Ho un dubbio»: pulsanti di testo, mai pieni; il campo si apre lì sotto, uno alla volta;
 * - in «Da completare» il chiarimento del team con il campo della risposta (si invia con «Invia» in fondo)
 *   e la risposta del team a un suo dubbio, da leggere.
 * Mai chi del team ha scritto («il team»), mai un portale: la pagina vive in `.survey-light`.
 */

const TT = REFERENT_PUBLIC_TEXT.thread;

export const newsAnchor = (id: string) => `ucq-novita-${id.toLowerCase()}`;
export const newsTitleId = (id: string) => `ucq-novita-${id.toLowerCase()}-titolo`;

/** Le righe del filo di un'ancora. */
export function ThreadLines({ messages, today }: { messages: readonly ReferentThreadMessageView[]; today: string }) {
  if (messages.length === 0) return null;
  return (
    <ul aria-label={TT.aria.thread} data-slot="referent-thread" className="space-y-1.5 border-l-2 border-border pl-3 text-base">
      {messages.map((m) => (
        <li key={m.id} className={cn("break-words whitespace-pre-line", m.side === "referente" && "text-muted-foreground")}>
          {threadLineOf(m, today)}
        </li>
      ))}
    </ul>
  );
}

/** Il campo che si apre sotto una risposta: «Ho un dubbio», «Aggiungi qualcosa» o «Modifica». */
function ThreadComposer({
  token,
  mode,
  targetKey,
  initial,
  primary,
  onCancel,
  onSent,
  onStale,
  onDirty,
}: {
  token: string;
  mode: ThreadAction;
  targetKey: string;
  initial: string;
  /** Il campo ha un testo che il team non ha ancora ricevuto (l'«Invia» della pagina si ferma lì). */
  onDirty?: (dirty: boolean) => void;
  /** Il pulsante d'invio è pieno solo quando la schermata non ne ha già uno. */
  primary: boolean;
  onCancel: () => void;
  onSent: () => void;
  onStale: (code: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = mode === "edit" ? REFERENT_LIMITS.answerMax : REFERENT_THREAD_RULES.referentTextMax;
  const label = mode === "edit" ? TT.editLabel : mode === "add" ? TT.addLabel : TT.doubtLabel;
  const placeholder = mode === "edit" ? undefined : mode === "add" ? TT.addPlaceholder : TT.doubtPlaceholder;
  useEffect(() => () => onDirty?.(false), [onDirty]);

  async function send() {
    if (busy) return;
    const clean = text.trim();
    if (!clean) {
      setError(TT.empty);
      return;
    }
    setBusy(true);
    setError(null);
    const target = threadTargetOf(targetKey);
    const r =
      mode === "edit" && target.anchor === "domanda"
        ? await postEdit(token, { needId: target.needId, text: clean })
        : mode === "add"
          ? await postAddition(token, { ...target, text: clean })
          : await postDoubt(token, { ...target, text: clean });
    setBusy(false);
    if (r.ok) {
      onSent();
      return;
    }
    if (r.code === "link_non_valido") {
      window.location.reload();
      return;
    }
    setError(r.issues[0]?.message ?? r.message);
    if (r.code === "risposta_chiusa" || r.code === "domanda_non_disponibile" || r.code === "informativa_da_leggere") onStale(r.code);
  }

  return (
    <form
      noValidate
      data-slot="referent-thread-composer"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={`${id}-testo`} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={`${id}-testo`}
        value={text}
        maxLength={max}
        rows={3}
        placeholder={placeholder}
        disabled={busy}
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-errore` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onDirty?.(e.target.value.trim() !== initial.trim());
          if (error) setError(null);
        }}
        className={TEXTAREA_CLASS}
      />
      {error ? (
        <p id={`${id}-errore`} className="text-sm break-words text-uc-rosso">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={busy} onClick={onCancel}>
          {TT.cancel}
        </Button>
        <Button type="submit" variant={primary ? "default" : "outline"} className={SECONDARY_CLASS} aria-busy={busy || undefined} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {TT.send}
        </Button>
      </div>
    </form>
  );
}

/**
 * Sotto una risposta già inviata: le righe del filo, i pulsanti di testo e il campo che si apre. `subject` è il
 * titolo della risposta per i lettori di schermo («Ho un dubbio su «Volumi mensili»»).
 */
export function ThreadItem({
  token,
  targetKey,
  subject,
  messages,
  actions,
  today,
  editText = "",
  composer,
  onComposer,
  primary,
  privacyGate,
  sent,
  onSent,
  onStale,
  onDirty,
}: {
  token: string;
  targetKey: string;
  subject: string;
  messages: readonly ReferentThreadMessageView[];
  actions: readonly ThreadAction[];
  today: string;
  editText?: string;
  /** Il campo aperto qui, oppure null. */
  composer: ThreadAction | null;
  onComposer: (mode: ThreadAction | null) => void;
  primary: boolean;
  /** L'informativa da leggere prima di scrivere (una versione nuova): si mostra al posto del campo. */
  privacyGate: ReactNode | null;
  /** Appena inviato qui: «Inviato. Il team lo vede subito.» */
  sent: boolean;
  onSent: () => void;
  onStale: (code: string) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  if (messages.length === 0 && actions.length === 0 && !sent) return null;
  const aria = (mode: ThreadAction) => fillText(mode === "edit" ? TT.aria.editOn : mode === "add" ? TT.aria.addOn : TT.aria.doubtOn, { testo: subject });
  const word = (mode: ThreadAction) => (mode === "edit" ? TT.edit : mode === "add" ? TT.add : TT.doubt);
  return (
    <div className="min-w-0 space-y-2" data-slot="referent-thread-item">
      <ThreadLines messages={messages} today={today} />
      {sent ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Check className="size-4 text-uc-verde" aria-hidden />
          {TT.sent}
        </p>
      ) : null}
      {composer ? (
        privacyGate ?? (
          <ThreadComposer
            token={token}
            mode={composer}
            targetKey={targetKey}
            initial={composer === "edit" ? editText : ""}
            primary={primary}
            onCancel={() => onComposer(null)}
            onSent={onSent}
            onStale={onStale}
            onDirty={onDirty}
          />
        )
      ) : actions.length > 0 ? (
        <div className="-ml-2 flex flex-wrap gap-x-1">
          {actions.map((mode) => (
            <Button
              key={mode}
              type="button"
              variant="ghost"
              className={cn(TEXT_BUTTON_CLASS, "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline")}
              aria-label={aria(mode)}
              onClick={() => onComposer(mode)}
            >
              {word(mode)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewsFrame({ entry, title, children, missing, invalid, done }: { entry: NewsEntry; title: string; children: ReactNode; missing?: boolean; invalid?: boolean; done?: boolean }) {
  return (
    <section
      id={newsAnchor(entry.id)}
      aria-labelledby={newsTitleId(entry.id)}
      data-slot={`referent-news-${entry.kind}`}
      className={cn("min-w-0 scroll-mt-6 space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5", missing && "ring-2 ring-uc-giallo", invalid && "ring-2 ring-uc-rosso")}
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>{entry.label}</span>
          {done ? (
            <>
              <Check className="size-4 text-uc-verde" aria-hidden />
              <span className="sr-only">{REFERENT_PUBLIC_TEXT.doneSuffix}</span>
            </>
          ) : null}
        </p>
        <h3 id={newsTitleId(entry.id)} tabIndex={-1} className="rounded-md text-lg leading-snug font-semibold break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

/** «Da completare»: un chiarimento del team, con il campo della risposta (si invia con «Invia» in fondo). */
export function ClarificationCard({
  entry,
  message,
  value,
  onChange,
  missing,
  error,
  disabled,
}: {
  entry: NewsEntry;
  message: ReferentThreadMessageView;
  value: string;
  onChange: (value: string) => void;
  missing: boolean;
  error: string | null;
  disabled: boolean;
}) {
  const id = useId();
  const done = value.trim().length > 0;
  return (
    <NewsFrame entry={entry} title={entry.anchorLabel} missing={missing && !done} invalid={Boolean(error)} done={done}>
      <p className="rounded-xl bg-uc-giallo-bg px-4 py-3 text-base break-words whitespace-pre-line">{fillText(TT.teamAsks, { testo: message.text })}</p>
      <div className="min-w-0 space-y-1.5">
        <label htmlFor={`${id}-risposta`} className="block text-sm font-medium">
          {TT.replyLabel}
        </label>
        <textarea
          id={`${id}-risposta`}
          value={value}
          maxLength={REFERENT_THREAD_RULES.referentTextMax}
          rows={3}
          placeholder={TT.replyPlaceholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-errore` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={TEXTAREA_CLASS}
        />
      </div>
      {error ? (
        <p id={`${id}-errore`} className="text-sm break-words text-uc-rosso">
          {error}
        </p>
      ) : missing && !done ? (
        <p className="text-sm break-words">{TT.replyMissing}</p>
      ) : null}
    </NewsFrame>
  );
}

/** «Da completare»: la risposta del team a un dubbio del referente, da leggere. */
export function TeamReplyCard({ entry, reply, doubt }: { entry: NewsEntry; reply: ReferentThreadMessageView; doubt: ReferentThreadMessageView | null }) {
  return (
    <NewsFrame entry={entry} title={entry.anchorLabel} done>
      {doubt ? <p className="text-base break-words whitespace-pre-line text-muted-foreground">{fillText(TT.youAsked, { testo: doubt.text })}</p> : null}
      <p className="text-base break-words whitespace-pre-line">{reply.text}</p>
    </NewsFrame>
  );
}

/** (Rilascio 6) «Già inviato · n» sotto «Da completare»: chiuso, un tocco per leggerlo (B.1.5); senza rientro, così le schede restano larghe. */
export function SentDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details data-slot="referent-sent" className="group mt-8 text-base">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-base font-medium select-none [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        {summary}
      </summary>
      <div className="mt-2 space-y-4">{children}</div>
    </details>
  );
}
