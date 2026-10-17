import { useEffect, useState } from "react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { createOfficialSection, getOfficialSections, updateOfficialSection, type AcademicPathwayRead, type PathwayScopeRead } from "@/lib/api";
import type { OfficialSectionOption } from "@/types/adminClasses";
import type { AcademicLevelSettingItem } from "@/lib/settings-api";

export default function OfficialSectionsSettings({ academicYearId, levels, pathways, pathwayScopes }: {
  academicYearId: number;
  levels: AcademicLevelSettingItem[];
  pathways: AcademicPathwayRead[];
  pathwayScopes: PathwayScopeRead[];
}) {
  const [levelId, setLevelId] = useState("");
  const [sections, setSections] = useState<OfficialSectionOption[]>([]);
  const [name, setName] = useState("");
  const [pathwayId, setPathwayId] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!levelId && levels.length) setLevelId(String(levels[0].academic_level_id));
  }, [levelId, levels]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getOfficialSections(academicYearId).then((rows) => {
      if (!cancelled) setSections(rows);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load official sections.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [academicYearId]);

  const selectedLevel = levels.find((level) => String(level.academic_level_id) === levelId);
  const requiresPathway = pathwayScopes.find((scope) => scope.academic_level_id === Number(levelId))?.requires_pathway ?? selectedLevel?.grade_level === 11;
  const gradeSections = sections.filter((section) => section.academic_level_id === Number(levelId));
  const enabledPathways = pathways.filter((pathway) => pathway.is_enabled);

  function resetDraft() {
    setEditingId(null);
    setName("");
    setPathwayId("");
  }

  async function save() {
    if (!levelId || !name.trim() || (requiresPathway && !pathwayId) || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (editingId != null) {
        const updated = await updateOfficialSection(editingId, { section_name: name.trim(), pathway_id: requiresPathway ? Number(pathwayId) : null });
        setSections((current) => current.map((item) => item.id === editingId ? updated : item));
        setSuccess("Official section updated.");
      } else {
        const created = await createOfficialSection({ academic_year_id: academicYearId, academic_level_id: Number(levelId), section_name: name.trim(), pathway_id: requiresPathway ? Number(pathwayId) : null });
        setSections((current) => [...current, created]);
        setSuccess("Official section added.");
      }
      resetDraft();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to save official section.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(section: OfficialSectionOption) {
    setError("");
    setSuccess("");
    try {
      const updated = await updateOfficialSection(section.id, { is_active: !section.is_active });
      setSections((current) => current.map((item) => item.id === section.id ? updated : item));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to update official section.");
    }
  }

  return (
    <Card className="w-full">
      <Card.Header><Card.Title>Official Sections</Card.Title></Card.Header>
      <Card.Content className="grid gap-4">
        <Text as="p" className="text-sm text-muted-foreground">Maintain approved section choices for the configuration year above. Used sections cannot be renamed, remapped, or deactivated.</Text>
        <div className="grid gap-1 sm:max-w-xs">
          <Text as="p" className="text-sm font-semibold">Grade level</Text>
          <Select value={levelId} onValueChange={(value) => { setLevelId(value); resetDraft(); }}>
            <Select.Trigger><Select.Value placeholder="Select grade" /></Select.Trigger>
            <Select.Content><Select.Group>{levels.map((level) => <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>{level.level_name}</Select.Item>)}</Select.Group></Select.Content>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1 text-sm font-semibold">Section name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Official school name" disabled={saving} /></label>
          {requiresPathway ? (
            <div className="grid gap-1 text-sm font-semibold">Pathway
              <Select value={pathwayId} onValueChange={setPathwayId} disabled={saving}>
                <Select.Trigger><Select.Value placeholder="Select pathway" /></Select.Trigger>
                <Select.Content><Select.Group>{enabledPathways.map((pathway) => <Select.Item key={pathway.id} value={String(pathway.id)}>{pathway.name}</Select.Item>)}</Select.Group></Select.Content>
              </Select>
            </div>
          ) : <Text as="p" className="pb-2 text-xs text-muted-foreground">No pathway required for this grade in the selected year.</Text>}
          <Button onClick={() => void save()} disabled={saving || !name.trim() || (requiresPathway && !pathwayId)}>{editingId == null ? "Add Section" : "Save Section"}</Button>
        </div>
        {editingId != null && <Button variant="outline" className="w-fit" onClick={resetDraft}>Cancel edit</Button>}
        {error && <Text as="p" className="text-sm text-destructive">{error}</Text>}
        {success && <Text as="p" className="text-sm text-primary">{success}</Text>}
        {loading ? <Text as="p">Loading sections...</Text> : !gradeSections.length ? <Text as="p" className="text-sm text-muted-foreground">No official sections configured for this grade and academic year.</Text> : (
          <div className="grid gap-2">
            {gradeSections.map((section) => <div key={section.id} className="flex flex-wrap items-center justify-between gap-2 border-2 border-border p-2 text-sm">
              <div><b>{section.section_name}</b>{section.pathway_name ? ` — ${section.pathway_name}` : ""}<span className="ml-2 text-xs text-muted-foreground">{section.is_active ? "Active" : "Inactive"}{section.has_class ? " · In use" : ""}</span></div>
              {!section.has_class && <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditingId(section.id); setName(section.section_name); setPathwayId(section.pathway_id == null ? "" : String(section.pathway_id)); }}>Edit</Button>
                <Button size="sm" variant="outline" onClick={() => void toggle(section)}>{section.is_active ? "Deactivate" : "Activate"}</Button>
              </div>}
            </div>)}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
