import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { readableText, readableTitle } from "@/lib/uc/views/description";
import { PRIVACY_LABEL, WORDS, availabilityLabel, blockerLabel, humanizeToken } from "@/lib/uc/views/labels";
import type { FieldView, ModelItemView, RuleConfirmation, TestCaseView } from "@/lib/uc/views/model";
import { canOpenItem } from "@/lib/uc/views/page-access";
import { audienceFor, statusView, type Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { ItemLink } from "./item-link";
import { formatCountIt } from "@/lib/uc/views/format";

/**
 * Pannelli e pezzi server di Soluzione › Regole e Dati (DESIGN §3.7.3,
 * §3.7.4): prima le parole semplici; forma logica, parametri, chiavi, valori,
 * note di disponibilità, collegamenti e impronte stanno in «Dettagli tecnici»
 * (solo Lateral Space). Più la paginazione lato server.
 */


/** Una parte del pannello con un titolo piccolo; niente se il testo manca. */
function Part({ title, children }: { title: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <section className="min-w-0 space-y-1">
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      <div className="text-sm break-words whitespace-pre-line">{children}</div>
    </section>
  );
}

function text(v: string | null | undefined, audience: Audience): string | null {
  if (!v) return null;
  const t = readableText(v, audience);
  return t || null;
}

function LockLine() {
  return (
    <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Lock className="size-3.5 text-uc-lucchetto" aria-hidden />
      {WORDS.dopoSchedaPrivacy}
    </p>
  );
}

/** Riga di «Dettagli tecnici»: nome e valore, in monospazio. */
function TechRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <p>
      <span className="font-sans">{label}: </span>
      {value}
    </p>
  );
}

