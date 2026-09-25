import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SubjectCard } from "./subject-card";

describe("Student Subjects catalog cards", () => {
  it.each([
    "Mathematics", "English", "Science",
    "Computer Programming",
    "Advanced Computer Programming and Software Development",
  ])("renders a descriptive link without subject initials for %s", (title) => {
    const html = renderToStaticMarkup(<MemoryRouter><SubjectCard to="/student/subjects/7/5" title={title} /></MemoryRouter>);
    expect(html).toContain('href="/student/subjects/7/5"');
    expect(html).toContain(`aria-label="Open ${title}"`);
    expect(html).toContain("lucide-user-round");
    expect(html).toContain("focus-visible:outline-ring");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Completion");
    expect(html).not.toContain("No Classworks Assigned");
  });

  it("uses available metadata without fabricating a progress metric", () => {
    const html = renderToStaticMarkup(<MemoryRouter><SubjectCard to="/student/subjects/7/5" title="Science" teacher="Alex Santos" subjectCode="SCI-7" periodName="Quarter 1" yearLabel="2026–2027" isCurrentPeriod /></MemoryRouter>);
    for (const value of ["Science", "Alex Santos", "SCI-7", "Quarter 1", "2026–2027", "Current term"]) expect(html).toContain(value);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("LIVE");
    expect(html).toContain("retro-theme-stripes");
    expect(html).toMatch(/<span[^>]*bg-foreground[^>]*>Current term<\/span>/);
    expect(html).toContain("hover:shadow-sm");
    expect(html).toMatch(/<span[^>]*>SCI-7<\/span>/);
    expect(html).not.toContain("Section Einstein");
    expect(html).toMatch(/<span[^>]*bg-primary[^>]*>Quarter 1<\/span>/);
    expect(html).not.toContain("hover:shadow-none");
  });

  it("omits unavailable metadata and supports multiple independently linked cards", () => {
    const html = renderToStaticMarkup(<MemoryRouter><div>{[1, 2, 3, 4, 5, 6].map(id => <SubjectCard key={id} title={`Subject ${id}`} to={`/student/subjects/7/${id}`} />)}</div></MemoryRouter>);
    expect(html.match(/<a /g)).toHaveLength(6);
    expect(html).not.toContain("Current term");
    expect(html).not.toContain("undefined");
  });
});
