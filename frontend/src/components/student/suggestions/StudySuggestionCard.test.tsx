// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StudySuggestionCard from "./StudySuggestionCard";
import type { SuggestionResponse } from "@/types/suggestion";

afterEach(cleanup);

function suggestion(resourceType: "LINK" | "LESSON" | "CLASSWORK", externalUrl?: string): SuggestionResponse {
  return {
    student_suggestion_id: 1, suggestion_type: "MANUAL", resource_type: resourceType,
    title: "Review this learning material", description: "Read before the next lesson.",
    priority: "NORMAL", status: "ACTIVE", is_viewed: false,
    student_id: "student", subject_id: 2,
    resource: {
      resource_type: resourceType, title: "Learning resource", subject_id: 2,
      is_available: true, external_url: externalUrl,
      lesson_id: resourceType === "LESSON" ? 3 : null,
      classwork_assignment_id: resourceType === "CLASSWORK" ? 4 : null,
    },
  };
}

it("opens a standalone external suggestion safely and leaves the URL as text", () => {
  const opened = vi.fn();
  render(<StudySuggestionCard suggestion={suggestion("LINK", "https://example.org/a?x=1&y=2")} onOpenResource={opened} onComplete={vi.fn()} />);
  expect(screen.getByText("Read before the next lesson.")).toBeTruthy();
  expect(screen.getByText("https://example.org/a?x=1&y=2")).toBeTruthy();
  const link = screen.getByRole("link", { name: "Open Resource" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.getAttribute("href")).toBe("https://example.org/a?x=1&y=2");
  fireEvent.click(link);
  expect(opened).toHaveBeenCalledOnce();
});

it("never renders an unsafe external URL as a link", () => {
  render(<StudySuggestionCard suggestion={suggestion("LINK", "javascript:alert(1)")} onOpenResource={vi.fn()} onComplete={vi.fn()} />);
  expect(screen.queryByRole("link", { name: "Open Resource" })).toBeNull();
  expect(screen.getByRole("button", { name: "View Resource" }).hasAttribute("disabled")).toBe(true);
});

it.each(["LESSON", "CLASSWORK"] as const)("keeps %s suggestions on the internal action", (kind) => {
  const opened = vi.fn();
  const item = suggestion(kind);
  render(<StudySuggestionCard suggestion={item} onOpenResource={opened} onComplete={vi.fn()} />);
  expect(screen.queryByRole("link", { name: "Open Resource" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View Resource" }));
  expect(opened).toHaveBeenCalledWith(item);
});
