import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Una sezione delle impostazioni: stessa cornice, stessi margini e stessa
 * intestazione per tutte, così icone e testi stanno sulla stessa linea.
 * Il corpo usa le container query (@container): le colonne interne seguono
 * la larghezza della scheda, non quella dello schermo, che con la barra
 * laterale aperta direbbe il falso.
 */
export function SettingsSection({
  id,
  icon: Icon,
  iconClassName,
  title,
  description,
  aside,
  tone = "default",
  children,
  className,
}: {
  id?: string;
  icon: LucideIcon;
  iconClassName?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  tone?: "default" | "danger";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-28 overflow-clip rounded-xl bg-card text-card-foreground ring-1",
        tone === "danger" ? "bg-red-500/[0.03] ring-red-500/30" : "ring-foreground/10",
        className
      )}
    >
      <header className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6", children ? "border-b" : "")}>
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted", iconClassName)}>
            <Icon className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <div className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</div>}
          </div>
        </div>
        {aside && <div className="shrink-0 sm:pl-4">{aside}</div>}
      </header>
      {children && <div className="@container p-4 sm:p-6">{children}</div>}
    </section>
  );
}
