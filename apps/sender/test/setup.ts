import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

// Motion helpers inspect media preferences even though jsdom does not provide matchMedia.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

// @soapay/ui's dot textures draw on a canvas and watch their size; jsdom has neither.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}

// jsdom's crypto lacks SubtleCrypto; use Node's WebCrypto.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// framer-motion's whileInView needs IntersectionObserver; report everything as visible so
// scroll-triggered sections render their final state under jsdom.
if (!("IntersectionObserver" in globalThis)) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
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
  };
}
