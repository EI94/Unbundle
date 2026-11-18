import { Check } from "lucide-react";
import { Row, RowList } from "@/components/ui-10/row";
import type { StartChecklist } from "@/lib/home/start";
import { HOME_TEXT } from "@/lib/home/text";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";

/** Il cerchio della riga: pieno con la spunta quando è fatta, vuoto quando è da fare. */
function Tick({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={cn("grid size-5 place-items-center rounded-full border-[1.5px]", done ? "border-foreground bg-foreground text-background" : "border-input")}>
      {done ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * «Per partire · 2 di 5» (prototipo S1b): cinque righe con la spunta. Una riga fatta è grigia e ferma, con «(fatto)»
 * per i lettori di schermo; una da fare porta alla sua pagina. La prima riga aperta di chi guarda è anche il prossimo
 * passo, in cima alla Home. Senza stato: si rende sul server.
 */
export function StartList({ start }: { start: StartChecklist }) {
  const t = HOME_TEXT.start;
  return (
    <section aria-labelledby="per-partire" data-slot="start-list" className="space-y-3">
      <h2 id="per-partire" className="text-base font-semibold">
        {t.title} <span className="font-normal text-muted-foreground">· {keepTogether(t.progress(start.done, start.total))}</span>
      </h2>
      <RowList>
        {start.rows.map((row) => (
          <li key={row.key} data-start={row.key} data-done={row.done ? "" : undefined}>
            {row.done ? (
              <Row
                leading={<Tick done />}
                title={
                  <span className="font-normal text-muted-foreground">
                    {row.label}
                    <span className="sr-only"> ({t.done})</span>
                  </span>
                }
              />
            ) : (
              <Row leading={<Tick done={false} />} title={row.label} href={row.href} />
            )}
          </li>
        ))}
      </RowList>
    </section>
  );
}
