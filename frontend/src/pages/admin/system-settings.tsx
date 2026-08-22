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
import { ArrowUpRight, Lock, Pencil, Loader2, Plus, Calendar, Save } from "lucide-react";
import AddAcademicPeriodModal from "./forms/add-academic-period";
import AddGradingTemplateModal from "./forms/add-grading-template";
import AddPathwayModal from "./forms/add-pathway";

import {
  getAllSettings,
  updateSetting,
  getAcademicYearsSettings,
  setActiveAcademicYear,
  getAcademicLevelsSettings,
  getAcademicPeriodsSettings,
  setActivePeriod,
  type AcademicYearSettingItem,
  type AcademicLevelSettingItem,
  type AcademicPeriodSettingItem,
} from "@/lib/settings-api";
import { useSettings } from "@/context/SettingsContext";
import {
  getGradingTemplates,
  fetchPathways,
  updatePathway,
  fetchPathwayScopes,
  updatePathwayScopes,
  type AcademicPathwayRead,
  type PathwayScopeRead,
} from "@/lib/api";
import {
  getSubjectGroups,
  createSubjectGroup,
  updateSubjectGroup,
  deactivateSubjectGroup,
  type SubjectGroupRead,
  type AffectedSubject,
} from "@/lib/subject-groups-api";

type Template = {
  id?: number;
  name: string;
  ww: number;
  pt: number;
  qa: number;
  scope: string;
};

