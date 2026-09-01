"use client";

import { useEffect } from "react";

// Progressive-enhancement only: toggles the nav's `scrolled` state and reveals
// `[data-reveal]` sections as they enter the viewport. The page is fully
// readable with JS disabled (reveal styles only hide when this runs and honour
// prefers-reduced-motion). Returns null — it just wires DOM behaviour.
export default function GuideMotion() {
  useEffect(() => {
    const reduce =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nav = document.getElementById("guide-nav");
    const onScroll = () => {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 40);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const secs = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );

    let io: IntersectionObserver | undefined;
    if (reduce || !("IntersectionObserver" in window)) {
      secs.forEach((s) => s.classList.add("in-view"));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in-view");
              io?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12 },
      );
      secs.forEach((s) => io!.observe(s));
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
    };
  }, []);

  return null;
}
