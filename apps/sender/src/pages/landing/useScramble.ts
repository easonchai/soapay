import { useEffect, useRef, useState } from "react";

const HEX = "0123456789abcdef";
const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);

/** One scrambled frame: hex digits become random hex (matching case); `0x`, `…` and other chars stay put. */
function scrambleOnce(target: string): string {
  let out = "";
  for (let i = 0; i < target.length; i++) {
    const c = target[i]!;
    if (i < 2 && target.startsWith("0x")) out += c;
    else if (!isHex(c)) out += c;
    else {
      const r = HEX[Math.floor(Math.random() * 16)]!;
      out += c === c.toUpperCase() && c !== c.toLowerCase() ? r.toUpperCase() : r;
    }
  }
  return out;
}

/**
 * Returns the string to show for `target`. When `target` changes and `active` is true, the hex
 * digits flicker through `frames` random frames (`frameMs` apart) before settling on the new value.
 * The `0x` prefix, the `…` and any non-hex character never move. Inactive: the new target shows at once.
 */
export function useScramble(target: string, active: boolean, frames = 8, frameMs = 70): string {
  const [shown, setShown] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (prev.current === target) return;
    prev.current = target;
    if (!active || frames <= 0) {
      setShown(target);
      return;
    }
    let n = 0;
    setShown(scrambleOnce(target));
    const id = window.setInterval(() => {
      n += 1;
      if (n >= frames) {
        window.clearInterval(id);
        setShown(target);
        return;
      }
      setShown(scrambleOnce(target));
    }, frameMs);
    return () => window.clearInterval(id);
  }, [target, active, frames, frameMs]);
  return shown;
}
