/* Gabo Fragments Frame Lab — "Reassemble the Genesis" sliding puzzle
 *
 * A classic sliding (15-puzzle) game built on the Genesis #0 artwork. The board
 * is an N×N grid with one empty slot; each tile shows its correct slice of
 * genesis-bg.webp using the SAME slicing technique as the Collection Structure
 * grids in app.js:
 *
 *   background-size:     ${N*100}% ${N*100}%
 *   background-position: ${col/(N-1)*100}% ${row/(N-1)*100}%
 *
 * Reassemble the fragments → see the whole. Lore tie-in: 3×3 = "Tier 1 / 9
 * Large Fragments".
 *
 * Design constraints honoured:
 *   - SOLVABLE shuffle: never a raw random permutation (50% are unsolvable).
 *     Start from solved state, apply N random VALID slides, never immediately
 *     undoing the previous move. Guarantees solvability by construction.
 *   - Smooth slide: each tile is absolutely positioned inside a relative board
 *     and animated via CSS transform translate (set in JS), not grid reflow.
 *   - Timer starts on the FIRST move after a shuffle, stops on win.
 *   - No leaking globals — everything lives in this module / closures.
 */

const IMG = "genesis-bg.webp";

/** Difficulty presets. `label`/`sub` feed the selector buttons. */
const DIFFICULTIES = [
  { n: 3, label: "3 × 3", sub: "9 pieces · Tier 1" },
  { n: 4, label: "4 × 4", sub: "16 pieces" },
  { n: 5, label: "5 × 5", sub: "25 pieces" },
];

/** Number of random valid slides applied when shuffling (per spec: 150–300). */
const SHUFFLE_MOVES = 220;

const $ = (id) => document.getElementById(id);

/**
 * Puzzle engine. Holds board state for an N×N sliding puzzle and renders into
 * a `position:relative` board element. Tiles are absolutely positioned and
 * animated by updating their transform.
 */
class SlidingPuzzle {
  /**
   * @param {object} refs DOM references the engine drives.
   * @param {HTMLElement} refs.board   relative container the tiles live in
   * @param {HTMLElement} refs.timeEl  element showing the M:SS timer
   * @param {HTMLElement} refs.movesEl element showing the move count
   * @param {HTMLElement} refs.overlay win overlay container (toggled .show)
   * @param {HTMLElement} refs.winTime element inside overlay for final time
   * @param {HTMLElement} refs.winMoves element inside overlay for final moves
   * @param {() => void}  refs.onWin   callback fired once when solved
   */
  constructor(refs) {
    this.refs = refs;
    /** @type {number} grid size (tiles per side) */
    this.n = 3;
    /**
     * Board state as a flat array of length n*n. Each entry is the tile's
     * "solved index" (0..n*n-1), or null for the empty slot. The array index
     * is the CURRENT position; the value is which tile sits there.
     * @type {Array<number|null>}
     */
    this.state = [];
    /** @type {Map<number, HTMLElement>} solvedIndex -> tile element */
    this.tiles = new Map();
    /** @type {boolean} */
    this.solved = true;
    /** @type {boolean} timer is running */
    this.running = false;
    /** @type {number} move counter */
    this.moves = 0;
    /** @type {number|null} performance.now() when timer started */
    this.startTs = null;
    /** @type {number|null} rAF id for the timer tick */
    this.timerRaf = null;
    /** @type {boolean} suppress input while a shuffle animation settles */
    this.locked = false;
  }

  /** @returns {number} index of the empty slot in `state`. */
  get emptyIndex() {
    return this.state.indexOf(null);
  }

  /**
   * Build a fresh solved board for size `n` and render the tiles. Resets the
   * timer + move counter and hides the win overlay.
   * @param {number} n grid size
   */
  setup(n) {
    this.n = n;
    this.stopTimer();
    this.running = false;
    this.moves = 0;
    this.startTs = null;
    this.solved = true;
    this.refs.overlay.classList.remove("show");
    this.updateMoves();
    this.updateTime(0);

    // Solved state: tile k at position k, last slot empty.
    const total = n * n;
    this.state = [];
    for (let i = 0; i < total - 1; i++) this.state.push(i);
    this.state.push(null);

    this.renderTiles();
    this.layout();
  }

