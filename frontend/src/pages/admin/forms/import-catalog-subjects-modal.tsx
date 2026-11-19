import { useEffect, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import type { GradingTemplateListItem, SubjectOfferingFormOptions } from "@/lib/api";
import { TARGET_GRADES } from "../subjects/components/subject-utils";

type CatalogImportDraftRow = {
  subject_code: string;
  subject_name: string;
  grade_level: string;
  grading_template: string;
  description: string;
};

const CATALOG_CSV_HEADERS = [
  "subject_code",
  "subject_name",
  "grade_level",
  "grading_template",
  "description",
] as const;

function parseCsvMatrix(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && next === "\n") i++;
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
}

function parseCatalogImportRows(text: string): CatalogImportDraftRow[] | null {
  const matrix = parseCsvMatrix(text);
  if (matrix.length < 2) return null;
  const header = matrix[0].map((h) => h.trim());
  const isMatchingHeader =
    header.length === CATALOG_CSV_HEADERS.length &&
    CATALOG_CSV_HEADERS.every((expected, idx) => header[idx] === expected);
  if (!isMatchingHeader) return null;

  const parsed: CatalogImportDraftRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((cell) => !cell)) continue;
    parsed.push({
      subject_code: row[0] ?? "",
      subject_name: row[1] ?? "",
      grade_level: row[2] ?? "",
      grading_template: row[3] ?? "",
      description: row[4] ?? "",
    });
  }
  return parsed.length > 0 ? parsed : null;
}

function escapeCsvCell(value: string): string {
  const trimmed = value.trim();
  if (/[",\r\n]/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }
  return trimmed;
}

function buildCatalogCsvFile(rows: CatalogImportDraftRow[], originalName: string): File {
  const lines = [
    CATALOG_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        escapeCsvCell(row.subject_code),
        escapeCsvCell(row.subject_name),
        escapeCsvCell(row.grade_level),
        escapeCsvCell(row.grading_template),
        escapeCsvCell(row.description),
      ].join(","),
    ),
  ];
  return new File([lines.join("\n") + "\n"], originalName || "subject_catalog_import.csv", {
    type: "text/csv",
  });
}

