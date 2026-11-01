import type { ThemeProviderProps } from "next-themes";

/**
 * Il tema del dashboard (Scuro, Chiaro, Come il sistema): la scelta resta in questo browser, per
 * ogni workspace, sotto una chiave sua (quella delle pagine pubbliche /a e /s è
 * `unbundle-survey-theme`, che resta com'è). «Scuro» è il predefinito per tutti.
 *
 * next-themes scrive il tema in `data-theme` su <html> con uno script in linea che gira prima che
 * la pagina si disegni (niente lampo dell'altro tema al caricamento). I colori del tema chiaro
 * stanno in globals.css sotto `:root[data-theme="light"]:has([data-theme-scope])`: valgono solo
 * sulle pagine del dashboard, che portano il segno `data-theme-scope`.
 */
export const THEME_STORAGE_KEY = "unbundle-theme";

/** Il segno delle pagine del dashboard, in (dashboard)/layout.tsx. */
export const THEME_SCOPE_ATTRIBUTE = "data-theme-scope";

export type ThemeChoice = "dark" | "light" | "system";

export const THEME_PROVIDER_PROPS = {
  attribute: "data-theme",
  defaultTheme: "dark",
  themes: ["dark", "light"],
  enableSystem: true,
  // «Scuro» non scrive `color-scheme`, come prima; il blocco chiaro di globals.css mette il suo.
  enableColorScheme: false,
  storageKey: THEME_STORAGE_KEY,
  disableTransitionOnChange: true,
} satisfies Omit<ThemeProviderProps, "children">;

/** Le tre voci del menu, in quest'ordine. */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "dark", label: "Scuro" },
  { value: "light", label: "Chiaro" },
  { value: "system", label: "Come il sistema" },
];

export const THEME_MENU_LABEL = "Tema";

/**
 * Il tema dei toast: chiaro solo sulle pagine del dashboard con il tema chiaro; altrove (e con
 * «Scuro») "system", come prima del tema chiaro, così il tema scuro non cambia.
 */
export function toasterTheme(resolvedTheme: string | undefined, pathname: string | null | undefined): "light" | "system" {
  if (resolvedTheme !== "light") return "system";
  if (!pathname) return "system";
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/") ? "light" : "system";
}
