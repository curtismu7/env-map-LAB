import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import App from "./App";
import { startLab } from "./testServer";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that call
// reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has only { shelfUrl }, so there is no mark then.
let lab; let restore = () => {};
afterEach(async () => { cleanup(); restore(); await lab?.close(); lab = null; window.location.hash = ""; });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
async function withShelf(payload) {
  lab = await startLab();
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => (String(url) === "/api/shelf" ? Promise.resolve(new Response(JSON.stringify(payload))) : real(url, init));
  restore = () => { globalThis.fetch = real; };
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    await withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "env-map-lab", verification: mark("verified", "Verified", { note: "Every view checked on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every view checked on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "env-map-lab", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "env-map-lab", verification: { status: "none" } }] }]) {
      await withShelf(payload);
      render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      cleanup(); restore(); await lab.close(); lab = null;
    }
  });
});
