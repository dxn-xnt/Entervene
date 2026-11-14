import { useEffect, useState } from "react";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { NoChangesMessage } from "@/components/retroui/FormMessage";
import { BookOpenCheck, Copy, ExternalLink, Library, MoreVertical, Pencil, Plus, Trash2, UserRound, X } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import {
  Dialog,
  dialogHeaderCloseButtonClassName,
} from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { useToast } from "@/components/retroui/Toast";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RubricLevelFields } from "@/components/rubric-level-fields";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import { LoadingPanel } from "@/components/loading-panel";
import {
  activityRubricMaximum,
  defaultActivityRubric,
  rubricPointRange,
  validateActivityRubric,
} from "@/lib/classwork-utils";
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

const templateTabs: TabItem<"system" | "mine">[] = [
  { id: "system", label: "System Templates", icon: Library },
  { id: "mine", label: "My Templates", icon: UserRound },
];

type Props = {
  mode: "choose" | "save";
  currentLevels: ActivityRubricLevel[];
  onApply: (levels: ActivityRubricLevel[], templateName?: string) => void;
  onClose: () => void;
};

function sameAsDefaults(levels: ActivityRubricLevel[]) {
  return (
    JSON.stringify(copyRubricLevels(levels)) ===
    JSON.stringify(copyRubricLevels(defaultActivityRubric))
  );
}

