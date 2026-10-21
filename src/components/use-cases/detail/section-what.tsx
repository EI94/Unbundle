import type { ReactNode } from "react";
import type { EditableUseCaseField } from "@/lib/actions/use-case-edit";
import { TEXT_LIMITS } from "@/lib/use-cases/inputs";
import { WHAT_FIELD_LABEL, type WhatField } from "@/lib/use-cases/labels";
import type { UseCaseKind } from "@/lib/use-cases/types";
import type { UseCaseDetail } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { AddDetails } from "./add-details";
import { InlineTextField, type InlineFieldOption } from "./inline-text-field";

/** Il titolo del capitolo e della sua ancora (§6.1, §14.3; «Cos'è», non «Cosa è»). */
export const SECTION_WHAT_TITLE = "Cos'è";

/** Le colonne della scheda dietro ogni campo di «Cosa è» (§6.2). */
const FIELD_VALUE: Readonly<Record<WhatField, (detail: WhatSource) => string | null>> = {
  title: (d) => d.title,
  description: (d) => d.description,
  flowDescription: (d) => d.flowDescription,
  humanInTheLoop: (d) => d.humanInTheLoop,
  guardrails: (d) => d.guardrails,
  businessCase: (d) => d.businessCase,
  dataRequirements: (d) => d.dataRequirements,
  area: (d) => d.area,
  aiLab: (d) => d.aiLab,
  sustainabilityImpact: (d) => d.sustainabilityImpact,
};

/** I testi lunghi: Invio salva, Maiusc+Invio va a capo. */
const MULTILINE: ReadonlySet<WhatField> = new Set([
  "description",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "businessCase",
  "dataRequirements",
  "sustainabilityImpact",
]);

/** L'ordine della tabella di §6.2. */
const FIELD_ORDER: readonly WhatField[] = [
  "title",
  "description",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "businessCase",
  "dataRequirements",
  "area",
  "aiLab",
  "sustainabilityImpact",
];

export type WhatSource = Pick<
  UseCaseDetail,
  | "kind"
  | "title"
  | "description"
  | "flowDescription"
  | "humanInTheLoop"
  | "guardrails"
  | "businessCase"
  | "dataRequirements"
  | "area"
  | "aiLab"
  | "sustainabilityImpact"
>;

export interface WhatFieldRow {
  field: WhatField & EditableUseCaseField;
  label: string;
  value: string | null;
  max: number;
  multiline: boolean;
}

/**
 * I campi di «Cosa è» per il tipo della scheda (§6.2): le etichette «Da costruire» o «Da
 * diffondere» (`WHAT_FIELD_LABEL`), senza «Limiti» per una best practice e con «Impatto
 * ambientale e sociale» solo con ESG attivo. L'area ha 80 caratteri come testo libero.
 */
export function whatFieldRows(detail: WhatSource, opts: { esgEnabled: boolean }): WhatFieldRow[] {
  const kind: UseCaseKind = detail.kind;
  const rows: WhatFieldRow[] = [];
  for (const field of FIELD_ORDER) {
    const label = WHAT_FIELD_LABEL[field][kind];
    if (label === null) continue;
    if (field === "sustainabilityImpact" && !opts.esgEnabled) continue;
    rows.push({ field, label, value: FIELD_VALUE[field](detail), max: TEXT_LIMITS[field], multiline: MULTILINE.has(field) });
  }
  return rows;
}

export interface SectionWhatProps {
  workspaceId: string;
  /** La scheda dei revisori (`UseCaseDetail`): «Cosa è» non va mai ai contributori (§6.7). */
  detail: WhatSource & Pick<UseCaseDetail, "id" | "version">;
  /** `canEditWhat`: tutti i revisori. */
  canEdit: boolean;
  esgEnabled: boolean;
  /**
   * Le aree della guida del connettore, se ha un elenco (§6.2): l'area si sceglie da lì e si legge
   * con il titolo della guida, mai con la chiave.
   */
  areaOptions?: readonly InlineFieldOption[] | null;
  /** «Dettagli» (`IntakeDetails`), in fondo al capitolo. */
  details?: ReactNode;
  id?: string;
  className?: string;
}

/** Un campo ha un testo da mostrare? */
export function hasFieldText(value: string | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Il capitolo «Cos'è» della scheda (docs/use-case/DESIGN.md §6.2, §6.7): coppie etichetta-valore,
 * modificabili sul posto dai revisori (`InlineTextField`), con le etichette del tipo della scheda.
 * Il titolo no: sta nella testata, dove si modifica (H4p). I campi vuoti non hanno una riga
 * ciascuno: chi può modificarli li trova dietro un solo «Aggiungi altri campi», che apre i loro «+
 * Aggiungi …»; l'etichetta compare quando il campo si apre. In fondo «Dettagli» chiuso. Solo per
 * i revisori: il contributore non riceve questi testi.
 */
export function SectionWhat({ workspaceId, detail, canEdit, esgEnabled, areaOptions, details, id = "cosa-e", className }: SectionWhatProps) {
  const headingId = `${id}-titolo`;
  const item = { id: detail.id, version: detail.version };
  // Il titolo si legge e si modifica nella testata: qui non si ripete (H4p).
  const rows = whatFieldRows(detail, { esgEnabled }).filter((row) => row.field !== "title");
  const filled = rows.filter((row) => hasFieldText(row.value));
  const empty = canEdit ? rows.filter((row) => !hasFieldText(row.value)) : [];
  const field = (row: WhatFieldRow, compact: boolean) => (
    <InlineTextField
      key={row.field}
      workspaceId={workspaceId}
      item={item}
      field={row.field}
      label={row.label}
      value={row.value}
      max={row.max}
      multiline={row.multiline}
      options={row.field === "area" ? areaOptions : null}
      canEdit={canEdit}
      compact={compact}
    />
  );
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section-what" className={cn("scroll-mt-28 space-y-4", className)}>
      <h2 id={headingId} className="text-base font-semibold">
        {SECTION_WHAT_TITLE}
      </h2>
      {filled.length ? <dl className="grid gap-4">{filled.map((row) => field(row, false))}</dl> : null}
      {empty.length ? (
        <AddDetails>
          <div data-slot="what-empty-fields" className="contents">
            {empty.map((row) => field(row, true))}
          </div>
        </AddDetails>
      ) : null}
      {details}
    </section>
  );
}
