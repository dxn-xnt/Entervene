"use client";

import { Download, UserPlus } from "lucide-react";
import type { WizardMode } from "@/types/adminClasses";
import ModalShell from "./modal-shell";
import { Card } from "@/components/retroui/Card";
import { Text } from "@/components/retroui/Text";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";

export default function AddClassMethodSelection({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (mode: Exclude<WizardMode, "choice">) => void;
}) {
  return (
    <ModalShell title="Add New Classes" onClose={onClose}>
      <section className="grid gap-4 md:grid-cols-2">
        <Card
          className="cursor-pointer transition hover:bg-muted/50 p-4"
          onClick={() => onSelect("import")}
        >
          <div className="flex items-center gap-3 font-semibold mb-2">
            <Download className="size-5 text-primary" />
            <span>Import from file</span>
          </div>
          <Text as="p" className="text-sm text-muted-foreground">
            Upload a CSV file to add multiple classes at once
          </Text>
        </Card>

        <Card
          className="cursor-pointer transition hover:bg-muted/50 p-4"
          onClick={() => onSelect("manual")}
        >
          <div className="flex items-center gap-3 font-semibold mb-2">
            <UserPlus className="size-5 text-primary" />
            <span>Create manually</span>
          </div>
          <Text as="p" className="text-sm text-muted-foreground">
            Add individual class sections one at a time
          </Text>
        </Card>
      </section>

      <Dialog.Footer className="px-0 border-t-0 pt-2">
        <Button variant={"outline"} onClick={onClose}>Cancel</Button>
      </Dialog.Footer>
    </ModalShell>
  );
}
