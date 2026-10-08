import { useEffect, useState } from "react";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { useToast } from "@/components/retroui/use-toast";
import { RubricLevelFields } from "@/components/rubric-level-fields";
import { activityRubricMaximum, defaultActivityRubric, validateActivityRubric } from "@/lib/classwork-utils";
import {
  copyRubricLevels,
  deleteRubricTemplate,
  duplicateRubricTemplate,
  listRubricTemplates,
  saveRubricTemplate,
  type RubricTemplate,
} from "@/lib/rubric-templates";
import type { ActivityRubricLevel } from "@/types/classwork";

type View = "list" | "form" | "preview" | "replace" | "delete";
type Props = {
  mode: "choose" | "save";
  currentLevels: ActivityRubricLevel[];
  onApply: (levels: ActivityRubricLevel[]) => void;
  onClose: () => void;
};

function sameAsDefaults(levels: ActivityRubricLevel[]) {
  return JSON.stringify(copyRubricLevels(levels)) === JSON.stringify(copyRubricLevels(defaultActivityRubric));
}

export function RubricTemplateDialog({ mode, currentLevels, onApply, onClose }: Props) {
  const toast = useToast();
  const [templates, setTemplates] = useState<RubricTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"system" | "mine">(mode === "save" ? "mine" : "system");
  const [view, setView] = useState<View>(mode === "save" ? "form" : "list");
  const [previewFromForm, setPreviewFromForm] = useState(false);
  const [selected, setSelected] = useState<RubricTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [levels, setLevels] = useState<ActivityRubricLevel[]>(() =>
    copyRubricLevels(mode === "save" ? currentLevels : defaultActivityRubric),
  );

  useEffect(() => {
    let active = true;
    listRubricTemplates()
      .then((items) => { if (active) setTemplates(items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load rubric templates."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openForm = (template?: RubricTemplate) => {
    setSelected(template ?? null);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setLevels(copyRubricLevels(template?.levels ?? defaultActivityRubric));
    setError("");
    setView("form");
  };

  const save = async () => {
    const cleanName = name.trim();
    const validation = !cleanName ? "Template name is required."
      : cleanName.length > 100 ? "Template name must be 100 characters or fewer."
        : description.length > 300 ? "Description must be 300 characters or fewer."
          : activityRubricMaximum(levels) > 999999.99 ? "Maximum score must be at most 999999.99."
            : validateActivityRubric(levels);
    if (validation) { setError(validation); return; }
    setBusy(true);
    setError("");
    try {
      const saved = await saveRubricTemplate({ name: cleanName, description: description.trim(), levels }, selected?.rubric_template_id);
      setTemplates((current) => [saved, ...current.filter((item) => item.rubric_template_id !== saved.rubric_template_id)]);
      toast.success({ title: selected ? "Template updated" : "Template created" });
      if (mode === "save") onClose();
      else { setSelected(null); setTab("mine"); setView("list"); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save rubric template.";
      setError(message);
      toast.error({ title: "Template not saved", description: message });
    } finally { setBusy(false); }
  };

  const duplicate = async (template: RubricTemplate) => {
    setBusy(true);
    try {
      const copied = await duplicateRubricTemplate(template.rubric_template_id);
      setTemplates((current) => [copied, ...current]);
      setTab("mine");
      setView("list");
      toast.success({ title: "Template duplicated" });
    } catch (cause) {
      toast.error({ title: "Unable to duplicate template", description: cause instanceof Error ? cause.message : undefined });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!selected || selected.is_system) return;
    setBusy(true);
    try {
      await deleteRubricTemplate(selected.rubric_template_id);
      setTemplates((current) => current.filter((item) => item.rubric_template_id !== selected.rubric_template_id));
      setSelected(null);
      setView("list");
      toast.success({ title: "Template deleted" });
    } catch (cause) {
      toast.error({ title: "Unable to delete template", description: cause instanceof Error ? cause.message : undefined });
    } finally { setBusy(false); }
  };

  const apply = (template: RubricTemplate) => {
    setSelected(template);
    if (currentLevels.length > 0 && !sameAsDefaults(currentLevels)) {
      setView("replace");
      return;
    }
    onApply(copyRubricLevels(template.levels));
    onClose();
  };

  const visible = templates.filter((template) => tab === "system" ? template.is_system : !template.is_system);
  const title = view === "form" ? selected ? "Edit Rubric Template" : "Create Rubric Template"
    : view === "preview" ? "Preview Rubric Template"
      : view === "replace" ? "Replace Current Rubric?"
        : view === "delete" ? "Delete Rubric Template?" : "Choose Rubric Template";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content
        size="2xl"
        data-rubric-template-dialog
        className="max-h-[90dvh] p-0"
        portalContainer={typeof document === "undefined" ? undefined : document.body}
        style={{ zIndex: 1001 }}
        overlay={{ forceRender: true, style: { zIndex: 1000, backgroundColor: "rgb(0 0 0 / 0.6)", pointerEvents: "auto" } }}
      >
        <Dialog.Header asChild>
          <div className="flex w-full items-center justify-between">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            <Tooltip>
              <TooltipTrigger render={<button type="button" onClick={onClose} className={dialogHeaderCloseButtonClassName} aria-label="Close modal"><X className="size-4" /></button>} />
              <TooltipContent>Close modal</TooltipContent>
            </Tooltip>
          </div>
        </Dialog.Header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <Dialog.Description className="text-sm text-muted-foreground">
            {view === "form" ? "Save a reusable set of performance levels."
              : view === "replace" ? "Using this template will replace the current unsaved rubric."
                : view === "delete" ? "This personal template will be permanently removed."
                  : "Choose a template to fill the current rubric without saving the classwork."}
          </Dialog.Description>

          {view === "list" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2" role="tablist" aria-label="Template types">
                  <Button type="button" size="sm" variant={tab === "system" ? "default" : "outline"} role="tab" aria-selected={tab === "system"} onClick={() => setTab("system")}>System Templates</Button>
                  <Button type="button" size="sm" variant={tab === "mine" ? "default" : "outline"} role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>My Templates</Button>
                </div>
                <Button type="button" size="sm" onClick={() => openForm()}><Plus /> Create Template</Button>
              </div>
              {loading && <p className="text-sm text-muted-foreground">Loading templates…</p>}
              {error && !loading && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={() => { setLoading(true); setError(""); listRubricTemplates().then(setTemplates).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load templates.")).finally(() => setLoading(false)); }}>Retry</Button></div>}
              {!loading && !error && visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{tab === "mine" ? "No personal templates yet. Create one to reuse it later." : "No system templates are available."}</p>}
              {!loading && !error && <div className="grid gap-3 md:grid-cols-2">
                {visible.map((template) => (
                  <Card key={template.rubric_template_id} className="block min-w-0 p-4 shadow-none hover:shadow-none">
                    <div className="flex items-start justify-between gap-2"><Card.Title className="min-w-0 text-base">{template.name}</Card.Title><Badge size="sm" variant={template.is_system ? "secondary" : "outline"}>{template.is_system ? "System" : "Mine"}</Badge></div>
                    <Card.Description className="mt-1 text-sm">{template.description || "Reusable performance levels."}</Card.Description>
                    <p className="mt-3 text-xs text-muted-foreground">{template.levels.length} levels · Maximum {activityRubricMaximum(template.levels)} points</p>
                    <div className="mt-2 flex flex-wrap gap-1">{template.levels.map((level) => <Badge key={level.level_name} size="sm" variant="outline">{level.level_name}: {level.points}</Badge>)}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => { setSelected(template); setPreviewFromForm(false); setView("preview"); }}>Preview</Button>
                      <Button type="button" size="sm" onClick={() => apply(template)}>Use Template</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void duplicate(template)}><Copy /> Duplicate</Button>
                      {!template.is_system && <><Button type="button" size="sm" variant="outline" onClick={() => openForm(template)}><Pencil /> Edit</Button><Button type="button" size="sm" variant="destructive" onClick={() => { setSelected(template); setView("delete"); }}><Trash2 /> Delete</Button></>}
                    </div>
                  </Card>
                ))}
              </div>}
            </>
          )}

          {view === "form" && <div className="space-y-4">
            <label className="block text-sm font-semibold">Template name<Input className="mt-1 w-full" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="block text-sm font-semibold">Short description<textarea className="mt-1 min-h-16 w-full border-2 border-border bg-background px-3 py-2 text-sm" maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <RubricLevelFields levels={levels} onChange={setLevels} disabled={busy} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>}

          {view === "preview" && <div className="space-y-4">
            <div><h3 className="text-lg font-bold">{previewFromForm ? name || "New template" : selected?.name}</h3><p className="text-sm text-muted-foreground">{previewFromForm ? description : selected?.description}</p></div>
            <p className="text-sm font-semibold">Maximum score: {activityRubricMaximum(previewFromForm ? levels : selected?.levels ?? [])} points</p>
            <div className="grid gap-2 sm:grid-cols-2">{(previewFromForm ? levels : selected?.levels ?? []).map((level) => <Card key={level.level_name} className="block p-3 shadow-none hover:shadow-none"><div className="flex justify-between gap-2 font-bold"><span>{level.level_name}</span><span>{level.points} pts</span></div><p className="mt-2 text-sm text-muted-foreground">{level.description}</p></Card>)}</div>
          </div>}
        </div>
        {view !== "list" && (
          <Dialog.Footer className="mt-0">
            {view === "form" && <>
              <Button type="button" size="sm" variant="outline" onClick={() => { setError(""); setView("list"); }}>Back</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setPreviewFromForm(true); setView("preview"); }}>Preview</Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Template"}</Button>
            </>}
            {view === "preview" && <>
              <Button type="button" size="sm" variant="outline" onClick={() => setView(previewFromForm ? "form" : "list")}>Back</Button>
              {selected && !previewFromForm && <Button type="button" size="sm" onClick={() => apply(selected)}>Use Template</Button>}
            </>}
            {view === "replace" && selected && <>
              <Button type="button" size="sm" variant="outline" onClick={() => setView("list")}>Keep Current Rubric</Button>
              <Button type="button" size="sm" onClick={() => { onApply(copyRubricLevels(selected.levels)); onClose(); }}>Replace Rubric</Button>
            </>}
            {view === "delete" && selected && <>
              <Button type="button" size="sm" variant="outline" onClick={() => setView("list")}>Cancel</Button>
              <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete Template"}</Button>
            </>}
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog>
  );
}
