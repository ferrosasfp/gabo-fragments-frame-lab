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
