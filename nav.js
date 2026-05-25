/* Mobile tab bar — scroll-spy.
 *
 * Highlights the tab whose section is currently crossing the middle of the
 * viewport, giving the bottom bar a native-app "current tab" feel. Smooth
 * scrolling itself is handled by CSS (scroll-behavior). No-op on desktop
 * where the bar is hidden, but harmless to run.
 */
(() => {
  const tabs = Array.from(document.querySelectorAll(".tabbar .tab"));
  if (!tabs.length) return;

  const sections = tabs
    .map((t) => document.getElementById(t.dataset.section))
    .filter(Boolean);
  if (!sections.length) return;

  let activeId = null;
  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    for (const t of tabs) {
      const on = t.dataset.section === id;
      t.classList.toggle("is-active", on);
      if (on) t.setAttribute("aria-current", "true");
      else t.removeAttribute("aria-current");
    }
  }

  // Active section = the last one whose top has scrolled past a reference line
  // ~40% down the viewport. This assigns exactly one active section at every
  // scroll position regardless of section height — unlike a thin intersection
  // band, which misses very tall sections (the hero, the puzzle) whose
  // intersection ratio stays small.
  let raf = 0;
  function update() {
    raf = 0;
    const ref = window.innerHeight * 0.4;
    let current = sections[0].id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= ref) current = s.id;
    }
    // At the very bottom of the page, force the last section (it may be too
    // short to ever reach the reference line).
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
      current = sections[sections.length - 1].id;
    }
    setActive(current);
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(update);
  }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  update(); // initial state
})();

/* Pin the tab bar to the VISUAL viewport bottom.
 *
 * A position:fixed bottom bar anchors to the LAYOUT viewport, but mobile
 * browser chrome — notably iOS Safari's bottom address bar — sits below the
 * visual viewport and overlaps the bar until the user scrolls and the chrome
 * collapses (the "only half shows" symptom). visualViewport reports the real
 * visible area, so we offset the bar up by however much chrome covers the
 * bottom. No-op on desktop and where there's no overlap (e.g. Android, or an
 * installed standalone PWA with no browser chrome).
 */
(() => {
  const bar = document.querySelector(".tabbar");
  const vv = window.visualViewport;
  if (!bar || !vv) return;

  let raf = 0;
  function pin() {
    raf = 0;
    const overlap = window.innerHeight - vv.height - vv.offsetTop;
    // Apply only for browser-chrome-sized overlaps; ignore the on-screen
    // keyboard (which would otherwise fling the bar up over the input).
    bar.style.transform =
      overlap > 1 && overlap < 160 ? `translateY(${-Math.round(overlap)}px)` : "";
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(pin);
  }
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", schedule);
  pin();
})();
