"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { SECONDARY_CLASS, TEXT_BUTTON_CLASS } from "@/components/uc/referente/screen";
import { cn } from "@/lib/utils";
import { REFERENT_LIMITS, type ReferentThreadMessageView } from "@/lib/use-cases/referent/contract";
import { REFERENT_PUBLIC_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { waitsForPrivacy } from "@/lib/use-cases/referent/state";
import { REFERENT_THREAD_RULES } from "@/lib/use-cases/referent/thread";
import { postAddition, postDoubt, postEdit } from "./api";
import { threadLineOf, threadTargetOf, type NewsEntry, type ThreadAction, type WriteTarget } from "./public-view-render";

/**
 * (Rilascio 6) «Il filo con il team» sulla pagina del referente:
 * - sotto ogni risposta già inviata (una domanda, una voce dell'impatto, il caso d'uso) le righe del filo, in
 *   ordine di tempo, e «Modifica» (finché il team non la segna «A posto», poi «Aggiungi qualcosa») con
 *   «Ho un dubbio»: pulsanti di testo, mai pieni; il campo si apre lì sotto, uno alla volta;
 * - in «Novità» il chiarimento del team con il campo della risposta (si invia con «Invia» in fondo)
 *   e la risposta del team a un suo dubbio, da leggere.
 * Mai chi del team ha scritto («il team»), mai un portale: la pagina vive in `.survey-light`.
 *
 * (Rilascio 10, §3.11) In «Novità» il titolo della scheda è il messaggio del team (la sua domanda, o la sua risposta), con
 * sotto la riga grigia di dove sta; a lavoro finito «Scrivi al team» (`WriteToTeam`), con «Su cosa?» (un `<select>`
 * nativo), prende il posto di «Aggiungi qualcosa» e «Ho un dubbio» su ogni riga; sotto le risposte resta «Modifica».
 *
 * (Rilascio 9b) Un invio che aspetta l'informativa non perde il testo: il campo resta montato, nascosto, mentre
 * l'informativa è sullo schermo (al suo posto o in cima alla pagina), e torna con quello che c'era scritto.
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
  onPrivacyWait,
}: {
  token: string;
  mode: ThreadAction;
  targetKey: string;
  initial: string;
  /** (Rilascio 9b) L'invio aspetta l'informativa: la pagina la mostra, il testo resta. */
  onPrivacyWait?: () => void;
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
    // (Rilascio 9b) Aspetta l'informativa: niente messaggio qui sotto, il testo resta e la pagina mostra l'informativa.
    if (waitsForPrivacy(r.code) && onPrivacyWait) {
      onPrivacyWait();
      return;
    }
    setError(r.issues[0]?.message ?? r.message);
    if (r.code === "risposta_chiusa" || r.code === "domanda_non_disponibile" || waitsForPrivacy(r.code)) onStale(r.code);
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
  onPrivacyWait,
  labels,
}: {
  token: string;
  targetKey: string;
  subject: string;
  messages: readonly ReferentThreadMessageView[];
  actions: readonly ThreadAction[];
  /** (Rilascio 10) La parola di un'azione, al posto di quella di sempre: «Hai un dubbio sul caso d'uso?». */
  labels?: Partial<Record<ThreadAction, string>>;
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
  /** (Rilascio 9b) L'invio del campo aperto qui aspetta l'informativa. */
  onPrivacyWait?: () => void;
}) {
  if (messages.length === 0 && actions.length === 0 && !sent && !composer) return null;
  // Con una parola propria il nome è quello che si legge; altrimenti la parola e la risposta («Modifica la risposta a «…»»).
  const aria = (mode: ThreadAction) => (labels?.[mode] ? undefined : fillText(mode === "edit" ? TT.aria.editOn : mode === "add" ? TT.aria.addOn : TT.aria.doubtOn, { testo: subject }));
  const word = (mode: ThreadAction) => labels?.[mode] ?? (mode === "edit" ? TT.edit : mode === "add" ? TT.add : TT.doubt);
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
        <>
          {privacyGate}
          {/* (Rilascio 9b) Il campo resta montato sotto l'informativa, nascosto: il testo scritto non si perde. */}
          <div hidden={privacyGate ? true : undefined}>
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
              onPrivacyWait={onPrivacyWait}
            />
          </div>
        </>
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

function NewsFrame({
  entry,
  title,
  sub,
  children,
  missing,
  invalid,
  done,
}: {
  entry: NewsEntry;
  title: string;
  /** (Rilascio 10, §3.11) Sotto il titolo, in grigio: dove sta («Sulla domanda «…»»). */
  sub?: string;
  children?: ReactNode;
  missing?: boolean;
  invalid?: boolean;
  done?: boolean;
}) {
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
        <h3 id={newsTitleId(entry.id)} tabIndex={-1} className="rounded-md text-base leading-6 font-semibold break-words whitespace-pre-line outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          {title}
        </h3>
        {sub ? <p className="text-sm break-words text-muted-foreground">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * «Novità»: un chiarimento del team, con il campo della risposta (si invia con «Invia» in fondo). (Rilascio 10, §3.11) Il
 * titolo della scheda è la domanda del team; sotto, in grigio, dove sta.
 */
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
    <NewsFrame entry={entry} title={message.text} sub={entry.anchorLabel} missing={missing && !done} invalid={Boolean(error)} done={done}>
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

/** «Novità»: la risposta del team a un dubbio del referente, da leggere. (Rilascio 10, §3.11) Il titolo è la risposta del team. */
export function TeamReplyCard({ entry, reply, doubt }: { entry: NewsEntry; reply: ReferentThreadMessageView; doubt: ReferentThreadMessageView | null }) {
  return (
    <NewsFrame entry={entry} title={reply.text} sub={entry.anchorLabel} done>
      {doubt ? <p className="text-base break-words whitespace-pre-line text-muted-foreground">{fillText(TT.youAsked, { testo: doubt.text })}</p> : null}
    </NewsFrame>
  );
}

/**
 * (Rilascio 6) Quello che ha già inviato, chiuso: un tocco per leggerlo (B.1.5); senza rientro, così le schede restano
 * larghe. (Rilascio 10, §3.11) «Le tue risposte (n)», in «Novità» e a lavoro finito.
 */
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

/** (Rilascio 10, §3.11) Il campo aperto di «Scrivi al team», nello stato della pagina (un campo alla volta). */
export const WRITE_KEY = "scrivi";
/** «Su cosa?»: riceve il fuoco quando si apre «Scrivi al team», prima del testo. */
export const WRITE_ABOUT_ID = "ucq-scrivi-su";

/**
 * (Rilascio 10, §3.11) «Scrivi al team»: un pulsante solo, che apre il campo con «Su cosa?» (un `<select>` nativo, niente
 * portali) per il caso d'uso, una voce delle stime o una domanda già inviata. Dove si può fare tutte e due le cose, due
 * scelte: «Aggiungi qualcosa» (il team la vede da verificare) o «Ho un dubbio» (il team risponde); altrimenti quella che
 * c'è. Gli stessi invii e le stesse regole di prima (`postAddition`, `postDoubt`): cambia solo dove stanno.
 */
export function WriteToTeam({
  token,
  targets,
  open,
  onOpen,
  primary,
  privacyGate,
  sent,
  onSent,
  onStale,
  onDirty,
  onPrivacyWait,
}: {
  token: string;
  targets: readonly WriteTarget[];
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Il pulsante è pieno solo quando la schermata non ne ha già uno. */
  primary: boolean;
  /** L'informativa da leggere prima di scrivere (una versione nuova): si mostra al posto del campo. */
  privacyGate: ReactNode | null;
  /** Appena inviato: «Inviato. Il team lo vede subito.» */
  sent: boolean;
  onSent: () => void;
  onStale: (code: string) => void;
  onDirty?: (dirty: boolean) => void;
  onPrivacyWait?: () => void;
}) {
  if (targets.length === 0) return null;
  return (
    <div className="mt-6 space-y-3" data-slot="referent-write">
      {sent && !open ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Check className="size-4 text-uc-verde" aria-hidden />
          {TT.sent}
        </p>
      ) : null}
      {open ? (
        <>
          {privacyGate}
          {/* (Rilascio 9b) Il campo resta montato sotto l'informativa, nascosto: il testo scritto non si perde. */}
          <div hidden={privacyGate ? true : undefined}>
            <WriteForm token={token} targets={targets} primary={primary} onCancel={() => onOpen(false)} onSent={onSent} onStale={onStale} onDirty={onDirty} onPrivacyWait={onPrivacyWait} />
          </div>
        </>
      ) : (
        <Button type="button" variant={primary ? "default" : "outline"} className="h-12 w-full text-base sm:w-auto sm:min-w-48" onClick={() => onOpen(true)}>
          {TT.write}
        </Button>
      )}
    </div>
  );
}

function WriteForm({
  token,
  targets,
  primary,
  onCancel,
  onSent,
  onStale,
  onDirty,
  onPrivacyWait,
}: {
  token: string;
  targets: readonly WriteTarget[];
  primary: boolean;
  onCancel: () => void;
  onSent: () => void;
  onStale: (code: string) => void;
  onDirty?: (dirty: boolean) => void;
  onPrivacyWait?: () => void;
}) {
  const id = useId();
  const [key, setKey] = useState(targets[0]?.key ?? "g");
  const [chosen, setChosen] = useState<"add" | "doubt" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const target = targets.find((t) => t.key === key) ?? targets[0];
  // Una scelta sola: è quella. Due: la sceglie il referente.
  const kind = target.kinds.length === 1 ? target.kinds[0] : chosen !== null && target.kinds.includes(chosen) ? chosen : null;
  const label = kind === "add" ? TT.addLabel : kind === "doubt" ? TT.doubtLabel : TT.writeLabel;
  const placeholder = kind === "add" ? TT.addPlaceholder : kind === "doubt" ? TT.doubtPlaceholder : undefined;

  async function send() {
    if (busy) return;
    const clean = text.trim();
    if (!clean) {
      setError(TT.empty);
      return;
    }
    if (!kind) {
      setError(TT.writeKindMissing);
      return;
    }
    setBusy(true);
    setError(null);
    const anchor = threadTargetOf(target.key);
    const r = kind === "add" ? await postAddition(token, { ...anchor, text: clean }) : await postDoubt(token, { ...anchor, text: clean });
    setBusy(false);
    if (r.ok) {
      onSent();
      return;
    }
    if (r.code === "link_non_valido") {
      window.location.reload();
      return;
    }
    // (Rilascio 9b) Aspetta l'informativa: niente messaggio qui sotto, il testo resta e la pagina mostra l'informativa.
    if (waitsForPrivacy(r.code) && onPrivacyWait) {
      onPrivacyWait();
      return;
    }
    setError(r.issues[0]?.message ?? r.message);
    if (r.code === "risposta_chiusa" || r.code === "domanda_non_disponibile" || waitsForPrivacy(r.code)) onStale(r.code);
  }

  return (
    <form
      noValidate
      data-slot="referent-thread-composer"
      className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="min-w-0 space-y-1.5">
        <label htmlFor={WRITE_ABOUT_ID} className="block text-sm font-medium">
          {TT.writeAbout}
        </label>
        <select
          id={WRITE_ABOUT_ID}
          value={target.key}
          disabled={busy}
          onChange={(e) => {
            setKey(e.target.value);
            if (error === TT.writeKindMissing) setError(null);
          }}
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {targets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {target.kinds.length > 1 ? (
        <div role="group" aria-label={TT.writeKinds} className="-ml-2 flex flex-wrap gap-x-1">
          {target.kinds.map((k) => (
            <Button
              key={k}
              type="button"
              variant="ghost"
              aria-pressed={kind === k}
              disabled={busy}
              className="min-h-11 h-auto px-2 text-base font-medium aria-pressed:bg-muted aria-pressed:ring-[1.5px] aria-pressed:ring-foreground aria-pressed:ring-inset"
              onClick={() => {
                setChosen(k);
                if (error === TT.writeKindMissing) setError(null);
              }}
            >
              {k === "add" ? TT.add : TT.doubt}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="min-w-0 space-y-1.5">
        <label htmlFor={`${id}-testo`} className="block text-sm font-medium">
          {label}
        </label>
        <textarea
          id={`${id}-testo`}
          value={text}
          maxLength={REFERENT_THREAD_RULES.referentTextMax}
          rows={3}
          placeholder={placeholder}
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-errore` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onDirty?.(e.target.value.trim().length > 0);
            if (error === TT.empty) setError(null);
          }}
          className={TEXTAREA_CLASS}
        />
      </div>
      {error ? (
        <p id={`${id}-errore`} role="alert" className="text-sm break-words text-uc-rosso">
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
