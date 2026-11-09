import { describe, expect, it } from "vitest";
import { getSubjectColor } from "./subject-colors";

describe("getSubjectColor", () => {
  it("assigns respective pastel colors for DepEd subjects", () => {
    // Subjects shown in the user's schedule screenshot
    expect(getSubjectColor("FILIPINO 8")).toContain("bg-rose-100");
    expect(getSubjectColor("English 8")).toContain("bg-amber-100");
    expect(getSubjectColor("TLE8")).toContain("bg-teal-100");
    expect(getSubjectColor("MAPEH 8")).toContain("bg-purple-100");
    expect(getSubjectColor("Araling Panlipunan 8")).toContain("bg-orange-100");
    expect(getSubjectColor("Enhanced Science 8")).toContain("bg-emerald-100");
    expect(getSubjectColor("Enhanced Mathematics 8")).toContain("bg-blue-100");
    expect(getSubjectColor("Homeroom Guidance")).toContain("bg-indigo-100");
  });

  it("handles variations in subject naming", () => {
    expect(getSubjectColor("Math 7")).toContain("bg-blue-100");
    expect(getSubjectColor("General Biology")).toContain("bg-emerald-100");
    expect(getSubjectColor("World Literature")).toContain("bg-amber-100");
    expect(getSubjectColor("Panitikang Pilipino")).toContain("bg-rose-100");
    expect(getSubjectColor("AP 10")).toContain("bg-orange-100");
    expect(getSubjectColor("Physical Education")).toContain("bg-purple-100");
    expect(getSubjectColor("Information & Communications Technology (ICT)")).toContain("bg-teal-100");
    expect(getSubjectColor("Edukasyon sa Pagpapakatao (EsP)")).toContain("bg-indigo-100");
  });

  it("returns fallback deterministic colors for custom or unmatched subjects", () => {
    const color1 = getSubjectColor("Robotics", 101);
    const color2 = getSubjectColor("Robotics", 101);
    expect(color1).toBe(color2);
    expect(color1).toContain("bg-");
  });

  it("returns white when subject name is empty or undefined", () => {
    expect(getSubjectColor(undefined)).toBe("bg-white");
    expect(getSubjectColor(null)).toBe("bg-white");
    expect(getSubjectColor("")).toBe("bg-white");
  });
});
