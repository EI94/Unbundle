"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { THEME_MENU_LABEL, THEME_OPTIONS, type ThemeChoice } from "./theme-config";

const ICONS: Record<ThemeChoice, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };

const isChoice = (value: unknown): value is ThemeChoice => THEME_OPTIONS.some((option) => option.value === value);

/**
 * «Tema» nel menu sotto il nome, in fondo alla barra laterale: «Scuro», «Chiaro», «Come il
 * sistema». La scelta vale subito e resta in questo browser (theme-config.ts); il menu resta aperto,
 * così si vede la pagina cambiare. Dalla tastiera: le frecce e Invio o Spazio, come le altre voci.
 * Il menu si apre solo nel browser, quindi leggere il tema qui non cambia l'HTML del server.
 */
export function ThemeMenuGroup() {
  const { theme, setTheme } = useTheme();
  const value: ThemeChoice = isChoice(theme) ? theme : "dark";

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{THEME_MENU_LABEL}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => { if (isChoice(next)) setTheme(next); }}>
        {THEME_OPTIONS.map((option) => {
          const Icon = ICONS[option.value];
          return (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <Icon aria-hidden="true" className="mr-0.5" />
              {option.label}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}
