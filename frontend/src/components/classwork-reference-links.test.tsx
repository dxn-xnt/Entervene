// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReferenceLinkEditor, ReferenceLinkList } from "./classwork-reference-links";
import { validateReferenceLinks, type ReferenceLinkDraft } from "@/lib/classwork-reference-links";

afterEach(cleanup);

it("adds, edits, reorders and removes teacher reference links", () => {
  function Form() {
    const [links, setLinks] = useState<ReferenceLinkDraft[]>([]);
    return <><ReferenceLinkEditor links={links} onChange={setLinks} /><output data-testid="links">{JSON.stringify(links)}</output></>;
  }
  render(<Form />);
  fireEvent.click(screen.getByRole("button", { name: "Add Reference Link" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Reference link 1 URL" }), { target: { value: "https://example.test/one" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Reference link 1 title" }), { target: { value: "First" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Another Link" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Reference link 2 URL" }), { target: { value: "https://example.test/two" } });
  fireEvent.click(screen.getByRole("button", { name: "Move reference link 2 up" }));
  expect(JSON.parse(screen.getByTestId("links").textContent || "[]")[0].url).toBe("https://example.test/two");
  fireEvent.click(screen.getByRole("button", { name: "Remove reference link 2" }));
  expect(JSON.parse(screen.getByTestId("links").textContent || "[]")).toEqual([{ url: "https://example.test/two", title: "" }]);
});

it("rejects unsafe links and displays titles and safe URL fallbacks", () => {
  expect(validateReferenceLinks([{ url: "javascript:alert(1)", title: "" }])).toMatch(/HTTP or HTTPS/);
  expect(validateReferenceLinks([{ url: "https://user:pass@example.test", title: "" }])).toMatch(/credentials/);
  expect(validateReferenceLinks([{ url: "https://example.test/a", title: "" }, { url: "https://example.test/a", title: "" }])).toMatch(/duplicates/);
  expect(validateReferenceLinks([{ url: "https://example.test/a", title: "" }])).toBe("");
  render(<ReferenceLinkList links={[
    { classwork_reference_link_id: 2, url: "https://example.test/guide", title: null, position: 1 },
    { classwork_reference_link_id: 1, url: "https://docs.example.test/first", title: "Long reference title", position: 0 },
    { classwork_reference_link_id: 3, url: "javascript:alert(1)", title: "Unsafe", position: 2 },
  ]} />);
  const anchors = screen.getAllByRole("link");
  expect(anchors.map((anchor) => anchor.textContent)).toEqual(["Long reference title", "example.test/guide"]);
  for (const anchor of anchors) {
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  }
  expect(screen.queryByText("Unsafe")).toBeNull();
});

it("renders empty state with the add reference link button inside", () => {
  const onChange = vi.fn();
  render(<ReferenceLinkEditor links={[]} onChange={onChange} />);
  const emptyState = screen.getByText("No reference links").closest('[data-slot="empty"]');
  expect(emptyState).toBeTruthy();
  const button = screen.getByRole("button", { name: "Add Reference Link" });
  expect(emptyState?.contains(button)).toBe(true);

  fireEvent.click(button);
  expect(onChange).toHaveBeenCalledWith([{ url: "", title: "" }]);
});
