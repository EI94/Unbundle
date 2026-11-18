import { BookOpen, Check, ClipboardCheck, GitBranch, ListChecks, MessageCircle, Plus, Send, ShieldCheck, Target, type LucideIcon } from "lucide-react";
import type { StepIcon, StepView } from "@/lib/home/next-step";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import type { NextStepItem } from "@/components/ui-10/next-step";

/** Le icone lucide dei passi (§5.8, prototipo S1): sempre con la parola accanto. */
export const STEP_ICONS: Readonly<Record<StepIcon, LucideIcon>> = Object.freeze({
  fornitori: ShieldCheck,
  decidi: Check,
  chiedi: Send,
  verifica: ListChecks,
  sal: ClipboardCheck,
  racconta: MessageCircle,
  appunti: BookOpen,
  processi: GitBranch,
  obiettivi: Target,
  proponi: Plus,
});

/**
 * Il passo da disegnare con `NextStep`; `onPanel` apre un pannello della pagina al posto di un link. A schermo un
 * numero resta con la sua parola («Decidi 4 use case», «da 9 giorni»: `keepTogether`).
 */
export function stepItem(step: StepView | null, onPanel?: (panel: NonNullable<StepView["panel"]>) => void): NextStepItem | null {
  if (!step) return null;
  const panel = step.panel;
  return {
    label: keepTogether(step.label),
    icon: STEP_ICONS[step.icon],
    why: keepTogether(step.why),
    mine: step.mine,
    turn: keepTogether(step.turn),
    href: step.href,
    onClick: panel && onPanel ? () => onPanel(panel) : null,
  };
}
