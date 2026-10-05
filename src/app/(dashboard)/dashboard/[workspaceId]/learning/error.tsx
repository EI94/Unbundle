"use client";
import { Button } from "@/components/ui/button";
export default function LearningErrorPage({ unstable_retry }: { unstable_retry: () => void }) {
  return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Formazione non disponibile</h1><p>Il corso potrebbe essere sospeso, non assegnato a questo account o non raggiungibile in questo momento. Le risposte già inviate restano salvate.</p><p>Controlla di essere nel workspace giusto, oppure chiedi a chi tiene il corso.</p><Button onClick={unstable_retry}>Riprova</Button></main>;
}
