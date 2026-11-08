import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import App, { AFTER_NOTE, BANNER } from "./App";
import { startLab } from "./testServer";

let lab; let dirs = [];
afterEach(async () => { cleanup(); await lab?.close(); lab = null; window.location.hash = ""; for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); dirs = []; });
beforeEach(() => { window.location.hash = ""; });

const NOENV = { STANDALONE_ENV: "/nonexistent/settings.env" };
const snapshot = (over = {}) => ({
  schema: "env-map/1", takenAt: "2026-11-08T12:00:00Z",
  environments: [
    { id: "box", label: "Real box", kind: "local", workloads: [{ name: "real-ui", ready: 1, want: 1 }, { name: "real-api", ready: 1, want: 1 }] },
    { id: "ns", label: "Real namespace", kind: "k8s", workloads: [{ name: "real-api", ready: 1, want: 1 }] },
  ],
  links: [{ from: "box/real-ui", to: "ns/real-api", label: "calls", source: "seen" }],
  ...over,
});
const realEnv = (snap) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-map-web-"));
  fs.writeFileSync(path.join(dir, "snapshot.json"), typeof snap === "string" ? snap : JSON.stringify(snap));
  dirs.push(dir);
  return { ...NOENV, ENV_MAP_SNAPSHOT: path.join(dir, "snapshot.json") };
};
const titles = () => [...document.querySelectorAll(".fcard .t b")].map((b) => b.textContent);
const click = (el) => fireEvent.click(el);

describe("Mock", () => {
  it("banner first, Real disabled with a how-to tooltip, the diagram draws regions and cards", async () => {
    lab = await startLab();
    render(<App />);
    await screen.findByTestId("diagram");
    expect(screen.getByTestId("banner").textContent).toBe(BANNER.mock);
    expect(document.querySelector("main").firstElementChild).toBe(screen.getByTestId("banner"));
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    const real = screen.getByTestId("mode-real");
    expect(real).toBeDisabled();
    expect(real.getAttribute("title")).toMatch(/ENV_MAP_SNAPSHOT/);
    expect(screen.getByTestId("real-hint").textContent).toMatch(/collect\.sh/);
    await waitFor(() => expect(document.querySelectorAll(".region").length).toBe(5));
    expect(titles()).toContain("Web front ends");
    expect(titles()).toContain("Scaled to 0");
    expect(titles()).not.toContain("To deploy on Kubernetes");
    expect(screen.getByTestId("stamp").textContent).toMatch(/31 workloads in 5 environments/);
  });

  it("Today / After changes the cards, the After note and the hash; Today brings them back", async () => {
    lab = await startLab();
    render(<App />);
    await waitFor(() => expect(titles()).toContain("Stopped"));
    click(screen.getByTestId("view-after"));
    await waitFor(() => expect(titles()).toContain("To deploy on Kubernetes"));
    expect(titles()).toContain("Servers to scale up (at 0 today)");
    expect(titles().some((t) => /moved from Kubernetes/.test(t))).toBe(true);
    expect(titles()).not.toContain("Scaled to 0");
    expect(screen.getByTestId("after-note").textContent).toBe(AFTER_NOTE);
    expect(screen.getByTestId("view-after")).toHaveAttribute("aria-pressed", "true");
    expect(window.location.hash).toBe("#/diagram/after");
    click(screen.getByTestId("view-today"));
    await waitFor(() => expect(titles()).toContain("Scaled to 0"));
    expect(titles()).not.toContain("To deploy on Kubernetes");
    expect(screen.queryByTestId("after-note")).toBeNull();
  });

  it("clicking a card lists its workloads; a name guess is shown as by name, unverified", async () => {
    lab = await startLab();
    render(<App />);
    await waitFor(() => expect(titles()).toContain("Web front ends"));
    click(screen.getByText("Web front ends"));
    const list = await screen.findByTestId("side-list");
    expect(screen.getByTestId("side-title").textContent).toBe("Web front ends");
    expect(within(list).getByText("portal-ui")).toBeInTheDocument();
    expect(within(list).getAllByTestId("by-name").length).toBe(3);
    expect(within(list).getAllByTestId("by-name")[0].textContent).toBe("by name, unverified");
    click(screen.getByText("Data"));
    await waitFor(() => expect(screen.getByTestId("side-title").textContent).toBe("Data"));
    expect(within(screen.getByTestId("side-list")).queryAllByTestId("by-name").length).toBe(0); // declared roles are not flagged
  });

  it("the Map tab shows the environment summaries and the what-lives-where matrix, for both arrangements", async () => {
    lab = await startLab();
    render(<App />);
    await waitFor(() => expect(titles().length).toBeGreaterThan(5));
    click(screen.getByTestId("tab-map"));
    expect(window.location.hash).toBe("#/map");
    const m = await screen.findByTestId("matrix");
    expect(within(m).getByText("Web front ends")).toBeInTheDocument();
    expect(within(m).getByText("Orders")).toBeInTheDocument();
    expect(within(m).getAllByText("Laptop (Docker)").length).toBeGreaterThan(0);
    expect(screen.getByTestId("env-team-a").textContent).toMatch(/Workloads\s*7/);
    expect(screen.queryByTestId("changes")).toBeNull();
    click(screen.getByTestId("view-after"));
    await screen.findByTestId("changes");
    expect(screen.getByTestId("change-toDeploy").textContent).toMatch(/search-api/);
    expect(screen.getByTestId("change-toScaleUp").textContent).toMatch(/payments-api/);
    expect(screen.getByTestId("change-removed").textContent).toMatch(/orders-ui/);
    expect(screen.getByTestId("unverified-count").textContent).toMatch(/25 of 31 roles were guessed/);
    expect(screen.getByTestId("tab-map")).toHaveAttribute("aria-selected", "true");
  });

  it("routes by hash: #/map/after opens the map in the After arrangement", async () => {
    window.location.hash = "#/map/after";
    lab = await startLab();
    render(<App />);
    await screen.findByTestId("matrix");
    expect(screen.getByTestId("view-after")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("diagram")).toBeNull();
    expect(screen.queryByTestId("reset")).toBeNull();
  });

  it("Reset layout is on the diagram and restores the computed layout without breaking the view", async () => {
    lab = await startLab();
    render(<App />);
    await waitFor(() => expect(titles()).toContain("Data"));
    const before = document.querySelectorAll(".fcard").length;
    click(screen.getByTestId("reset"));
    await waitFor(() => expect(document.querySelectorAll(".fcard").length).toBe(before));
  });

  it("zero outbound attempts across a whole session", async () => {
    lab = await startLab();
    render(<App />);
    await waitFor(() => expect(titles()).toContain("Data"));
    click(screen.getByTestId("view-after")); click(screen.getByTestId("tab-map"));
    await screen.findByTestId("matrix");
    expect(await lab.attempts()).toEqual([]);
  });
});

