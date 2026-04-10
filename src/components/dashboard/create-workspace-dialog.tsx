"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createWorkspaceAction } from "@/lib/actions/workspace";
import type { Organization } from "@/lib/db/schema";

export function CreateWorkspaceDialog({
  organizations,
  children,
}: {
  organizations: Organization[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isNewOrg, setIsNewOrg] = useState(organizations.length === 0);

  return (
    <>
      <span onClick={() => setOpen(true)} className="cursor-pointer">
        {children}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form action={createWorkspaceAction}>
            <DialogHeader>
              <DialogTitle>Nuovo Workspace</DialogTitle>
              <DialogDescription>
                Crea un nuovo spazio di lavoro per analizzare e trasformare
                un&apos;area della tua organizzazione.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {organizations.length > 0 && !isNewOrg ? (
                <div className="space-y-2">
                  <Label htmlFor="organizationId">Organizzazione</Label>
                  <Select name="organizationId" defaultValue={organizations[0]?.id}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona organizzazione" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setIsNewOrg(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    + Crea nuova organizzazione
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="orgName">Nome organizzazione</Label>
                  <Input
                    id="orgName"
                    name="orgName"
                    placeholder="Es. Acme Corp"
                    required
                  />
                  {organizations.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsNewOrg(false)}
                      className="text-xs text-primary hover:underline"
                    >
                      Usa organizzazione esistente
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Nome workspace</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="Es. Trasformazione Q3 2026"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrizione (opzionale)</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Descrivi brevemente l'obiettivo di questo workspace..."
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Annulla
              </Button>
              <Button type="submit">Crea workspace</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