export function RubricTemplateDialog({
  mode,
  currentLevels,
  onApply,
  onClose,
}: Props) {
  const toast = useToast();
  const [templates, setTemplates] = useState<RubricTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"system" | "mine">(
    mode === "save" ? "mine" : "system",
  );
  const [view, setView] = useState<View>(mode === "save" ? "form" : "list");
  const [previewFromForm, setPreviewFromForm] = useState(false);
  const [selected, setSelected] = useState<RubricTemplate | null>(null);
  const [name, setName] = useState("");
  const [levels, setLevels] = useState<ActivityRubricLevel[]>(() =>
    copyRubricLevels(mode === "save" ? currentLevels : defaultActivityRubric),
  );

  useEffect(() => {
    let active = true;
    listRubricTemplates()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load rubric templates.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const openForm = (template?: RubricTemplate) => {
    setSelected(template ?? null);
    setName(template?.name ?? "");
    setLevels(copyRubricLevels(template?.levels ?? defaultActivityRubric));
    setError("");
    setView("form");
  };

  const changes = useEditFormChanges({
    enabled: !!selected,
    resetKey: `${view}:${selected?.rubric_template_id}`,
    initialValues: [selected?.name.trim(), selected ? copyRubricLevels(selected.levels) : []],
    values: [name.trim(), copyRubricLevels(levels)],
  });
  const save = async () => {
    if (!changes.guardChanges()) return;
    const cleanName = name.trim();
    const validation = !cleanName
      ? "Template name is required."
      : cleanName.length > 100
        ? "Template name must be 100 characters or fewer."
        : activityRubricMaximum(levels) > 999999.99
          ? "Maximum score must be at most 999999.99."
          : validateActivityRubric(levels);

    if (validation) {
      setError(validation);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const saved = await saveRubricTemplate(
        { name: cleanName, description: "", levels },
        selected?.rubric_template_id,
      );
      setTemplates((current) => [
        saved,
        ...current.filter(
          (item) => item.rubric_template_id !== saved.rubric_template_id,
        ),
      ]);
      toast.success({
        title: selected ? "Template updated" : "Template created",
      });
      if (mode === "save") {
        onClose();
      } else {
        setSelected(null);
        setTab("mine");
        setView("list");
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unable to save rubric template.";
      setError(message);
      toast.error({ title: "Template not saved", description: message });
    } finally {
      setBusy(false);
    }
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
      toast.error({
        title: "Unable to duplicate template",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || selected.is_system) return;
    setBusy(true);
    try {
      await deleteRubricTemplate(selected.rubric_template_id);
      setTemplates((current) =>
        current.filter(
          (item) => item.rubric_template_id !== selected.rubric_template_id,
        ),
      );
      setSelected(null);
      setView("list");
      toast.success({ title: "Template deleted" });
    } catch (cause) {
      toast.error({
        title: "Unable to delete template",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const apply = (template: RubricTemplate) => {
    setSelected(template);
    if (currentLevels.length > 0 && !sameAsDefaults(currentLevels)) {
      setView("replace");
      return;
    }
    onApply(copyRubricLevels(template.levels), template.name);
    onClose();
  };

  const visible = templates.filter((template) =>
    tab === "system" ? template.is_system : !template.is_system,
  );

  const title =
    view === "form"
      ? selected
        ? "Edit Rubric Template"
        : "Create Rubric Template"
      : view === "preview"
        ? "Preview Rubric Template"
        : view === "replace"
          ? "Replace Current Rubric?"
          : view === "delete"
            ? "Delete Rubric Template?"
            : "Choose Rubric Template";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        size={view === "list" ? "xl" : "2xl"}
        data-rubric-template-dialog
        className="max-h-[90dvh] p-0"
        portalContainer={typeof document === "undefined" ? undefined : document.body}
        style={{ zIndex: 1001 }}
        overlay={{
          forceRender: true,
          style: {
            zIndex: 1000,
            backgroundColor: "rgb(0 0 0 / 0.6)",
            pointerEvents: "auto",
          },
        }}
      >
        <Dialog.Header asChild>
          <div className="flex w-full items-center justify-between">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onClose}
                    className={dialogHeaderCloseButtonClassName}
                    aria-label="Close modal"
                  >
                    <X className="size-4" />
                  </button>
                }
              />
              <TooltipContent>Close modal</TooltipContent>
            </Tooltip>
          </div>
        </Dialog.Header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {view === "list" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h3 className="text-base font-bold">Choose a scoring guide</h3>
                  <p className="text-sm text-muted-foreground">
                    Preview a rubric before applying it, or create one for future assignments.
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => openForm()}>
                  <Plus /> Create Template
                </Button>
              </div>

              <div className="border-b-2 border-border">
                  <Tabs
                    tabs={templateTabs}
                    activeTab={tab}
                    onTabChange={setTab}
                    counts={{
                      system: templates.filter((template) => template.is_system).length,
                      mine: templates.filter((template) => !template.is_system).length,
                    }}
                    className="!mx-0 !border-b-0"
                    tabClassName="rounded-t!"
                  />
              </div>

              {loading && (
                <LoadingPanel
                  label="Loading rubric templates…"
                  className="rounded! shadow-none"
                />
              )}

              {error && !loading && (
                <Alert status="error" className="space-y-3">
                  <div>
                    <Alert.Title>Templates could not be loaded</Alert.Title>
                    <Alert.Description>{error}</Alert.Description>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setLoading(true);
                      setError("");
                      listRubricTemplates()
                        .then(setTemplates)
                        .catch((cause: unknown) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "Unable to load templates.",
                          ),
                        )
                        .finally(() => setLoading(false));
                    }}
                  >
                    Retry
                  </Button>
                </Alert>
              )}

              {!loading && !error && visible.length === 0 && (
                <TeacherEmptyState
                  compact
                  className="mt-0 rounded! shadow-none hover:shadow-none"
                  icon={<BookOpenCheck />}
                  title={tab === "mine" ? "No personal templates yet" : "No system templates available"}
                  description={tab === "mine" ? "Create a template to reuse in future classwork." : "System rubric templates will appear here when available."}
                  action={tab === "mine" ? { label: "Create Template", onClick: () => openForm(), icon: <Plus /> } : undefined}
                />
              )}

              {!loading && !error && visible.length > 0 && (
                <div className={`grid gap-4 ${visible.length === 1 ? "grid-cols-1" : "md:grid-cols-2"}`}>
                  {visible.map((template) => (
                    <Card
                      key={template.rubric_template_id}
                      className="flex min-w-0 flex-col border-2 border-border p-4 shadow-md hover:-translate-y-0.5 hover:shadow-none"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center border-2 border-border bg-primary" aria-hidden="true">
                            <BookOpenCheck className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <Card.Title className="truncate text-base">
                              {template.name}
                            </Card.Title>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge size="sm" variant="secondary">
                                {template.is_system ? "System" : "Custom"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {template.levels.length} levels · {activityRubricMaximum(template.levels)} points
                              </span>
                            </div>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="size-8 shrink-0 p-0 shadow-none"
                              aria-label={`Options for ${template.name}`}
                            >
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="z-[1100] min-w-[140px] border-2 border-black bg-white p-1 rounded font-semibold text-xs shadow-md"
                          >
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => void duplicate(template)}
                              className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                            >
                              <Copy className="size-3.5" />
                              <span>Duplicate</span>
                            </DropdownMenuItem>
                            {!template.is_system && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => openForm(template)}
                                  className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                                >
                                  <Pencil className="size-3.5" />
                                  <span>Edit</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelected(template);
                                    setView("delete");
                                  }}
                                  className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-red-50 text-destructive"
                                >
                                  <Trash2 className="size-3.5" />
                                  <span>Delete</span>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
                        {template.levels.map((level) => (
                          <div
                            key={level.level_name}
                            className="flex min-w-0 items-center justify-between gap-2 rounded! border-2 border-border bg-background px-2.5 py-1.5 text-xs"
                          >
                            <span className="truncate font-semibold">{level.level_name}</span>
                            <span className="shrink-0 font-bold">
                              {rubricPointRange(level.points, template.levels.map((item) => item.points))}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t-2 border-border pt-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="sm:min-w-28"
                          onClick={() => {
                            setSelected(template);
                            setPreviewFromForm(false);
                            setView("preview");
                          }}
                        >
                          <ExternalLink />
                          Preview
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="sm:min-w-36"
                          disabled={busy}
                          onClick={() => apply(template)}
                        >
                          <BookOpenCheck />
                          Use Template
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "form" && (
            <div className="space-y-4">
              <label className="block text-sm font-semibold">
                Template Name
                <Input
                  className="mt-1 w-full"
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <RubricLevelFields
                levels={levels}
                onChange={setLevels}
                disabled={busy}
              />

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          {view === "preview" && (
            <div className="space-y-4">
              <RubricsScoreBoard
                title={
                  previewFromForm
                    ? name || "New template"
                    : selected?.name || "Scoring Rubric"
                }
                totalPoints={activityRubricMaximum(
                  previewFromForm ? levels : selected?.levels ?? [],
                )}
                rubricLevels={previewFromForm ? levels : selected?.levels ?? []}
              />
            </div>
          )}
        </div>

        {view !== "list" && (
          <Dialog.Footer className="mt-0 flex w-full items-center justify-between gap-2">
            <NoChangesMessage message={changes.noChangesMessage} />
            {view === "form" && (
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setError("");
                    setView("list");
                  }}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPreviewFromForm(true);
                      setView("preview");
                    }}
                  >
                    <ExternalLink />
                    Preview
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || (!!selected && !changes.hasChanges)}
                    onClick={() => void save()}
                  >
                    {busy ? "Saving…" : "Save Template"}
                  </Button>
                </div>
              </div>
            )}

            {view === "preview" && (
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setView(previewFromForm ? "form" : "list")}
                >
                  Back
                </Button>
                <div>
                  {selected && !previewFromForm && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => apply(selected)}
                    >
                      <BookOpenCheck />
                      Use Template
                    </Button>
                  )}
                </div>
              </div>
            )}

            {view === "replace" && selected && (
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setView("list")}
                >
                  Keep Current Rubric
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onApply(copyRubricLevels(selected.levels), selected.name);
                    onClose();
                  }}
                >
                  Replace Rubric
                </Button>
              </div>
            )}

            {view === "delete" && selected && (
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setView("list")}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {busy ? "Deleting…" : "Delete Template"}
                </Button>
              </div>
            )}
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog>
  );
}
