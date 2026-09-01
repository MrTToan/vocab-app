"use client";

import { useEffect } from "react";

/*
 * Client motion island for the MNTN landing page. Reproduces the prototype's
 * choreography on the server-rendered markup:
 *   · nav turns from transparent/white to paper/ink after the first 40px
 *   · the left rail flips dark once the hero has scrolled past
 *   · the hero content fades/rises in shortly after mount
 *   · each [data-reveal] section fades/rises its .r children in on first view
 * Honors prefers-reduced-motion (everything shown immediately, no observers).
 * Pure class toggling on existing DOM — no markup created here.
 */
export default function MarketingMotion() {
  useEffect(() => {
    const reduce =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nav = document.getElementById("mntn-nav");
    const rail = document.getElementById("mntn-rail");
    const hero = document.getElementById("top");

    const onScroll = () => {
      const past = window.scrollY > window.innerHeight - 90;
      nav?.classList.toggle("scrolled", window.scrollY > 40);
      rail?.classList.toggle("dark", past);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // reveal hero content (skip the fade when reduced motion is requested)
    let heroTimer: ReturnType<typeof setTimeout> | undefined;
    let heroRaf: number | undefined;
    if (reduce) {
      hero?.classList.add("in-view");
    } else {
      heroRaf = requestAnimationFrame(() => {
        heroTimer = setTimeout(() => hero?.classList.add("in-view"), 140);
      });
    }

    const secs = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    let io: IntersectionObserver | undefined;
    if (reduce || typeof IntersectionObserver === "undefined") {
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
      secs.forEach((s) => io?.observe(s));
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (heroRaf) cancelAnimationFrame(heroRaf);
      if (heroTimer) clearTimeout(heroTimer);
      io?.disconnect();
    };
  }, []);

  return null;
}