export default function AdminSystemSettings() {
  const navigate = useNavigate();
  const { refetch: refetchGlobalSettings } = useSettings();

  // Loading state
  const [isLoadingSettings, setIsLoadingSettings] = React.useState(true);
  const [isSavingThresholds, setIsSavingThresholds] = React.useState(false);
  const [isSavingScope, setIsSavingScope] = React.useState(false);

  // Passing grade thresholds
  const [averagePassing, setAveragePassing] = React.useState("80");

  // Academic calendar & periods
  const [schoolDayStart, setSchoolDayStart] = React.useState("06:00");
  const [schoolDayEnd, setSchoolDayEnd] = React.useState("20:00");
  const [isSavingSchoolHours, setIsSavingSchoolHours] = React.useState(false);

  // Teacher Workload Caps
  const [minSubjects, setMinSubjects] = React.useState("4");
  const [maxSubjects, setMaxSubjects] = React.useState("6");
  const [maxHours, setMaxHours] = React.useState("6.0");
  const [isSavingTeacherCaps, setIsSavingTeacherCaps] = React.useState(false);

  const [academicYears, setAcademicYears] = React.useState<AcademicYearSettingItem[]>([]);
  const [selectedYearId, setSelectedYearId] = React.useState<string>("");
  const [academicPeriods, setAcademicPeriods] = React.useState<AcademicPeriodSettingItem[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = React.useState<string>("");
  const [pendingPeriodId, setPendingPeriodId] = React.useState<string | null>(null);

  // Academic Levels
  const [academicLevels, setAcademicLevels] = React.useState<AcademicLevelSettingItem[]>([]);

  // Curriculum scope
  const [jhsEnabled, setJhsEnabled] = React.useState(true);
  const [shsEnabled, setShsEnabled] = React.useState(true);
  const [medicalEnabled, setMedicalEnabled] = React.useState(true);
  const [engineeringEnabled, setEngineeringEnabled] = React.useState(true);

  // Grading templates
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = React.useState(false);

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

  // Pathways state
  const [pathways, setPathways] = React.useState<AcademicPathwayRead[]>([]);
  const [isLoadingPathways, setIsLoadingPathways] = React.useState(false);
  const [isAddPathwayOpen, setIsAddPathwayOpen] = React.useState(false);

  // Pathway Scopes state
  const [pathwayScopes, setPathwayScopes] = React.useState<PathwayScopeRead[]>([]);
  const [_isLoadingScopes, setIsLoadingScopes] = React.useState(false);

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

  const loadPathways = React.useCallback(async () => {
    setIsLoadingPathways(true);
    try {
      const res = await fetchPathways();
      setPathways(res.pathways || []);
    } catch (err) {
      console.error("Failed to load pathways", err);
    } finally {
      setIsLoadingPathways(false);
    }
  }, []);

  const loadPathwayScopes = React.useCallback(async (yearId?: number) => {
    setIsLoadingScopes(true);
    try {
      const res = await fetchPathwayScopes(yearId || 1);
      setPathwayScopes(res.scopes || []);
    } catch (err) {
      console.error("Failed to load pathway scopes", err);
    } finally {
      setIsLoadingScopes(false);
    }
  }, []);

  const handleTogglePathwayScope = async (scope: PathwayScopeRead) => {
    try {
      const yearId = Number(selectedYearId) || 1;
      const updatedScopes = await updatePathwayScopes({
        academic_year_id: yearId,
        scopes: [
          {
            academic_level_id: scope.academic_level_id,
            requires_pathway: !scope.requires_pathway,
          },
        ],
      });
      setPathwayScopes(updatedScopes.scopes);
      showToast(`Grade ${scope.grade_level} pathway assignment updated.`);
    } catch (err) {
      console.error("Failed to update pathway scope", err);
      showToast("Failed to update pathway scope.");
    }
  };

  const handleTogglePathwayEnabled = async (pathway: AcademicPathwayRead) => {
    try {
      const updated = await updatePathway(pathway.id, {
        is_enabled: !pathway.is_enabled,
      });
      setPathways((prev) =>
        prev.map((p) => (p.id === pathway.id ? updated : p))
      );
      showToast(`Pathway ${pathway.name} ${updated.is_enabled ? "enabled" : "disabled"}.`);
    } catch (err) {
      console.error("Failed to toggle pathway", err);
      showToast("Failed to toggle pathway.");
    }
  };

  const fetchGradingTemplatesList = React.useCallback(async () => {
    try {
      const templatesRes = await getGradingTemplates({ status: "active" });
      const list = templatesRes.grading_templates || [];
      const mappedTemplates: Template[] = list.map((gt) => {
        const wwComp = gt.components.find((c) => c.component_name.toLowerCase().includes("written"))?.weight ?? 0;
        const ptComp = gt.components.find((c) => c.component_name.toLowerCase().includes("performance"))?.weight ?? 0;
        const qaComp = gt.components.find((c) =>
          c.component_name.toLowerCase().includes("quarter") ||
          c.component_name.toLowerCase().includes("term") ||
          c.component_name.toLowerCase().includes("exam")
        )?.weight ?? 0;
        return {
          id: gt.grading_template_id,
          name: gt.template_name,
          ww: wwComp,
          pt: ptComp,
          qa: qaComp,
          scope: gt.description || (gt.academic_level?.level_name ? `Level: ${gt.academic_level.level_name}` : "General Template"),
        };
      });
      setTemplates(mappedTemplates);
    } catch (err) {
      console.error("Failed to fetch grading templates", err);
    }
  }, []);

  const loadAcademicPeriodsForYear = React.useCallback(async (yearId?: number) => {
    try {
      const periods = await getAcademicPeriodsSettings(yearId);
      setAcademicPeriods(periods);
      const active = periods.find((p) => p.is_active) || periods[0];
      if (active) {
        setSelectedPeriodId(String(active.id));
      }
    } catch (err) {
      console.error("Failed to load academic periods", err);
    }
  }, []);

  const loadSettingsFromBackend = React.useCallback(async () => {
    setIsLoadingSettings(true);
    try {
      const [settingsData, yearsData, levelsData] = await Promise.all([
        getAllSettings(),
        getAcademicYearsSettings(),
        getAcademicLevelsSettings(),
      ]);

      const flatSettings: Record<string, string> = {};
      Object.values(settingsData.groups || {}).forEach((items) => {
        items.forEach((item) => {
          flatSettings[item.key] = item.value;
        });
      });

      if (flatSettings["general_average_passing_grade"]) setAveragePassing(flatSettings["general_average_passing_grade"]);
      if (flatSettings["jhs_enabled"]) setJhsEnabled(flatSettings["jhs_enabled"] === "true");
      if (flatSettings["shs_enabled"]) setShsEnabled(flatSettings["shs_enabled"] === "true");
      if (flatSettings["medical_pathway_enabled"]) setMedicalEnabled(flatSettings["medical_pathway_enabled"] === "true");
      if (flatSettings["engineering_pathway_enabled"]) setEngineeringEnabled(flatSettings["engineering_pathway_enabled"] === "true");
      if (flatSettings["school_day_start"]) setSchoolDayStart(flatSettings["school_day_start"]);
      if (flatSettings["school_day_end"]) setSchoolDayEnd(flatSettings["school_day_end"]);

      if (flatSettings["min_subjects_per_day"]) setMinSubjects(flatSettings["min_subjects_per_day"]);
      if (flatSettings["max_subjects_per_day"]) setMaxSubjects(flatSettings["max_subjects_per_day"]);
      if (flatSettings["max_hours_per_day"]) setMaxHours(flatSettings["max_hours_per_day"]);

      setAcademicYears(yearsData);
      setAcademicLevels(levelsData);

      const activeYear = yearsData.find((y) => y.is_active) || yearsData[0];
      if (activeYear) {
        setSelectedYearId(String(activeYear.academic_year_id));
        await Promise.all([
          loadAcademicPeriodsForYear(activeYear.academic_year_id),
          loadPathwayScopes(activeYear.academic_year_id),
        ]);
      }

      await Promise.all([
        fetchGradingTemplatesList(),
        loadPathways(),
      ]);
    } catch (err) {
      console.error("Failed to load system settings", err);
    } finally {
      setIsLoadingSettings(false);
    }
  }, [fetchGradingTemplatesList, loadAcademicPeriodsForYear, loadPathwayScopes, loadPathways]);

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

  const handleSaveTeacherCaps = async () => {
    if (parseInt(minSubjects) > parseInt(maxSubjects)) {
      showToast("Minimum subjects cannot exceed Maximum subjects.");
      return;
    }
    setIsSavingTeacherCaps(true);
    try {
      await Promise.all([
        updateSetting("min_subjects_per_day", minSubjects),
        updateSetting("max_subjects_per_day", maxSubjects),
        updateSetting("max_hours_per_day", maxHours),
      ]);
      showToast("Teacher workload caps saved.");
      refetchGlobalSettings();
    } catch (err) {
      console.error(err);
      showToast("Failed to save teacher workload caps.");
    } finally {
      setIsSavingTeacherCaps(false);
    }
  };

  const handleSaveSchoolHours = async () => {
    setIsSavingSchoolHours(true);
    try {
      // Basic client-side validation to prevent obvious errors before hitting the backend
      const startMins = (parseInt(schoolDayStart.split(":")[0]) || 0) * 60 + (parseInt(schoolDayStart.split(":")[1]) || 0);
      const endMins = (parseInt(schoolDayEnd.split(":")[0]) || 0) * 60 + (parseInt(schoolDayEnd.split(":")[1]) || 0);
      if (startMins >= endMins) {
        showToast("Start time must be before end time.");
        return;
      }
      await saveSingleSetting("school_day_start", schoolDayStart);
      await saveSingleSetting("school_day_end", schoolDayEnd);
      showToast("School operational hours saved");
    } finally {
      setIsSavingSchoolHours(false);
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

  const handleYearChange = async (yearIdStr: string) => {
    const yearId = Number(yearIdStr);
    setSelectedYearId(yearIdStr);
    try {
      await setActiveAcademicYear(yearId);
      const selectedYear = academicYears.find((y) => y.academic_year_id === yearId);
      setAcademicYears((prev) =>
        prev.map((y) => ({
          ...y,
          is_active: y.academic_year_id === yearId,
        }))
      );
      await loadAcademicPeriodsForYear(yearId);
      await loadPathwayScopes(yearId);
      showToast(`Active academic year changed to ${selectedYear?.year_label || yearIdStr}`);
    } catch (err) {
      console.error("Failed to change academic year", err);
      showToast("Failed to change academic year.");
    }
  };

  const handlePeriodSelect = (periodIdStr: string) => {
    setPendingPeriodId(periodIdStr);
  };

  const confirmPeriodChange = async () => {
    if (pendingPeriodId) {
      const periodId = Number(pendingPeriodId);
      try {
        await setActivePeriod(periodId);
        setSelectedPeriodId(pendingPeriodId);
        setAcademicPeriods((prev) =>
          prev.map((p) => ({
            ...p,
            is_active: p.id === periodId,
            status: p.id === periodId ? "Active" : p.status,
          }))
        );
        const selectedP = academicPeriods.find((p) => p.id === periodId);
        showToast(`Active period changed to ${selectedP?.period || `Period ${periodId}`}`);
      } catch (err) {
        console.error("Failed to change academic period", err);
        showToast("Failed to change academic period.");
      }
    }
    setPendingPeriodId(null);
  };

  // Dynamic progress calculation based on active period
  const activePeriod = academicPeriods.find((p) => String(p.id) === selectedPeriodId || p.is_active) || academicPeriods[0];
  const progressRatio = activePeriod
    ? Math.min(1, Math.max(0, activePeriod.period_sequence / (activePeriod.total_periods || 3)))
    : 0.33;
  const progressPercent = Math.round(progressRatio * 100);

  const pathwayPills = (stage: string) => {
    if (stage !== "Senior High") return null;
    const activePathways = pathways.filter((p) => p.is_enabled);
    if (!activePathways.length) {
      return (
        <Badge size="sm" variant="default">
          No pathway enabled
        </Badge>
      );
    }
    return activePathways.map((p) => (
      <Badge size="sm" variant="surface" key={p.id}>
        {p.name}
      </Badge>
    ));
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
            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />
            {/* School Operational Hours */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1">
                  School Operational Hours
                  <Text as="p" className="text-sm font-normal text-muted-foreground">
                    Set the bounds for valid class schedules. Attempting to schedule classes outside these bounds will be rejected.
                  </Text>

                </Card.Title >
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  onClick={handleSaveSchoolHours}
                  disabled={isSavingSchoolHours}
                >
                  <Save className="size-3.5 mr-2" />
                  Save Hours
                </Button>
              </Card.Header>


              <Card.Content className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex flex-col gap-1 w-1/3">
                      <Text as="h6" className="font-sans font-medium text-sm">
                        Day Start
                      </Text>
                      <Input
                        className="shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md transition-all"
                        type="time"
                        value={schoolDayStart}
                        onChange={(e) => setSchoolDayStart(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1 w-1/3">
                      <Text as="h6" className="font-sans font-medium text-sm">
                        Day End
                      </Text>
                      <Input
                        className="shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md transition-all"
                        type="time"
                        value={schoolDayEnd}
                        onChange={(e) => setSchoolDayEnd(e.target.value)}
                      />
                    </div>
                  </div>
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
                    className="whitespace-nowrap"
                    onClick={handleSaveThresholds}
                    disabled={isSavingThresholds}
                  >
                    <Save className="size-3.5 mr-2" />
                    Save Threshold
                  </Button>
                </Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <div className="flex flex-col gap-1">
                      <Text as="h6" className="font-sans font-medium">
                        General Average Passing Grade
                      </Text>
                      <Text
                        as="p"
                        className="font-sans text-sm text-muted-foreground"
                      >
                        Used for general promotion/completion reports. Adjust only
                        if the client confirms a different rule.
                      </Text>
                    </div>

                    <Input
                      className="w-20 shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md transition-all"
                      type="number"
                      min={0}
                      max={100}
                      value={averagePassing}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setAveragePassing(e.target.value)
                      }
                    />
                  </div>

                </div>
              </Card.Content>
            </Card>



            {/* Subject Groups & Passing Thresholds */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1">
                  Subject Groups & Passing Thresholds
                  <Text as="p" className="text-sm font-normal text-muted-foreground">
                    Threshold changes apply to grades finalized from this point forward. Already-finalized period grades are not re-evaluated.
                  </Text>

                </Card.Title >
                <Button size="sm" className="whitespace-nowrap" onClick={() => setIsAddGroupOpen(true)}>
                  <Plus className="size-3.5 mr-2" />Add Group
                </Button>
              </Card.Header>

              <Card.Content className="flex flex-col gap-4">
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
                                  className="w-20 shadow-none text-center"
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
                            <Table.Cell className="text-right flex flex-row justify-end items-center">
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


            {/* Default Grading Templates */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1">
                  Default Grading Templates
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Reusable grade-weight templates stored in database. Assigned to subjects during grading setup.
                  </Text>
                </Card.Title>
                <div className="flex items-center gap-4">
                  <Dialog
                    open={templateModalOpen}
                    onOpenChange={setTemplateModalOpen}
                  >
                    <Dialog.Trigger>
                      <Button size="sm" className="whitespace-nowrap">
                        <Plus className="size-3.5 mr-2" /> Add Template
                      </Button>
                    </Dialog.Trigger>
                    <AddGradingTemplateModal
                      onClose={() => setTemplateModalOpen(false)}
                      onSaved={async () => {
                        await fetchGradingTemplatesList();
                        setTemplateModalOpen(false);
                        showToast("New grading template saved to database");
                      }}
                    />
                  </Dialog>
                </div>
              </Card.Header>

              <Card.Content className="flex flex-col gap-4">
                {templates.length === 0 ? (
                  <div className="border-2 border-dashed border-black/30 rounded-md p-6 text-center text-sm text-muted-foreground bg-muted/10">
                    No active grading templates found in database. Click &ldquo;New Template&rdquo; to configure one.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {templates.map((t, i) => (
                      <Card key={t.id || i} className="shadow-none bg-primary p-3 flex flex-col gap-3 w-full">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <Text as="h6" className="font-sans font-bold">
                              {t.name}
                            </Text>
                            <Text as="p" className="font-sans text-xs text-foreground">
                              {t.scope}
                            </Text>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-background"
                            onClick={() =>
                              showToast(
                                `Template: ${t.name} (WW: ${t.ww}%, PT: ${t.pt}%, QA: ${t.qa}%)`
                              )
                            }
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Card className="flex flex-col shadow-none p-2 items-center justify-center w-full">
                            <Text as="p" className="font-bold text-lg">
                              {t.ww}%
                            </Text>
                            <Text as="p" className="text-xs text-muted-foreground">
                              WW
                            </Text>
                          </Card>
                          <Card className="flex flex-col shadow-none p-2 items-center justify-center w-full">
                            <Text as="p" className="font-bold text-lg">
                              {t.pt}%
                            </Text>
                            <Text as="p" className="text-xs text-muted-foreground">
                              PT
                            </Text>
                          </Card>
                          <Card className="flex flex-col shadow-none p-2 items-center justify-center w-full">
                            <Text as="p" className="font-bold text-lg">
                              {t.qa}%
                            </Text>
                            <Text as="p" className="text-xs text-muted-foreground">
                              QA
                            </Text>
                          </Card>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
                {/* <Alert status="warning" className="border-2 border-dashed border-black bg-yellow-50 text-foreground text-sm">
                  <strong>Grading Architecture:</strong> Settings stores reusable
                  grade-weight templates. Subject-specific weights and assessments are configured in{" "}
                  <strong>Subjects → Grading Setup</strong>.
                </Alert> */}
              </Card.Content>
            </Card>

            {/* Academic Calendar */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1">
                  Academic Calendar
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Set the active school year and active term. This determines the current academic period system-wide.
                  </Text>
                </Card.Title>
                <div className="flex items-center gap-4">
                  <Dialog>
                    <Dialog.Trigger>
                      <Button size="sm" className="whitespace-nowrap">
                        <Calendar className="size-3 mr-2" /> New Academic Period
                      </Button>
                    </Dialog.Trigger>
                    <AddAcademicPeriodModal />
                  </Dialog>
                </div>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Current Academic Year
                    </Text>
                    <Select
                      value={selectedYearId}
                      onValueChange={handleYearChange}
                    >
                      <Select.Trigger className="w-full shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md data-[state=open]:shadow-md transition-all">
                        <Select.Value placeholder="Select Academic Year" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {academicYears.length === 0 ? (
                            <Select.Item value="0" disabled>No Academic Years found</Select.Item>
                          ) : (
                            academicYears.map((y) => (
                              <Select.Item key={y.academic_year_id} value={String(y.academic_year_id)}>
                                {y.year_label} {y.is_active ? "(Active)" : ""}
                              </Select.Item>
                            ))
                          )}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Period Type
                    </Text>
                    <div className="h-10 border-2 border-black flex items-center gap-2 px-3 text-md font-medium">
                      <Lock className="w-3.5 h-3.5" />
                      Three-Term Academic Calendar
                    </div>
                    <Text as="p" className="font-sans text-xs text-muted-foreground">
                      Standard DepEd trimestral schedule.
                    </Text>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Text as="h6" className="font-sans font-medium">
                      Active Period
                    </Text>
                    <Select value={selectedPeriodId} onValueChange={handlePeriodSelect}>
                      <Select.Trigger className="w-full shadow-none hover:shadow-md focus:shadow-md focus-visible:shadow-md data-[state=open]:shadow-md transition-all">
                        <Select.Value placeholder="Select Active Period" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {academicPeriods.length === 0 ? (
                            <Select.Item value="0" disabled>No periods for this year</Select.Item>
                          ) : (
                            academicPeriods.map((p) => (
                              <Select.Item key={p.id} value={String(p.id)}>
                                {p.period} {p.is_active ? "(Active)" : ""}
                              </Select.Item>
                            ))
                          )}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>
                </div>

                <div className="border-2 border-black bg-background p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Text as="p" className="text-sm font-semibold">
                        {progressPercent}% Complete
                      </Text>
                    </div>
                    <div className="flex items-center gap-2">
                      <Text as="p" className="text-sm font-semibold">
                        Active Period:
                      </Text>
                      <Badge size="sm" variant="secondary">
                        {activePeriod?.period || "No Active Period"}
                      </Badge>
                    </div>
                  </div>
                  <Progress value={progressPercent} className="w-full" />
                </div>
                <div className="flex flex-row justify-between w-full items-center -my-2">
                  <Text as="p" className="font-sans text-sm text-muted-foreground">
                    Applies to Junior High School and Senior High School.
                  </Text>
                  <Button
                    size="sm"
                    variant="link"
                    className="shadow-none -mr-2"
                    onClick={() => navigate(`/admin/academic-periods`)}
                  >
                    View All Periods
                    <ArrowUpRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </Card.Content>
            </Card>

            {/* School Curriculum Scope */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1">
                  School Curriculum Scope
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Define school levels and Senior High School pathways.
                  </Text>
                </Card.Title>
                <div className="flex items-center gap-4">
                  <Button
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={handleSaveScope}
                    disabled={isSavingScope}
                  >
                    <Save className="size-3.5 mr-2" />
                    Save Scope
                  </Button>
                </div>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-primary border-2 border-black p-4 flex flex-col gap-3">
                    <Text as="h6" className="text-xl font-bold mb-1">
                      School Levels
                    </Text>
                    <div className="flex items-center justify-between border-2 border-black px-3 py-2 bg-white">
                      <Text as="p" className="font-medium">
                        Junior High School
                      </Text>
                      <Switch
                        checked={jhsEnabled}
                        onCheckedChange={() => setJhsEnabled((v) => !v)}
                      />
                    </div>
                    <div className="flex items-center justify-between border-2 border-black px-3 py-2 bg-white">
                      <Text as="p" className="font-sans font-medium">
                        Senior High School
                      </Text>
                      <Switch
                        checked={shsEnabled}
                        onCheckedChange={() => setShsEnabled((v) => !v)}
                      />
                    </div>
                    <Text as="p" className="font-sans text-xs text-foreground">
                      Enabled levels control available grade levels across classes, subjects, and reports.
                    </Text>
                  </div>

                  <div className="bg-primary border-2 border-black p-4 flex flex-col gap-3 bg-neutral-50">
                    <div className="flex items-center justify-between">
                      <Text as="h6" className="text-xl font-bold">
                        Senior High School Pathways
                      </Text>
                      <Dialog open={isAddPathwayOpen} onOpenChange={setIsAddPathwayOpen}>
                        <Dialog.Trigger>
                          <Button variant="outline" className="bg-background" size="sm" disabled={!shsEnabled}>
                            Add Pathway
                          </Button>
                        </Dialog.Trigger>
                        <AddPathwayModal
                          onClose={() => setIsAddPathwayOpen(false)}
                          onSaved={async () => {
                            await loadPathways();
                            setIsAddPathwayOpen(false);
                            showToast("Pathway created successfully.");
                          }}
                        />
                      </Dialog>
                    </div>

                    {isLoadingPathways ? (
                      <Text as="p" className="text-xs text-muted-foreground">Loading pathways...</Text>
                    ) : pathways.length === 0 ? (
                      <Text as="p" className="text-xs text-muted-foreground">No pathways configured.</Text>
                    ) : (
                      pathways.map((p) => (
                        <div key={p.id} className="flex items-center justify-between border-2 border-black px-3 py-2 bg-white">
                          <div className="flex flex-row gap-2 items-end">
                            <Text as="p" className="font-sans font-medium">
                              {p.name}
                            </Text>
                            <Text as="p" className="font-sans text-xs text-muted-foreground pb-0.5">
                              ({p.code})
                            </Text>
                          </div>
                          <Switch
                            checked={p.is_enabled}
                            onCheckedChange={() => handleTogglePathwayEnabled(p)}
                            disabled={!shsEnabled}
                          />
                        </div>
                      ))
                    )}

                    <Text as="p" className="font-sans text-xs text-foreground">
                      Admin-configurable SHS Academic Pathways (DepEd Order No. 017 s. 2026).
                    </Text>
                  </div>
                </div>
              </Card.Content>
            </Card>

            {/* Academic Levels */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">Academic Levels</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Level</Table.Head>
                      <Table.Head>School Stage</Table.Head>
                      <Table.Head>Available Curriculum</Table.Head>
                      <Table.Head>SHS Pathways </Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {academicLevels.map((item) => {
                      const stageEnabled = item.stage === "Junior High" ? jhsEnabled : shsEnabled;
                      const scope = pathwayScopes.find((s) => s.grade_level === item.grade_level);
                      return (
                        <Table.Row key={item.academic_level_id}>
                          <Table.Cell className="font-bold">
                            {item.level_name}
                          </Table.Cell>
                          <Table.Cell>{item.stage}</Table.Cell>
                          <Table.Cell className="text-center">
                            {item.stage === "Junior High" ? (
                              <Badge
                                size="sm"
                                variant="default"
                              >
                                Standard JHS setup
                              </Badge>
                            ) : (
                              <div className="flex gap-2 flex-wrap justify-center">
                                {pathwayPills(item.stage)}
                              </div>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            {item.grade_level < 11 ? (
                              <Text as="p" className="text-xs text-muted-foreground">
                                N/A (SHS only)
                              </Text>
                            ) : scope ? (
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={scope.requires_pathway}
                                  onCheckedChange={() => handleTogglePathwayScope(scope)}
                                  disabled={!shsEnabled}
                                />
                                <Text as="p" className="text-xs text-muted-foreground">
                                  {scope.requires_pathway ? "Required" : "General"}
                                </Text>
                              </div>
                            ) : (
                              <Text as="p" className="text-xs text-muted-foreground">
                                {item.grade_level === 11 ? "Required" : "General"}
                              </Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <Badge variant={stageEnabled ? "secondary" : "outline"} size="sm">
                              {stageEnabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              </Card.Content>
            </Card>

            {/* Teacher Workload Caps */}
            <Card className="@container/card w-full">
              <Card.Header className="flex flex-row justify-between items-start mb-0">
                <Card.Title className="flex flex-col w-full gap-1">
                  Teacher Workload Caps
                  <Text as="p" className="text-sm font-normal text-muted-foreground">
                    These limits are enforced globally across all subjects during scheduling.
                  </Text>
                </Card.Title >
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  onClick={handleSaveTeacherCaps}
                  disabled={isSavingTeacherCaps || parseInt(minSubjects) > parseInt(maxSubjects)}
                >
                  <Save className="size-3.5 mr-2" />
                  Save Workload Caps
                </Button>
              </Card.Header>
              <Card.Content className="flex flex-col gap-6 w-full">
                <div className="flex flex-col gap-1">
                  {parseInt(minSubjects) > parseInt(maxSubjects) && (
                    <Text as="p" className="font-sans text-sm font-semibold text-red-600 mt-1">
                      Error: Minimum subjects cannot exceed maximum subjects.
                    </Text>
                  )}
                </div>
                <div className="flex w-full flex-row gap-4 items-center">
                  <div className="flex flex-col gap-2 w-full">
                    <label className="text-sm font-semibold">Min Subjects/Day</label>
                    <Input
                      type="number"
                      min={0}
                      className="w-full"
                      value={minSubjects}
                      onChange={(e) => setMinSubjects(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                    <label className="text-sm font-semibold">Max Subjects/Day</label>
                    <Input
                      type="number"
                      min={1}
                      className="w-full"
                      value={maxSubjects}
                      onChange={(e) => setMaxSubjects(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                    <label className="text-sm font-semibold">Max Hours/Day</label>
                    <Input
                      type="number"
                      min={1}
                      step={0.5}
                      className="w-full"
                      value={maxHours}
                      onChange={(e) => setMaxHours(e.target.value)}
                    />
                  </div>
                </div>
              </Card.Content>
            </Card>

            {/* Module Responsibility Map */}
            <Card className="@container/card w-full">
              <Card.Header>
                <Card.Title className="flex flex-row justify-between w-full items-center">Module Responsibility Map</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    {
                      n: 1,
                      title: "Settings",
                      body: "Academic year, active term, grade levels, pathways, default templates.",
                    },
                    {
                      n: 2,
                      title: "Subjects",
                      body: "Subject catalog, pathway offerings per grade and term, grading template assignment.",
                    },
                    {
                      n: 3,
                      title: "Classes",
                      body: "Section management, adviser assignment, and student roster enrollments.",
                    },
                    {
                      n: 4,
                      title: "Subject Load",
                      body: "Teacher assignment per subject, section, and term schedule.",
                    },
                  ].map((s) => (
                    <Card key={s.n} className="p-3 w-full shadow-none">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-yellow-300 border-1 border-black p-0 text-xs font-bold"
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

      {/* Confirm period change */}
      <Dialog
        open={pendingPeriodId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPeriodId(null);
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
              Change the active academic period to{" "}
              <strong>
                {academicPeriods.find((p) => String(p.id) === pendingPeriodId)?.period || "selected period"}
              </strong>?
              This will update the active term system-wide across all student, teacher, and admin views.
            </p>
          </section>
          <Dialog.Footer position="static">
            <Button onClick={confirmPeriodChange}>Confirm</Button>
            <Button variant="outline" onClick={() => setPendingPeriodId(null)}>
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
          className="fixed right-6 bottom-6 z-50 border-2 border-black bg-white px-4 py-3 font-bold text-sm max-w-sm"
          style={{ boxShadow: "5px 5px 0 #000" }}
        >
          {toastMsg}
        </div>
      )}
    </AppLayout>
  );
}
