import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Landing from "@/pages/Landing";
import { Button } from "./Button";

describe("Button", () => {
  it("renders the landing page with a styled login link through asChild", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    expect(html).toContain("ENTERVENE");
    expect(html).toMatch(/<a[^>]*href="\/login"[^>]*>Get Started<\/a>/);
    expect(html).toContain("bg-primary");
  });

  it("keeps the automatic icon for ordinary buttons", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);

    expect(html).toContain("<button");
    expect(html).toContain("<svg");
    expect(html).toContain("Save</button>");
  });
});
