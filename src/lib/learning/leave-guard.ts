/**
 * (Rilascio 10, ondata 1 · docs/ui-10/PROPOSTA-10.md §1 regola 7) Le modifiche non salvate dei moduli della
 * Formazione, senza le finestre del browser. Prima `confirmLearningNavigation` bloccava la pagina con
 * `window.confirm` (o `window.alert` mentre un salvataggio partiva) e rispondeva subito sì o no; ora apre la finestra
 * dell'app e risponde «no, per ora»: chi conferma scarta le modifiche e poi `proceed` fa il passo chiesto (il
 * collegamento, «Aggiorna», un'altra sezione).
 *
 * Qui solo lo stato, senza React e senza DOM: i moduli si registrano, la finestra (`LearningLeaveDialog`) si iscrive e
 * legge che cosa chiedere. I clic sui collegamenti e la chiusura della scheda li ascolta
 * `src/components/learning/use-unsaved-changes.ts`. Nessuna risposta e nessun identificativo viene conservato.
 */

/** Un modulo registrato: modifiche non salvate, un salvataggio in corso, come scartarle. */
export type LearningGuard = { dirty: boolean; pending?: boolean; onDiscard?: () => void };

/** Che cosa chiede la finestra: lasciare la pagina (un collegamento), continuare (un altro passo), scartare. */
export type LearningLeaveKind = "leave" | "continue" | "discard";

/** «wait»: un salvataggio sta partendo e si aspetta la conferma; si chiude soltanto. */
export type LearningLeaveAsk = { kind: "wait" } | { kind: LearningLeaveKind; proceed: (() => void) | null };

/** Dopo la conferma il passo chiesto parte senza chiedere di nuovo, anche al browser che chiude la pagina. */
export const LEARNING_LEAVE_GRACE_MS = 500;

export interface LearningLeaveGuard {
  register(key: object, guard: LearningGuard): void;
  unregister(key: object): void;
  /** I moduli registrati. */
  size(): number;
  /**
   * true: niente da perdere, chi chiama va avanti subito. false: la finestra si apre (o dice di aspettare) e il passo
   * parte, con `proceed`, solo dopo la conferma.
   */
  request(kind: LearningLeaveKind, proceed?: (() => void) | null): boolean;
  /** Il pulsante della finestra: scarta le modifiche e fa il passo chiesto; con «wait» chiude soltanto. */
  confirm(): void;
  /** «Resta», «Annulla», Esc o un clic fuori: niente cambia. */
  dismiss(): void;
  /** La chiusura della scheda chiede al browser di fermarsi. */
  blocksUnload(): boolean;
  subscribe(listener: () => void): () => void;
  current(): LearningLeaveAsk | null;
}

export function createLearningLeaveGuard(now: () => number = Date.now): LearningLeaveGuard {
  const guards = new Map<object, LearningGuard>();
  const listeners = new Set<() => void>();
  let ask: LearningLeaveAsk | null = null;
  let graceUntil = 0;

  const show = (next: LearningLeaveAsk | null) => {
    ask = next;
    for (const listener of listeners) listener();
  };

  return {
    register(key, guard) {
      guards.set(key, guard);
    },
    unregister(key) {
      guards.delete(key);
      if (guards.size > 0) return;
      // L'ultimo modulo se ne va: niente più da proteggere, né una finestra rimasta aperta.
      graceUntil = 0;
      if (ask) show(null);
    },
    size: () => guards.size,
    request(kind, proceed = null) {
      if (now() < graceUntil) return true;
      const active = [...guards.values()];
      // Senza la finestra montata non si blocca niente: nessuno potrebbe rispondere.
      if (active.length === 0 || listeners.size === 0) return true;
      if (active.some((guard) => guard.pending)) {
        show({ kind: "wait" });
        return false;
      }
      if (!active.some((guard) => guard.dirty)) return true;
      show({ kind, proceed });
      return false;
    },
    confirm() {
      const current = ask;
      if (!current) return;
      show(null);
      if (current.kind === "wait") return;
      for (const guard of guards.values()) if (guard.dirty) guard.onDiscard?.();
      // Il passo confermato non deve far chiedere di nuovo, né all'app né al browser; il tempo scade anche se il passo
      // non parte.
      graceUntil = now() + LEARNING_LEAVE_GRACE_MS;
      current.proceed?.();
    },
    dismiss() {
      if (ask) show(null);
    },
    blocksUnload() {
      if (now() < graceUntil) return false;
      return [...guards.values()].some((guard) => guard.dirty || guard.pending);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => ask,
  };
}
