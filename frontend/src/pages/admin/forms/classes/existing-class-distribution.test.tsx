// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ExistingClassDistribution from "./existing-class-distribution";

const previewExistingClassDistribution = vi.hoisted(() => vi.fn());
const commitExistingClassDistribution = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ previewExistingClassDistribution, commitExistingClassDistribution }));
vi.mock("@/components/retroui/Dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: Object.assign(Container, { Content: Container, Header: Container, Footer: Container }) };
});

let capturedOnDragEnd: ((event: any) => void) | undefined;
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children, onDragEnd, ...rest }: any) => {
      capturedOnDragEnd = onDragEnd;
      return <actual.DndContext onDragEnd={onDragEnd} {...rest}>{children}</actual.DndContext>;
    },
  };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); capturedOnDragEnd = undefined; });

const props = {
  sourceClassId: 19, sourceSectionName: "Del Mundo", academicYear: "2025-2026",
  academicLevel: "Grade 12", requiresPathway: false, initialAvailableCount: 2,
  otherClasses: [{ class_id: 20, section_name: "Reyes" }],
  onClose: vi.fn(), onCommitted: vi.fn().mockResolvedValue(undefined),
};

it("previews saved-class assignments and commits customized assignments after confirmation", async () => {
  const preview = {
    academic_year_id: 1, academic_year_label: "2025-2026", academic_level_id: 6,
    grade_level: 12, mode: "alphabetical" as const, snapshot: "snapshot-1", unassigned_count: 2,
    classes: [
      { class_id: 19, section_name: "Del Mundo", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 0, female_count: 1, unspecified_count: 0, average_gwa: null },
      { class_id: 20, section_name: "Reyes", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 1, female_count: 0, unspecified_count: 0, average_gwa: null },
    ],
    assignments: [
      { student_id: "student-1", class_id: 19, student_name: "One, Ada", gender: "Female", gwa: null },
      { student_id: "student-2", class_id: 20, student_name: "Two, Bob", gender: "Male", gwa: null },
    ],
    imbalance: 0,
  };
  previewExistingClassDistribution.mockResolvedValue(preview);
  commitExistingClassDistribution.mockResolvedValue({ ...preview, committed_count: 2 });
  render(<ExistingClassDistribution {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview Distribution" }));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Del Mundo assignments" })).getByText("One, Ada")).toBeTruthy());
  expect(within(screen.getByRole("region", { name: "Reyes assignments" })).getByText("Two, Bob")).toBeTruthy();
  expect(screen.getByText("Male (1)")).toBeTruthy();
  expect(previewExistingClassDistribution).toHaveBeenCalledWith(19, [19, 20], "alphabetical");
  expect(commitExistingClassDistribution).not.toHaveBeenCalled();

  // Confirm without modifications submits the initial proposed assignments
  fireEvent.click(screen.getByRole("button", { name: "Confirm and Assign 2" }));
  await waitFor(() => expect(commitExistingClassDistribution).toHaveBeenCalledWith(19, preview, [
    { student_id: "student-1", class_id: 19 },
    { student_id: "student-2", class_id: 20 },
  ]));
  await waitFor(() => expect(props.onCommitted).toHaveBeenCalled());
});

