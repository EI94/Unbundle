import type { Viewport } from "next";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11, §5.1) Le pagine fuori dalla dashboard sono chiare (`.survey-light`, resa dal
 * server nel layout della rotta): anche la barra del browser del telefono. Gli stessi valori dei layout di `/r` e
 * `/rispondi`. Qui e non in `src/components/public/`, dove il censimento dei colori fissi non vuole esadecimali.
 */
export const PUBLIC_VIEWPORT: Viewport = {
  themeColor: "#f9fafb",
  colorScheme: "light",
};
