import "@testing-library/jest-dom/vitest";

// Some Node versions expose a half-working global localStorage that shadows jsdom's; use a plain in-memory one.
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
  });
}

// jsdom has no scrolling; the contents list calls these.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function scrollIntoView() {};
window.scrollTo = () => {};

// ReactFlow measures with these; jsdom has neither.
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
globalThis.DOMMatrixReadOnly = globalThis.DOMMatrixReadOnly || class { constructor(t) { const m = /scale\(([\d.]+)\)/.exec(String(t || "")); this.m22 = m ? Number(m[1]) : 1; } };
