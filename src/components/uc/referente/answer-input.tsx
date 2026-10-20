"use client";

import { confirmationBase } from "@/lib/uc/answers/confirm";
import type { ResponseType } from "@/lib/uc/vocab";
import type { AttachmentRef } from "./attachment-field";
import { ChoiceInput, MultiChoiceInput, YesNoInput } from "./inputs/choice-inputs";
import { FormulaConfirmInput, RuleConfirmInput, ValueConfirmInput } from "./inputs/confirm-inputs";
import { CurrencyInput } from "./inputs/currency-input";
import { DateInput, DateTimeInput, IntervalInput } from "./inputs/date-inputs";
import type { InputProps } from "./inputs/fields";
import { FileAnswerInput } from "./inputs/file-inputs";
import { DurationInput, NumberInput, PercentInput } from "./inputs/number-inputs";
import { TableInput } from "./inputs/table-input";
import { CodeInput, FreeTextInput, SystemLinkInput, TestCaseInput } from "./inputs/text-inputs";

/**
 * L'input della voce secondo il tipo di risposta del template (PIANO §3.9):
 * tutti i tipi dell'MVP, più `collegamento_sistema` e `caso_prova`. Un tipo
 * mancante vale come testo.
 */
export interface AnswerInputProps extends InputProps {
  type: ResponseType | null;
  token: string;
  itemId: string;
  attachments: AttachmentRef[];
  onAttachmentsChange: (next: AttachmentRef[]) => void;
  attachmentHint: string | null;
  personal: boolean;
  /** Tabella: griglia (computer) o editor a schede (telefono, DESIGN §4.3 R2c). */
  tableLayout?: "grid" | "cards";
}

export function AnswerInput(props: AnswerInputProps) {
  const { type, token, itemId, attachments, onAttachmentsChange, attachmentHint, personal, tableLayout = "grid", ...input } = props;
  switch (type ?? "testo") {
    case "numero":
      return <NumberInput {...input} />;
    case "valuta":
      return <CurrencyInput {...input} />;
    case "percentuale":
      return <PercentInput {...input} />;
    case "durata":
      return <DurationInput {...input} />;
    case "data":
      return <DateInput {...input} />;
    case "data_ora":
      return <DateTimeInput {...input} />;
    case "intervallo":
      return <IntervalInput {...input} />;
    case "si_no":
      return <YesNoInput {...input} />;
    case "scelta":
      return <ChoiceInput {...input} />;
    case "scelta_multipla":
      return <MultiChoiceInput {...input} />;
    case "codice":
      return <CodeInput {...input} />;
    case "tabella":
      return (
        <TableInput
          {...input}
          layout={tableLayout}
          templateHref={token && itemId ? `/api/r/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/template.xlsx` : undefined}
        />
      );
    case "file":
    case "dataset":
      return (
        <FileAnswerInput
          token={token}
          itemId={itemId}
          attachments={attachments}
          onAttachmentsChange={onAttachmentsChange}
          hint={attachmentHint}
          personal={personal}
          disabled={input.disabled}
          issues={input.issues}
          dataset={type === "dataset"}
        />
      );
    case "conferma_regola":
      return <RuleConfirmInput {...input} />;
    case "conferma_formula":
      return <FormulaConfirmInput {...input} />;
    case "conferma_valore": {
      const baseType = confirmationBase(input.config).type ?? "testo";
      return <ValueConfirmInput {...input} renderBase={(p) => <AnswerInput {...props} {...p} type={baseType} />} />;
    }
    case "collegamento_sistema":
      return <SystemLinkInput {...input} />;
    case "caso_prova":
      return <TestCaseInput {...input} />;
    case "testo":
    default:
      return <FreeTextInput {...input} />;
  }
}

/** Il tipo usa l'allegato come risposta (non serve il riquadro «Allega un file» in più). */
export function isFileType(type: ResponseType | null): boolean {
  return type === "file" || type === "dataset";
}
