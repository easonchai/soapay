import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks what @soapay/ui's dot texture (canvas + ResizeObserver) uses; it draws nothing in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}

// framer-motion's whileInView needs IntersectionObserver; report everything visible so
// scroll-triggered reveals render their final state under jsdom.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    private cb: (entries: { isIntersecting: boolean; intersectionRatio: number; target: Element }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean; intersectionRatio: number; target: Element }[]) => void) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ isIntersecting: true, intersectionRatio: 1, target }]);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}
if (typeof window !== "undefined" && typeof window.matchMedia === "undefined") {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

afterEach(() => cleanup());
