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

  // Shrink the observer root to a thin band in the vertical middle of the
  // viewport; whichever section crosses that band is the active one.
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setActive(visible[0].target.id);
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.01, 0.25, 0.5, 1] }
  );
  sections.forEach((s) => io.observe(s));

  setActive(sections[0].id); // default before first scroll
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
