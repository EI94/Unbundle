import { ChevronRight, FileLock2 } from "lucide-react";
import type { PrivacyAccessRow, PrivacyZoneFile } from "@/lib/db/queries/uc-events";
import { auditEventLabel } from "@/lib/uc/views/audit";
import { formatBytes, formatCountIt, formatDateIt, formatDateTimeIt } from "@/lib/uc/views/format";
import type { PrivacyClass } from "@/lib/uc/vocab";
import { InfoHint } from "./info-hint";

/**
 * Parti di sola lettura della pagina Privacy (DESIGN §3.10): la riga
 * «Modalità dei dati», le parti chiuse «Domande per riservatezza» (solo
 * Lateral Space) e «Registro degli accessi» (Lateral Space e approvatore
 * privacy), con i file della zona dei dati personali (solo metadati, mai il
 * contenuto). Titoli delle domande, mai le chiavi. Componenti server.
 */


/** Una riga «etichetta · valore · azione» dell'elenco della Privacy. */
export function PrivacyRow({ label, children, aside }: { label: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid min-h-11 min-w-0 grid-cols-1 items-center gap-x-4 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[13rem_minmax(0,1fr)_auto]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
      {aside && <dd className="flex items-center sm:justify-end">{aside}</dd>}
    </div>
  );
}

export function DataModeRow({ mode }: { mode: { label: string; help: string } }) {
  return (
    <PrivacyRow label="Modalità dei dati">
      <span className="inline-flex max-w-full items-center gap-1">
        <span className="font-medium">{mode.label}</span>
        {mode.help && <InfoHint label={`Cosa vuol dire «${mode.label}»`}>{mode.help}</InfoHint>}
      </span>
    </PrivacyRow>
  );
}

/** Una parte chiusa della pagina («▸ Domande per riservatezza»). */
export function PrivacyDisclosure({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="group min-w-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium select-none hover:text-foreground sm:min-h-9 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        {title}
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </summary>
      <div className="mt-2 space-y-4 pl-5.5">{children}</div>
    </details>
  );
}

/** Domande per riservatezza: le domande ai referenti e tutto il catalogo, per classe. */
export function PrivacyQuestionsTable({ rows }: { rows: readonly { key: PrivacyClass; label: string; questions: number; all: number }[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <table className="w-full table-fixed text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="p-2.5 font-medium">
              Riservatezza
            </th>
            <th scope="col" className="w-24 p-2.5 text-right font-medium">
              Ai referenti
            </th>
            <th scope="col" className="w-24 p-2.5 text-right font-medium sm:w-28">
              In tutto
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="p-2.5 text-left font-normal break-words">
                {r.label}
              </th>
              <td className="p-2.5 text-right tabular-nums">{formatCountIt(r.questions)}</td>
              <td className="p-2.5 text-right tabular-nums">{formatCountIt(r.all)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCAN_LABEL: Readonly<Record<string, string>> = {
  in_quarantena: "In controllo",
  pulito: "Controllato",
  rifiutato: "Rifiutato",
};

/** File della zona dei dati personali: solo metadati, mai il nome né il contenuto. */
export function PersonalFilesList({ files }: { files: readonly PrivacyZoneFile[] }) {
  return (
    <ul className="divide-y">
      {files.map((f) => (
        <li key={f.id} className="flex min-w-0 items-start gap-2 py-2.5 text-sm">
          <FileLock2 className="mt-0.5 size-4 shrink-0 text-uc-lucchetto" aria-hidden />
          <div className="min-w-0">
            <p className="break-words">
              {f.itemTitle ?? "File senza domanda"} · {f.mime}
              {formatBytes(f.sizeBytes) ? ` · ${formatBytes(f.sizeBytes)}` : ""}
            </p>
            <p className="text-xs break-words text-muted-foreground">
              {SCAN_LABEL[f.scanStatus] ?? f.scanStatus}
              {f.createdAt ? ` · caricato il ${formatDateIt(f.createdAt)}` : ""}
              {f.retentionUntil ? ` · si conserva fino al ${formatDateIt(f.retentionUntil)}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const ACTION_LABEL: Readonly<Record<string, string>> = {
  proposta: "accesso proposto",
  firmata: "firma registrata",
  attivata: "accesso attivato",
  revocata: "accesso tolto",
};

/** Accessi alla zona dei dati personali, letture di dati personali e download, dal più recente. */
export function PersonalAccessLog({ events }: { events: readonly PrivacyAccessRow[] }) {
  return (
    <ul className="divide-y">
      {events.map((e) => (
        <li key={e.id} className="min-w-0 py-2.5 text-sm">
          <p className="break-words">
            {auditEventLabel(e.type)}
            {e.action ? ` · ${ACTION_LABEL[e.action] ?? e.action}` : ""}
            {e.itemTitle ? ` · «${e.itemTitle}»` : ""}
          </p>
          <p className="text-xs break-words text-muted-foreground">
            {formatDateTimeIt(e.at) ?? ""}
            {` · ${e.actorName ?? "Una persona"}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
