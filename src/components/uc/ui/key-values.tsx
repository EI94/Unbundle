import { cn } from "@/lib/utils";

/** Elenco chiave-valore dei pannelli e delle pagine di dettaglio: le righe vuote si omettono. */
export function KeyValues({ rows, className }: { rows: readonly (readonly [string, React.ReactNode | null | undefined])[]; className?: string }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (shown.length === 0) return null;
  return (
    <dl className={cn("grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]", className)}>
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words whitespace-pre-line">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
