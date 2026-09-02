"use client";

import { useEffect } from "react";

// Progressive-enhancement only: toggles the nav's `scrolled` state as the page
// moves off the top. The hero reveal is pure CSS (a one-time load entrance that
// honours prefers-reduced-motion), so nothing here gates the page's content —
// it stays fully readable with JS disabled. Returns null.
export default function AboutMotion() {
  useEffect(() => {
    const nav = document.getElementById("about-nav");
    const onScroll = () => {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 40);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
