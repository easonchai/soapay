# Soapay pitch

Pitch materials for ETHGlobal Tokyo 2026.

- `deck/soapay-deck.pdf`: the deck, thirteen slides, 16:9.
- `deck/soapay-deck.html`: the deck source. Edit the HTML, then rebuild the PDF (below). The deck is styled with the product's own design system, Direction A "Ledger" (`packages/ui/src/styles.css`): IBM Plex Sans and Mono, navy `#1e3a5f`, hairline panels, the dot-matrix texture and the lockup, scaled about 2.4x for a projector. If the UI tokens change, change the `:root` block in the deck to match.
- `deck/assets/`: screenshots of the cited sources and sponsor logos used on the slides.
- `PITCH.md`: talk track with timings, Q&A sheet, slide-by-slide notes, and every quote with its source URL.
- `evidence/`: the six research digests behind the Problem slides. Every quote marked "verified" was matched word for word against the fetched page on Sep 25, 2026. Items marked "spot-check" came through a summarizing fetch and should be confirmed on the live page before use.

## Rebuild the PDF

Headless Chrome prints the HTML to PDF. On macOS:

```sh
cd pitch/deck
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=14000 \
  --print-to-pdf="$PWD/soapay-deck.pdf" "file://$PWD/soapay-deck.html"
```

To render one slide as a PNG for a quick look, open the HTML with `?only=N` in the URL and screenshot at 2000x1125.

## Slide order

1. Title
2. Team
3. Problem statement: "Who sees what you earn?"
4. Everyone with a browser (a live payout batch on Base)
5. Your colleagues (Gitcoin DAO)
6. So companies walk away (Toku, Visa, Stripe, Circle, J.P. Morgan)
7. Even the ones who wanted to (Deel)
8. The only fix is enterprise only (Base Ledgers, Tempo, Arc, JPMD, Toku on Aleo)
9. Solution
10. Architecture, high level
11. Use cases
12. Future plan
13. Demo
