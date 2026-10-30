import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useEditFormChanges } from "./use-edit-form-changes";

// Server rendering exercises this state-only hook without a browser or jsdom.
describe("useEditFormChanges", () => {
  it("blocks an unchanged handler and clears its neutral notice after editing", () => {
    function Form() {
      const [stage, setStage] = useState(0);
      const changes = useEditFormChanges({ initialValues: "saved", values: stage < 2 ? "saved" : "edited" });
      if (stage === 0) {
        expect(changes.hasChanges).toBe(false);
        expect(changes.guardChanges()).toBe(false);
        setStage(1);
      } else if (stage === 1) {
        expect(changes.noChangesMessage).toBe("No changes to save.");
        setStage(2);
      } else {
        expect(changes.hasChanges).toBe(true);
        expect(changes.noChangesMessage).toBeNull();
        expect(changes.guardChanges()).toBe(true);
      }
      return null;
    }
    renderToStaticMarkup(createElement(Form));
  });

  it("disables save again after reverting to the original values", () => {
    function Form() {
      const [stage, setStage] = useState(0);
      const changes = useEditFormChanges({ initialValues: 20, values: stage === 1 ? 30 : 20 });
      expect(changes.hasChanges).toBe(stage === 1);
      if (stage < 2) setStage(stage + 1);
      return null;
    }
    renderToStaticMarkup(createElement(Form));
  });

  it("uses a successful save as the new baseline and resets on a new record", () => {
    function Form() {
      const [stage, setStage] = useState(0);
      const changes = useEditFormChanges({
        initialValues: "original", values: "updated", resetKey: stage === 2 ? "other record" : "record",
      });
      if (stage === 0) {
        expect(changes.hasChanges).toBe(true);
        changes.markSaved();
        setStage(1);
      } else if (stage === 1) {
        expect(changes.hasChanges).toBe(false);
        setStage(2);
      } else expect(changes.hasChanges).toBe(true);
      return null;
    }
    renderToStaticMarkup(createElement(Form));
  });

  it("leaves create flows enabled", () => {
    function Form() {
      const changes = useEditFormChanges({ initialValues: "", values: "", enabled: false });
      expect(changes.guardChanges()).toBe(true);
      return null;
    }
    renderToStaticMarkup(createElement(Form));
  });

  it("clears the unchanged notice when the modal closes and reopens", () => {
    function Form() {
      const [stage, setStage] = useState(0);
      const changes = useEditFormChanges({
        initialValues: "saved", values: "saved", resetKey: stage === 2 ? "closed" : "open",
      });
      if (stage === 0) {
        changes.guardChanges();
        setStage(1);
      } else if (stage === 1) {
        expect(changes.noChangesMessage).toBe("No changes to save.");
        setStage(2);
      } else {
        expect(changes.noChangesMessage).toBeNull();
        expect(changes.hasChanges).toBe(false);
        if (stage === 2) setStage(3);
      }
      return null;
    }
    renderToStaticMarkup(createElement(Form));
  });
});
