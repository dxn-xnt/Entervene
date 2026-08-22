"use client";

import * as React from "react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Text } from "@/components/retroui/Text";
import { createPathway } from "@/lib/api";

interface AddPathwayModalProps {
  onClose?: () => void;
  onSaved?: () => void | Promise<void>;
}

export default function AddPathwayModal({
  onClose,
  onSaved,
}: AddPathwayModalProps) {
  const [pathwayCode, setPathwayCode] = React.useState("");
  const [pathwayName, setPathwayName] = React.useState("");
  const [pathwayError, setPathwayError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const handleReset = () => {
    setPathwayCode("");
    setPathwayName("");
    setPathwayError(null);
  };

  const handleCreatePathway = async () => {
    const code = pathwayCode.trim();
    const name = pathwayName.trim();

    if (!code || !name) {
      setPathwayError("Both pathway code and name are required.");
      return;
    }

    setIsSaving(true);
    setPathwayError(null);

    try {
      await createPathway({ code, name });
      handleReset();
      await onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create pathway.";
      setPathwayError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Content size="md">
      <Dialog.Header position="static">
        <Text as="h5" className="font-sans text-lg font-bold">
          Add New SHS Academic Pathway
        </Text>
      </Dialog.Header>
      <section className="flex flex-col gap-4 p-4 text-sm">

        {pathwayError && (
          <Alert status="error" className="text-sm">
            {pathwayError}
          </Alert>
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Text as="p" className="text-sm font-medium">
              Pathway Code
            </Text>
            <Input
              placeholder="e.g. ict-programming"
              value={pathwayCode}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPathwayCode(e.target.value)
              }
              disabled={isSaving}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Text as="p" className="text-sm font-medium">
              Pathway Display Name
            </Text>
            <Input
              placeholder="e.g. ICT and Computer Programming Related"
              value={pathwayName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPathwayName(e.target.value)
              }
              disabled={isSaving}
            />
          </div>
        </div>
        <Text as="p" className="text-xs text-muted-foreground -mb-2">
          Configure a new Senior High School academic pathway for section and subject assignment
        </Text>
      </section>
      <Dialog.Footer position="static">
        <Button
          variant="outline"
          onClick={() => {
            handleReset();
            onClose?.();
          }}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button onClick={handleCreatePathway} disabled={isSaving}>
          Save Pathway
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
