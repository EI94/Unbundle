"use client";
import { Button } from "@/components/ui/button";
export default function LearningErrorPage({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Formazione non disponibile</h1><p>Il percorso potrebbe essere sospeso, non assegnato a questo account oppure temporaneamente non raggiungibile. Le risposte già confermate dal server restano conservate.</p><p>Verifica di essere nel workspace corretto o contatta il responsabile del corso.</p><Button onClick={reset}>Riprova</Button></main>;
}
