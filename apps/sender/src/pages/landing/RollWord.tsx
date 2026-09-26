import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motionOff } from "@soapay/ui";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Rolls the headline's last word through what Soapay pays out (owner request 2026-09-26): the current
 * word slides up and out while the next slides up in, clipped to the line. Same pattern as Magic UI's
 * WordRotate, on the framer-motion the app already ships. The box takes the current word's width, so
 * the centred line glides instead of jumping. Reduced motion keeps the first word.
 */
export function RollWord({ words, hold = 2400 }: { words: readonly string[]; hold?: number }) {
  const still = motionOff();
  const key = words.join("|");
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const measure = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (still || words.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), hold);
    return () => window.clearInterval(id);
  }, [still, key, words.length, hold]);

  // Width comes from hidden copies of every word, re-read on resize because the headline size is fluid.
  useLayoutEffect(() => {
    const read = () => setWidth(measure.current[index]?.offsetWidth || undefined);
    read();
    const ro = new ResizeObserver(read);
    for (const el of measure.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [index, key]);

  if (still) return <span className="roll-word">{words[0]}</span>;
  const word = words[index] ?? words[0];
  return (
    <span className="roll-word" style={width ? { width } : undefined}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={word}
          className="roll-item"
          initial={{ y: "130%" }}
          animate={{ y: 0 }}
          exit={{ y: "-110%" }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
      <span className="roll-measure" aria-hidden>
        {words.map((w, i) => (
          <span
            key={w}
            ref={(el) => {
              measure.current[i] = el;
            }}
          >
            {w}
          </span>
        ))}
      </span>
    </span>
  );
}