it("shows two section columns with gender groups and descending GWA within each gender", async () => {
  previewExistingClassDistribution.mockResolvedValue({
    academic_year_id: 1, academic_year_label: "2025-2026", academic_level_id: 6,
    grade_level: 12, mode: "gwa", snapshot: "snapshot-2", unassigned_count: 5,
    classes: [
      { class_id: 19, section_name: "Del Mundo", existing_count: 0, to_add_count: 4, final_count: 4, male_count: 2, female_count: 2, unspecified_count: 0, average_gwa: 88 },
      { class_id: 20, section_name: "Reyes", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 1, female_count: 0, unspecified_count: 0, average_gwa: 90 },
    ],
    assignments: [
      { student_id: "1", class_id: 19, student_name: "Low Male", gender: "Male", gwa: 82 },
      { student_id: "2", class_id: 20, student_name: "Reyes Student", gender: "Male", gwa: 90 },
      { student_id: "3", class_id: 19, student_name: "Low Female", gender: "Female", gwa: 85 },
      { student_id: "4", class_id: 19, student_name: "High Male", gender: "Male", gwa: 94 },
      { student_id: "5", class_id: 19, student_name: "High Female", gender: "Female", gwa: 91 },
    ],
    imbalance: 3,
  });
  render(<ExistingClassDistribution {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview Distribution" }));
  const delMundo = await screen.findByRole("region", { name: "Del Mundo assignments" });
  const reyes = screen.getByRole("region", { name: "Reyes assignments" });
  expect(delMundo.parentElement?.className).toContain("md:grid-cols-2");
  const delMundoItems = within(delMundo).getAllByRole("listitem").map((item) => within(item).getByText(/Male|Female/).textContent);
  expect(delMundoItems).toEqual(["High Male", "Low Male", "High Female", "Low Female"]);
  expect(within(reyes).getByText("Reyes Student")).toBeTruthy();
  expect(within(delMundo).queryByText("Reyes Student")).toBeNull();
});

it("allows manually reassigning a student to another participating section and submitting the customized plan", async () => {
  const preview = {
    academic_year_id: 1, academic_year_label: "2025-2026", academic_level_id: 6,
    grade_level: 12, mode: "alphabetical" as const, snapshot: "snapshot-3", unassigned_count: 2,
    classes: [
      { class_id: 19, section_name: "Del Mundo", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 1, female_count: 0, unspecified_count: 0, average_gwa: null },
      { class_id: 20, section_name: "Reyes", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 1, female_count: 0, unspecified_count: 0, average_gwa: null },
    ],
    assignments: [
      { student_id: "student-1", class_id: 19, student_name: "Malanto, Tristan Noel", gender: "Male", gwa: null },
      { student_id: "student-2", class_id: 20, student_name: "Castillo, Marco Luis", gender: "Male", gwa: null },
    ],
    imbalance: 0,
  };
  previewExistingClassDistribution.mockResolvedValue(preview);
  commitExistingClassDistribution.mockResolvedValue({ ...preview, committed_count: 2 });
  render(<ExistingClassDistribution {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview Distribution" }));
  await screen.findByRole("region", { name: "Del Mundo assignments" });

  // Tristan is initially in Del Mundo
  const delMundoRegion = screen.getByRole("region", { name: "Del Mundo assignments" });
  expect(within(delMundoRegion).getByText("Malanto, Tristan Noel")).toBeTruthy();

  // Verify there are no select dropdowns (removed as requested)
  expect(screen.queryByRole("combobox")).toBeNull();

  // Move Tristan from Del Mundo to Reyes via drag-and-drop
  act(() => {
    capturedOnDragEnd?.({
      active: { data: { current: { studentId: "student-1" } } },
      over: { data: { current: { classId: 20 } } },
    });
  });

  // Tristan should now be in Reyes assignments
  const reyesRegion = screen.getByRole("region", { name: "Reyes assignments" });
  expect(within(reyesRegion).getByText("Malanto, Tristan Noel")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Del Mundo assignments" })).queryByText("Malanto, Tristan Noel")).toBeNull();

  // Header should show "1 manual adjustment made"
  expect(screen.getByText(/1 manual adjustment made/)).toBeTruthy();

  // Confirming should send Tristan assigned to Reyes (20)
  fireEvent.click(screen.getByRole("button", { name: "Confirm and Assign 2" }));
  await waitFor(() => expect(commitExistingClassDistribution).toHaveBeenCalledWith(19, preview, [
    { student_id: "student-1", class_id: 20 },
    { student_id: "student-2", class_id: 20 },
  ]));
});

it("resets manual adjustments back to suggested distribution", async () => {
  const preview = {
    academic_year_id: 1, academic_year_label: "2025-2026", academic_level_id: 6,
    grade_level: 12, mode: "alphabetical" as const, snapshot: "snapshot-4", unassigned_count: 2,
    classes: [
      { class_id: 19, section_name: "Del Mundo", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 1, female_count: 0, unspecified_count: 0, average_gwa: null },
      { class_id: 20, section_name: "Reyes", existing_count: 0, to_add_count: 1, final_count: 1, male_count: 1, female_count: 0, unspecified_count: 0, average_gwa: null },
    ],
    assignments: [
      { student_id: "student-1", class_id: 19, student_name: "Malanto, Tristan Noel", gender: "Male", gwa: null },
      { student_id: "student-2", class_id: 20, student_name: "Castillo, Marco Luis", gender: "Male", gwa: null },
    ],
    imbalance: 0,
  };
  previewExistingClassDistribution.mockResolvedValue(preview);
  render(<ExistingClassDistribution {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview Distribution" }));
  await screen.findByRole("region", { name: "Del Mundo assignments" });

  // Drag Tristan to Reyes
  act(() => {
    capturedOnDragEnd?.({
      active: { data: { current: { studentId: "student-1" } } },
      over: { data: { current: { classId: 20 } } },
    });
  });
  expect(screen.getByText(/1 manual adjustment made/)).toBeTruthy();

  // Click reset
  fireEvent.click(screen.getByRole("button", { name: "Reset to suggested distribution" }));
  expect(screen.queryByText(/manual adjustment made/)).toBeNull();

  // Tristan is back in Del Mundo
  const delMundoRegion = screen.getByRole("region", { name: "Del Mundo assignments" });
  expect(within(delMundoRegion).getByText("Malanto, Tristan Noel")).toBeTruthy();
});

it("requires another saved class and cancels without a write", () => {
  render(<ExistingClassDistribution {...props} otherClasses={[]} />);
  expect(screen.getByText(/Create another eligible class/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(props.onClose).toHaveBeenCalled();
  expect(commitExistingClassDistribution).not.toHaveBeenCalled();
});
