import type { LessonPlanDraft } from "./useLessonPlanner";

// Helper to format array items nicely
function formatArray(arr: string[] | undefined): string {
  if (!arr || arr.length === 0) return "";
  return arr.filter((i) => i.trim()).join("\n");
}

function formatFlow(flow: LessonPlanDraft["learning_experience"]["flow"]): string {
  if (!flow || flow.length === 0) return "";
  const before = flow.filter((f) => f.phase === "before" && f.description.trim());
  const during = flow.filter((f) => f.phase === "during" && f.description.trim());
  const after = flow.filter((f) => f.phase === "after" && f.description.trim());

  let out = "";
  if (before.length > 0) {
    out += "**Before (Engage):**\n" + before.map((b, i) => `* ${b.description}`).join("\n") + "\n\n";
  }
  if (during.length > 0) {
    out += "**During (Explore & Explain):**\n" + during.map((d, i) => `* ${d.description}`).join("\n") + "\n\n";
  }
  if (after.length > 0) {
    out += "**After (Consolidate & Evaluate):**\n" + after.map((a, i) => `* ${a.description}`).join("\n");
  }
  return out.trim();
}

function formatTasks(tasks: LessonPlanDraft["assessment"]["tasks"]): string {
  if (!tasks || tasks.length === 0) return "";
  return tasks.filter((t) => t.description.trim()).map((t, i) => `${i + 1}. ${t.description}`).join("\n");
}

function formatContext(context: LessonPlanDraft["intentions"]["context"]): string {
  if (!context) return "-";
  if (typeof context.text === "string" && context.text.trim()) {
    return context.text.trim();
  }
  if (Array.isArray(context.checklist) && context.checklist.length > 0) {
    return "Observed Learner Context:\n• " + context.checklist.join("\n• ");
  }
  return "-";
}

/**
 * Builds the exact HTML table structure matching the official DepEd ILAW Lesson Plan format.
 */
