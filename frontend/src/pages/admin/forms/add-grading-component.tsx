"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { Plus, Trash2 } from "lucide-react";
import {
  createGradingTemplate,
  updateGradingTemplate,
  type GradingTemplateComponentPayload,
  type GradingTemplateFormOptions,
  type GradingTemplateListItem,
  type SubjectStatus,
} from "@/lib/api";

const NONE_VALUE = "none";

type ComponentRow = {
  local_id: string;
  component_name: string;
  weight: string;
  display_order: string;
};

type FormState = {
  template_name: string;
  description: string;
  academic_level_id: string;
  subject_id: string;
  status: SubjectStatus;
  components: ComponentRow[];
};

type AddGradingComponentModalProps = {
  options: GradingTemplateFormOptions | null;
  template?: GradingTemplateListItem | null;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
};

function newComponentRow(index: number, overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    local_id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    component_name: "",
    weight: "",
    display_order: String(index),
    ...overrides,
  };
}

function rowsFromOptions(options: GradingTemplateFormOptions | null): ComponentRow[] {
  const defaults = options?.default_components?.length
    ? options.default_components
    : [
      { component_name: "Written Works", weight: 25, display_order: 1 },
      { component_name: "Performance Tasks", weight: 50, display_order: 2 },
      { component_name: "Quarterly/Term Assessment", weight: 25, display_order: 3 },
    ];
  return defaults.map((component, index) =>
    newComponentRow(index + 1, {
      component_name: component.component_name,
      weight: String(component.weight),
      display_order: String(component.display_order ?? index + 1),
    })
  );
}

function initialForm(options: GradingTemplateFormOptions | null, template?: GradingTemplateListItem | null): FormState {
  if (template) {
    return {
      template_name: template.template_name,
      description: template.description ?? "",
      academic_level_id: template.academic_level ? String(template.academic_level.academic_level_id) : NONE_VALUE,
      subject_id: template.subject ? String(template.subject.subject_id) : NONE_VALUE,
      status: template.status,
      components: template.components.map((component, index) =>
        newComponentRow(index + 1, {
          component_name: component.component_name,
          weight: String(component.weight),
          display_order: String(component.display_order),
        })
      ),
    };
  }
  return {
    template_name: "",
    description: "",
    academic_level_id: NONE_VALUE,
    subject_id: NONE_VALUE,
    status: options?.default_status ?? "active",
    components: rowsFromOptions(options),
  };
}

