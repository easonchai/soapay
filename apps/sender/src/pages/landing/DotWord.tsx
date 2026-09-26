import { useEffect, useRef } from "react";
import { motionOff } from "@soapay/ui";
import { mountDotField } from "./dotField.js";

/**
 * A headline word drawn as the hero's dot material (owner decision 2026-09-26: no decrypt on load,
 * the word is dots by default and the cursor pushes them around). The plain text stays in the DOM
 * for readers and tests and turns transparent once the canvas has painted over it.
 */
export function DotWord({ word }: { word: string }) {
  const span = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = span.current;
    const drawing = canvas.current;
    if (!el || !drawing) return;
    const painter = mountDotField(el, drawing, {
      word,
      live: !motionOff(),
      onReady: () => el.classList.add("is-dots"),
    });
    if (!painter) return;
    return () => {
      painter.destroy();
      el.classList.remove("is-dots");
    };
  }, [word]);

  return (
    <span ref={span} className="dot-word">
      {word}
      <canvas ref={canvas} className="dot-word-canvas" aria-hidden />
    </span>
  );
}
