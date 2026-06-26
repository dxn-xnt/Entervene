import { BookOpen, CheckCircle2, ClipboardList, Eye, ExternalLink, Loader2 } from "lucide-react";
import type { SuggestionResponse } from "@/types/suggestion";

type StudySuggestionCardProps = {
  suggestion: SuggestionResponse;
  isBusy?: boolean;
  onOpenResource: (suggestion: SuggestionResponse) => void;
  onComplete: (suggestion: SuggestionResponse) => void;
};

const priorityStyles = {
  LOW: "bg-gray-100 text-gray-800 border-gray-300",
  NORMAL: "bg-blue-100 text-blue-800 border-blue-300",
  HIGH: "bg-yellow-100 text-yellow-800 border-yellow-300",
  URGENT: "bg-red-100 text-red-800 border-red-300",
};

function formatDate(value?: string | null) {
  if (!value) return "Recently suggested";
  return new Date(value).toLocaleDateString();
}

export default function StudySuggestionCard({
  suggestion,
  isBusy,
  onOpenResource,
  onComplete,
}: StudySuggestionCardProps) {
  const isCompleted = suggestion.status === "COMPLETED";
  const resource = suggestion.resource;
  const Icon = resource.resource_type === "LESSON" ? BookOpen : ClipboardList;

  return (
    <article className="rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
            <Icon size={21} />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold text-gray-900">{suggestion.title}</h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${priorityStyles[suggestion.priority]}`}>
                {suggestion.priority.toLowerCase()} priority
              </span>
              <span className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-700">
                {suggestion.is_viewed ? "Viewed" : "New"}
              </span>
              {isCompleted ? (
                <span className="rounded-full border border-green-300 bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">
                  Completed
                </span>
              ) : null}
            </div>

            <p className="text-sm font-medium text-gray-500">Suggested {formatDate(suggestion.created_at)}</p>

            {suggestion.description ? (
              <p className="max-w-3xl text-sm text-gray-700">{suggestion.description}</p>
            ) : (
              <p className="max-w-3xl text-sm text-gray-500">Your teacher suggested this material for review.</p>
            )}

            <div className="rounded-lg border border-gray-300 bg-[#FFFBEE] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Linked resource</p>
              <p className="mt-1 font-bold text-gray-900">{resource.title}</p>
              <p className="text-sm text-gray-600">
                {resource.resource_type === "LESSON" ? "Lesson" : `Classwork${resource.classwork_type ? ` - ${resource.classwork_type}` : ""}`}
              </p>
              {!resource.is_available && resource.unavailable_reason ? (
                <p className="mt-2 text-sm font-medium text-red-700">{resource.unavailable_reason}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:flex-col">
          <button
            type="button"
            onClick={() => onOpenResource(suggestion)}
            disabled={isBusy || !resource.is_available}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-colors hover:bg-[#F6E9B2] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? <Loader2 size={16} className="animate-spin" /> : suggestion.is_viewed ? <ExternalLink size={16} /> : <Eye size={16} />}
            {suggestion.is_viewed ? "Open Resource" : "View Resource"}
          </button>
          <button
            type="button"
            onClick={() => onComplete(suggestion)}
            disabled={isBusy || isCompleted}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-colors hover:bg-[#69a967] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
          >
            {isBusy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {isCompleted ? "Completed" : "Mark Complete"}
          </button>
        </div>
      </div>
    </article>
  );
}