  /** Recreate all tile elements for the current size and wire click handlers. */
  renderTiles() {
    const { board } = this.refs;
    board.innerHTML = "";
    this.tiles.clear();
    board.style.setProperty("--puzzle-n", String(this.n));

    const denom = this.n - 1;
    const total = this.n * this.n;
    for (let solvedIdx = 0; solvedIdx < total - 1; solvedIdx++) {
      const row = Math.floor(solvedIdx / this.n);
      const col = solvedIdx % this.n;

      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "puzzle-tile";
      tile.dataset.solved = String(solvedIdx);
      // Slicing technique — mirrors the Collection Structure grids in app.js.
      tile.style.backgroundImage = `url('${IMG}')`;
      tile.style.backgroundSize = `${this.n * 100}% ${this.n * 100}%`;
      const xPct = denom > 0 ? (col / denom) * 100 : 50;
      const yPct = denom > 0 ? (row / denom) * 100 : 50;
      tile.style.backgroundPosition = `${xPct}% ${yPct}%`;
      tile.setAttribute("aria-label", `Fragment ${solvedIdx + 1} of ${total - 1}`);

      tile.addEventListener("click", () => this.onTileClick(solvedIdx));
      this.tiles.set(solvedIdx, tile);
      board.appendChild(tile);
    }
  }

  /**
   * Position every tile according to the current `state`, animating via the
   * CSS transition declared on `.puzzle-tile`. The empty slot has no element,
   * so it simply renders as the bone-colored board background.
   */
  layout() {
    // A tile is (100/n)% of the board. CSS translate percentages are relative
    // to the ELEMENT's own size, so to advance one cell we translate by 100%
    // of the tile (= one cell of the board). Column `col` → translateX(col*100%).
    for (let pos = 0; pos < this.state.length; pos++) {
      const solvedIdx = this.state[pos];
      if (solvedIdx === null) continue;
      const tile = this.tiles.get(solvedIdx);
      if (!tile) continue;
      const row = Math.floor(pos / this.n);
      const col = pos % this.n;
      tile.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
    }
  }

  /**
   * @param {number} pos board index
   * @returns {number[]} board indices orthogonally adjacent to `pos`.
   */
  neighbors(pos) {
    const n = this.n;
    const row = Math.floor(pos / n);
    const col = pos % n;
    const out = [];
    if (row > 0) out.push(pos - n);
    if (row < n - 1) out.push(pos + n);
    if (col > 0) out.push(pos - 1);
    if (col < n - 1) out.push(pos + 1);
    return out;
  }

  /**
   * Handle a click on the tile whose solved index is `solvedIdx`. If that tile
   * currently sits adjacent to the empty slot, slide it; otherwise shake it.
   * @param {number} solvedIdx
   */
  onTileClick(solvedIdx) {
    if (this.locked || this.solved) return;
    const pos = this.state.indexOf(solvedIdx);
    const empty = this.emptyIndex;
    if (this.neighbors(pos).includes(empty)) {
      this.slide(pos, true);
    } else {
      this.shake(solvedIdx);
    }
  }

  /**
   * Swap the tile at `pos` into the empty slot. When `countMove` is true this
   * is a player move: increments the counter, starts the timer on first move,
   * and checks for a win. Shuffle moves pass false.
   * @param {number} pos board index of the tile to move (must be adjacent to empty)
   * @param {boolean} countMove whether this counts as a player move
   */
  slide(pos, countMove) {
    const empty = this.emptyIndex;
    this.state[empty] = this.state[pos];
    this.state[pos] = null;
    this.layout();

    if (countMove) {
      if (!this.running) this.startTimer();
      this.moves++;
      this.updateMoves();
      if (this.checkWin()) this.win();
    }
  }

  /**
   * Reset to solved, then apply SHUFFLE_MOVES random valid slides without ever
   * immediately undoing the previous move. Guarantees a solvable board that is
   * (almost surely) not already solved.
   */
  shuffle() {
    this.setup(this.n);
    let prevEmpty = -1; // where the empty slot was BEFORE the last move
    for (let i = 0; i < SHUFFLE_MOVES; i++) {
      const empty = this.emptyIndex;
      // Tiles that could slide into the empty slot = neighbors of empty.
      // Skip the one that would just undo the previous move (sending the empty
      // back to where it came from): that's the neighbor equal to prevEmpty.
      const candidates = this.neighbors(empty).filter((p) => p !== prevEmpty);
      const choice = candidates[Math.floor(Math.random() * candidates.length)];
      prevEmpty = empty;
      this.slide(choice, false);
    }
    this.solved = false;
    // Extremely unlikely with 220 moves, but guard: if we landed on solved,
    // nudge with a couple more valid slides.
    if (this.isSolvedState()) {
      const empty = this.emptyIndex;
      const c = this.neighbors(empty)[0];
      this.slide(c, false);
    }
  }

  /** @returns {boolean} true if every tile is in its solved position. */
  isSolvedState() {
    for (let i = 0; i < this.state.length - 1; i++) {
      if (this.state[i] !== i) return false;
    }
    return this.state[this.state.length - 1] === null;
  }

  /** @returns {boolean} win check used after a counted move. */
  checkWin() {
    return this.isSolvedState();
  }

  /** Briefly shake a non-slidable tile to signal "can't move". */
  shake(solvedIdx) {
    const tile = this.tiles.get(solvedIdx);
    if (!tile) return;
    tile.classList.remove("shake");
    // force reflow so the animation can restart if clicked rapidly
    void tile.offsetWidth;
    tile.classList.add("shake");
  }

