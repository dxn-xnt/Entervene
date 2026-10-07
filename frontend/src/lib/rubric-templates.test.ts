import { describe, expect, it } from "vitest";
import { copyRubricLevels } from "./rubric-templates";

describe("rubric template copies", () => {
  it("copies existing level fields without retaining classwork level IDs", () => {
    const source = [{ rubric_level_id: 4, level_name: "Excellent", description: "Complete work", points: 10, display_order: 0 }];
    const copy = copyRubricLevels(source);
    copy[0].points = 8;

    expect(source[0].points).toBe(10);
    expect(copy[0]).toEqual({ level_name: "Excellent", description: "Complete work", points: 8, display_order: 0 });
  });
});
