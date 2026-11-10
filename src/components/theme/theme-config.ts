import type { ThemeProviderProps } from "next-themes";

/**
 * Il tema del dashboard (Scuro, Chiaro, Come il sistema): la scelta resta in questo browser, per
 * ogni workspace, sotto una chiave sua (quella delle pagine pubbliche /a e /s è
 * `unbundle-survey-theme`, che resta com'è). «Scuro» è il predefinito per tutti.
 *
 * next-themes scrive il tema in `data-theme` su <html> con uno script in linea all'inizio del corpo
 * della pagina, e sulle pagine del dashboard THEME_BOOT_SCRIPT lo scrive già nel <head> (niente
 * lampo dell'altro tema al caricamento). I colori del tema chiaro stanno in globals.css sotto
 * `:root[data-theme="light"]:has([data-theme-scope])`: valgono solo sulle pagine del dashboard, che
 * portano il segno `data-theme-scope`.
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

/**
 * Lo script nel <head> del layout di base, per le pagine del dashboard (/dashboard e sotto): scrive il
 * tema scelto in `data-theme` (come next-themes: niente di salvato vale «Scuro», «Come il sistema»
 * segue il sistema) e mette nel <head> un segno `data-theme-scope` provvisorio, prima che il browser
 * legga il corpo della pagina. Così il primo fotogramma è già del tema scelto: lo script di
 * next-themes sta nel corpo, e il browser può disegnare la pagina una prima volta prima di
 * eseguirlo, o prima di leggere il segno vero di (dashboard)/layout. Il segno provvisorio sparisce a
 * DOMContentLoaded, quando quello vero è nella pagina; le pagine pubbliche non lo hanno mai.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=location.pathname;if(p!=="/dashboard"&&p.indexOf("/dashboard/")!==0)return;var t;try{t=localStorage.getItem(${JSON.stringify(THEME_PROVIDER_PROPS.storageKey)})}catch(e){}t=t||${JSON.stringify(THEME_PROVIDER_PROPS.defaultTheme)};if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute(${JSON.stringify(THEME_PROVIDER_PROPS.attribute)},t);var m=document.createElement("meta");m.setAttribute("name","unbundle-theme-scope");m.setAttribute(${JSON.stringify(THEME_SCOPE_ATTRIBUTE)},"");document.head.appendChild(m);document.addEventListener("DOMContentLoaded",function(){m.remove()})}catch(e){}})()`;

/** Le tre voci del menu, in quest'ordine. */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "dark", label: "Scuro" },
  { value: "light", label: "Chiaro" },
  { value: "system", label: "Come il sistema" },
];

export const THEME_MENU_LABEL = "Tema";

/**
 * Il tema dei toast: sulle pagine del dashboard quello della pagina, chiaro con «Chiaro» e scuro con
 * «Scuro» (anche prima che il tema sia letto, perché «Scuro» è il predefinito); prima seguiva il
 * sistema, e con il sistema chiaro i toast erano chiari sul dashboard scuro. Altrove "system".
 */
export function toasterTheme(resolvedTheme: string | undefined, pathname: string | null | undefined): "light" | "dark" | "system" {
  if (!pathname || (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/"))) return "system";
  return resolvedTheme === "light" ? "light" : "dark";
}
