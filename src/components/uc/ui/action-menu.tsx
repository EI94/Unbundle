"use client";

import Link from "next/link";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Menu di azioni (DESIGN §5.1): il «⋯» del caso, il pannello della domanda, le
 * righe di Persone e Documenti, la selezione. Una voce è un link (`href`) o
 * un'azione (`onSelect`, solo da un componente client). Senza voci il menu non
 * c'è: chi non ha azioni non vede il pulsante.
 */
export interface ActionMenuItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Riga grigia sotto l'etichetta. */
  hint?: string;
}

export interface ActionMenuProps {
  items: readonly ActionMenuItem[];
  /** `icon`: «⋯»; `altro`: pulsante «Altro». */
  trigger?: "icon" | "altro";
  /** Nome accessibile del menu (e testo del pulsante `altro`). */
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
}

const ITEM =
  "flex min-h-11 w-full cursor-default items-start gap-1.5 rounded-md px-2 py-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 sm:min-h-8 sm:py-1.5";

function ItemBody({ item }: { item: ActionMenuItem }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn(item.destructive && "text-destructive")}>{item.label}</span>
      {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
    </span>
  );
}

export function ActionMenu({ items, trigger = "icon", label, align = "end", className }: ActionMenuProps) {
  if (items.length === 0) return null;
  const name = label ?? (trigger === "icon" ? "Altre azioni" : "Altro");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          trigger === "icon" ? (
            <Button variant="outline" size="icon" aria-label={name} className={cn("size-11 sm:size-8", className)} />
          ) : (
            <Button variant="outline" className={cn("min-h-11 sm:min-h-8", className)} />
          )
        }
      >
        {trigger === "icon" ? (
          <MoreHorizontal aria-hidden />
        ) : (
          <>
            {name}
            <ChevronDown aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-auto min-w-48 max-w-[min(20rem,calc(100vw-2rem))]">
        {items.map((item) =>
          item.href && !item.disabled ? (
            <MenuPrimitive.LinkItem
              key={`${item.label}-${item.href}`}
              closeOnClick
              render={<Link href={item.href} />}
              className={cn(ITEM, item.destructive && "focus:bg-destructive/10")}
            >
              <ItemBody item={item} />
            </MenuPrimitive.LinkItem>
          ) : (
            <DropdownMenuItem key={item.label} variant={item.destructive ? "destructive" : "default"} disabled={item.disabled} onClick={item.onSelect} className={ITEM}>
              <ItemBody item={item} />
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