export default function AddGradingComponentModal({
  options,
  template,
  onClose,
  onSaved,
}: AddGradingComponentModalProps) {
  const [form, setForm] = React.useState<FormState>(() => initialForm(options, template));
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setForm(initialForm(options, template));
    setError(null);
  }, [options, template]);

  const selectedLevelId = form.academic_level_id === NONE_VALUE ? null : Number(form.academic_level_id);
  const subjectOptions = React.useMemo(() => {
    const subjects = options?.subjects ?? [];
    if (!selectedLevelId) return subjects;
    return subjects.filter((subject) => subject.academic_level_id === selectedLevelId);
  }, [options, selectedLevelId]);

  const totalWeight = React.useMemo(
    () => form.components.reduce((sum, component) => sum + (Number(component.weight) || 0), 0),
    [form.components]
  );

  const setField = <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleLevelChange = (value: string) => {
    setForm((current) => {
      const currentSubject = options?.subjects.find((subject) => String(subject.subject_id) === current.subject_id);
      return {
        ...current,
        academic_level_id: value,
        subject_id:
          value !== NONE_VALUE && currentSubject?.academic_level_id !== Number(value)
            ? NONE_VALUE
            : current.subject_id,
      };
    });
  };

  const handleSubjectChange = (value: string) => {
    const subject = options?.subjects.find((item) => String(item.subject_id) === value);
    setForm((current) => ({
      ...current,
      subject_id: value,
      academic_level_id: subject ? String(subject.academic_level_id) : current.academic_level_id,
    }));
  };

  const updateComponent = (localId: string, patch: Partial<ComponentRow>) => {
    setForm((current) => ({
      ...current,
      components: current.components.map((component) =>
        component.local_id === localId ? { ...component, ...patch } : component
      ),
    }));
  };

  const addComponent = () => {
    setForm((current) => ({
      ...current,
      components: [...current.components, newComponentRow(current.components.length + 1)],
    }));
  };

  const removeComponent = (localId: string) => {
    setForm((current) => ({
      ...current,
      components: current.components.filter((component) => component.local_id !== localId),
    }));
  };

  const buildComponents = (): GradingTemplateComponentPayload[] => {
    return form.components.map((component, index) => ({
      component_name: component.component_name.trim(),
      weight: Number(component.weight),
      display_order: component.display_order.trim() ? Number(component.display_order) : index + 1,
    }));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.template_name.trim()) {
      setError("Template name is required.");
      return;
    }
    if (!form.components.length) {
      setError("Add at least one grading component.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        template_name: form.template_name.trim(),
        description: form.description.trim() || null,
        academic_level_id: form.academic_level_id === NONE_VALUE ? null : Number(form.academic_level_id),
        subject_id: form.subject_id === NONE_VALUE ? null : Number(form.subject_id),
        status: form.status,
        components: buildComponents(),
      };

      if (template) {
        await updateGradingTemplate(template.grading_template_id, payload);
      } else {
        await createGradingTemplate(payload);
      }
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save grading template.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Content size="3xl">
      <Dialog.Header position="fixed" asChild>
        <Text as="h5" className="font-sans text-xl font-bold">
          {template ? "Edit Grading Template" : "Create Grading Template"}
        </Text>
      </Dialog.Header>
      <section className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="grading-template-name" className="text-sm">Template Name</label>
            <Input
              id="grading-template-name"
              className="w-full"
              value={form.template_name}
              onChange={(event) => setField("template_name", event.target.value)}
              placeholder="Default SHS Grading"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="grading-template-status" className="text-sm">Status</label>
            <Select value={form.status} onValueChange={(value) => setField("status", value as SubjectStatus)}>
              <Select.Trigger id="grading-template-status" className="w-full">
                <Select.Value placeholder="Select status" />
              </Select.Trigger>
              <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  {(options?.statuses ?? ["active", "archived"]).map((status) => (
                    <Select.Item key={status} value={status}>{status}</Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="grading-template-level" className="text-sm">Academic Level Scope</label>
            <Select value={form.academic_level_id} onValueChange={handleLevelChange}>
              <Select.Trigger id="grading-template-level" className="w-full">
                <Select.Value placeholder="Any level" />
              </Select.Trigger>
              <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  <Select.Item value={NONE_VALUE}>Any level</Select.Item>
                  {options?.academic_levels.map((level) => (
                    <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                      {level.level_name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="grading-template-subject" className="text-sm">Subject Scope</label>
            <Select value={form.subject_id} onValueChange={handleSubjectChange}>
              <Select.Trigger id="grading-template-subject" className="w-full">
                <Select.Value placeholder="Any subject" />
              </Select.Trigger>
              <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  <Select.Item value={NONE_VALUE}>Any subject</Select.Item>
                  {subjectOptions.map((subject) => (
                    <Select.Item key={subject.subject_id} value={String(subject.subject_id)}>
                      {subject.subject_name} ({subject.subject_codename || "No code"})
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor="grading-template-description" className="text-sm">Description</label>
            <Input
              id="grading-template-description"
              className="w-full"
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="Optional note for admins"
            />
          </div>
        </div>

        <section className="rounded-lg border-2 border-black p-3 shadow-[3px_3px_0_#000]">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-bold">Components</h3>
              <p className="text-sm text-black/70">Weights must total 100 before the backend accepts the template.</p>
            </div>
            <div className={`w-fit rounded-full border border-black px-3 py-1 text-sm font-bold ${totalWeight === 100 ? "bg-[#bbf7d0]" : "bg-[#fff7d6]"}`}>
              Total: {totalWeight}%
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {form.components.map((component, index) => (
              <div key={component.local_id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_120px_120px_auto]">
                <Input
                  value={component.component_name}
                  onChange={(event) => updateComponent(component.local_id, { component_name: event.target.value })}
                  placeholder="Component name"
                />
                <Input
                  value={component.weight}
                  onChange={(event) => updateComponent(component.local_id, { weight: event.target.value })}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Weight"
                />
                <Input
                  value={component.display_order}
                  onChange={(event) => updateComponent(component.local_id, { display_order: event.target.value })}
                  type="number"
                  min={1}
                  placeholder={String(index + 1)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => removeComponent(component.local_id)}
                  disabled={form.components.length <= 1}
                  title="Remove component"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={addComponent}>
            <Plus className="size-4 mr-2" /> Add Component
          </Button>
        </section>

        {totalWeight !== 100 ? (
          <p className="text-sm font-semibold text-amber-700">Total weight is currently {totalWeight}%. It should be 100%.</p>
        ) : null}
        {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
      </section>
      <Dialog.Footer>
        <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={isSaving || !options}>
          {isSaving ? "Saving..." : "Save Template"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
