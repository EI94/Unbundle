import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ChevronRight, Download, FileText, Info, Lock, XCircle } from "lucide-react";
import { KeyValues } from "@/components/uc/ui/key-values";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { cn } from "@/lib/utils";
import type {
  ActivityEntry,
  FileView,
  ItemBlockerView,
  LinkGroup,
  PendingSignatureNotice,
  QuestionAnswerView,
  SpecEntry,
} from "@/lib/uc/views/item-detail";
import { WORDS } from "@/lib/uc/views/labels";
import type { CaseRole, SemaforoColor } from "@/lib/uc/vocab";
import { QuestionActionBar, SignLink, type QuestionActionBarProps } from "./item-actions";
import { QuestionActivity } from "./item-comments";
import { filePath } from "./paths";
import { ValueText } from "./value-text";

export function FileList({ workspaceId, caseId, files }: { workspaceId: string; caseId: string; files: FileView[] }) {
  if (files.length === 0) return <p className="text-sm text-muted-foreground">Nessun file.</p>;
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <li key={f.id} className="flex min-w-0 items-start gap-2 text-sm">
          {f.zone === "personale" ? <Lock className="mt-0.5 size-4 shrink-0 text-uc-lucchetto" aria-hidden /> : <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            {f.usable && f.zone === "standard" ? (
              <a href={filePath(workspaceId, caseId, f.id)} className="inline-flex items-center gap-1 break-all hover:underline">
                {f.name}
                <Download className="size-3 shrink-0" aria-hidden />
              </a>
            ) : (
              <span className="break-all">{f.name}</span>
            )}
            <p className="text-xs text-muted-foreground">
              {[f.scanLabel, f.size, f.zone === "personale" ? "Zona personale (solo metadati)" : f.personalData, f.at].filter(Boolean).join(" · ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Pannello e pagina della domanda (DESIGN §3.6.5, §3.6.8) ───────────

/** Tutto quello che pannello e pagina intera mostrano di una domanda, già per chi guarda. */
export interface QuestionDetailModel {
  workspaceId: string;
  caseId: string;
  itemId: string;
  key: string;
  title: string;
  /** Argomento della domanda (titolo del modulo). */
  topic: string | null;
  status: { tone: SemaforoColor; label: string; sublabel: string | null };
  must: boolean;
  personal: boolean;
  outOfContract: boolean;
  client: boolean;
  roles: readonly CaseRole[];
  /** Bloccata: il motivo, sulla riga del lucchetto (nessuna primaria). */
  blocked: string | null;
  /** «Manca il dato: …», «Risposta parziale: …»: il motivo scritto con l'esito. */
  reason: string | null;
  notice: PendingSignatureNotice | null;
  firmeHref: string;
  actions: Omit<QuestionActionBarProps, "filledFirst"> | null;
  answer: QuestionAnswerView | null;
  /** Solo se la domanda prevede un file. */
  files: FileView[] | null;
  about: { explanation: string | null; why: string | null; example: string | null; help: string | null };
  activity: { entries: ActivityEntry[]; visibilities: ("interno_ls" | "condiviso")[]; canResolve: boolean };
  tech: {
    spec: SpecEntry[];
    relations: LinkGroup[];
    privacy: string;
    visibility: string | null;
    sources: string[];
    blockers: ItemBlockerView[];
    textHash: string | null;
    validated: string | null;
  } | null;
  linked: { id: string; title: string; tone: SemaforoColor; label: string; href: string | null }[];
  side: { assignee: string | null; roleLabel: string | null; due: string | null };
  fullHref: string;
}

/** Riga sotto il titolo: stato, «Indispensabile», «Fuori contratto», lucchetto. */
export function QuestionStatusLine({ model }: { model: QuestionDetailModel }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <StatusDot tone={model.status.tone} label={model.status.label} sublabel={model.status.sublabel ?? undefined} size="md" />
      {model.must && <span className="text-muted-foreground">· {WORDS.indispensabile}</span>}
      {model.outOfContract && <span className="text-muted-foreground">· {WORDS.fuoriContratto}</span>}
      {model.personal && (
        <span title={WORDS.datoPersonale} className="inline-flex items-center text-uc-lucchetto">
          <Lock className="size-3.5" aria-hidden />
          <span className="sr-only">{WORDS.datoPersonale}</span>
        </span>
      )}
    </div>
  );
}

function Section({ title, count, children, className }: { title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 space-y-2", className)} aria-label={title}>
      <h3 className="text-base font-semibold">
        {title}
        {count !== undefined && count > 0 && <span className="font-normal text-muted-foreground"> · {count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group min-w-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground select-none hover:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {title}
      </summary>
      <div className="mt-1 space-y-2 pl-5.5 text-sm">{children}</div>
    </details>
  );
}

/** Notice in linea: il motivo dello stato, firma in attesa (con [Firma] solo per chi può) o il lucchetto della bloccata. */
function QuestionNotices({ model }: { model: QuestionDetailModel }) {
  return (
    <>
      {model.reason && (
        <p className="flex items-start gap-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-words">{model.reason}</span>
        </p>
      )}
      {model.blocked && (
        <p className="flex items-start gap-2 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-uc-lucchetto" aria-hidden />
          <span className="min-w-0 break-words">{model.client ? `In attesa: ${model.blocked}` : `Bloccata: ${model.blocked}`}</span>
        </p>
      )}
      {model.notice && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 break-words">{model.notice.text}</span>
          {model.notice.canSign && <SignLink href={model.firmeHref} />}
        </div>
      )}
    </>
  );
}

/** La risposta (§3.6.5): valore, chi e quando, controlli subito sotto, dettagli e versioni chiusi. */
export function QuestionAnswerBlock({ answer, files, workspaceId, caseId, client, size = "md" }: { answer: QuestionAnswerView | null; files: FileView[] | null; workspaceId: string; caseId: string; client: boolean; size?: "md" | "lg" }) {
  if (!answer) {
    return <p className="text-sm text-muted-foreground">{client ? "Il referente non ha ancora risposto." : "Ancora nessuna risposta."}</p>;
  }
  return (
    <div className="min-w-0 space-y-2">
      <div className={cn(size === "lg" ? "text-2xl font-semibold tracking-tight" : "text-base")}>
        {answer.summary ? <span className="break-words">{answer.summary}</span> : <ValueText value={answer.value} declared={answer.declared} className={size === "lg" ? "text-2xl" : undefined} />}
      </div>
      {answer.byLine && <p className="text-sm text-muted-foreground">{answer.byLine}</p>}
      {answer.declared && <p className="text-xs text-muted-foreground">Valore già dichiarato: va confermato da chi lo possiede.</p>}
      {answer.checks.length > 0 && (
        <ul className="space-y-1">
          {answer.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {c.outcome === "errore" ? <XCircle className="mt-0.5 size-4 shrink-0 text-uc-rosso" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-uc-giallo" aria-hidden />}
              <span className="min-w-0 break-words">
                {c.outcome === "errore" ? "Errore" : "Avviso"}: {c.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!client && (answer.details.length > 0 || (files && files.length > 0)) && (
        <Fold title="Dettagli della risposta">
          <KeyValues className="text-sm sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]" rows={answer.details} />
          {files && files.length > 0 && <FileList workspaceId={workspaceId} caseId={caseId} files={files} />}
        </Fold>
      )}
      {answer.previous.length > 0 && (
        <Fold title={`Versioni precedenti (${answer.previous.length})`}>
          <ul className="space-y-2">
            {answer.previous.map((a) => (
              <li key={a.id} className="min-w-0">
                {a.summary ? <span className="break-words">{a.summary}</span> : <ValueText value={a.value} />}
                <p className="text-xs text-muted-foreground">{[a.responder, a.at, a.validated ? "validata" : null].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}

/** «La domanda»: cos'è e perché ci serve, poi esempio e dove trovarlo, chiusi. */
function QuestionAbout({ about, clamp }: { about: QuestionDetailModel["about"]; clamp: boolean }) {
  const main = [about.explanation, about.why].filter(Boolean).join("\n\n");
  const extra = [about.example ? `Esempio: ${about.example}` : null, about.help ? `Dove trovarlo: ${about.help}` : null].filter(Boolean).join("\n\n");
  if (!main && !extra) return <p className="text-sm text-muted-foreground">Nessuna spiegazione per questa domanda.</p>;
  return (
    <div className="min-w-0 space-y-1">
      {main && <p className={cn("text-sm break-words whitespace-pre-line", clamp && "line-clamp-4")}>{main}</p>}
      {extra && (
        <Fold title="Esempio e dove trovarlo">
          <p className="break-words whitespace-pre-line">{extra}</p>
        </Fold>
      )}
    </div>
  );
}

/** «Dettagli tecnici» (solo Lateral Space): chiave con «Copia», schema, collegamenti, riservatezza, fonti, blocchi, impronta. */
function QuestionTech({ model }: { model: QuestionDetailModel }) {
  if (!model.tech) return null;
  const t = model.tech;
  return (
    <TechDetails roles={model.roles} copyValue={model.key}>
      <p>Chiave: {model.key}</p>
      {t.spec.length > 0 && <KeyValues className="font-sans text-xs sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]" rows={t.spec.map((e) => [e.label, e.value] as const)} />}
      <KeyValues
        className="font-sans text-xs sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]"
        rows={[
          ["Collegata a", model.linked.length > 0 ? `${model.linked.length} ${model.linked.length === 1 ? "domanda" : "domande"}` : null],
          ["Riservatezza", t.privacy],
          ["Chi vede il valore", t.visibility],
          ["Fonti", t.sources.length ? t.sources.join(", ") : null],
          ["Validata", t.validated],
          ["Blocchi", t.blockers.length ? t.blockers.map((b) => `${b.label} (${b.permanent ? "permanente" : b.active ? "attivo" : "sciolto"}, ${b.origin})`).join("; ") : null],
          ["Impronta del testo", t.textHash],
        ]}
      />
      {t.relations.length > 0 && (
        <ul className="font-sans text-xs">
          {t.relations.map((g) => (
            <li key={`${g.direction}:${g.relation}`}>
              {g.label}: {g.items.map((i) => i.key).join(", ")}
            </li>
          ))}
        </ul>
      )}
    </TechDetails>
  );
}

/** «Collegata a N domande», con i titoli. */
function LinkedQuestions({ linked }: { linked: QuestionDetailModel["linked"] }) {
  if (linked.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {linked.map((l) => (
        <li key={l.id} className="flex min-w-0 items-start gap-2">
          <span className="mt-1.5 shrink-0">
            <StatusDot tone={l.tone} label={l.label} hideLabel />
          </span>
          {l.href ? (
            <Link href={l.href} className="min-w-0 break-words hover:underline">
              {l.title}
            </Link>
          ) : (
            <span className="min-w-0 break-words">{l.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Il contenuto del pannello `?apri=<id>` (§3.6.5): azioni, avvisi, risposta,
 * la domanda, attività, dettagli tecnici e «Apri a tutta pagina».
 */
export function QuestionPanelBody({ model }: { model: QuestionDetailModel }) {
  return (
    <div className="min-w-0 space-y-6">
      {model.actions && <QuestionActionBar key={model.itemId} {...model.actions} filledFirst />}
      <QuestionNotices model={model} />
      <Section title={model.client ? "Risposta del referente" : "Risposta"}>
        <QuestionAnswerBlock answer={model.answer} files={model.files} workspaceId={model.workspaceId} caseId={model.caseId} client={model.client} />
      </Section>
      <Section title="La domanda">
        <QuestionAbout about={model.about} clamp />
      </Section>
      {!model.client && (
        <Section title="Attività" count={model.activity.entries.length}>
          <QuestionActivity key={model.itemId} workspaceId={model.workspaceId} caseId={model.caseId} itemId={model.itemId} entries={model.activity.entries} visibilities={model.activity.visibilities} canResolve={model.activity.canResolve} />
        </Section>
      )}
      <QuestionTech model={model} />
      <Link href={model.fullHref} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
        Apri a tutta pagina
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Al telefono le azioni della pagina intera restano fisse in alto, sotto la
 * barra del workspace (61 px) e la barra fissa del caso (66 px, `case-tabs`);
 * un modulo aperto scorre dentro la sua cornice.
 */
const PHONE_STICKY_ACTIONS =
  "max-sm:sticky max-sm:top-[127px] max-sm:z-10 max-sm:-mx-4 max-sm:max-h-[50dvh] max-sm:overflow-y-auto max-sm:border-b max-sm:bg-background max-sm:px-4 max-sm:py-2";

/**
 * La pagina intera `/domande/<id>` (§3.6.5): da `lg` due colonne, a sinistra
 * risposta, domanda e attività, a destra referente, scadenza e domande
 * collegate. Al telefono le azioni restano fisse in alto, sotto il titolo.
 */
export function QuestionPageBody({ model, upload }: { model: QuestionDetailModel; upload?: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-2">
        <QuestionStatusLine model={model} />
        <h2 className="text-xl font-semibold tracking-tight break-words">{model.title}</h2>
      </header>
      {model.actions && (
        <div className={PHONE_STICKY_ACTIONS}>
          <QuestionActionBar key={model.itemId} {...model.actions} filledFirst={false} />
        </div>
      )}
      <QuestionNotices model={model} />
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <div className="min-w-0 space-y-8">
          <Section title={model.client ? "Risposta del referente" : "Risposta"}>
            <QuestionAnswerBlock answer={model.answer} files={model.files} workspaceId={model.workspaceId} caseId={model.caseId} client={model.client} />
            {upload}
          </Section>
          <Section title="La domanda">
            <QuestionAbout about={model.about} clamp={false} />
          </Section>
          {!model.client && (
            <Section title="Attività" count={model.activity.entries.length}>
              <QuestionActivity key={model.itemId} workspaceId={model.workspaceId} caseId={model.caseId} itemId={model.itemId} entries={model.activity.entries} visibilities={model.activity.visibilities} canResolve={model.activity.canResolve} all />
            </Section>
          )}
          <QuestionTech model={model} />
        </div>
        <aside className="min-w-0 space-y-6 text-sm">
          <section className="space-y-1">
            <h3 className="text-xs tracking-wide text-muted-foreground">Referente</h3>
            <p className={cn(!model.side.assignee && "text-uc-giallo")}>{model.side.assignee ?? "Senza referente"}</p>
            {model.side.roleLabel && <p className="text-xs text-muted-foreground">{model.side.roleLabel}</p>}
          </section>
          {model.side.due && (
            <section className="space-y-1">
              <h3 className="text-xs tracking-wide text-muted-foreground">Scadenza</h3>
              <p>{model.side.due}</p>
            </section>
          )}
          {model.linked.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs tracking-wide text-muted-foreground">
                Collegata a {model.linked.length} {model.linked.length === 1 ? "domanda" : "domande"}
              </h3>
              <LinkedQuestions linked={model.linked} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * La scheda di «Verifica una alla volta» (§3.6.4), senza le azioni:
 * argomento, titolo, il valore in grande, chi e quando, gli avvisi, poi
 * «Perché la chiediamo», le versioni precedenti e i dettagli, chiusi.
 */
export function QuestionReviewCard({ model }: { model: QuestionDetailModel }) {
  const why = [model.about.why, model.about.explanation].filter(Boolean).join("\n\n");
  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">{[model.topic, model.must ? WORDS.indispensabile : null].filter(Boolean).join(" · ")}</p>
        <h2 className="text-lg font-semibold tracking-tight break-words">{model.title}</h2>
      </div>
      <QuestionAnswerBlock answer={model.answer} files={model.files} workspaceId={model.workspaceId} caseId={model.caseId} client={model.client} size="lg" />
      <QuestionNotices model={model} />
      {why && (
        <Fold title="Perché la chiediamo">
          <p className="break-words whitespace-pre-line">{why}</p>
        </Fold>
      )}
    </div>
  );
}