export function ImportCatalogSubjectsDialog({
  pendingImport,
  isImportingCatalog,
  isImportingOfferings,
  gradingTemplates,
  academicLevels = [],
  onClose,
  onConfirmCatalog,
  onConfirmOfferings,
}: {
  pendingImport: { kind: "catalog" | "offerings"; file: File } | null;
  isImportingCatalog: boolean;
  isImportingOfferings: boolean;
  gradingTemplates: GradingTemplateListItem[];
  academicLevels?: SubjectOfferingFormOptions["academic_levels"];
  onClose: () => void;
  onConfirmCatalog: (file: File) => Promise<void>;
  onConfirmOfferings: (file: File) => Promise<void>;
}) {
  const [catalogRows, setCatalogRows] = useState<CatalogImportDraftRow[] | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!pendingImport || pendingImport.kind !== "catalog") return;
    let active = true;

    pendingImport.file
      .text()
      .then((text) => {
        if (!active) return;
        const parsed = parseCatalogImportRows(text);
        if (!parsed) {
          setCatalogRows(null);
          return;
        }
        const validGrades = new Set(academicLevels.map((lvl) => String(lvl.grade_level)));
        const defaultGrade = academicLevels[0] ? String(academicLevels[0].grade_level) : "";
        const validTemplates = new Map(
          gradingTemplates.map((t) => [t.template_name.toLowerCase(), t.template_name]),
        );
        const defaultTemplate =
          gradingTemplates.find((t) => t.template_name.toLowerCase().includes("core"))?.template_name ??
          gradingTemplates[0]?.template_name ??
          "";

        setCatalogRows(
          parsed.map((row) => {
            const digits = row.grade_level.replace(/\D/g, "");
            const normalizedGrade =
              validGrades.size > 0
                ? validGrades.has(digits)
                  ? digits
                  : defaultGrade || digits
                : digits || row.grade_level;
            const matchedTpl = validTemplates.get(row.grading_template.toLowerCase());
            const normalizedTemplate =
              validTemplates.size > 0
                ? matchedTpl || defaultTemplate || row.grading_template
                : row.grading_template;
            return {
              ...row,
              grade_level: normalizedGrade,
              grading_template: normalizedTemplate,
            };
          }),
        );
      })
      .catch(() => {
        if (!active) return;
        setCatalogRows(null);
      });

    return () => {
      active = false;
    };
  }, [pendingImport, academicLevels, gradingTemplates]);

  if (!pendingImport) return null;

  if (pendingImport.kind === "offerings") {
    return (
      <ConfirmDialog
        open={true}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Import Subject Offerings"
        description="Confirm the selected CSV file before importing."
        confirmLabel={isImportingOfferings ? "Importing..." : "Import"}
        isLoading={isImportingOfferings}
        onConfirm={() => onConfirmOfferings(pendingImport.file)}
      >
        <p className="break-words font-medium">{pendingImport.file.name}</p>
      </ConfirmDialog>
    );
  }

  const updateRow = (index: number, patch: Partial<CatalogImportDraftRow>) => {
    setCatalogRows((current) =>
      current
        ? current.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
        : current,
    );
  };

  const handleImportClick = async () => {
    const fileToSubmit =
      catalogRows && catalogRows.length > 0
        ? buildCatalogCsvFile(catalogRows, pendingImport.file.name)
        : pendingImport.file;
    await onConfirmCatalog(fileToSubmit);
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content size="md" className="max-h-[90vh]">
        <Dialog.Header>
          <span className="font-sans text-xl font-bold">Import Catalog Subjects</span>
        </Dialog.Header>

        <section className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto p-4">
          {catalogRows && catalogRows.length > 0 ? (
            catalogRows.map((row, index) => {
              const isEditing = editingIndex === index;
              return (
                <RetroCard
                  key={index}
                  className="flex w-full flex-col justify-between p-3 shadow-none"
                >
                  {isEditing ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold">Edit Imported Subject</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="p-1.5 shadow-none"
                          aria-label="Done editing subject"
                          onClick={() => setEditingIndex(null)}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Subject Name</label>
                          <Input
                            value={row.subject_name}
                            onChange={(e) => updateRow(index, { subject_name: e.target.value })}
                            placeholder="Subject name"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Subject Code</label>
                          <Input
                            value={row.subject_code}
                            onChange={(e) => updateRow(index, { subject_code: e.target.value })}
                            placeholder="Subject code"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Grade Level</label>
                          <Select
                            value={row.grade_level}
                            onValueChange={(value) => updateRow(index, { grade_level: value })}
                          >
                            <Select.Trigger className="w-full">
                              <Select.Value placeholder="Select grade" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Group>
                                {academicLevels.length > 0
                                  ? academicLevels.map((lvl) => (
                                      <Select.Item key={lvl.academic_level_id} value={String(lvl.grade_level)}>
                                        {lvl.level_name}
                                      </Select.Item>
                                    ))
                                  : [...TARGET_GRADES].map((grade) => (
                                      <Select.Item key={grade} value={String(grade)}>
                                        Grade {grade}
                                      </Select.Item>
                                    ))}
                              </Select.Group>
                            </Select.Content>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold">Grading Template</label>
                          {gradingTemplates.length > 0 ? (
                            <Select
                              value={row.grading_template}
                              onValueChange={(value) => updateRow(index, { grading_template: value })}
                            >
                              <Select.Trigger className="w-full">
                                <Select.Value placeholder="Select template" />
                              </Select.Trigger>
                              <Select.Content>
                                <Select.Group>
                                  {gradingTemplates.map((t) => (
                                    <Select.Item key={t.grading_template_id} value={t.template_name}>
                                      {t.template_name}
                                    </Select.Item>
                                  ))}
                                </Select.Group>
                              </Select.Content>
                            </Select>
                          ) : (
                            <Input
                              value={row.grading_template}
                              onChange={(e) => updateRow(index, { grading_template: e.target.value })}
                              placeholder="Core / Applied / Specialized"
                            />
                          )}
                        </div>
                        <div className="col-span-2 flex flex-col gap-1">
                          <label className="text-xs font-semibold">Description</label>
                          <Input
                            value={row.description}
                            onChange={(e) => updateRow(index, { description: e.target.value })}
                            placeholder="Optional description"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xl font-bold leading-tight truncate">
                            {row.subject_name || "Untitled Subject"}
                          </p>
                          <p className="text-sm font-semibold">
                            {row.subject_code || "No code"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {row.grade_level ? (
                            <Badge size="sm" variant="secondary">
                              Grade {row.grade_level}
                            </Badge>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="p-1.5 shadow-none"
                            aria-label={`Edit ${row.subject_name || "subject"}`}
                            onClick={() => setEditingIndex(index)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-row items-center justify-between gap-2 text-xs">
                        <span className="font-medium">{row.grading_template || "No template"}</span>
                        {row.description ? (
                          <span className="truncate text-muted-foreground">{row.description}</span>
                        ) : null}
                      </div>
                    </>
                  )}
                </RetroCard>
              );
            })
          ) : (
            <p className="break-words text-sm font-medium">{pendingImport.file.name}</p>
          )}
        </section>

        <Dialog.Footer>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isImportingCatalog}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isImportingCatalog}
            onClick={() => void handleImportClick()}
          >
            {isImportingCatalog ? "Importing..." : "Import"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default ImportCatalogSubjectsDialog;
