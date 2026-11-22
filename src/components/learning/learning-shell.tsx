import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PAGE_TITLE_CLASS, PageContainer } from "@/components/dashboard/page-container";
import { EmptyState, type EmptyStateAction } from "@/components/ui-10/empty-state";
import { LEARNING_TEXT } from "@/lib/learning/text";

/**
 * Cornice comune delle pagine della formazione: il ritorno facoltativo, l'H1, una riga sotto e le azioni della testata.
 *
 * (Rilascio 10, ondata 7a) Niente più «Formazione del workspace» su ogni pagina: portava alla pagina stessa (FO-2), e la
 * barra laterale ha già «Formazione». Le pagine dentro un corso hanno il loro ritorno (`back`: «‹ {corso}»). La pagina
 * del corso e l'esercizio di chi lo segue sono stretti (`size="narrow"`, 768 px), il resto è largo come Persone.
 */
export function LearningShell({ title, back, subtitle, actions, size = "default", children }: {
  /** Il workspace della pagina: le pagine lo passano sempre, la cornice non ne ha più bisogno. */
  workspaceId?: string;
  title: string;
  back?: { href: string; label: string };
  /** Una riga sotto il titolo (la lezione, lo stato del corso), al massimo dieci parole. */
  subtitle?: ReactNode;
  /** Le azioni della testata, a destra del titolo (al telefono sotto). */
  actions?: ReactNode;
  size?: "narrow" | "default";
  children: ReactNode;
}) {
  return <PageContainer size={size} className="space-y-6">
    <header className="space-y-2">
      {back ? (
        <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-4 sm:min-h-9" href={back.href}>
          <ArrowLeft aria-hidden className="size-4" />{back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className={`${PAGE_TITLE_CLASS} min-w-0 break-words`}>{title}</h1>
        {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div> : null}
      </div>
      {subtitle ? <div data-slot="learning-subtitle" className="text-sm text-muted-foreground">{subtitle}</div> : null}
    </header>
    {children}
  </PageContainer>;
}

/** Una pagina della Formazione che non ha niente da mostrare a questo account: una frase, senza titolo di troppo. */
export function LearningUnavailable({ message = "La formazione non è disponibile per questo account o workspace. Contatta chi tiene il corso.", action }: {
  message?: string;
  /** L'azione del vuoto: piena solo se è il prossimo passo della pagina (`nextStep`). */
  action?: EmptyStateAction | null;
}) {
  return <EmptyState text={message} action={action ?? null} />;
}

/**
 * (Rilascio 10) Un corso che questo account non può aprire (`forbidden`: un altro account, nessuna iscrizione, un corso
 * sospeso o nascosto): la spiegazione, nella cornice della Formazione, al posto della pagina che non si è caricata, e
 * il ritorno alla Formazione del workspace.
 */
export function ProgramUnavailable({ workspaceId }: { workspaceId: string }) {
  const T = LEARNING_TEXT.programUnavailable;
  return <LearningShell workspaceId={workspaceId} title={T.title} back={{ href: `/dashboard/${workspaceId}/learning`, label: LEARNING_TEXT.backToLearning }}>
    <LearningUnavailable message={T.body} />
  </LearningShell>;
}

export function outcomeLabel(status: string | null | undefined) {
  return ({ consolidated: "Obiettivo raggiunto", needs_practice: "Da ripassare", formative_completed: "Fatto", draft: "In corso", submitted: "Consegnato", pending_review: "Revisione in corso", available: "Disponibile", locked: "In programma" } as Record<string, string>)[status ?? ""] ?? "Non iniziato";
}
