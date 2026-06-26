import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Loader2, Search, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import { Alert } from "@/components/retroui/Alert";
import StudySuggestionCard from "@/components/student/suggestions/StudySuggestionCard";
import { completeSuggestion, getMySuggestions, markSuggestionViewed } from "@/lib/suggestion-api";
import type { SuggestionResponse } from "@/types/suggestion";

type Notice = {
  status: "success" | "error" | "info";
  title: string;
  description: string;
};

type SubjectSuggestionsTabProps = {
  classId: number;
  subjectId: number;
  selectedLessonId?: number | null;
  hideIntro?: boolean;
};

type SortMode = "priority" | "newest" | "resource";

const priorityRank = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

function resourceRoute(classId: number, subjectId: number, suggestion: SuggestionResponse) {
  const tab = suggestion.resource.resource_type === "CLASSWORK" ? "classwork" : "lessons";
  const params = new URLSearchParams({ tab });
  if (suggestion.resource.lesson_id) params.set("lessonId", String(suggestion.resource.lesson_id));
  if (suggestion.resource.classwork_assignment_id) {
    params.set("classworkAssignmentId", String(suggestion.resource.classwork_assignment_id));
  }
  return `${routes.student.subjectDetail
    .replace(":classId", String(classId))
    .replace(":subjectId", String(subjectId))}?${params.toString()}`;
}

function suggestionLessonId(suggestion: SuggestionResponse) {
  return suggestion.resource.lesson_id ?? suggestion.lesson_id ?? null;
}

export default function SubjectSuggestionsTab({
  classId,
  subjectId,
  selectedLessonId,
  hideIntro = false,
}: SubjectSuggestionsTabProps) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SuggestionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("priority");

  const loadSuggestions = useCallback(async () => {
    setIsLoading(true);
    setNotice(null);
    try {
      const data = await getMySuggestions("ACTIVE");
      setSuggestions(data.suggestions);
    } catch (err) {
      setNotice({
        status: "error",
        title: "Unable to load study materials",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const updateSuggestion = (updated: SuggestionResponse) => {
    setSuggestions((current) =>
      current.map((suggestion) =>
        suggestion.student_suggestion_id === updated.student_suggestion_id ? updated : suggestion,
      ),
    );
  };

  const handleOpenResource = async (suggestion: SuggestionResponse) => {
    setBusyId(suggestion.student_suggestion_id);
    try {
      const updated = suggestion.is_viewed
        ? suggestion
        : await markSuggestionViewed(suggestion.student_suggestion_id);
      updateSuggestion(updated);
      navigate(resourceRoute(classId, subjectId, suggestion));
    } catch (err) {
      setNotice({
        status: "error",
        title: "Unable to open material",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (suggestion: SuggestionResponse) => {
    setBusyId(suggestion.student_suggestion_id);
    try {
      const updated = await completeSuggestion(suggestion.student_suggestion_id);
      updateSuggestion(updated);
      setNotice({
        status: "success",
        title: "Suggestion completed",
        description: "This study material is now marked complete.",
      });
    } catch (err) {
      setNotice({
        status: "error",
        title: "Unable to complete suggestion",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const visibleSuggestions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return suggestions
      .filter((suggestion) => suggestion.subject_id === subjectId)
      .filter((suggestion) => {
        if (!selectedLessonId) return true;
        return suggestionLessonId(suggestion) === selectedLessonId;
      })
      .filter((suggestion) => {
        if (!term) return true;
        return [
          suggestion.title,
          suggestion.description,
          suggestion.resource.title,
          suggestion.resource.resource_type,
          suggestion.priority,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        if (sortMode === "resource") return a.resource.title.localeCompare(b.resource.title);
        if (sortMode === "newest") {
          return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        }
        return priorityRank[a.priority] - priorityRank[b.priority] || a.title.localeCompare(b.title);
      });
  }, [search, selectedLessonId, sortMode, subjectId, suggestions]);

  return (
    <div className="space-y-4">
      {!hideIntro ? (
        <section className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 shrink-0" size={22} />
            <div>
              <h2 className="text-lg font-bold">Suggested Study Materials</h2>
              <p className="text-sm text-gray-700">
                {selectedLessonId
                  ? "Materials recommended for the selected lesson."
                  : "Select a lesson to narrow suggestions to that lesson."}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {notice ? (
        <Alert status={notice.status}>
          <Alert.Title>{notice.title}</Alert.Title>
          <Alert.Description>{notice.description}</Alert.Description>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-black bg-white p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] lg:flex-row lg:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-[#FFFBEE] px-3 py-2">
          <Search size={16} className="shrink-0 text-gray-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search suggested materials"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-[#FFFBEE] px-3 py-2 text-sm font-bold">
          <ArrowUpDown size={15} />
          <span>Sort</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="bg-transparent text-sm font-bold outline-none"
          >
            <option value="priority">Priority</option>
            <option value="newest">Newest</option>
            <option value="resource">Resource</option>
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-gray-400" size={36} />
        </div>
      ) : visibleSuggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-gray-500">
          {selectedLessonId
            ? "No suggested study materials for this lesson yet."
            : "No suggested study materials for this subject yet."}
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          {visibleSuggestions.map((suggestion) => (
            <StudySuggestionCard
              key={suggestion.student_suggestion_id}
              suggestion={suggestion}
              isBusy={busyId === suggestion.student_suggestion_id}
              onOpenResource={handleOpenResource}
              onComplete={handleComplete}
            />
          ))}
        </section>
      )}
    </div>
  );
}
