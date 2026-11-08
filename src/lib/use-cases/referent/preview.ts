/**
 * «Controlla e invia» (rilascio 4, §9.2): l'anteprima dell'email che riceve il referente. È l'email
 * vera: oggetto e blocchi vengono da `referentRequestParts` di `email.ts`, la stessa funzione
 * dell'invio, con gli stessi testi, nello stesso ordine.
 *
 * Quello che il browser non sa resta fuori o al suo posto:
 * - il link personale nasce all'invio: qui un indirizzo finto che passa i controlli dell'email e non
 *   si mostra mai (a schermo c'è solo «Apri le domande», mai un indirizzo);
 * - la scadenza è oggi più i giorni del link (`REFERENT_LIMITS.linkDays`), come la scrive il server;
 * - la riga del team o dell'account («Hai già accesso…», «Hai già un account…») dipende dall'account
 *   della persona, che il browser non deve sapere: nell'anteprima non c'è mai (l'email vera può averla);
 * - chi chiede ha l'email verificata (altrimenti la finestra non si apre): la risposta arriva a lui.
 *
 * Modulo puro: lo usano la finestra (client) e i test.
 */
import { UC_EMAIL_SENDER_NAME } from "../../uc/notify/email-render.ts";
import { REFERENT_LIMITS } from "./contract.ts";
import { referentNewsParts, referentRequestParts, type ReferentRequestParts } from "./email.ts";

/** Il link finto dell'anteprima: passa `checkReferentLink`, non si mostra mai. */
export const PREVIEW_LINK = `https://unbundle.invalid/rispondi/ucq_${"x".repeat(32)}`;

/** «Lateral Space via Unbundle»: il mittente dell'email, la riga «Da» dell'anteprima. */
export const PREVIEW_SENDER = UC_EMAIL_SENDER_NAME;

/** Il piè di pagina dell'email, come lo scrive `render`. */
export const PREVIEW_FOOTER = `${UC_EMAIL_SENDER_NAME}.`;

const DAY_MS = 86_400_000;

/**
 * Il nome di chi chiede come lo salva la richiesta (`requester_name`, l'INSERT di
 * `sendReferentRequest`): il nome dell'account senza spazi in più, fino a 120 caratteri; senza nome,
 * «Il team di {workspace}» fino a 120.
 */
export function requesterNameOf(name: string | null | undefined, workspaceName: string | null | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || `Il team di ${workspaceName ?? ""}`.slice(0, 120);
}

export interface ReferentRequestPreviewInput {
  /** Il nome del workspace (`companyLabel` lo pulisce, come all'invio). */
  company: string | null;
  useCase: { code: string | null; title: string };
  /** `requesterNameOf(panel.requester.name, workspace.name)`. */
  requesterName: string;
  /** Le domande spuntate. */
  questions: number;
  message: string | null;
  /** Adesso: la scadenza è adesso più i giorni del link. */
  today: Date;
  /** (Rilascio 5) «referente»: l'email della richiesta al referente (conferma, stima, domande). */
  kind?: "referente" | "domande";
}

/** L'oggetto e i blocchi dell'email che riceve il referente, senza il link vero né la riga dell'account. */
export function referentRequestPreview(input: ReferentRequestPreviewInput): ReferentRequestParts {
  return referentRequestParts({
    template: "richiesta",
    ...(input.kind ? { kind: input.kind } : {}),
    company: input.company ?? "",
    useCase: input.useCase,
    requesterName: input.requesterName,
    questions: input.questions,
    message: input.message,
    expiresAt: new Date(input.today.getTime() + REFERENT_LIMITS.linkDays * DAY_MS),
    link: PREVIEW_LINK,
    replyToKnown: true,
    cardLink: null,
    accountNotice: false,
  });
}

/**
 * (Rilascio 6) Le domande che entrano nella richiesta attiva del referente («Chiedi al referente» verso chi ha
 * già una richiesta viva, o completata con il link ancora valido): non parte una richiesta nuova ma l'email
 * «nuove» («{Nome} ha aggiunto 2 domande …: le trovi insieme alle altre, con lo stesso link.»), con il link
 * rinnovato per 30 giorni da oggi. Il resto come `referentRequestPreview`.
 */
export function referentNewQuestionsPreview(input: Omit<ReferentRequestPreviewInput, "kind" | "message">): ReferentRequestParts {
  return referentNewsParts(
    {
      useCase: input.useCase,
      requesterName: input.requesterName,
      kind: "nuove",
      openQuestions: input.questions,
      newQuestions: Math.max(1, input.questions),
      expiresAt: new Date(input.today.getTime() + REFERENT_LIMITS.linkDays * DAY_MS),
      link: PREVIEW_LINK,
      cardLink: null,
    },
    { company: input.company ?? "", replyToKnown: true, accountNotice: false },
  );
}

/** Un blocco dell'anteprima a schermo: il link è solo la sua etichetta, mai un indirizzo. */
export type PreviewBlock =
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "small"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "link"; label: string };

/** I blocchi dell'email come li disegna l'anteprima, nello stesso ordine. */
export function previewBlocks(parts: Pick<ReferentRequestParts, "blocks">): PreviewBlock[] {
  return parts.blocks.map((block): PreviewBlock => {
    if ("p" in block) return { kind: "p", text: block.p };
    if ("quote" in block) return { kind: "quote", text: block.quote };
    if ("small" in block) return { kind: "small", text: block.small };
    if ("list" in block) return { kind: "list", items: [...block.list] };
    return { kind: "link", label: block.link.label };
  });
}
