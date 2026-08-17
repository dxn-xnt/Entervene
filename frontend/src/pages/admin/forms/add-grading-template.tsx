"use client";

import * as React from "react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Text } from "@/components/retroui/Text";
import { createGradingTemplate } from "@/lib/api";

interface AddGradingTemplateModalProps {
  onClose?: () => void;
  onSaved?: () => void | Promise<void>;
}

export default function AddGradingTemplateModal({
  onClose,
  onSaved,
}: AddGradingTemplateModalProps) {
  const [tplName, setTplName] = React.useState("");
  const [tplWw, setTplWw] = React.useState("25");
  const [tplPt, setTplPt] = React.useState("45");
  const [tplQa, setTplQa] = React.useState("30");
  const [tplError, setTplError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const handleReset = () => {
    setTplName("");
    setTplWw("25");
    setTplPt("45");
    setTplQa("30");
    setTplError(null);
  };

  const addTemplate = async () => {
    const name = tplName.trim();
    const ww = Number(tplWw) || 0;
    const pt = Number(tplPt) || 0;
    const qa = Number(tplQa) || 0;

    if (!name) {
      setTplError("Template name is required.");
      return;
    }
    if (ww + pt + qa !== 100) {
      setTplError(
        `Weights must total 100%. Current total is ${ww + pt + qa}%.`,
      );
      return;
    }

    setIsSaving(true);
    setTplError(null);

    try {
      await createGradingTemplate({
        template_name: name,
        description: "Custom template",
        components: [
          { component_name: "Written Work", weight: ww, display_order: 1 },
          { component_name: "Performance Task", weight: pt, display_order: 2 },
          { component_name: "Quarterly Assessment", weight: qa, display_order: 3 },
        ],
      });

      handleReset();
      await onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save template";
      setTplError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Content size="md">
      <Dialog.Header position="static">
        <Text as="h5" className="font-sans text-xl font-bold">
          New Grading Template
        </Text>
      </Dialog.Header>
      <section className="flex flex-col gap-4 p-4 text-sm">
        <Text as="p" className="text-muted-foreground text-xs">
          Weights must total 100%. This creates a reusable template only;
          subject assignment happens in Subjects.
        </Text>
        <div className="flex flex-col gap-2">
          <Text as="h6" className="font-sans font-medium">
            Template Name
          </Text>
          <Input
            value={tplName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setTplName(e.target.value)
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-2">
            <Text as="h6" className="font-sans text-sm font-medium">
              Written Work %
            </Text>
            <Input
              type="number"
              value={tplWw}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTplWw(e.target.value)
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Text as="h6" className="font-sans text-sm font-medium">
              Performance Task %
            </Text>
            <Input
              type="number"
              value={tplPt}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTplPt(e.target.value)
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Text as="h6" className="font-sans text-sm font-medium">
              Quarterly/Term Assessment %
            </Text>
            <Input
              type="number"
              value={tplQa}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTplQa(e.target.value)
              }
            />
          </div>
        </div>
        {tplError && (
          <Alert status="error" className="text-sm">
            {tplError}
          </Alert>
        )}
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
        <Button onClick={addTemplate} disabled={isSaving}>
          Save Template
        </Button>

      </Dialog.Footer>
    </Dialog.Content>
  );
}
