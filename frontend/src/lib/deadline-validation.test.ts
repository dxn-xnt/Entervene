import { describe, it, expect } from "vitest";
import {
  DEADLINE_FUTURE_ERROR,
  formatLocalDateTimeInput,
  getMinFutureDeadlineInput,
  validateFutureDeadline,
} from "./deadline-validation";
import { toDateTimeLocal } from "./classwork-utils";

describe("deadline-validation", () => {
  // Frozen local time: 2026-11-23 15:30:00
  const now = new Date(2026, 10, 23, 15, 30, 0, 0);

  it("rejects past deadlines on the same day", () => {
    expect(validateFutureDeadline("2026-11-23T15:00", now)).toBe(DEADLINE_FUTURE_ERROR);
  });

  it("rejects a deadline equal to the current date and time", () => {
    expect(validateFutureDeadline("2026-11-23T15:30", now)).toBe(DEADLINE_FUTURE_ERROR);
  });

  it("rejects yesterday at any time", () => {
    expect(validateFutureDeadline("2026-11-22T23:59", now)).toBe(DEADLINE_FUTURE_ERROR);
  });

  it("accepts a future deadline later on the same day", () => {
    expect(validateFutureDeadline("2026-11-23T15:31", now)).toBe("");
  });

  it("accepts a future date", () => {
    expect(validateFutureDeadline("2026-11-24T08:00", now)).toBe("");
  });

  it("allows empty values so optional due-date rules remain preserved", () => {
    expect(validateFutureDeadline("", now)).toBe("");
    expect(validateFutureDeadline(null, now)).toBe("");
  });

  it("rejects a previously valid deadline once current time passes it", () => {
    const selected = "2026-11-23T15:31";
    expect(validateFutureDeadline(selected, new Date(2026, 10, 23, 15, 30, 0))).toBe("");
    expect(validateFutureDeadline(selected, new Date(2026, 10, 23, 15, 31, 0))).toBe(
      DEADLINE_FUTURE_ERROR,
    );
  });

  it("compares timezone-aware ISO timestamps by actual instant across date boundaries", () => {
    const boundaryNow = new Date("2026-11-22T16:00:00Z"); // 2026-11-23 00:00:00+08:00
    expect(validateFutureDeadline("2026-11-23T00:00:00+08:00", boundaryNow)).toBe(
      DEADLINE_FUTURE_ERROR,
    );
    expect(validateFutureDeadline("2026-11-23T00:01:00+08:00", boundaryNow)).toBe("");
  });

  it("computes the next valid minute for DatePicker min attribute", () => {
    expect(getMinFutureDeadlineInput(now)).toBe("2026-11-23T15:31");
    expect(getMinFutureDeadlineInput(new Date(2026, 10, 23, 23, 59, 40))).toBe("2026-11-24T00:00");
  });

  it("round-trips ISO strings in local time via toDateTimeLocal", () => {
    const localDate = new Date(2026, 10, 23, 15, 31, 0, 0);
    expect(toDateTimeLocal(localDate.toISOString())).toBe(formatLocalDateTimeInput(localDate));
  });
});
