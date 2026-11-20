"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { Button } from "@/components/ui/button";
import { ResultsToggle } from "./results-toggle";

const L = LEARNING_TEXT.manage.lessons;

/**
 * Il QR a schermo intero (rilascio 10, ondata 7a, §3.9, FO-34), da proiettare in aula: grande quanto lo schermo, su
 * bianco, con la lezione, «Inquadra il QR per entrare nel corso» e l'interruttore dell'ingresso, così chi tiene il
 * corso lo apre senza uscire. Esc, «Esci», Indietro del browser e l'uscita dallo schermo intero lo chiudono; il resto
 * della pagina resta inerte. Il QR lo genera il server (libreria qrcode): nessun testo di chi usa la pagina finisce nel
 * suo markup.
 */
export function AdminQrFullscreen({ qrSvg, lesson, doorOpen, busy, onDoor, onClose }: {
  qrSvg: string; lesson: string; doorOpen: boolean; busy: boolean; onDoor: (open: boolean) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  });
  const onLeave = useEffectEvent(() => onClose());

  useEffect(() => {
    const node = dialog.current;
    const listener = (event: KeyboardEvent) => onKey(event);
    const onFullscreen = () => { if (!document.fullscreenElement) onLeave(); };
    const onPopState = () => onLeave();
    window.addEventListener("keydown", listener);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("fullscreenchange", onFullscreen);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const muted = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== node && !element.inert);
    for (const element of muted) element.inert = true;
    node?.focus();
    try {
      // Lo schermo intero è un di più: il QR si vede anche senza.
      if (!document.fullscreenElement && typeof document.documentElement.requestFullscreen === "function") void document.documentElement.requestFullscreen().catch(() => undefined);
    } catch { /* niente schermo intero */ }
    return () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.body.style.overflow = overflow;
      for (const element of muted) element.inert = false;
      try { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); } catch { /* già uscito */ }
    };
  }, []);

  return createPortal(<div
    ref={dialog}
    tabIndex={-1}
    role="dialog"
    aria-modal="true"
    aria-labelledby="qr-title"
    data-testid="qr-fullscreen"
    className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none"
  >
    <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-8">
      <p className="min-w-0 flex-1 truncate text-sm font-medium sm:text-base">{lesson}</p>
      <ResultsToggle checked={doorOpen} onChange={(open) => { if (!busy) onDoor(open); }} label={doorOpen ? "Ingresso aperto" : "Ingresso chiuso"} testId="qr-door" />
      <Button type="button" variant="outline" className="min-h-11 gap-2 px-3 sm:min-h-9" onClick={onClose}>
        <X aria-hidden /> {L.exit}
      </Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto p-4">
      {/* Il margine bianco attorno al QR (il tema chiaro delle pagine pubbliche: la card è bianca), in tutti e due i temi:
          sul fondo scuro un QR senza margine chiaro non si legge. */}
      <div className="survey-light rounded-2xl bg-card p-6">
        <div
          className="aspect-square w-[min(72vh,86vw)] [&_svg]:h-full [&_svg]:w-full"
          // Generato dal server con la libreria qrcode: nessun input della persona finisce in questo markup.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      </div>
      <p id="qr-title" className="text-center text-xl font-semibold sm:text-3xl">{L.qrTitle}</p>
    </div>
  </div>, document.body);
}
