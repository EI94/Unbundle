"use client";

/**
 * «Mappatura board»: l'assistente accanto alla board, S2d (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5, §5, §7.4).
 *
 * Il contenuto del pannello (la testa del pannello, «Assistente» e «Chiudi», e il suo posto sono della board): i due
 * bottoni piccoli contornati «Carica documenti» e, quando l'unità ha un documento, «Proponi passi dai documenti»; la
 * conversazione; il campo con il bottone d'invio contornato (il bottone pieno della schermata resta quello della testa
 * della vista). Le decisioni su che cosa mostrare di una risposta sono quelle della chat di sempre (`assistantView` di
 * chat-view.ts), con l'aspetto della board e le etichette dei tool della board («Passo salvato»).
 *
 * La conversazione vive nella sessione dello store della board (session.ts): chiudere e riaprire il pannello non la
 * perde, e ogni tool della board finito rilegge la board aperta. Il campo porta `data-b="companion-input"`: «Inizia con
 * l'assistente» della board ci mette il cursore.
 *
 * (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.3) Senza l'ok ai sub-responsabili del workspace al posto del campo c'è
 * l'avviso calmo di «Contesto» (`AiConsentNotice`), come nella chat di Discovery; i messaggi di prima restano. L'ok si
 * chiede al montaggio e dopo un 403 `ok_fornitori_mancante` della rotta, che è il controllo vero: mentre si chiede il
 * campo resta com'è.
 */
import { useChat } from "@ai-sdk/react";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { CONTEXT_TEXT } from "../../../lib/context/text.ts";
import { CONSENT_CHECKING, isConsentError, loadChatConsent, type ChatConsent } from "../../agent/chat-consent.ts";
import { HIDDEN_TOOLS, MAPPING_TOOL_LABELS, TOOL_LABELS, assistantView, messageText, type ChatProgress, type ChatUIMessage } from "../../agent/chat-view.ts";
import { AiConsentNotice } from "../../context/ai-consent-notice.tsx";
import type { CompanionProps } from "../contracts.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { BoardButton, StatusChip } from "../ui/atoms.tsx";
import { fitHeight, PanelToast } from "../ui/edit.tsx";
import { Documents } from "./documents.tsx";
import { Proposals } from "./proposals.tsx";
import { openClassificationTab } from "./completion.ts";
import { companionSessionFor, createCompanionSession } from "./session.ts";
import { COMPANION_TEXT, chatErrorText, waitingText } from "./text.ts";

/** Le etichette dei tool come le mostra l'assistente della board: quelle della board sopra quelle di sempre. */
export const COMPANION_TOOL_LABELS = Object.freeze({ ...TOOL_LABELS, ...MAPPING_TOOL_LABELS });

/** Dopo quanti secondi, se tocca alla persona, l'assistente lo ricorda. */
export const NUDGE_AFTER_S = 45;

/** Il campo dell'assistente cresce con il testo fino a questa altezza (board-companion.css, `.b-comp-input`), poi scorre. */
export const FIELD_MAX_HEIGHT = 200;

// ─── Il testo di una risposta ────────────────────────────────────────

/** Il grassetto `**…**` di una riga. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, index) =>
    piece.startsWith("**") && piece.endsWith("**") && piece.length > 4 ? <strong key={index}>{piece.slice(2, -2)}</strong> : <Fragment key={index}>{piece}</Fragment>,
  );
}

/** Il testo di un messaggio: righe, i trattini come elenco, il grassetto. Nient'altro del markdown. */
export function MessageText(p: { text: string }): JSX.Element {
  return (
    <div className="b-comp-text">
      {p.text.split("\n").map((line, index) =>
        /^[—-]\s/.test(line) ? (
          <div key={index} className="b-comp-li">
            {inline(line.replace(/^[—-]\s*/, ""))}
          </div>
        ) : (
          <p key={index}>{inline(line)}</p>
        ),
      )}
    </div>
  );
}