/** I collegamenti della voce aperta, con relazione e chiave: solo in «Dettagli tecnici». */
function TechLinks({ item }: { item: ModelItemView }) {
  if (item.links.length === 0) return null;
  return (
    <div className="space-y-2">
      {item.links.map((g) => (
        <div key={`${g.direction}:${g.relation}`}>
          <p className="font-sans">{g.label}</p>
          <ul>
            {g.items.map((it) => (
              <li key={it.id}>
                {it.title} · {it.key}
                {it.cardinality ? ` · ${it.cardinality}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Il pannello di una regola: in parole semplici, eccezioni, chi la conferma, la domanda di conferma. */
export function RuleDetail({
  workspaceId,
  caseId,
  rule,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  rule: ModelItemView & { confirmation: RuleConfirmation; locked: boolean };
  roles: readonly CaseRole[];
}) {
  const audience = audienceFor(roles);
  const q = rule.confirmation.question;
  return (
    <>
      {rule.locked && <LockLine />}
      <Part title="In parole semplici">{text(rule.explanation, audience)}</Part>
      <Part title="Eccezioni">{text(rule.fields.eccezioni, audience)}</Part>
      <Part title="Chi la conferma">{rule.ownerRoleLabel ?? "Da indicare"}</Part>
      {q && (
        <section className="min-w-0 space-y-1">
          <h3 className="text-xs text-muted-foreground">Domanda di conferma</h3>
          <ItemLink workspaceId={workspaceId} caseId={caseId} item={{ ...q, title: readableTitle(q.title, audience, "Domanda di conferma") }} canOpen={canOpenItem(roles, q.status)} />
        </section>
      )}
      {/* In vista solo le quattro parti di DESIGN §3.7.3; l'esempio del modello sta nei «Dettagli tecnici». */}
      <TechDetails roles={roles} copyValue={rule.key}>
        <TechRow label="Chiave" value={rule.key} />
        <TechRow label="Come la legge il modello" value={rule.fields.forma_logica} />
        <TechRow label="Esempio" value={rule.example} />
        <TechRow label="Parametri" value={rule.fields.parametri} />
        <TechRow label="Tipo" value={rule.fields.tipo_regola ? humanizeToken(rule.fields.tipo_regola) : null} />
        <TechRow label="Fonte" value={rule.sourceRefs.length ? rule.sourceRefs.join(", ") : null} />
        <TechRow label="Impronta del testo" value={rule.confirmation.textHash} />
        <TechLinks item={rule} />
      </TechDetails>
    </>
  );
}

/** I campi di un'entità: titolo, stato e lucchetto; tipo, unità, esempio e fonte su una riga grigia. */
function EntityFields({ workspaceId, caseId, fields, audience }: { workspaceId: string; caseId: string; fields: readonly FieldView[]; audience: Audience }) {
  if (fields.length === 0) return null;
  return (
    <section className="min-w-0 space-y-1">
      <h3 className="text-xs text-muted-foreground">Campi · {formatCountIt(fields.length)}</h3>
      <ul className="divide-y divide-border">
        {fields.map((f) => {
          const sv = statusView(f.status, audience);
          const sources = f.sources.map((x) => text(x, audience)).filter((x): x is string => x !== null);
          const example = text(f.example, audience);
          // Tipo e unità vengono dallo schema e possono citare una chiave («riferimento a ent.x»): passano dallo stesso filtro.
          const grey = text(
            [f.type ? humanizeToken(f.type) : null, f.unit, example ? `Esempio: ${example}` : null, sources.length ? `Fonte: ${sources.join(", ")}` : null].filter(Boolean).join(" · "),
            audience,
          );
          return (
            <li key={f.id} className="min-w-0 space-y-0.5 py-2">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <ItemLink
                  workspaceId={workspaceId}
                  caseId={caseId}
                  item={{ id: f.id, key: f.key, title: readableTitle(f.title, audience, "Campo"), status: f.status }}
                  canOpen={f.canOpen}
                  className="min-w-0 flex-1"
                />
                {/* Il puntino dello stato è già nel link: qui la parola, per non dirlo solo con il colore. */}
                <span className="flex shrink-0 items-center gap-2 pt-1 text-xs text-muted-foreground">
                  {f.locked && <Lock className="size-3.5 text-uc-lucchetto" aria-label={WORDS.dopoSchedaPrivacy} />}
                  <span aria-hidden>{sv.label}</span>
                </span>
              </div>
              {grey && <p className="text-xs break-words text-muted-foreground">{grey}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Il pannello di una voce di Dati, secondo la vista. */
export function DataItemDetail({
  workspaceId,
  caseId,
  item,
  locked,
  fields,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  item: ModelItemView;
  locked: boolean;
  fields: FieldView[] | null;
  roles: readonly CaseRole[];
}) {
  const audience = audienceFor(roles);
  const f = item.fields;
  const explanation = text(item.explanation, audience);
  return (
    <>
      {locked && <LockLine />}
      {item.kind === "entita" && (
        <>
          <Part title="Cos'è">{explanation}</Part>
          <Part title="Perché serve al modello">{text(item.why, audience)}</Part>
          <Part title="Una riga è">{text(f.granularita, audience)}</Part>
          <Part title="Fonte di verità">{text(f.fonte_verita, audience)}</Part>
          <Part title="Aggiornamento">{text(f.frequenza, audience)}</Part>
          <EntityFields workspaceId={workspaceId} caseId={caseId} fields={fields ?? []} audience={audience} />
        </>
      )}
      {item.kind === "fonte" && (
        <>
          <Part title="Cosa contiene">{explanation}</Part>
          {item.help && (
            <section className="min-w-0 space-y-1">
              <h3 className="text-xs text-muted-foreground">Cosa chiediamo al cliente</h3>
              <p className="rounded-lg bg-muted/40 p-3 text-sm break-words whitespace-pre-line ring-1 ring-foreground/10">{text(item.help, audience)}</p>
            </section>
          )}
          <Part title="Come arriva">{text([f.metodo, f.formato, f.periodo].filter(Boolean).join(" · "), audience)}</Part>
          <Part title={WORDS.chiRisponde}>{item.ownerRoleLabel}</Part>
        </>
      )}
      {item.kind === "controllo_qualita" && (
        <>
          <Part title="Cosa controlla">{text(f.controllo, audience)}</Part>
          <Part title="Perché">{explanation}</Part>
          <Part title="Se non passa">{text(f.azione, audience)}</Part>
          <Part title="Quanto è grave">{f.gravita ? humanizeToken(f.gravita) : null}</Part>
        </>
      )}
      {item.kind === "formula" && (
        <>
          <Part title="In parole semplici">{explanation}</Part>
          {!explanation && <Part title="Come si calcola">{text(f.formula, audience)}</Part>}
        </>
      )}
      {!["entita", "fonte", "controllo_qualita", "formula"].includes(item.kind) && (
        <>
          <Part title="In parole semplici">{explanation}</Part>
          <Part title="Si misura in">{text(f.unit ?? f.unita, audience)}</Part>
          <Part title="Esempio">{text(item.example, audience)}</Part>
        </>
      )}
      <TechDetails roles={roles} copyValue={item.key}>
        <TechRow label="Chiave" value={item.key} />
        <TechRow label="Chiave dell'entità" value={item.kind === "entita" ? (f.chiave ?? null) : null} />
        <TechRow label="Formula" value={item.kind === "formula" ? (f.formula ?? null) : null} />
        <TechRow label="Definizione" value={f.definizione ?? null} />
        <TechRow label="Valori" value={f.valori ?? null} />
        <TechRow label="Disponibilità" value={item.availability.length ? item.availability.map(availabilityLabel).join(", ") : null} />
        <TechRow label="Note sulla disponibilità" value={item.notes.availability ?? null} />
        <TechRow label="Privacy" value={item.notes.privacy ? `${PRIVACY_LABEL[item.privacyClass]} · ${item.notes.privacy}` : PRIVACY_LABEL[item.privacyClass]} />
        <TechRow label="Blocchi" value={item.activeBlockers.length ? item.activeBlockers.map(blockerLabel).join(", ") : null} />
        <TechRow label="Fonte" value={item.sourceRefs.length ? item.sourceRefs.join(", ") : null} />
        <TechLinks item={item} />
      </TechDetails>
    </>
  );
}

const RESULT_LABEL = { superato: "Superato", fallito: "Non superato", non_eseguito: "Non ancora provato" } as const;

/**
 * «Prova sul passato»: una riga per caso di prova, «Caso di prova N», con
 * «Sintetico» o «Pseudonimizzato», «Copre N domande» ed esito. Mai il
 * contenuto. Nella riga nessuna chiave, per nessuno (DESIGN §1, principio 5):
 * Lateral Space la legge nel suggerimento del nome.
 */
export function TestCasesList({ testCases, roles, offset }: { testCases: TestCaseView[]; roles: readonly CaseRole[]; offset: number }) {
  if (testCases.length === 0) return null;
  const ls = audienceFor(roles) === "ls";
  return (
    <ul className="divide-y divide-border border-y border-border">
      {testCases.map((t, i) => (
        <li key={t.id} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium" title={ls ? t.key : undefined}>
            Caso di prova {offset + i + 1}
          </span>
          <span className="text-xs text-muted-foreground">
            {[t.kind === "pseudonimizzato" ? "Pseudonimizzato" : "Sintetico", `Copre ${formatCountIt(t.covers)} ${t.covers === 1 ? "domanda" : "domande"}`, t.approved ? "Approvato dal cliente" : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className={cn("shrink-0 text-xs", t.result === "fallito" ? "text-destructive" : "text-muted-foreground")}>{RESULT_LABEL[t.result]}</span>
        </li>
      ))}
    </ul>
  );
}

/** «‹ Precedenti · Pagina 2 di 3 · Successive ›»: le pagine sono lette dal server. */
export function ListPagination({ page, pages, prevHref, nextHref }: { page: number; pages: number; prevHref: string | null; nextHref: string | null }) {
  if (pages <= 1) return null;
  const link = "inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8";
  return (
    <nav aria-label="Pagine" className="mt-4 flex min-w-0 items-center justify-between gap-3">
      {prevHref ? (
        <Link href={prevHref} className={link}>
          <ChevronLeft className="size-4" aria-hidden />
          Precedenti
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        Pagina {formatCountIt(page)} di {formatCountIt(pages)}
      </span>
      {nextHref ? (
        <Link href={nextHref} className={link}>
          Successive
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
