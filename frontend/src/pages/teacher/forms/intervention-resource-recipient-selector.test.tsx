// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/retroui/Dialog";
import type { InterventionRecipientScopes } from "@/lib/teacher-interventions-api";
import CreateClassworkModal from "./create-classwork";
import { InterventionResourceRecipientSelector } from "./intervention-resource-recipient-selector";

const apiMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: apiMocks.apiFetch,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => toastMocks,
}));

const sampleScopes: InterventionRecipientScopes = {
  default_scope: "THIS_STUDENT",
  this_student: {
    scope: "THIS_STUDENT",
    student_id: "student-1",
    student_name: "Juan Dela Cruz",
    class_id: 8,
    class_name: "Archimedes",
    student_count: 1,
  },
  entire_class: {
    scope: "ENTIRE_CLASS",
    class_id: 8,
    class_name: "Archimedes",
    student_count: 17,
  },
  all_subject_students: {
    scope: "ALL_SUBJECT_STUDENTS",
    subject_id: 7,
    subject_name: "Enhanced Mathematics 9",
    class_ids: [8, 9],
    class_names: ["Archimedes", "Einstein"],
    section_count: 2,
    student_count: 35,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InterventionResourceRecipientSelector", () => {
  it("displays accurate server-provided recipient counts and updates summary per scope", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <InterventionResourceRecipientSelector
        value="THIS_STUDENT"
        onChange={onChange}
        scopes={sampleScopes}
        fallbackStudentName="Juan Dela Cruz"
        fallbackClassName="Archimedes"
        fallbackSubjectName="Enhanced Mathematics 9"
      />,
    );

    expect(screen.getByText("Assign resource to")).toBeDefined();
    expect(screen.getByRole("radio", { name: /This student — Juan Dela Cruz \(Default\)/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Assigned to: 1 student (Juan Dela Cruz in Archimedes)")).toBeDefined();

    fireEvent.click(screen.getByRole("radio", { name: /Entire class — Archimedes/i }));
    expect(onChange).toHaveBeenCalledWith("ENTIRE_CLASS");

    rerender(
      <InterventionResourceRecipientSelector
        value="ENTIRE_CLASS"
        onChange={onChange}
        scopes={sampleScopes}
        fallbackStudentName="Juan Dela Cruz"
        fallbackClassName="Archimedes"
        fallbackSubjectName="Enhanced Mathematics 9"
      />,
    );
    expect(screen.getByText("Assigned to: 17 students in Archimedes")).toBeDefined();
    expect(screen.getByText(/Other students will not receive an intervention record or diagnosis/i)).toBeDefined();

    fireEvent.click(screen.getByRole("radio", { name: /All my students in this subject — Enhanced Mathematics 9/i }));
    expect(onChange).toHaveBeenCalledWith("ALL_SUBJECT_STUDENTS");

    rerender(
      <InterventionResourceRecipientSelector
        value="ALL_SUBJECT_STUDENTS"
        onChange={onChange}
        scopes={sampleScopes}
        fallbackStudentName="Juan Dela Cruz"
        fallbackClassName="Archimedes"
        fallbackSubjectName="Enhanced Mathematics 9"
      />,
    );
    expect(
      screen.getByText("Assigned to: 35 students across 2 sections (Archimedes, Einstein)"),
    ).toBeDefined();
  });
});

describe("CreateClassworkModal reading creation from an Intervention", () => {
  const setupLessonAndCreateMocks = () => {
    apiMocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/lessons/")) {
        return {
          ok: true,
          json: async () => [
            {
              lesson_id: 41,
              subject_id: 7,
              title: "Quadratic Equations",
              is_archived: false,
              order_index: 1,
            },
          ],
        };
      }
      if (url === "/api/v1/classwork-assignments/with-assignments" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            classwork_id: 501,
            title: "Quadratic Factoring Notes",
            classwork_type: "READING",
          }),
        };
      }
      return { ok: true, json: async () => [] };
    });
  };

  it("defaults to THIS_STUDENT and submits intervention_id + recipient_scope in FormData", async () => {
    setupLessonAndCreateMocks();
    const onSuccess = vi.fn();

    render(
      <Dialog open>
        <CreateClassworkModal
          nested
          selectedType="READING"
          subjects={[{ id: 7, name: "Enhanced Mathematics 9" }]}
          loads={[
            {
              subject_load_id: 1,
              subject_id: 7,
              subject_name: "Enhanced Mathematics 9",
              class_id: 8,
              section_name: "Archimedes",
              grade_level: "Grade 9",
              academic_period_id: 3,
              student_count: 17,
            },
          ]}
          initialSubjectId="7"
          initialClassId={8}
          initialLessonId={41}
          interventionResourceContext={{
            interventionId: 77,
            studentId: "student-1",
            studentName: "Juan Dela Cruz",
            classId: 8,
            className: "Archimedes",
            subjectId: 7,
            subjectName: "Enhanced Mathematics 9",
            academicPeriodId: 3,
            recipientScopes: sampleScopes,
          }}
          onClose={vi.fn()}
          onBack={vi.fn()}
          onSuccess={onSuccess}
        />
      </Dialog>,
    );

    const titleInput = await screen.findByLabelText(/Topic Title/i);
    fireEvent.change(titleInput, { target: { value: "Quadratic Factoring Notes" } });

    // Wait for lesson to be loaded/selected, then go to Step 2
    await waitFor(() => expect(apiMocks.apiFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    // Step 2 must show recipient selector defaulting to THIS_STUDENT
    const thisStudentRadio = await screen.findByRole("radio", {
      name: /This student — Juan Dela Cruz \(Default\)/i,
    });
    expect(thisStudentRadio.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Assigned to: 1 student (Juan Dela Cruz in Archimedes)")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^Assign$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const postCall = apiMocks.apiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/classwork-assignments/with-assignments" &&
        init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const formData = postCall![1].body as FormData;
    expect(formData.get("intervention_id")).toBe("77");
    expect(formData.get("recipient_scope")).toBe("THIS_STUDENT");
    expect(formData.get("academic_period_id")).toBe("3");
    expect(formData.get("subject_id")).toBe("7");
  });

  it("allows switching to ALL_SUBJECT_STUDENTS before submitting", async () => {
    setupLessonAndCreateMocks();
    const onSuccess = vi.fn();

    render(
      <Dialog open>
        <CreateClassworkModal
          nested
          selectedType="READING"
          subjects={[{ id: 7, name: "Enhanced Mathematics 9" }]}
          loads={[
            {
              subject_load_id: 1,
              subject_id: 7,
              subject_name: "Enhanced Mathematics 9",
              class_id: 8,
              section_name: "Archimedes",
              grade_level: "Grade 9",
              academic_period_id: 3,
              student_count: 17,
            },
          ]}
          initialSubjectId="7"
          initialClassId={8}
          initialLessonId={41}
          interventionResourceContext={{
            interventionId: 77,
            studentId: "student-1",
            studentName: "Juan Dela Cruz",
            classId: 8,
            className: "Archimedes",
            subjectId: 7,
            subjectName: "Enhanced Mathematics 9",
            academicPeriodId: 3,
            recipientScopes: sampleScopes,
          }}
          onClose={vi.fn()}
          onBack={vi.fn()}
          onSuccess={onSuccess}
        />
      </Dialog>,
    );

    const titleInput = await screen.findByLabelText(/Topic Title/i);
    fireEvent.change(titleInput, { target: { value: "Subject-Wide Quadratic Guide" } });

    await waitFor(() => expect(apiMocks.apiFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    fireEvent.click(
      await screen.findByRole("radio", {
        name: /All my students in this subject — Enhanced Mathematics 9/i,
      }),
    );
    expect(
      screen.getByText("Assigned to: 35 students across 2 sections (Archimedes, Einstein)"),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^Assign$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const postCall = apiMocks.apiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/classwork-assignments/with-assignments" &&
        init?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const formData = postCall![1].body as FormData;
    expect(formData.get("intervention_id")).toBe("77");
    expect(formData.get("recipient_scope")).toBe("ALL_SUBJECT_STUDENTS");
    expect(JSON.parse(String(formData.get("class_ids")))).toEqual([8, 9]);
  });
});
