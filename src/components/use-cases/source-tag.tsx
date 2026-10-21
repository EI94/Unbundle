import { costSourceText, valueEurSourceText, valueSourceText, type SourceForm } from "@/lib/use-cases/format";
import type { CostSource, ValueEurSource, ValueSource } from "@/lib/use-cases/labels";
import { cn } from "@/lib/utils";

/** Di quale cifra è la fonte: il costo, il punteggio del Valore o gli euro all'anno. */
export type SourceTagProps = (
  | { figure: "costo"; source: CostSource; form?: SourceForm }
  | { figure: "valore"; source: ValueSource; form?: SourceForm }
  | { figure: "valore_anno"; source: ValueEurSource; form?: SourceForm }
) & { className?: string };

/** Il testo della fonte nella forma chiesta (§7.2, §14.3): corta nella riga, lunga nella scheda. */
export function sourceTagText(props: SourceTagProps): string {
  const form = props.form ?? "corta";
  if (props.figure === "costo") return costSourceText(props.source, form);
  if (props.figure === "valore") return valueSourceText(props.source);
  return valueEurSourceText(props.source, form);
}

/**
 * La fonte accanto a una cifra (docs/use-case/DESIGN.md §7.1, §7.2): «team», «AI», «dossier»,
 * «stimato»; per esteso «importo del team», «fascia del team», «stimato dall'impegno»,
 * «dal dossier». Grigia, mai sola: sta dentro `ValueFigure` e `CostFigure`. `data-source`
 * permette alle schermate di controllare che ogni costo abbia la sua fonte (PIANO §5.7).
 */
export function SourceTag(props: SourceTagProps) {
  return (
    <span data-source={props.source} className={cn("text-xs whitespace-nowrap text-muted-foreground", props.className)}>
      {sourceTagText(props)}
    </span>
  );
}
