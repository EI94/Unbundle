import { BadgeCheck, Clock, Coins, PackageCheck, Scale, ShieldAlert, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVERS, type Lever } from "@/lib/uc/vocab";

/** Le 8 leve di valore: etichetta in italiano semplice e icona. */
export const LEVER_META: Readonly<Record<Lever, { label: string; icon: LucideIcon }>> = {
  tempo: { label: "Tempo", icon: Clock },
  output: { label: "Output", icon: PackageCheck },
  qualita: { label: "Qualità", icon: BadgeCheck },
  nuove_capacita: { label: "Nuove capacità", icon: Sparkles },
  decisioni: { label: "Decisioni", icon: Scale },
  costi: { label: "Costi", icon: Coins },
  ricavi: { label: "Ricavi", icon: TrendingUp },
  rischio: { label: "Rischio", icon: ShieldAlert },
};

/**
 * Una leva: icona più etichetta, mai l'icona da sola (DESIGN §5.1). Una leva
 * non toccata è grigia e lo dice anche a parole.
 */
export function LeverIcon({ lever, active = true, className }: { lever: Lever; active?: boolean; className?: string }) {
  const { label, icon: Icon } = LEVER_META[lever];
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
        active ? "border-border text-foreground" : "border-dashed border-border text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
      {!active && <span className="sr-only">: non toccata</span>}
    </span>
  );
}

/**
 * Le leve del caso, nell'ordine fisso, ognuna con il suo nome. Lo zero non si
 * mostra: di partenza solo le leve attive; con `onlyActive={false}` anche le
 * altre, in grigio.
 */
export function LeverIcons({ active, onlyActive = true, className }: { active: readonly string[]; onlyActive?: boolean; className?: string }) {
  const on = new Set(active);
  const levers = onlyActive ? LEVERS.filter((l) => on.has(l)) : LEVERS;
  if (levers.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Leve di valore">
      {levers.map((lever) => (
        <li key={lever}>
          <LeverIcon lever={lever} active={on.has(lever)} />
        </li>
      ))}
    </ul>
  );
}
