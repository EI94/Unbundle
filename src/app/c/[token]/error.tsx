"use client";

import { useEffect } from "react";
import { PublicErrorScreen } from "@/components/public/state-card";
import { COURSE_LINK_TEXT } from "@/lib/public/course";

/**
 * Rete che cade durante l'accesso, errore transitorio del server: senza questo
 * boundary la persona in aula vede "Application error", che non spiega nulla.
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) La scheda unica dell'errore, chiara, con il solo «Riprova»: `retry` rilegge
 * la pagina dal server (guida di Next `03-file-conventions/error.md`). Non ha perso niente: chi era nel corso ci resta.
 */
export default function CourseJoinError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[course-join]", error);
  }, [error]);

  return <PublicErrorScreen retry={retry} body={COURSE_LINK_TEXT.error} />;
}
