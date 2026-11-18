import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateAction {
  label: string;
  href?: string;
  /** Un'azione della pagina: solo da un componente client. */
  onClick?: () => void;
  icon?: LucideIcon;
  /** L'azione è il prossimo passo della schermata: allora, e solo allora, il pulsante è pieno. */
  nextStep?: boolean;
}

export interface EmptyStateProps {
  /** Una frase, al massimo dodici parole. */
  text: string;
  action?: EmptyStateAction | null;
  className?: string;
}

/**
 * `EmptyState` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4, regola 5 di §1): un vuoto vero, con una frase e
 * un'azione. Il pulsante è pieno solo se è il prossimo passo della schermata (`nextStep`); altrimenti bordato. Le
 * sezioni a zero, invece, non si mostrano affatto: questo pezzo è per il vuoto che chiede di fare qualcosa.
 */
export function EmptyState({ text, action, className }: EmptyStateProps) {
  const Icon = action?.icon;
  const body = action ? (
    <>
      {Icon ? <Icon aria-hidden data-icon="inline-start" /> : null}
      {action.label}
    </>
  ) : null;
  const variant = action?.nextStep ? "default" : "outline";
  const size = "min-h-11 sm:min-h-9";
  return (
    <div data-slot="empty-state" className={cn("space-y-3 rounded-xl border border-dashed p-4 sm:p-6", className)}>
      <p className="text-sm text-muted-foreground">{text}</p>
      {action?.href ? (
        <Button render={<Link href={action.href} />} nativeButton={false} variant={variant} className={size}>
          {body}
        </Button>
      ) : action?.onClick ? (
        <Button type="button" variant={variant} className={size} onClick={action.onClick}>
          {body}
        </Button>
      ) : null}
    </div>
  );
}