const DONE_MARK = (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M2 6.3l2.5 2.4L10 3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Una riga di avanzamento: una nota del modello, o un tool con la sua etichetta (finito, o in corso a tratteggio). */
export function ProgressItem(p: { item: ChatProgress }): JSX.Element {
  if (p.item.kind === "note") return <p className="b-comp-note">{p.item.text}</p>;
  return (
    <StatusChip tone={p.item.done ? "ok" : "check"}>
      {p.item.done ? DONE_MARK : null}
      {p.item.label}
    </StatusChip>
  );
}

/** Un messaggio della conversazione: la domanda della persona, o la risposta con le sue righe di avanzamento. */
export function MessageView(p: { message: ChatUIMessage; arriving: boolean }): JSX.Element {
  if (p.message.role === "user") {
    return (
      <div className="b-comp-msg" data-role="user">
        <MessageText text={messageText(p.message)} />
      </div>
    );
  }
  const view = assistantView(p.message, HIDDEN_TOOLS, { arriving: p.arriving, labels: COMPANION_TOOL_LABELS });
  const text = view.kind === "refused" ? view.notice : view.text;
  if (!text.trim() && view.progress.length === 0) return <Fragment />;
  return (
    <div className="b-comp-msg" data-role="assistant" data-refused={view.kind === "refused" ? "" : undefined}>
      {view.kind === "refused" ? <p className="b-comp-note">{view.notice}</p> : text.trim() ? <MessageText text={text} /> : null}
      {view.progress.length > 0 ? (
        <div className="b-comp-progress">
          {view.progress.map((item, index) => (
            <ProgressItem key={index} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Attesa, promemoria, errore ──────────────────────────────────────

function useSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

function Waiting(): JSX.Element {
  return <p className="b-comp-wait">{waitingText(useSeconds())}</p>;
}

function Nudge(): JSX.Element | null {
  return useSeconds() < NUDGE_AFTER_S ? null : <p className="b-comp-nudge">{COMPANION_TEXT.nudge}</p>;
}

export function ChatError(p: { error: Error }): JSX.Element {
  return (
    <div className="b-comp-error" role="alert">
      <b>{COMPANION_TEXT.errors.title}</b>
      <span>{chatErrorText(p.error)}</span>
    </div>
  );
}

const SEND_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Il primo antenato che scorre: il pannello, o il corpo del drawer. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

// ─── L'assistente ────────────────────────────────────────────────────

export function Companion(p: CompanionProps): JSX.Element {
  const client = useBoardClient();
  const canEdit = useBoard((state) => state.board.can.edit);
  const [session] = useState(() =>
    companionSessionFor(client, () =>
      createCompanionSession({
        workspaceId: p.workspaceId,
        departmentId: p.departmentId,
        unitName: p.unitName,
        hasDocuments: p.hasDocuments,
        initialMessages: p.initialMessages,
        client,
        openClassification: () => openClassificationTab(),
      }),
    ),
  );
  const { messages, status, error, sendMessage } = useChat({ chat: session.chat });
  const [hasDocuments, setHasDocuments] = useState(p.hasDocuments);
  const [docsOpen, setDocsOpen] = useState(false);
  const docsId = useId();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";

  // L'ok ai sub-responsabili (rilascio 9a): al montaggio, e di nuovo quando la rotta risponde che manca.
  const [consent, setConsent] = useState<ChatConsent>(p.initialConsent ?? CONSENT_CHECKING);
  const checkConsent = useCallback(() => {
    let live = true;
    void loadChatConsent(p.workspaceId).then((next) => {
      if (live) setConsent(next);
    });
    return () => {
      live = false;
    };
  }, [p.workspaceId]);
  useEffect(() => checkConsent(), [checkConsent]);
  const refusedForConsent = isConsentError(error);
  useEffect(() => (refusedForConsent ? checkConsent() : undefined), [refusedForConsent, checkConsent]);
  const consentMissing = consent.state === "missing";

  const userTurn = !busy && messages.length > 1 && messages[messages.length - 1]?.role === "assistant" && messages.some((message) => message.role === "user");
  const showSuggestions = !busy && !consentMissing && !messages.some((message) => message.role === "user");

  // Ogni tool della board finito rilegge la board aperta, una volta (session.ts).
  useEffect(() => session.observe(messages), [session, messages]);

  // La conversazione resta in fondo mentre arriva, se la persona era già in fondo.
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const parent = scrollParent(root.current);
    if (parent && atBottom.current) parent.scrollTop = parent.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    const parent = scrollParent(root.current);
    if (!parent) return;
    const onScroll = () => {
      atBottom.current = parent.scrollHeight - parent.scrollTop - parent.clientHeight < 80;
    };
    parent.addEventListener("scroll", onScroll, { passive: true });
    return () => parent.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  // Finita la risposta, il cursore torna nel campo, ma solo se era nell'assistente: chi sta lavorando sulla board resta lì.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const active = document.activeElement;
      if (!active || active === document.body || root.current?.contains(active)) field.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);

  // Il campo cresce con il testo, fino a 200 px (il bordo compreso: senza, il testo scorrerebbe di 2 px).
  const grow = () => {
    if (field.current) fitHeight(field.current, FIELD_MAX_HEIGHT);
  };

  const send = (text: string) => {
    const value = text.trim();
    if (!value || busy || consentMissing) return;
    atBottom.current = true;
    void sendMessage({ role: "user", parts: [{ type: "text", text: value }] });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const element = field.current;
    if (!element || busy) return;
    const value = element.value;
    element.value = "";
    grow();
    send(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit(event);
    }
  };

  const F = COMPANION_TEXT.field;
  return (
    <div className="b-comp" ref={root} data-b="companion">
      {/* (Rilascio 10, §3.7) Un solo «Documenti ▾»: dentro, «Carica documenti» e «Proponi passi dai documenti». */}
      <div className="b-comp-tools">
        <button type="button" className="b-btn b-small" aria-expanded={docsOpen} aria-controls={docsId} onClick={() => setDocsOpen(!docsOpen)} data-b="documents-menu">
          {COMPANION_TEXT.documents.menu}
          <span className="b-caret" aria-hidden="true">
            {docsOpen ? "▴" : "▾"}
          </span>
        </button>
        <div className="b-comp-tools" id={docsId} hidden={!docsOpen}>
          <Documents workspaceId={p.workspaceId} departmentId={p.departmentId} disabled={!canEdit} onUploaded={() => setHasDocuments(true)} />
          {hasDocuments ? <Proposals workspaceId={p.workspaceId} departmentId={p.departmentId} disabled={!canEdit} /> : null}
        </div>
      </div>
      <div className="b-comp-log" role="log" aria-busy={busy} data-b="companion-log">
        {messages.map((message, index) => (
          <MessageView key={message.id} message={message} arriving={busy && index === messages.length - 1} />
        ))}
        {busy ? <Waiting /> : null}
        {/* Manca l'ok: al posto dell'errore, l'avviso in fondo. */}
        {error && !refusedForConsent ? <ChatError error={error} /> : null}
        {userTurn ? <Nudge /> : null}
      </div>
      {showSuggestions ? (
        <div className="b-comp-sugg">
          {COMPANION_TEXT.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="b-fchip"
              onClick={() => {
                // I suggerimenti spariscono con il primo messaggio: il cursore va nel campo, dove si continua (F1).
                field.current?.focus();
                send(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      {consent.state === "missing" ? (
        <div className="b-comp-form" data-b="companion-consent">
          <PanelToast />
          <div>
            <AiConsentNotice
              notice={consent.notice}
              variant="card"
              onGranted={() => {
                setConsent(CONSENT_CHECKING);
                checkConsent();
              }}
            />
            <p className="b-comp-note">{CONTEXT_TEXT.consent.chatHint}</p>
          </div>
        </div>
      ) : (
      <form className="b-comp-form" onSubmit={onSubmit}>
        {/* Il toast della board, quando il pannello sta sopra la pagina: sopra il campo, mai sopra quello che si scrive. */}
        <PanelToast />
        <textarea
          ref={field}
          className="b-input b-comp-input"
          rows={1}
          aria-label={F.label}
          placeholder={busy ? F.waiting : F.placeholder}
          // Mentre aspetta la risposta il campo non si scrive ma tiene il cursore: spento, il fuoco cadrebbe sulla pagina (F1).
          readOnly={busy}
          aria-disabled={busy || undefined}
          onInput={grow}
          onKeyDown={onKeyDown}
          data-b="companion-input"
        />
        <BoardButton type="submit" aria-label={F.send} title={F.send} aria-disabled={busy || undefined} data-action="send">
          {SEND_ICON}
        </BoardButton>
      </form>
      )}
    </div>
  );
}