describe("Real", () => {
  it("defaults to Real, switches both ways without a restart and the data reloads each time", async () => {
    lab = await startLab({ env: realEnv(snapshot()) });
    render(<App />);
    await waitFor(() => expect(titles()).toContain("Servers"));
    expect(screen.getByTestId("banner").textContent).toBe(BANNER.real);
    expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "live");
    expect(screen.getByTestId("mode-real")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-real")).not.toBeDisabled();
    expect(document.querySelectorAll(".region").length).toBe(2);
    click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(document.querySelectorAll(".region").length).toBe(5));
    expect(screen.getByTestId("banner").textContent).toBe(BANNER.mock);
    expect(screen.getByTestId("mode").textContent).toBe("Mock");
    click(screen.getByTestId("mode-real"));
    await waitFor(() => expect(document.querySelectorAll(".region").length).toBe(2));
    expect(screen.getByTestId("mode").textContent).toBe("Real");
    expect(screen.queryByTestId("real-hint")).toBeNull();
  });

  it("hostile snapshot text is drawn as text, never as markup", async () => {
    const hostile = snapshot({
      environments: [
        { id: "box", label: "<img src=x onerror=alert(1)> box", kind: "local", workloads: [{ name: "a-ui", group: "<script>alert(2)</script>", ready: 1, want: 1, hosts: ["x.example"] }] },
        { id: "ns", label: "<b>bold</b>", kind: "k8s", context: "<iframe src=//evil.example>", workloads: [{ name: "b-api", group: "\"><svg onload=alert(3)>", ready: 1, want: 1 }] },
      ],
      links: [{ from: "box/a-ui", to: "ns/b-api", label: "<u>link</u>", source: "seen" }],
    });
    lab = await startLab({ env: realEnv(hostile) });
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".region").length).toBe(2));
    expect(screen.getByText("<img src=x onerror=alert(1)> box")).toBeInTheDocument();
    click(screen.getByText("<script>alert(2)</script>"));
    await screen.findByTestId("side-list");
    click(screen.getByTestId("tab-map"));
    await screen.findByTestId("matrix");
    for (const sel of ["script", "img", "iframe", "svg[onload]", "b", "u", "[onerror]"]) expect(document.querySelector(`main ${sel}`), sel).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/<img src=x/);
  });

  it("a snapshot that does not validate is reported with its problems, and Mock still works", async () => {
    lab = await startLab({ env: realEnv({ schema: "env-map/1", takenAt: "x", environments: [] }) });
    render(<App />);
    const err = await screen.findByTestId("map-error");
    expect(err.textContent).toMatch(/does not validate/);
    expect(err.textContent).toMatch(/takenAt/);
    click(screen.getByTestId("mode-mock"));
    await waitFor(() => expect(document.querySelectorAll(".region").length).toBe(5));
    expect(screen.queryByTestId("map-error")).toBeNull();
  });

  it("a roles file warning is shown", async () => {
    const env = realEnv(snapshot());
    fs.writeFileSync(path.join(path.dirname(env.ENV_MAP_SNAPSHOT), "env-map.roles.json"), "broken");
    lab = await startLab({ env });
    render(<App />);
    expect((await screen.findByTestId("warning")).textContent).toMatch(/roles file/);
  });
});