  // ---- Timer ----------------------------------------------------------------

  /** Start the timer (called on the first counted move after a shuffle). */
  startTimer() {
    this.running = true;
    this.startTs = performance.now();
    const tick = () => {
      if (!this.running) return;
      this.updateTime(performance.now() - this.startTs);
      this.timerRaf = requestAnimationFrame(tick);
    };
    this.timerRaf = requestAnimationFrame(tick);
  }

  /** Stop the timer rAF loop (does not reset elapsed display). */
  stopTimer() {
    this.running = false;
    if (this.timerRaf) {
      cancelAnimationFrame(this.timerRaf);
      this.timerRaf = null;
    }
  }

  /** @returns {number} elapsed milliseconds since the timer started. */
  elapsedMs() {
    return this.startTs == null ? 0 : performance.now() - this.startTs;
  }

  /**
   * Format milliseconds as M:SS.
   * @param {number} ms
   * @returns {string}
   */
  static fmt(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /** @param {number} ms */
  updateTime(ms) {
    this.refs.timeEl.textContent = SlidingPuzzle.fmt(ms);
  }

  updateMoves() {
    this.refs.movesEl.textContent = String(this.moves);
  }

  // ---- Win ------------------------------------------------------------------

  /** Mark solved, stop the timer, freeze elapsed, and show the win overlay. */
  win() {
    this.solved = true;
    const finalMs = this.elapsedMs();
    this.stopTimer();
    this.updateTime(finalMs);
    this.refs.winTime.textContent = SlidingPuzzle.fmt(finalMs);
    this.refs.winMoves.textContent = String(this.moves);
    this.lastWin = { moves: this.moves, ms: finalMs };
    // Small delay so the final tile finishes sliding before the overlay fades in.
    setTimeout(() => this.refs.overlay.classList.add("show"), 180);
    if (typeof this.refs.onWin === "function") this.refs.onWin(this.lastWin);
  }
}

/* ===========================================================================
   Wiring — build the selector, hook the controls, boot the puzzle.
   =========================================================================== */
function initPuzzle() {
  const board = $("puzzleBoard");
  if (!board) return; // puzzle section not present — nothing to do.

  const puzzle = new SlidingPuzzle({
    board,
    timeEl: $("puzzleTime"),
    movesEl: $("puzzleMoves"),
    overlay: $("puzzleWin"),
    winTime: $("puzzleWinTime"),
    winMoves: $("puzzleWinMoves"),
    onWin: null,
  });

  // Build difficulty buttons.
  const diffWrap = $("puzzleDifficulty");
  let activeN = DIFFICULTIES[0].n;
  const diffButtons = new Map();
  DIFFICULTIES.forEach((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "puzzle-diff-btn";
    btn.setAttribute("aria-pressed", d.n === activeN ? "true" : "false");
    btn.innerHTML =
      `<span class="diff-main">${d.label}</span>` +
      `<span class="diff-sub">${d.sub}</span>`;
    btn.addEventListener("click", () => {
      activeN = d.n;
      diffButtons.forEach((b, n) => {
        const on = n === activeN;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      puzzle.shuffle(); // switching difficulty starts a fresh shuffled game
    });
    if (d.n === activeN) btn.classList.add("active");
    diffButtons.set(d.n, btn);
    diffWrap.appendChild(btn);
  });

  // Shuffle / new game.
  const shuffleBtn = $("puzzleShuffle");
  shuffleBtn.addEventListener("click", () => puzzle.shuffle());

  // Reference (hint) toggle — shows the full Genesis faintly behind the board.
  const refBtn = $("puzzleReference");
  if (refBtn) {
    refBtn.addEventListener("click", () => {
      const on = board.classList.toggle("show-reference");
      refBtn.classList.toggle("active", on);
      refBtn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // Win overlay buttons.
  const playAgain = $("puzzlePlayAgain");
  if (playAgain) playAgain.addEventListener("click", () => puzzle.shuffle());

  const shareBtn = $("puzzleShare");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const win = puzzle.lastWin || { moves: puzzle.moves, ms: puzzle.elapsedMs() };
      const time = SlidingPuzzle.fmt(win.ms);
      const grid = `${puzzle.n}×${puzzle.n}`;
      const text =
        `I reassembled @thegaboeth's Genesis #0 (${grid}) in ${win.moves} moves · ${time} 🧩\n\n` +
        `Gabo Fragments Society — 1 artwork, 991 fragments.\n\n` +
        `https://gfs-lab.vercel.app/`;
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener");
    });
  }

  // First paint: solved board so visitors see the full Genesis, then a single
  // gentle shuffle so it's immediately playable.
  puzzle.setup(activeN);
  puzzle.shuffle();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPuzzle);
} else {
  initPuzzle();
}

export { SlidingPuzzle, DIFFICULTIES };
