import type { SemaforoColor } from "@/lib/uc/vocab";

/** Classi Tailwind per ogni colore del semaforo (token `--uc-*` in globals.css). */
export const SEMAFORO_TONE: Readonly<Record<SemaforoColor, { text: string; bg: string; fill: string; ring: string }>> = {
  verde: { text: "text-uc-verde", bg: "bg-uc-verde-bg", fill: "bg-uc-verde", ring: "ring-uc-verde/40" },
  blu: { text: "text-uc-blu", bg: "bg-uc-blu-bg", fill: "bg-uc-blu", ring: "ring-uc-blu/40" },
  giallo: { text: "text-uc-giallo", bg: "bg-uc-giallo-bg", fill: "bg-uc-giallo", ring: "ring-uc-giallo/40" },
  rosso: { text: "text-uc-rosso", bg: "bg-uc-rosso-bg", fill: "bg-uc-rosso", ring: "ring-uc-rosso/40" },
  grigio: { text: "text-uc-grigio", bg: "bg-uc-grigio-bg", fill: "bg-uc-grigio", ring: "ring-uc-grigio/40" },
  lucchetto: { text: "text-uc-lucchetto", bg: "bg-uc-lucchetto-bg", fill: "bg-uc-lucchetto", ring: "ring-uc-lucchetto/40" },
};
