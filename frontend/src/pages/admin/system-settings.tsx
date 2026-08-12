import * as React from "react";
import { Card } from "@/components/retroui/Card";
import { Text } from "@/components/retroui/Text";
import AppLayout from "@/layouts/app-layout";
import { useNavigate } from "react-router-dom";
import { Select } from "@/components/retroui/Select";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Dialog } from "@/components/retroui/Dialog";
import { Switch } from "@/components/retroui/Switch";
import { Progress } from "@/components/retroui/Progress";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { ArrowUpRight, Lock, Pencil, Loader2 } from "lucide-react";
import AddAcademicPeriodModal from "./forms/add-academic-period";

import { getAllSettings, updateSetting, type GroupedSettings } from "@/lib/settings-api";
import { useSettings } from "@/context/SettingsContext";
import { getGradingTemplates, createGradingTemplate } from "@/lib/api";
import {
  getSubjectGroups,
  createSubjectGroup,
  updateSubjectGroup,
  deactivateSubjectGroup,
  type SubjectGroupRead,
  type AffectedSubject,
} from "@/lib/subject-groups-api";

function Pill({
  children,
  tone = "default",
  locked = false,
}: {
  children: React.ReactNode;
  tone?: "default" | "green" | "blue" | "yellow" | "gray";
  locked?: boolean;
}) {
  const variantMap: Record<
    string,
    "default" | "secondary" | "outline" | "solid" | "surface"
  > = {
    default: "outline",
    green: "secondary",
    blue: "surface",
    yellow: "secondary",
    gray: "default",
  };
  return (
    <Badge
      size="sm"
      variant={variantMap[tone] || "default"}
      className="inline-flex items-center gap-1"
    >
      {locked && <Lock className="w-3 h-3" />}
      {children}
    </Badge>
  );
}

/* ---------------------------------------------------------------- */
/* Data                                                              */
/* ---------------------------------------------------------------- */

type Template = {
  name: string;
  ww: number;
  pt: number;
  qa: number;
  scope: string;
};

const DEFAULT_TEMPLATES: Template[] = [
  {
    name: "JHS Enhanced Academic",
    ww: 40,
    pt: 40,
    qa: 20,
    scope: "JHS enhanced subjects",
  },
  {
    name: "JHS Language / Social Studies",
    ww: 30,
    pt: 50,
    qa: 20,
    scope: "English, Filipino, AP, similar",
  },
  {
    name: "JHS Performance-Based",
    ww: 20,
    pt: 60,
    qa: 20,
    scope: "MAPEH, technology, output-heavy",
  },
  { name: "SHS Core Subject", ww: 25, pt: 50, qa: 25, scope: "Core subjects" },
  {
    name: "SHS Academic Elective",
    ww: 25,
    pt: 45,
    qa: 30,
    scope: "STEM Medical / Engineering electives",
  },
  {
    name: "SHS Work Immersion / Field Exposure",
    ww: 35,
    pt: 40,
    qa: 25,
    scope: "Work immersion, field exposure",
  },
];

const ACADEMIC_LEVELS = [
  { level: "Grade 7", stage: "Junior High" },
  { level: "Grade 8", stage: "Junior High" },
  { level: "Grade 9", stage: "Junior High" },
  { level: "Grade 10", stage: "Junior High" },
  { level: "Grade 11", stage: "Senior High" },
  { level: "Grade 12", stage: "Senior High" },
];

const TERM_LABELS: Record<string, string> = {
  "1": "Term 1",
  "2": "Term 2",
  "3": "Term 3",
};

/* ---------------------------------------------------------------- */
/* Main component                                                    */
/* ---------------------------------------------------------------- */

