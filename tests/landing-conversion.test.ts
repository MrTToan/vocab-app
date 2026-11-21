import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { metadata } from "@/app/layout";

/*
 * Landing-audit conversion pass (findings 2, 3, 5, 6, 8). The landing is a
 * server component with next/font, so these are structural source guards that
 * pin the conversion decisions so a later restyle can't silently undo them.
 */
const root = join(__dirname, "..");
const page = readFileSync(join(root, "app", "(marketing)", "page.tsx"), "utf8");
const css = readFileSync(join(root, "app", "(marketing)", "marketing.css"), "utf8");

const heroSrc = page.slice(page.indexOf('<header className="hero"'), page.indexOf("</header>"));
const closeSrc = page.slice(page.indexOf('<section className="close"'), page.indexOf("<footer"));

describe("landing hero (finding 2)", () => {
  it("says what Lexi is and who it's for, with one primary sign-in-aware CTA", () => {
    expect(heroSrc).toMatch(/English vocabulary/);
    expect(heroSrc).toMatch(/IELTS/);
    expect(heroSrc).toMatch(/className="hero-sub/);
    // One primary button, through AppLink (signed out → Google sign-in, PR #79).
    expect(heroSrc.match(/<AppLink/g)).toHaveLength(1);
    expect(heroSrc).toMatch(/<AppLink className="cbtn" to="\/vocab">\s*Start practicing free/);
  });

  it("carries the recognise/produce positioning line", () => {
    expect(heroSrc).toMatch(/<i>recognise<\/i>[\s\S]*<i>produce<\/i>/);
  });

  it("drops the template 'Scroll to begin' cue and the 'Follow the climb' rail", () => {
    expect(page).not.toMatch(/Scroll to begin/);
    expect(page).not.toMatch(/Follow the climb/);
    expect(page).not.toMatch(/mntn-rail/);
    expect(css).not.toMatch(/\.rail\b/);
  });
});

describe("landing copy (findings 3, 5)", () => {
  it("intro is benefit bullets without infrastructure jargon", () => {
    expect(page).toMatch(/<ul className="benefits/);
    expect(page).not.toMatch(/fallback chain|multi-provider/);
  });

  it("closing band has one primary button; IELTS writing is a text link", () => {
    expect(closeSrc.match(/className="cbtn/g)).toHaveLength(1);
    expect(closeSrc).toMatch(/<AppLink className="cbtn" to="\/vocab">/);
    expect(closeSrc).toMatch(/<AppLink className="textlink" to="\/writing">/);
    expect(closeSrc).not.toMatch(/ghost/);
  });
});

describe("landing a11y + ship basics (findings 6, 8)", () => {
  it("has a <main> landmark, a skip link and no skipped heading level", () => {
    expect(page).toMatch(/<a className="skip" href="#main">/);
    expect(page).toMatch(/<main id="main"/);
    expect(page).not.toMatch(/<h4/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/\.cbtn:active/);
  });

  it("ships a branded favicon, not the create-next-app default", () => {
    const ico = readFileSync(join(root, "app", "favicon.ico"));
    expect(createHash("md5").update(ico).digest("hex")).not.toBe(
      "c30c7d42707a47a3f4591831641e50dc",
    );
    expect(existsSync(join(root, "app", "icon.svg"))).toBe(true);
    expect(existsSync(join(root, "app", "apple-icon.png"))).toBe(true);
  });

  it("has share-preview metadata and images", () => {
    expect(metadata.metadataBase?.toString()).toMatch(/^https:\/\//);
    expect(metadata.openGraph).toBeTruthy();
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(existsSync(join(root, "app", "opengraph-image.jpg"))).toBe(true);
    expect(existsSync(join(root, "app", "twitter-image.jpg"))).toBe(true);
  });

  it("has a branded 404", () => {
    const nf = readFileSync(join(root, "app", "not-found.tsx"), "utf8");
    expect(nf).toMatch(/className=\{`mntn nf/);
    expect(nf).toMatch(/href="\/"/);
  });
});