export function buildILAWHTML(draft: LessonPlanDraft, teacherName: string): string {
  const competenciesText = formatArray(draft.intentions?.competencies);
  const flowText = formatFlow(draft.learning_experience?.flow);
  const evaluationTasksText = formatTasks(draft.assessment?.tasks);
  const contextText = formatContext(draft.intentions?.context);

  const formativeCombined = [
    draft.assessment?.formative,
    evaluationTasksText ? `Evaluation Tasks:\n${evaluationTasksText}` : "",
  ].filter(Boolean).join("\n\n");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lesson Plan - ${draft.title || "Untitled"}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 15mm;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      color: #111827;
      line-height: 1.4;
      margin: 0;
      padding: 20px;
      background: #ffffff;
    }
    .header-title {
      text-align: center;
      font-size: 16pt;
      font-weight: bold;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }
    .header-subtitle {
      text-align: center;
      font-size: 10pt;
      color: #b45309;
      font-weight: bold;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
    }
    table.ilaw-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    table.ilaw-table th, table.ilaw-table td {
      border: 1px solid #d1d5db;
      padding: 8px 12px;
      vertical-align: top;
    }
    .label-col {
      width: 25%;
      font-weight: bold;
      background-color: #ffffff;
      color: #111827;
      font-size: 10.5pt;
    }
    .sub-label {
      font-size: 8.5pt;
      font-weight: normal;
      font-style: italic;
      color: #6b7280;
      margin-top: 4px;
    }
    .section-banner {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 10px 12px;
      background-color: #ffffff;
      border: 1px solid #d1d5db;
      border-bottom: none;
      margin-top: 12px;
    }
    .section-title {
      font-size: 14pt;
      font-weight: bold;
      color: #111827;
    }
    .section-desc {
      font-size: 9pt;
      font-style: italic;
      color: #4b5563;
    }
    .content-cell {
      white-space: pre-wrap;
      font-size: 10pt;
    }
    .footer-signatures {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      page-break-inside: avoid;
    }
    .sig-block {
      flex: 1;
      text-align: center;
    }
    .sig-line {
      border-top: 1.5px solid #111827;
      margin-top: 40px;
      padding-top: 4px;
      font-weight: bold;
      font-size: 10pt;
    }
    .sig-role {
      font-size: 8.5pt;
      color: #4b5563;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>

  <div class="header-title">LESSON PLAN</div>
  <div class="header-subtitle">MNSTS &nbsp; ILAW &middot; SY 2026-2027</div>

  <!-- Header Info Table -->
  <table class="ilaw-table">
    <tr>
      <td class="label-col">Lesson Title</td>
      <td class="content-cell">${draft.title || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">Learning Area/s</td>
      <td class="content-cell">${draft.learning_area || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">Name of Teacher/s</td>
      <td class="content-cell">${teacherName || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">Grade Level and Section</td>
      <td class="content-cell">${draft.grade_section || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">No. of Sessions</td>
      <td class="content-cell">${draft.sessions || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        References
        <div class="sub-label">(books, websites, toolkits, etc.)</div>
      </td>
      <td class="content-cell">${draft.references || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        Declaration of AI Use
        <div class="sub-label">Cite how AI was used in the formulation of the lesson plan. See DO 3 s.2026 Annex A.</div>
      </td>
      <td class="content-cell">${draft.ai_declaration || "No AI assistance was used."}</td>
    </tr>
  </table>

  <!-- SECTION 1: Intentions -->
  <div class="section-banner">
    <span class="section-title">Intentions.</span>
    <span class="section-desc">Meaningful learning experiences are anchored in how we frame them. Start by deciding what you want learners to master by the end of the lesson — keep it clear and simple.</span>
  </div>
  <table class="ilaw-table">
    <tr>
      <td class="label-col">
        Learning Competency and Curriculum Standards
        <div class="sub-label">Write the competency/ies from the curriculum that we are targeting, and the content or performance standards.</div>
      </td>
      <td class="content-cell">
${competenciesText ? `Competencies:\n${competenciesText}\n\n` : ""}
${draft.intentions?.content_standard ? `Content Standard: ${draft.intentions.content_standard}\n\n` : ""}
${draft.intentions?.performance_standard ? `Performance Standard: ${draft.intentions.performance_standard}` : ""}
      </td>
    </tr>
    <tr>
      <td class="label-col">
        Learning Objectives
        <div class="sub-label">Write the smaller knowledge, skills, or tasks from the competency that the learners will work on.</div>
      </td>
      <td class="content-cell">${draft.intentions?.objectives || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        Learner Context
        <div class="sub-label">Write your observations of your learners, including strengths, interests, and possible barriers.</div>
      </td>
      <td class="content-cell">${contextText}</td>
    </tr>
  </table>

  <!-- SECTION 2: Learning Experience -->
  <div class="section-banner">
    <span class="section-title">Learning Experience.</span>
    <span class="section-desc">A learning experience is like a thoughtfully designed journey. Each activity and interaction builds towards meaningful understanding and growth.</span>
  </div>
  <table class="ilaw-table">
    <tr>
      <td class="label-col">
        Pre-Lesson
        <div class="sub-label">Describe how you will help the learners get ready for the lesson.</div>
      </td>
      <td class="content-cell">${draft.learning_experience?.pre_lesson || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        Flow
        <div class="sub-label">Describe the activities that you can implement in 1 or more sessions to meet the learning objectives.</div>
      </td>
      <td class="content-cell">${flowText || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        Learning Resources
        <div class="sub-label">List down the learning resources that will help you reach your objectives.</div>
      </td>
      <td class="content-cell">${draft.learning_experience?.resources || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        Opportunities for Integration
        <div class="sub-label">Write down any possibilities to meaningfully integrate another learning area, topic, or technology.</div>
      </td>
      <td class="content-cell">${draft.learning_experience?.integration || "-"}</td>
    </tr>
  </table>

  <!-- SECTION 3: Assessment -->
  <div class="section-banner">
    <span class="section-title">Assessment.</span>
    <span class="section-desc">Assessments reveal what learners have gained and what they still need help with.</span>
  </div>
  <table class="ilaw-table">
    <tr>
      <td class="label-col">
        Formative Assessment
        <div class="sub-label">Create a task, activity or questions to evaluate learning and provide feedback throughout the session.</div>
      </td>
      <td class="content-cell">${formativeCombined || "-"}</td>
    </tr>
  </table>

  <!-- SECTION 4: Ways Forward -->
  <div class="section-banner">
    <span class="section-title">Ways Forward.</span>
    <span class="section-desc">Meaningful learning can also happen beyond the classroom — for both the learners and the teacher.</span>
  </div>
  <table class="ilaw-table">
    <tr>
      <td class="label-col">
        Extended Learning Opportunities
        <div class="sub-label">Suggest other learning experiences outside the classroom/class hours.</div>
      </td>
      <td class="content-cell">${draft.ways_forward?.extended_opportunities || "-"}</td>
    </tr>
    <tr>
      <td class="label-col">
        Reflections
        <div class="sub-label">Think about what you need to change for the next session based on what happened today.</div>
      </td>
      <td class="content-cell">${draft.ways_forward?.reflections || "-"}</td>
    </tr>
  </table>

  <!-- Signature Footer -->
  <div class="footer-signatures">
    <div class="sig-block">
      <div class="sig-line">${teacherName || "TEACHER NAME"}</div>
      <div class="sig-role">Prepared by &middot; Teacher</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-role">Reviewed and corrected by &middot; Master Teacher / Head Teacher</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">&nbsp;</div>
      <div class="sig-role">Noted by &middot; Principal</div>
    </div>
  </div>

</body>
</html>
  `.trim();
}

/**
 * Triggers browser print/save as PDF for the formatted DepEd ILAW Lesson Plan.
 */
export function exportLessonPlanPDF(draft: LessonPlanDraft, teacherName: string) {
  const html = buildILAWHTML(draft, teacherName);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow popups to export the PDF.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 300);
}

/**
 * Downloads an official formatted Microsoft Word (.docx) document matching the DepEd ILAW format.
 */
export function exportLessonPlanWord(draft: LessonPlanDraft, teacherName: string) {
  const html = buildILAWHTML(draft, teacherName);
  const blob = new Blob(["\ufeff" + html], {
    type: "application/msword;charset=utf-8",
  });

  const filename = `${(draft.title || "Lesson_Plan").replace(/[^a-z0-9_-]/gi, "_")}_ILAW.doc`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
