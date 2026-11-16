/**
 * «Mappatura board»: la board nel browser (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7).
 *
 * Senza React: si prova con Node, con fetch, orologio e memoria finti. Tiene l'ultima board letta dal server e la coda
 * delle operazioni non ancora salvate; quello che si vede è la board con la coda applicata sopra (`applyOps`). I tempi,
 * la pillola, «Salva ora», la bozza sul dispositivo e i toast sono quelli della board di riferimento (BOARD-SPEC §3.3–
 * §3.5); il salvataggio è per operazioni, non per file intero:
 * - una modifica si vede subito, segna la pillola «Modifiche da salvare», scrive la bozza e fa partire il salvataggio:
 *   5 secondi dopo l'ultima modifica, mai due salvataggi automatici a meno di 15 secondi;
 * - un salvataggio manda la coda com'è in quel momento; una modifica fatta mentre viaggia resta in coda e la pillola
 *   torna «da salvare» (il difetto F4 del riferimento);
 * - un'eliminazione si vede subito e aspetta il suo toast: «Annulla» la toglie dalla coda; «Salva ora» e la pagina che
 *   si nasconde o si chiude la mandano lo stesso;
 * - la pagina che si nasconde o si chiude salva subito: con `keepalive` quando il corpo sta sotto i 60 KB (una pagina
 *   in secondo piano sul telefono può essere fermata senza `pagehide`), con una richiesta normale altrimenti; la bozza
 *   resta sul dispositivo finché il server non risponde;
 * - un rifiuto del server per un campo cambiato da altri alza il toast del conflitto, e la board prende i valori più
 *   recenti; il resto è salvato;
 * - senza permesso (401, 403, 404) la board passa in sola lettura e le modifiche restano sul dispositivo; un errore di
 *   rete o del server lascia «da salvare» (o «solo su questo dispositivo» senza rete) e si riprova al ritorno in linea.
 *
 * Non c'è una vista dal vivo degli altri, come sul riferimento: le loro modifiche arrivano al prossimo salvataggio, a
 * un `pull` o a una ricarica. Nessun timer rilegge la board.
 */
