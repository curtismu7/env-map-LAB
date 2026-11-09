import { describe, expect, it } from "vitest";
import { CARD_W, MIN_ZOOM, REGION_W, STEP, TOP, buildFlow, chooseViewport, toneOf } from "./lib/layout.js";
import { parseRoute, routeHash } from "./lib/route.js";

const card = (id, envId, title = id) => ({ id, envId, title, subtitle: "", chip: null, off: false, count: 1, workloads: [] });
const region = (envId, kind, cards) => ({ id: `R:${envId}`, envId, label: envId, kind, subtitle: "", cards });
const view = (regions, links = []) => ({ regions, links });

describe("default view", () => {
  it("never starts zoomed out below 0.9 and leaves a bigger fit alone", () => {
    expect(MIN_ZOOM).toBe(0.9);
    expect(chooseViewport({ x: 100, y: 50, zoom: 0.5 })).toEqual({ x: 12, y: 8, zoom: 0.9 });
    expect(chooseViewport({ x: 0, y: 0, zoom: 0.89 }).zoom).toBe(0.9);
    const big = { x: 3, y: 4, zoom: 1.2 };
    expect(chooseViewport(big)).toBe(big);
    expect(chooseViewport({ x: 0, y: 0, zoom: 0.9 }).zoom).toBe(0.9);
  });
});

describe("routes", () => {
  it("parses tab and view; anything else is the diagram Landscape", () => {
    expect(parseRoute("#/map/after")).toEqual({ tab: "map", view: "after" });
    expect(parseRoute("#map")).toEqual({ tab: "map", view: "today" });
    expect(parseRoute("#/diagram/after")).toEqual({ tab: "diagram", view: "after" });
    expect(parseRoute("#/nope/x")).toEqual({ tab: "diagram", view: "landscape" });
    expect(routeHash({ tab: "map", view: "after" })).toBe("#/map/after");
    expect(routeHash({ tab: "diagram", view: "today" })).toBe("#/diagram/today");
    expect(routeHash({ tab: "diagram", view: "landscape" })).toBe("#/diagram");
    expect(parseRoute("#/diagram")).toEqual({ tab: "diagram", view: "landscape" });
    expect(parseRoute("")).toEqual({ tab: "diagram", view: "landscape" });
    expect(parseRoute("#/diagram/today")).toEqual({ tab: "diagram", view: "today" });
    expect(parseRoute("#/map")).toEqual({ tab: "map", view: "today" });
  });
});

describe("layout", () => {
  const v = view(
    [region("a", "local", [card("a1", "a"), card("a2", "a")]), region("b", "k8s", [card("b1", "b")]), region("c", "k8s", [card("c1", "c")]), region("s", "saas", [card("s1", "s"), card("s2", "s")])],
    [{ id: "e0", from: "a1", to: "b1", label: "x", source: "seen" }, { id: "e1", from: "b1", to: "a1", label: "y", source: "configured" }, { id: "e2", from: "a2", to: "s1", label: "z", source: "seen" }, { id: "e3", from: "a1", to: "a2", label: "w", source: "seen" }],
  );
  const f = buildFlow(v);
  const node = (id) => f.nodes.find((n) => n.id === id);

  it("puts the regions in a row and the SaaS strip below them", () => {
    expect(node("R:a").position).toEqual({ x: 0, y: 0 });
    expect(node("R:b").position.x).toBe(REGION_W + 60);
    expect(node("R:c").position.x).toBe(2 * (REGION_W + 60));
    expect(node("R:s").position.y).toBeGreaterThan(node("R:a").style.height);
    expect(node("R:a").style.height).toBe(TOP + 2 * STEP + 14);
  });
  it("stacks cards inside their region, clamped to it", () => {
    expect(node("a1").parentNode).toBe("R:a");
    expect(node("a1").extent).toBe("parent");
    expect(node("a2").position.y - node("a1").position.y).toBe(STEP);
    expect(node("a1").position.x).toBe((REGION_W - CARD_W) / 2);
  });
  it("gives each environment its own tone", () => {
    expect([node("R:a"), node("R:b"), node("R:c"), node("R:s")].map((n) => n.data.tone)).toEqual(["local", "k8s0", "k8s1", "saas"]);
    expect(toneOf({ kind: "k8s" }, 5)).toBe("k8s2");
  });
  it("chooses handles from where the regions sit; configured links are dashed", () => {
    const e = (id) => f.edges.find((x) => x.id === id);
    expect([e("e0").sourceHandle, e("e0").targetHandle]).toEqual(["r", "l"]);
    expect([e("e1").sourceHandle, e("e1").targetHandle]).toEqual(["l", "r"]);
    expect([e("e2").sourceHandle, e("e2").targetHandle]).toEqual(["l", "t"]);
    expect([e("e3").sourceHandle, e("e3").targetHandle]).toEqual(["r", "r"]);
    expect(e("e1").style.strokeDasharray).toBeTruthy();
    expect(e("e0").style.strokeDasharray).toBeUndefined();
  });
  it("copes with an empty region and wraps SaaS regions", () => {
    const many = view([region("a", "local", []), ...["s1", "s2", "s3", "s4"].map((id) => region(id, "saas", [card(`${id}c`, id), card(`${id}d`, id), card(`${id}e`, id)]))]);
    const g = buildFlow(many);
    expect(g.nodes.find((n) => n.id === "R:a").style.height).toBe(TOP + STEP + 14);
    const ys = new Set(g.nodes.filter((n) => n.id.startsWith("R:s")).map((n) => n.position.y));
    expect(ys.size).toBeGreaterThan(1);
  });
});