export default function AdminSystemSettings() {
  const navigate = useNavigate();
  const { refetch: refetchGlobalSettings } = useSettings();

  // Loading state
  const [isLoadingSettings, setIsLoadingSettings] = React.useState(true);
  const [isSavingThresholds, setIsSavingThresholds] = React.useState(false);
  const [isSavingScope, setIsSavingScope] = React.useState(false);

  // Passing grade thresholds
  const [subjectPassing, setSubjectPassing] = React.useState("80");
  const [averagePassing, setAveragePassing] = React.useState("80");

  // Academic calendar
  const [schoolYear, setSchoolYear] = React.useState("AP26-27");
  const [activeTerm, setActiveTerm] = React.useState("1");
  const [pendingTerm, setPendingTerm] = React.useState<string | null>(null);

  // Curriculum scope
  const [jhsEnabled, setJhsEnabled] = React.useState(true);
  const [shsEnabled, setShsEnabled] = React.useState(true);
  const [medicalEnabled, setMedicalEnabled] = React.useState(true);
  const [engineeringEnabled, setEngineeringEnabled] = React.useState(true);

  // Grading templates
  const [templates, setTemplates] =
    React.useState<Template[]>(DEFAULT_TEMPLATES);
  const [templateModalOpen, setTemplateModalOpen] = React.useState(false);
  const [tplName, setTplName] = React.useState("");
  const [tplWw, setTplWw] = React.useState("25");
  const [tplPt, setTplPt] = React.useState("45");
  const [tplQa, setTplQa] = React.useState("30");
  const [tplError, setTplError] = React.useState<string | null>(null);

  // Toast
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 2400);
  };

  // Subject Groups state
  const [subjectGroups, setSubjectGroups] = React.useState<SubjectGroupRead[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = React.useState(false);
  const [isAddGroupOpen, setIsAddGroupOpen] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState("");
  const [newGroupThreshold, setNewGroupThreshold] = React.useState("83");
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [deactivateErrorDialog, setDeactivateErrorDialog] = React.useState<{
    message: string;
    affectedSubjects: AffectedSubject[];
  } | null>(null);

  const loadSubjectGroups = React.useCallback(async () => {
    setIsLoadingGroups(true);
    try {
      const res = await getSubjectGroups();
      setSubjectGroups(res.groups || []);
    } catch (err) {
      console.error("Failed to load subject groups", err);
    } finally {
      setIsLoadingGroups(false);
    }
  }, []);

  // Load Settings from Backend API
  const loadSettingsFromBackend = React.useCallback(async () => {
    setIsLoadingSettings(true);
    try {
      const data: GroupedSettings = await getAllSettings();
      const flatSettings: Record<string, string> = {};
      Object.values(data.groups || {}).forEach((items) => {
        items.forEach((item) => {
          flatSettings[item.key] = item.value;
        });
      });

      if (flatSettings["general_average_passing_grade"]) setAveragePassing(flatSettings["general_average_passing_grade"]);
      if (flatSettings["current_school_year"]) setSchoolYear(flatSettings["current_school_year"]);
      if (flatSettings["active_term"]) setActiveTerm(flatSettings["active_term"]);
      if (flatSettings["jhs_enabled"]) setJhsEnabled(flatSettings["jhs_enabled"] === "true");
      if (flatSettings["shs_enabled"]) setShsEnabled(flatSettings["shs_enabled"] === "true");
      if (flatSettings["medical_pathway_enabled"]) setMedicalEnabled(flatSettings["medical_pathway_enabled"] === "true");
      if (flatSettings["engineering_pathway_enabled"]) setEngineeringEnabled(flatSettings["engineering_pathway_enabled"] === "true");

      // Fetch dynamic grading templates from DB
      try {
        const templatesRes = await getGradingTemplates({ status: "active" });
        const list = templatesRes.grading_templates || [];
        if (list.length > 0) {
          const mappedTemplates: Template[] = list.map((gt) => {
            const wwComp = gt.components.find((c) => c.component_name.toLowerCase().includes("written"))?.weight ?? 0;
            const ptComp = gt.components.find((c) => c.component_name.toLowerCase().includes("performance"))?.weight ?? 0;
            const qaComp = gt.components.find((c) => 
              c.component_name.toLowerCase().includes("quarter") || 
              c.component_name.toLowerCase().includes("term") || 
              c.component_name.toLowerCase().includes("exam")
            )?.weight ?? 0;
            return {
              name: gt.template_name,
              ww: wwComp,
              pt: ptComp,
              qa: qaComp,
              scope: gt.description || "Database Template",
            };
          });
          setTemplates(mappedTemplates);
        }
      } catch {
        // Fallback to default templates if table empty or unseeded
      }
    } catch {
      // Graceful fallback to default state if backend settings are missing/unseeded
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  React.useEffect(() => {
    loadSettingsFromBackend();
    loadSubjectGroups();
  }, [loadSettingsFromBackend, loadSubjectGroups]);

  const saveSingleSetting = async (key: string, value: string) => {
    try {
      await updateSetting(key, value);
      await refetchGlobalSettings();
    } catch (err) {
      console.error(`Failed to update setting ${key}:`, err);
    }
  };

  const handleSaveThresholds = async () => {
    setIsSavingThresholds(true);
    try {
      await saveSingleSetting("general_average_passing_grade", averagePassing);
      showToast("General average threshold saved");
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const handleUpdateGroupThreshold = async (groupId: number, passingThreshold: number) => {
    try {
      await updateSubjectGroup(groupId, { passing_threshold: passingThreshold });
      showToast("Subject group passing threshold updated");
      await loadSubjectGroups();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update threshold");
    }
  };

  const handleToggleGroupActive = async (groupId: number, currentActive: boolean) => {
    if (currentActive) {
      // Try deactivating
      try {
        await deactivateSubjectGroup(groupId);
        showToast("Subject group deactivated");
        await loadSubjectGroups();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "affectedSubjects" in err) {
          const customErr = err as Error & { affectedSubjects: AffectedSubject[] };
          setDeactivateErrorDialog({
            message: customErr.message,
            affectedSubjects: customErr.affectedSubjects,
          });
        } else {
          showToast(err instanceof Error ? err.message : "Failed to deactivate group");
        }
      }
    } else {
      // Re-activate
      try {
        await updateSubjectGroup(groupId, { is_active: true });
        showToast("Subject group activated");
        await loadSubjectGroups();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to activate group");
      }
    }
  };

  const handleCreateGroup = async () => {
    setGroupError(null);
    if (!newGroupName.trim()) {
      setGroupError("Group name is required.");
      return;
    }
    const val = Number(newGroupThreshold);
    if (isNaN(val) || val < 0 || val > 100) {
      setGroupError("Passing threshold must be between 0 and 100.");
      return;
    }

    try {
      await createSubjectGroup({
        name: newGroupName.trim(),
        passing_threshold: val,
      });
      showToast(`Group "${newGroupName.trim()}" created successfully`);
      setNewGroupName("");
      setNewGroupThreshold("83");
      setIsAddGroupOpen(false);
      await loadSubjectGroups();
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Failed to create group");
    }
  };

  const handleSaveScope = async () => {
    setIsSavingScope(true);
    try {
      await saveSingleSetting("jhs_enabled", jhsEnabled ? "true" : "false");
      await saveSingleSetting("shs_enabled", shsEnabled ? "true" : "false");
      await saveSingleSetting("medical_pathway_enabled", medicalEnabled ? "true" : "false");
      await saveSingleSetting("engineering_pathway_enabled", engineeringEnabled ? "true" : "false");
      showToast("Curriculum scope saved");
    } finally {
      setIsSavingScope(false);
    }
  };

  const ratio = Number(activeTerm) / 3;

  const handleTermChange = (value: string) => setPendingTerm(value);
  const confirmTermChange = async () => {
    if (pendingTerm) {
      setActiveTerm(pendingTerm);
      await saveSingleSetting("active_term", pendingTerm);
      showToast(`Active term changed to ${TERM_LABELS[pendingTerm]}`);
    }
    setPendingTerm(null);
  };

  const openTemplateModal = () => {
    setTplName("");
    setTplWw("25");
    setTplPt("45");
    setTplQa("30");
    setTplError(null);
    setTemplateModalOpen(true);
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

      // Re-fetch dynamic template list from DB
      const templatesRes = await getGradingTemplates({ status: "active" });
      const list = templatesRes.grading_templates || [];
      if (list.length > 0) {
        const mappedTemplates: Template[] = list.map((gt) => {
          const wwComp = gt.components.find((c) => c.component_name.toLowerCase().includes("written"))?.weight ?? 0;
          const ptComp = gt.components.find((c) => c.component_name.toLowerCase().includes("performance"))?.weight ?? 0;
          const qaComp = gt.components.find((c) => 
            c.component_name.toLowerCase().includes("quarter") || 
            c.component_name.toLowerCase().includes("term") || 
            c.component_name.toLowerCase().includes("exam")
          )?.weight ?? 0;
          return {
            name: gt.template_name,
            ww: wwComp,
            pt: ptComp,
            qa: qaComp,
            scope: gt.description || "Database Template",
          };
        });
        setTemplates(mappedTemplates);
      } else {
        setTemplates((prev) => [
          ...prev,
          { name, ww, pt, qa, scope: "Custom template" },
        ]);
      }

      setTemplateModalOpen(false);
      showToast("New grading template saved to database");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save template";
      setTplError(msg);
    }
  };

  const pathwayPills = (level: string) => {
    if (level !== "Grade 11" && level !== "Grade 12") return null;
    const pills: React.ReactNode[] = [];
    if (medicalEnabled)
      pills.push(
        <Pill tone="blue" key="med">
          STEM Medical
        </Pill>,
      );
    if (engineeringEnabled)
      pills.push(
        <Pill tone="blue" key="eng">
          STEM Engineering
        </Pill>,
      );
    if (pills.length === 0)
      pills.push(
        <Pill tone="gray" key="none">
          No pathway enabled
        </Pill>,
      );
    return pills;
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-4xl font-bold tracking-tight">
                  System Settings
                </h1>
              </div>
              {isLoadingSettings && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading settings...
                </div>
              )}
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            {/* Subject Groups & Passing Thresholds */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  Subject Groups & Passing Thresholds
                  <Button size="sm" onClick={() => setIsAddGroupOpen(true)}>
                    Add Group
                  </Button>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text as="p" className="font-sans text-sm text-muted-foreground">
                  Threshold changes apply to grades finalized from this point forward. Already-finalized period grades are not re-evaluated.
                </Text>
                <div className="overflow-x-auto">
                  <Table className="w-full">
                    <Table.Header>
                      <Table.Row>
                        <Table.Head>Group Name</Table.Head>
                        <Table.Head>Passing Threshold</Table.Head>
                        <Table.Head>Subjects Assigned</Table.Head>
                        <Table.Head>Status</Table.Head>
                        <Table.Head className="text-right">Actions</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {isLoadingGroups ? (
                        <Table.Row>
                          <Table.Cell colSpan={5} className="text-center py-4 text-sm text-muted-foreground">
                            Loading subject groups...
                          </Table.Cell>
                        </Table.Row>
                      ) : subjectGroups.length === 0 ? (
                        <Table.Row>
                          <Table.Cell colSpan={5} className="text-center py-4 text-sm text-muted-foreground">
                            No subject groups found.
                          </Table.Cell>
                        </Table.Row>
                      ) : (
                        subjectGroups.map((g) => (
                          <Table.Row key={g.subject_group_id}>
                            <Table.Cell className="font-medium">{g.name}</Table.Cell>
                            <Table.Cell>
                              <div className="flex items-center gap-2">
                                <Input
                                  className="w-20"
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  defaultValue={g.passing_threshold}
                                  onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                                    const val = Number(e.target.value);
                                    if (!isNaN(val) && val !== g.passing_threshold && val >= 0 && val <= 100) {
                                      handleUpdateGroupThreshold(g.subject_group_id, val);
                                    }
                                  }}
                                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                    if (e.key === "Enter") {
                                      const val = Number(e.currentTarget.value);
                                      if (!isNaN(val) && val !== g.passing_threshold && val >= 0 && val <= 100) {
                                        handleUpdateGroupThreshold(g.subject_group_id, val);
                                      }
                                    }
                                  }}
                                />
                              </div>
                            </Table.Cell>
                            <Table.Cell>{g.subject_count}</Table.Cell>
                            <Table.Cell>
                              <Badge variant={g.is_active ? "secondary" : "default"}>
                                {g.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell className="text-right">
                              <Button
                                size="sm"
                                variant={g.is_active ? "outline" : "default"}
                                onClick={() => handleToggleGroupActive(g.subject_group_id, g.is_active)}
                              >
                                {g.is_active ? "Deactivate" : "Activate"}
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))
                      )}
                    </Table.Body>
                  </Table>
                </div>
              </Card.Content>
            </Card>

            {/* General Average Threshold */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  General Average Passing Grade
                  <Button
                    size="sm"
                    onClick={handleSaveThresholds}
                    disabled={isSavingThresholds}
                  >
                    {isSavingThresholds ? "Saving..." : "Save Threshold"}
                  </Button>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      General Average Passing Grade
                    </Text>
                    <Input
                      className="w-20"
                      type="number"
                      min={0}
                      max={100}
                      value={averagePassing}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setAveragePassing(e.target.value)
                      }
                    />
                  </div>
                  <Text
                    as="p"
                    className="font-sans text-sm text-muted-foreground"
                  >
                    Used for general promotion/completion reports. Adjust only
                    if the client confirms a different rule.
                  </Text>
                </div>
              </Card.Content>
            </Card>

            {/* Academic Calendar */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  Academic Calendar
                  <div className="flex items-center gap-4">
                    <Button
                      size="sm"
                      variant="link"
                      className="p-0! shadow-none flex-row gap-2"
                      onClick={() => navigate(`/admin/academic-periods`)}
                    >
                      View All Periods
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                    <Dialog>
                      <Dialog.Trigger>
                        <Button size="sm">New Academic Period</Button>
                      </Dialog.Trigger>
                      <AddAcademicPeriodModal />
                    </Dialog>
                  </div>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text
                  as="p"
                  className="font-sans text-sm text-muted-foreground -mt-2"
                >
                  Set the active school year and active term. This is the only
                  current-period selector for both JHS and SHS.
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Current Academic Year
                    </Text>
                    <Select
                      value={schoolYear}
                      onValueChange={(val) => {
                        setSchoolYear(val);
                        saveSingleSetting("current_school_year", val);
                      }}
                    >
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="2026 - 2027" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="AP25-26">2025 - 2026</Select.Item>
                          <Select.Item value="AP26-27">2026 - 2027</Select.Item>
                          <Select.Item value="AP27-28">2027 - 2028</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Calendar Type
                    </Text>
                    <div className="h-10 border-2 border-black flex items-center gap-2 px-3 text-sm bg-neutral-50 shadow-[4px_4px_0_#000]">
                      <Lock className="w-3.5 h-3.5" />
                      Three-Term Calendar
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-xs text-muted-foreground"
                    >
                      Locked for the current implementation.
                    </Text>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Active Period
                    </Text>
                    <Select value={activeTerm} onValueChange={handleTermChange}>
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="Term 1" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="1">Term 1</Select.Item>
                          <Select.Item value="2">Term 2</Select.Item>
                          <Select.Item value="3">Term 3</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>
                </div>

                <div className="border-2 border-black bg-neutral-50 rounded-md p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Text as="p" className="font-sans text-sm">
                      <strong>Active:</strong> {TERM_LABELS[activeTerm]} ·
                      Progress Ratio {ratio.toFixed(4)} · Applies to JHS and SHS
                    </Text>
                    <Pill tone="green">TERM</Pill>
                  </div>
                  <Progress value={ratio * 100} className="mt-2" />
                </div>
              </Card.Content>
            </Card>

            {/* School Curriculum Scope */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  School Curriculum Scope
                  <Button
                    size="sm"
                    onClick={handleSaveScope}
                    disabled={isSavingScope}
                  >
                    {isSavingScope ? "Saving..." : "Save Scope"}
                  </Button>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text
                  as="p"
                  className="font-sans text-sm text-muted-foreground -mt-2"
                >
                  Define what the school offers. Actual pathway subjects belong
                  in the Subjects module.
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border-2 border-black rounded-md p-4 flex flex-col gap-3">
                    <Text as="h6" className="font-sans font-bold">
                      School Levels
                    </Text>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2">
                      <Text as="p" className="font-sans font-medium">
                        Junior High School
                      </Text>
                      <Switch
                        checked={jhsEnabled}
                        onCheckedChange={() => setJhsEnabled((v) => !v)}
                      />
                    </div>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2">
                      <Text as="p" className="font-sans font-medium">
                        Senior High School
                      </Text>
                      <Switch
                        checked={shsEnabled}
                        onCheckedChange={() => setShsEnabled((v) => !v)}
                      />
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-xs text-muted-foreground"
                    >
                      Enabled levels control the available grade levels,
                      dashboards, and reports.
                    </Text>
                  </div>

                  <div className="border-2 border-black rounded-md p-4 flex flex-col gap-3 bg-neutral-50">
                    <Text as="h6" className="font-sans font-bold">
                      Senior High School Setup
                    </Text>
                    <div className="flex gap-2 flex-wrap">
                      <Pill locked>Academic Track</Pill>
                      <Pill locked>STEM Strand</Pill>
                    </div>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2 bg-white">
                      <Text as="p" className="font-sans font-medium">
                        Medical / Pre-Med Pathway
                      </Text>
                      <Switch
                        checked={medicalEnabled}
                        onCheckedChange={() => setMedicalEnabled((v) => !v)}
                        disabled={!shsEnabled}
                      />
                    </div>
                    <div className="flex items-center justify-between border-2 border-black rounded-md px-3 py-2 bg-white">
                      <Text as="p" className="font-sans font-medium">
                        Engineering Pathway
                      </Text>
                      <Switch
                        checked={engineeringEnabled}
                        onCheckedChange={() => setEngineeringEnabled((v) => !v)}
                        disabled={!shsEnabled}
                      />
                    </div>
                    <Text
                      as="p"
                      className="font-sans text-xs text-muted-foreground"
                    >
                      Client scope is STEM only. Other strands are hidden to
                      prevent wrong setup.
                    </Text>
                  </div>
                </div>

                <Alert status="warning" className="border-2 border-dashed border-black bg-yellow-50 text-foreground text-sm">
                  <strong>Design rule:</strong> Settings only says the school
                  offers STEM Medical and STEM Engineering. The different
                  subjects for each pathway should be configured in{" "}
                  <strong>Subjects → Subject Offerings</strong>, not here.
                </Alert>
              </Card.Content>
            </Card>

            {/* Academic Levels */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title>Academic Levels</Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Level</Table.Head>
                      <Table.Head>School Stage</Table.Head>
                      <Table.Head>Available Curriculum</Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {ACADEMIC_LEVELS.map((item) => {
                      const stageEnabled =
                        item.stage === "Junior High" ? jhsEnabled : shsEnabled;
                      return (
                        <Table.Row key={item.level}>
                          <Table.Cell className="font-bold">
                            {item.level}
                          </Table.Cell>
                          <Table.Cell>{item.stage}</Table.Cell>
                          <Table.Cell>
                            {item.stage === "Junior High" ? (
                              <Text
                                as="p"
                                className="text-muted-foreground text-sm"
                              >
                                Standard JHS setup
                              </Text>
                            ) : (
                              <div className="flex gap-2 flex-wrap">
                                {pathwayPills(item.level)}
                              </div>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <Pill tone={stageEnabled ? "green" : "gray"}>
                              {stageEnabled ? "Enabled" : "Disabled"}
                            </Pill>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              </Card.Content>
            </Card>

            {/* Default Grading Templates */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">
                  Default Grading Templates
                  <Dialog
                    open={templateModalOpen}
                    onOpenChange={setTemplateModalOpen}
                  >
                    <Dialog.Trigger>
                      <Button size="sm" onClick={openTemplateModal}>
                        New Template
                      </Button>
                    </Dialog.Trigger>
                    <Dialog.Content size="md">
                      <Dialog.Header position="static">
                        <Text as="h5" className="font-sans text-xl font-bold">
                          New Grading Template
                        </Text>
                      </Dialog.Header>
                      <section className="flex flex-col gap-4 p-4 text-sm">
                        <Text as="p" className="text-muted-foreground text-xs">
                          Weights must total 100%. This creates a reusable
                          template only; subject assignment happens in Subjects.
                        </Text>
                        <div className="flex flex-col gap-2">
                          <Text as="h6" className="font-sans font-medium">
                            Template Name
                          </Text>
                          <Input
                            value={tplName}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) => setTplName(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="flex flex-col gap-2">
                            <Text
                              as="h6"
                              className="font-sans text-sm font-medium"
                            >
                              Written Work %
                            </Text>
                            <Input
                              type="number"
                              value={tplWw}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) => setTplWw(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Text
                              as="h6"
                              className="font-sans text-sm font-medium"
                            >
                              Performance Task %
                            </Text>
                            <Input
                              type="number"
                              value={tplPt}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) => setTplPt(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Text
                              as="h6"
                              className="font-sans text-sm font-medium"
                            >
                              Quarterly/Term Assessment %
                            </Text>
                            <Input
                              type="number"
                              value={tplQa}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) => setTplQa(e.target.value)}
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
                        <Button onClick={addTemplate}>Save Template</Button>
                        <Button
                          variant="outline"
                          onClick={() => setTemplateModalOpen(false)}
                        >
                          Cancel
                        </Button>
                      </Dialog.Footer>
                    </Dialog.Content>
                  </Dialog>
                </Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4 flex flex-col gap-4">
                <Text
                  as="p"
                  className="font-sans text-sm text-muted-foreground -mt-2"
                >
                  Subjects will choose one template or override it in the
                  Subjects module.
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map((t, i) => (
                    <Card key={i} className="p-3 flex flex-col gap-3 w-full">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Text as="h6" className="font-sans font-bold">
                            {t.name}
                          </Text>
                          <Text
                            as="p"
                            className="font-sans text-xs text-muted-foreground"
                          >
                            {t.scope}
                          </Text>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            showToast(
                              `Edit workflow opened for ${t.name} (preview only)`,
                            )
                          }
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="border-2 border-black rounded-md bg-neutral-50 text-center py-2">
                          <Text as="p" className="font-bold text-lg">
                            {t.ww}%
                          </Text>
                          <Text
                            as="p"
                            className="text-xs text-muted-foreground"
                          >
                            WW
                          </Text>
                        </div>
                        <div className="border-2 border-black rounded-md bg-neutral-50 text-center py-2">
                          <Text as="p" className="font-bold text-lg">
                            {t.pt}%
                          </Text>
                          <Text
                            as="p"
                            className="text-xs text-muted-foreground"
                          >
                            PT
                          </Text>
                        </div>
                        <div className="border-2 border-black rounded-md bg-neutral-50 text-center py-2">
                          <Text as="p" className="font-bold text-lg">
                            {t.qa}%
                          </Text>
                          <Text
                            as="p"
                            className="text-xs text-muted-foreground"
                          >
                            QA
                          </Text>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                <Alert status="warning" className="border-2 border-dashed border-black bg-yellow-50 text-foreground text-sm">
                  <strong>Important:</strong> Do not assign Medical or
                  Engineering subjects in Settings. Settings stores reusable
                  grade-weight templates only. Actual grading setup per subject
                  belongs in <strong>Subjects → Grading Setup</strong>.
                </Alert>
              </Card.Content>
            </Card>

            {/* Module Responsibility Map */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title>Module Responsibility Map</Card.Title>
              </Card.Header>
              <Card.Content className="px-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    {
                      n: 1,
                      title: "Settings",
                      body: "Academic year, active term, STEM scope, pathways, default templates.",
                    },
                    {
                      n: 2,
                      title: "Subjects",
                      body: "Subject catalog, Medical/Engineering offerings per grade and term, grading template assignment.",
                    },
                    {
                      n: 3,
                      title: "Classes",
                      body: "Sections such as Grade 11 STEM Medical or Grade 11 STEM Engineering.",
                    },
                    {
                      n: 4,
                      title: "Subject Load",
                      body: "Teacher assignment per subject, section, and term.",
                    },
                  ].map((s) => (
                    <Card key={s.n} className="p-3 w-full">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-yellow-300 border-2 border-black p-0 text-xs font-bold"
                        >
                          {s.n}
                        </Badge>
                        <Text as="h6" className="font-sans font-bold">
                          {s.title}
                        </Text>
                      </div>
                      <Text
                        as="p"
                        className="font-sans text-xs text-muted-foreground"
                      >
                        {s.body}
                      </Text>
                    </Card>
                  ))}
                </div>
              </Card.Content>
            </Card>
          </div>
        </div>
      </div>

      {/* Confirm term change */}
      <Dialog
        open={pendingTerm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTerm(null);
        }}
      >
        <Dialog.Content size="md">
          <Dialog.Header position="static">
            <Text as="h5" className="font-sans text-xl font-bold">
              Confirm Period Change
            </Text>
          </Dialog.Header>
          <section className="flex flex-col gap-4 p-4 text-sm">
            <p>
              Change the active period to{" "}
              <strong>{pendingTerm ? TERM_LABELS[pendingTerm] : ""}</strong>?
              This applies to both Junior and Senior High School, and will mark{" "}
              <strong>{TERM_LABELS[activeTerm]}</strong> as completed.
            </p>
          </section>
          <Dialog.Footer position="static">
            <Button onClick={confirmTermChange}>Confirm</Button>
            <Button variant="outline" onClick={() => setPendingTerm(null)}>
              Cancel
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Add Subject Group Dialog */}
      <Dialog open={isAddGroupOpen} onOpenChange={setIsAddGroupOpen}>
        <Dialog.Content size="md">
          <Dialog.Header position="static">
            <Text as="h5" className="font-sans text-xl font-bold">
              Add Subject Group
            </Text>
          </Dialog.Header>
          <section className="flex flex-col gap-4 p-4 text-sm">
            {groupError && (
              <Alert status="error" className="text-sm">
                {groupError}
              </Alert>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="new-group-name" className="font-medium text-xs">
                Group Name
              </label>
              <Input
                id="new-group-name"
                placeholder="e.g. Elective, Practicum"
                value={newGroupName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGroupName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-group-threshold" className="font-medium text-xs">
                Passing Threshold (Grade)
              </label>
              <Input
                id="new-group-threshold"
                type="number"
                min={0}
                max={100}
                step="0.5"
                placeholder="83"
                value={newGroupThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGroupThreshold(e.target.value)}
              />
            </div>
          </section>
          <Dialog.Footer position="static">
            <Button onClick={handleCreateGroup}>Create Group</Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddGroupOpen(false);
                setGroupError(null);
              }}
            >
              Cancel
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Deactivate Error Dialog (Lists affected subjects) */}
      <Dialog
        open={deactivateErrorDialog !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateErrorDialog(null);
        }}
      >
        <Dialog.Content size="lg">
          <Dialog.Header position="static">
            <Text as="h5" className="font-sans text-xl font-bold text-red-600">
              Cannot Deactivate Group
            </Text>
          </Dialog.Header>
          <section className="flex flex-col gap-3 p-4 text-sm">
            <p>{deactivateErrorDialog?.message}</p>
            {deactivateErrorDialog?.affectedSubjects && deactivateErrorDialog.affectedSubjects.length > 0 && (
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto border p-2 rounded bg-muted/20">
                <Text as="p" className="font-semibold text-xs text-muted-foreground">
                  Assigned Subjects:
                </Text>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  {deactivateErrorDialog.affectedSubjects.map((s) => (
                    <li key={s.subject_id}>
                      {s.subject_name} {s.subject_codename ? `(${s.subject_codename})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <Dialog.Footer position="static">
            <Button onClick={() => setDeactivateErrorDialog(null)}>Close</Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Toast */}
      {toastMsg && (
        <div
          className="fixed right-6 bottom-6 z-50 border-2 border-black bg-white rounded-md px-4 py-3 font-bold text-sm max-w-sm"
          style={{ boxShadow: "5px 5px 0 #000" }}
        >
          {toastMsg}
        </div>
      )}
    </AppLayout>
  );
}