import { allSteps, caseLinksOf, withUseCaseLinks, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { applyOps, boardOpSchema, coalesce, type BoardOp } from "../../../lib/mappatura/board-ops.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import { AUTOSAVE, MAPPING_LIMITS, OP_MEMORY } from "../../../lib/mappatura/vocab.ts";
import { draftKey } from "./drafts.ts";

export type PillState = "saved" | "dirty" | "saving" | "readonly" | "local";

export interface BoardToast {
  key: number;
  text: string;
  undo?: boolean;
  action?: { label: string; run(): void };
}

export interface BoardClientState {
  board: MappingBoard;
  pill: PillState;
  savedAt: string | null;
  pending: number;
  toast: BoardToast | null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Un'operazione senza il suo id: lo mette lo store. */
export type OpInput = DistributiveOmit<BoardOp, "id">;

export interface BoardClient {
  getState(): BoardClientState;
  subscribe(listener: () => void): () => void;
  /** Applica subito, segna «da salvare», scrive la bozza, programma il salvataggio. `undo`: il toast con «Annulla» (eliminazioni). */
  dispatch(ops: OpInput | OpInput[], options?: { undo?: string }): void;
  /**
   * Salva subito tutta la coda, anche le eliminazioni che aspettano il loro toast. `hidden`: la pagina si nasconde o si
   * chiude, e ogni richiesta usa `keepalive` se il suo corpo sta sotto i 60 KB (`keepaliveFits`).
   */
  saveNow(options?: { hidden?: boolean }): Promise<void>;
  /** Rilegge la board dal server e ci rimette sopra le modifiche non salvate. */
  pull(): Promise<void>;
  /**
   * Una board già letta (la risposta di «Completa la mappatura»). `linked`: la board arriva dalla pagina, con i suoi
   * use case collegati; senza, restano quelli che c'erano.
   */
  replace(board: MappingBoard, options?: { linked?: boolean }): void;
  notify(text: string, action?: BoardToast["action"]): void;
  newId(): string;
  /** Dopo il primo disegno: rimette la bozza del dispositivo sopra la board e fa ripartire il salvataggio. */
  start(): void;
  /** Il browser è in linea o no: fuori linea le modifiche restano «solo su questo dispositivo»; al ritorno si riprova una volta. */
  setOnline(online: boolean): void;
  /** La persona esce dall'app: si manda quello che c'è da salvare, poi la board smette e la sua bozza si toglie. */
  signOut(): Promise<void>;
  dispose(): void;
}

export interface BoardClientDeps {
  workspaceId: string;
  departmentId: string;
  /** Chi ha la board aperta: la bozza sul dispositivo è sua (`draftKey`). */
  userId: string;
  initial: MappingBoard;
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(): string;
}

/** Un'operazione in coda; un'eliminazione con il suo toast aspetta fino a `heldUntil`. */
interface Queued {
  op: BoardOp;
  heldUntil?: number;
}

interface SaveAnswer {
  board?: unknown;
  rejected?: Array<{ id: string; reason: string }>;
}

const PERSON = { kind: "persona" } as const;
/** Senza le tabelle della 0039, o senza il permesso di modificare, la board si legge e basta. */
const isReadonly = (board: MappingBoard) => board.store === "mancante" || !board.can.edit;
const sameBoard = (a: MappingBoard, b: MappingBoard) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** Una risposta che ha la forma di una board: il resto lo garantisce il server. */
const isBoard = (value: unknown): value is MappingBoard => {
  const board = value as Partial<MappingBoard> | null | undefined;
  return Boolean(board && typeof board === "object" && Array.isArray(board.processes) && Array.isArray(board.analysis) && typeof board.revision === "number" && board.can && board.unit);
};
const NO_ABILITIES = { edit: false, setStream: false, complete: false };
/**
 * Il corpo più grande di un salvataggio `keepalive` (la pagina che si nasconde o si chiude): il browser rifiuta una
 * richiesta `keepalive` oltre 64 KB (in tutto, per pagina). Un corpo più grande parte con una richiesta normale.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;
const encoder = new TextEncoder();

/** Un corpo da mandare con `keepalive`: al più `KEEPALIVE_MAX_BYTES` byte in UTF-8 (una lettera accentata ne conta due). */
export const keepaliveFits = (body: string): boolean => encoder.encode(body).length <= KEEPALIVE_MAX_BYTES;

/** Quanto vive la bozza sul dispositivo: oltre, chi riapre la board non rimanda modifiche vecchie di giorni. */
const DRAFT_MAX_AGE_MS = OP_MEMORY.draftDays * 24 * 60 * 60 * 1000;
const isRemove = (op: BoardOp) => op.t === "step.remove" || op.t === "note.remove" || op.t === "process.remove";

/** La chiave della bozza sul dispositivo: di una persona su un'unità (drafts.ts). */
export { draftKey };
/** Dove si legge e si salva la board di un'unità. */
export const boardUrl = (workspaceId: string, departmentId: string) => `/api/workspaces/${workspaceId}/mapping/${departmentId}/board`;

export function createBoardClient(deps: BoardClientDeps): BoardClient {
  const url = boardUrl(deps.workspaceId, deps.departmentId);
  const key = draftKey(deps.userId, deps.departmentId);
  const listeners = new Set<() => void>();

  /** L'ultima board letta dal server. */
  let base = deps.initial;
  /** Le operazioni in viaggio in un salvataggio, e quelle che aspettano. */
  let flight: BoardOp[] = [];
  let queue: Queued[] = [];
  let readonly = isReadonly(base);
  let online = true;
  let saving: Promise<void> | null = null;
  /** Un salvataggio non riuscito: al ritorno in linea si riprova una volta. */
  let failed = false;
  let lastSaveAt: number | null = null;
  let saveTimer: unknown = null;
  let toastTimer: unknown = null;
  let toast: BoardToast | null = null;
  let toastKey = 0;
  /** Le eliminazioni che il toast a schermo può annullare. */
  let undoIds: readonly string[] = [];
  let pullAfterSave = false;
  let disposed = false;
  let state: BoardClientState;

  const pendingOps = () => [...flight, ...queue.map((item) => item.op)];

  function compute(): BoardClientState {
    const pending = pendingOps();
    const shown = applyOps(base, pending, PERSON);
    const pill: PillState = readonly ? "readonly" : saving ? "saving" : pending.length === 0 ? "saved" : online ? "dirty" : "local";
    return {
      // In sola lettura i controlli si spengono: le modifiche già fatte restano visibili, su questo dispositivo.
      board: readonly && (shown.can.edit || shown.can.setStream || shown.can.complete) ? { ...shown, can: NO_ABILITIES } : shown,
      pill,
      savedAt: base.savedAt,
      pending: pending.length,
      toast,
    };
  }

  function emit() {
    state = compute();
    for (const listener of [...listeners]) listener();
  }

  function writeDraft() {
    if (!deps.storage) return;
    try {
      const ops = pendingOps();
      if (ops.length === 0) deps.storage.removeItem(key);
      else deps.storage.setItem(key, JSON.stringify({ v: 1, at: deps.now(), ops }));
    } catch {
      // La memoria del dispositivo è piena o spenta: la board funziona lo stesso, senza bozza.
    }
  }

  /**
   * La bozza del dispositivo, se c'è e ha meno di 7 giorni (`at`: l'ultima volta che è stata scritta). Una bozza più
   * vecchia, o senza ora, si toglie: le sue modifiche non tornano sopra il lavoro fatto dagli altri nel frattempo.
   */
  function readDraft(): BoardOp[] {
    if (!deps.storage) return [];
    try {
      const raw = deps.storage.getItem(key);
      if (!raw) return [];
      const draft = JSON.parse(raw) as { v?: unknown; at?: unknown; ops?: unknown };
      if (draft?.v !== 1 || !Array.isArray(draft.ops)) return [];
      if (typeof draft.at !== "number" || !(deps.now() - draft.at <= DRAFT_MAX_AGE_MS)) {
        deps.storage.removeItem(key);
        return [];
      }
      return draft.ops.flatMap((item) => {
        const parsed = boardOpSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    } catch {
      return [];
    }
  }

  function hideToast() {
    if (toastTimer !== null) deps.clearTimer(toastTimer);
    toastTimer = null;
    toast = null;
    undoIds = [];
  }

  /** Un toast alla volta: il nuovo prende il posto di quello a schermo. */
  function showToast(next: Omit<BoardToast, "key">, ms: number, undoable: readonly string[] = []) {
    hideToast();
    toast = { key: ++toastKey, ...next };
    undoIds = undoable;
    const shown = toast.key;
    toastTimer = deps.setTimer(() => {
      toastTimer = null;
      if (toast?.key !== shown) return;
      toast = null;
      undoIds = [];
      emit();
    }, ms);
  }

  function schedule() {
    if (saveTimer !== null) {
      deps.clearTimer(saveTimer);
      saveTimer = null;
    }
    if (disposed || readonly || queue.length === 0) return;
    const now = deps.now();
    // 5 secondi dopo l'ultima modifica, e mai due salvataggi automatici a meno di 15 secondi.
    const quiet = Math.max(AUTOSAVE.quietMs, lastSaveAt === null ? 0 : AUTOSAVE.minGapMs - (now - lastSaveAt));
    // Se in coda ci sono solo eliminazioni che aspettano il loro toast, si aspetta la prima che scade.
    const firstFree = Math.min(...queue.map((item) => (item.heldUntil ?? now) - now));
    saveTimer = deps.setTimer(
      () => {
        saveTimer = null;
        void save(false, false);
      },
      Math.max(quiet, firstFree),
    );
  }

  /**
   * La board arrivata dal server diventa la base. Gli use case collegati li legge solo la pagina: una board che arriva
   * dalle route non li porta, e restano quelli che c'erano (`linked` falso).
   */
  function adopt(board: MappingBoard, linked: boolean) {
    base = linked ? board : withUseCaseLinks(board, caseLinksOf(base));
    // Una board appena letta dice anche se si può scrivere: dopo «sola lettura» si torna a salvare da qui.
    readonly = isReadonly(board);
  }

  /** Il toast di un rifiuto: un passo collegato, un limite, o il conflitto. Uno solo, il più preciso. */
  function rejectionToast(sent: readonly BoardOp[], rejected: ReadonlyArray<{ id: string; reason: string }>): string | null {
    const byId = new Map(sent.map((op) => [op.id, op]));
    let text: string | null = null;
    let rank = 0;
    for (const { id, reason } of rejected) {
      const op = byId.get(id);
      if (!op) continue;
      // Un'eliminazione che non trova più il bersaglio è riuscita lo stesso.
      if (reason === "gone" && isRemove(op)) continue;
      if (reason === "linked") {
        text = BOARD_TEXT.toast.linked;
        rank = 3;
      } else if (reason === "limit" && rank < 2) {
        const T = BOARD_TEXT.toast;
        text =
          op.t === "process.add"
            ? T.limitProcesses
            : op.t === "note.add"
              ? op.stepId === null
                ? T.limitAnalysis
                : T.limitNotes
              : op.t === "step.add" && allSteps(base).length >= MAPPING_LIMITS.stepsPerUnit
                ? T.limitStepsInBoard
                : T.limitStepsInProcess;
        rank = 2;
      } else if (rank < 1) {
        text = BOARD_TEXT.toast.conflict;
        rank = 1;
      }
    }
    return text;
  }

  /**
   * Un salvataggio. `all`: anche le eliminazioni che aspettano il loro toast («Salva ora», la pagina che si nasconde o
   * si chiude). `hidden`: la pagina si nasconde o si chiude, e la richiesta usa `keepalive` se il suo corpo sta sotto i
   * 60 KB. Uno alla volta: chi arriva mentre uno viaggia aspetta che finisca, poi manda quello che restava in coda quando
   * ha chiesto (anche oltre le 200 operazioni di un salvataggio). Le modifiche fatte dopo, mentre il salvataggio
   * viaggia, restano «da salvare» e partono con il salvataggio automatico (F4). Quello che viaggia resta nella bozza
   * finché il server non risponde.
   */
  function save(all: boolean, hidden: boolean): Promise<void> {
    if (disposed || readonly) return Promise.resolve();
    const asked = all ? new Set(queue.map((item) => item.op.id)) : null;
    // Dopo un salvataggio non riuscito non si insiste: decide la persona, con «Salva ora».
    const rest = () => (asked && !failed && !readonly && !disposed && queue.some((item) => asked.has(item.op.id)) ? save(true, hidden) : undefined);
    if (saving) return saving.then(rest);

    const now = deps.now();
    const sending = queue.filter((item) => all || item.heldUntil === undefined || item.heldUntil <= now).slice(0, MAPPING_LIMITS.opsPerSave);
    if (sending.length === 0) {
      schedule();
      return Promise.resolve();
    }
    if (saveTimer !== null) {
      deps.clearTimer(saveTimer);
      saveTimer = null;
    }
    queue = queue.filter((item) => !sending.includes(item));
    flight = sending.map((item) => item.op);
    const sent = flight;
    lastSaveAt = now;
    failed = false;
    // Un'eliminazione che parte non si annulla più: il suo toast se ne va.
    if (sent.some((op) => undoIds.includes(op.id))) hideToast();

    const payload = JSON.stringify({ baseRevision: base.revision, ops: sent });
    // La pagina che si nasconde o si chiude: `keepalive` se il corpo ci sta (il browser rifiuta oltre 64 KB), altrimenti
    // una richiesta normale. In tutti e due i casi la bozza tiene le operazioni finché il server non risponde.
    const keepalive = hidden && keepaliveFits(payload);
    const request = (async (): Promise<{ status: number; body: SaveAnswer | null }> => {
      try {
        const response = await deps.fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive,
        });
        return { status: response.status, body: response.ok ? ((await response.json()) as SaveAnswer) : null };
      } catch {
        // Senza rete, o la risposta non è arrivata.
        return { status: 0, body: null };
      }
    })();

    const run = request.then(({ status, body }) => {
      saving = null;
      if (disposed) return;
      if (status >= 200 && status < 300 && isBoard(body?.board)) {
        // Salvate: escono dalla coda solo le operazioni mandate; quelle fatte nel frattempo restano da salvare.
        flight = [];
        adopt(body.board, false);
        const text = rejectionToast(sent, Array.isArray(body.rejected) ? body.rejected : []);
        if (text) showToast({ text }, AUTOSAVE.toastMs);
        // La risposta porta già la board più recente: non serve rileggerla.
        pullAfterSave = false;
      } else {
        // Non salvate: tornano in testa alla coda, nello stesso ordine, e restano nella bozza.
        queue = [...sent.map((op) => ({ op })), ...queue];
        flight = [];
        if (status === 401 || status === 403 || status === 404) {
          readonly = true;
          showToast({ text: BOARD_TEXT.toast.readonly }, AUTOSAVE.toastMs);
        } else if (status === 503) {
          // La 0039 manca ancora: sola lettura per qualche minuto, senza toast.
          readonly = true;
        } else {
          failed = true;
          showToast({ text: BOARD_TEXT.toast.failure }, AUTOSAVE.toastMs);
        }
      }
      writeDraft();
      emit();
      if (pullAfterSave) {
        pullAfterSave = false;
        void pull();
      }
      // Dopo un salvataggio non riuscito non si riprova da soli: alla prossima modifica, a «Salva ora», o al ritorno in linea.
      if (!failed) schedule();
    });
    saving = run;
    emit();
    return run.then(rest);
  }

  async function pull(): Promise<void> {
    if (disposed) return;
    if (saving) {
      // Il salvataggio in viaggio torna con la board più recente; si rilegge solo se non riesce.
      pullAfterSave = true;
      return;
    }
    let board: unknown;
    try {
      const response = await deps.fetch(`${url}?since=${base.revision}`, { method: "GET", headers: { accept: "application/json" } });
      if (!response.ok) return;
      board = ((await response.json()) as { board?: unknown } | null)?.board;
    } catch {
      return;
    }
    // «unchanged» arriva senza board: resta quella che c'è.
    if (disposed || !isBoard(board)) return;
    // Una risposta più vecchia di quello che c'è già (un salvataggio è arrivato prima) non torna indietro.
    if (board.revision < base.revision) return;
    const wasReadonly = readonly;
    adopt(board, false);
    emit();
    // La board è tornata scrivibile: le modifiche tenute sul dispositivo si salvano.
    if (wasReadonly && !readonly) schedule();
  }

  function dispose() {
    disposed = true;
    if (saveTimer !== null) deps.clearTimer(saveTimer);
    if (toastTimer !== null) deps.clearTimer(toastTimer);
    saveTimer = null;
    toastTimer = null;
    listeners.clear();
  }

  state = compute();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(input, options) {
      if (disposed) return;
      const now = deps.now();
      const added: Queued[] = [];
      for (const item of Array.isArray(input) ? input : [input]) {
        const parsed = boardOpSchema.safeParse({ ...item, id: deps.newId() });
        if (!parsed.success) {
          // Un controllo ha lasciato passare un valore fuori dai limiti: non si applica e non si manda.
          console.warn("[mappatura/board] operazione_non_valida", JSON.stringify({ tipo: String((item as { t?: unknown }).t).slice(0, 20) }));
          continue;
        }
        added.push(options?.undo && isRemove(parsed.data) ? { op: parsed.data, heldUntil: now + AUTOSAVE.undoMs } : { op: parsed.data });
      }
      if (added.length === 0) return;
      // Più modifiche dello stesso campo diventano una; le eliminazioni in attesa tengono la loro scadenza.
      const held = new Map([...queue, ...added].filter((item) => item.heldUntil !== undefined).map((item) => [item.op.id, item.heldUntil]));
      queue = coalesce([...queue, ...added].map((item) => item.op)).map((op) => (held.has(op.id) ? { op, heldUntil: held.get(op.id) } : { op }));
      if (options?.undo) {
        const ids = added.map((item) => item.op.id);
        const undo = () => {
          if (disposed) return;
          // Quello che è già partito non si annulla; il resto esce dalla coda e torna a schermo.
          queue = queue.filter((item) => !ids.includes(item.op.id));
          hideToast();
          writeDraft();
          emit();
          schedule();
        };
        showToast({ text: options.undo, undo: true, action: { label: BOARD_TEXT.buttons.undo, run: undo } }, AUTOSAVE.undoMs, ids);
      }
      writeDraft();
      emit();
      schedule();
    },
    saveNow: (options) => save(true, options?.hidden === true),
    pull,
    replace(board, options) {
      // Una board più vecchia di quella a schermo (un salvataggio è arrivato prima) non torna indietro.
      if (disposed || board.revision < base.revision) return;
      const wasReadonly = readonly;
      adopt(board, options?.linked === true);
      emit();
      if (wasReadonly && !readonly) schedule();
    },
    notify(text, action) {
      if (disposed) return;
      showToast({ text, ...(action ? { action } : {}) }, action ? AUTOSAVE.undoMs : AUTOSAVE.toastMs);
      emit();
    },
    newId: () => deps.newId(),
    start() {
      // In sola lettura la bozza resta dov'è, per quando la board torna scrivibile.
      if (disposed || readonly || queue.length > 0 || flight.length > 0) return;
      const draft = readDraft();
      if (draft.length === 0) return;
      if (sameBoard(applyOps(base, draft, PERSON), base)) {
        // Già salvata: la pagina si è chiusa prima della risposta. Non c'è niente da rimandare.
        writeDraft();
        return;
      }
      queue = draft.map((op) => ({ op }));
      emit();
      schedule();
    },
    setOnline(next) {
      if (disposed || online === next) return;
      online = next;
      emit();
      if (next && failed) void save(false, false);
    },
    async signOut() {
      if (disposed) return;
      // Finché la sessione c'è: quello che resta in coda parte adesso (la richiesta esce subito), poi la board smette.
      const leaving = pendingOps().length > 0 ? save(true, true) : Promise.resolve();
      dispose();
      try {
        deps.storage?.removeItem(key);
      } catch {
        // La memoria del dispositivo è spenta: non c'è bozza.
      }
      await leaving;
    },
    dispose,
  };
}
