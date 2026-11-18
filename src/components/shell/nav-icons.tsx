import {
  BookOpen,
  Bot,
  ClipboardCheck,
  Compass,
  FileText,
  FlaskConical,
  GitBranch,
  GraduationCap,
  House,
  Inbox,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Map,
  Radar,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ShellIcon } from "./sidebar-model";

/**
 * Le icone della barra (rilascio 10, PROPOSTA-10 §9.0): lucide a 16 px, sempre con la parola accanto. Home · Use case
 * · Agent Factory · Contesto · Persone · Impostazioni come nel prototipo; gli strumenti con le icone del prototipo; le
 * voci della barra di prima (area «Use case» spenta) con le loro.
 */
export const NAV_ICONS: Readonly<Record<ShellIcon, LucideIcon>> = Object.freeze({
  home: House,
  "use-case": Lightbulb,
  factory: Bot,
  context: BookOpen,
  people: Users,
  processes: GitBranch,
  interview: Compass,
  readiness: ClipboardCheck,
  learning: GraduationCap,
  realizations: ListChecks,
  "value-map": Map,
  reports: FileText,
  blueprints: Layers,
  simulation: FlaskConical,
  intelligence: Radar,
  settings: Settings,
  workspaces: LayoutGrid,
  overview: LayoutDashboard,
  portfolio: Inbox,
  strategy: Target,
  plan: FileText,
});
