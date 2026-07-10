import { describe, expect, it } from "vitest";
import { findAbbreviationHints, stripHtml } from "./index.js";

describe("stripHtml", () => {
  it("removes inline tags without inserting a gap", () => {
    expect(stripHtml("<b>D</b>ietary <b>A</b>pproaches")).toBe("Dietary Approaches");
  });

  it("converts <br> variants to a space", () => {
    expect(stripHtml("a<br>b")).toBe("a b");
    expect(stripHtml("a<br/>b")).toBe("a b");
    expect(stripHtml("a<br />b")).toBe("a b");
  });

  it("converts block/list tags to spaces", () => {
    expect(stripHtml("<li>x</li><li>y</li>")).toBe("x y");
    expect(stripHtml("<ul><li>Ubuntu</li><li>Debian</li></ul>")).toBe("Ubuntu Debian");
    expect(stripHtml("<div>one</div><div>two</div>")).toBe("one two");
  });

  it("decodes common HTML entities", () => {
    expect(stripHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(stripHtml("a&nbsp;b")).toBe("a b");
    expect(stripHtml("&lt;tag&gt;")).toBe("<tag>");
    expect(stripHtml("she said &quot;hi&quot;")).toBe('she said "hi"');
    expect(stripHtml("it&#39;s")).toBe("it's");
  });

  it("collapses whitespace and trims", () => {
    expect(stripHtml("  a   b  ")).toBe("a b");
    expect(stripHtml("<p>  hello </p>")).toBe("hello");
  });

  it("returns an empty string for tag-only input", () => {
    expect(stripHtml("<br>")).toBe("");
  });
});

describe("findAbbreviationHints", () => {
  const ABBREVIATION = "DASH";
  const FRONT = "<b>D</b>ietary <b>A</b>pproaches to <b>S</b>top <b>H</b>ypertension";

  it("returns [] when the definition shares no content words", () => {
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "An eating plan that lowers blood pressure.")).toEqual([]);
  });

  it("flags a shared content word, case-insensitively", () => {
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "A regimen to reduce hypertension.")).toEqual(["Hypertension"]);
  });

  it("matches regardless of which side is upper/lower case", () => {
    expect(findAbbreviationHints(ABBREVIATION, "Dietary plan", "a DIETARY thing")).toEqual(["Dietary"]);
  });

  it("ignores stop words even when shared", () => {
    // "to" is in both Front and Back but must not be flagged.
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "How to lower blood pressure.")).toEqual([]);
  });

  it("ignores words of two characters or fewer", () => {
    // "Of" (2 chars) appears in both but is too short to flag.
    expect(findAbbreviationHints(ABBREVIATION, "Of Mice", "a story of farms")).toEqual([]);
  });

  it("matches whole words only, not substrings", () => {
    // Front "Stop" must not match Back "stopped"/"nonstop".
    expect(findAbbreviationHints(ABBREVIATION, "Stop sign", "the bus stopped at a nonstop route")).toEqual([]);
  });

  it("strips HTML in the Back field before matching", () => {
    expect(findAbbreviationHints(ABBREVIATION, "Approaches taken", "various <b>approaches</b> exist")).toEqual([
      "Approaches",
    ]);
  });

  it("matches across trailing punctuation in the Back field", () => {
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "It treats hypertension.")).toEqual(["Hypertension"]);
  });

  it("returns multiple hits, deduped, preserving original Front casing", () => {
    const back = "a Dietary approach that targets hypertension and more hypertension";
    expect(findAbbreviationHints(ABBREVIATION, FRONT, back)).toEqual(["Dietary", "Hypertension"]);
  });

  it("flags the abbreviation itself, including abbreviations of two characters or fewer", () => {
    expect(findAbbreviationHints("AI", "Artificial Intelligence", "AI model behavior")).toEqual(["AI"]);
  });

  it("flags the abbreviation case-insensitively and next to punctuation", () => {
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "A dash-based eating plan.")).toEqual(["DASH"]);
  });

  it("does not match the abbreviation inside another word", () => {
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "A dashboard for meal planning.")).toEqual([]);
  });

  it("returns the abbreviation and reused expansion words without duplicates", () => {
    expect(findAbbreviationHints(ABBREVIATION, FRONT, "The DASH regimen treats hypertension.")).toEqual([
      "DASH",
      "Hypertension",
    ]);
  });
});
