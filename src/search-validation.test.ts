import { describe, expect, it } from "vitest";
import { prepareSearchQuery, validateSearchQuery } from "./index.js";

describe("validateSearchQuery", () => {
  // --- Should pass ---

  it("accepts a single word", () => {
    expect(() => validateSearchQuery("kafka")).not.toThrow();
  });

  it("accepts a single quoted phrase", () => {
    expect(() => validateSearchQuery('"binary tree"')).not.toThrow();
  });

  it("accepts words joined by OR", () => {
    expect(() => validateSearchQuery("PostgreSQL OR postgres OR psql")).not.toThrow();
  });

  it("accepts words joined by AND", () => {
    expect(() => validateSearchQuery("kafka AND streams")).not.toThrow();
  });

  it("accepts quoted phrases joined by AND", () => {
    expect(() => validateSearchQuery('"some text" AND "some other text"')).not.toThrow();
  });

  it("accepts quoted phrases joined by OR", () => {
    expect(() => validateSearchQuery('"binary tree" OR "B-tree"')).not.toThrow();
  });

  it("accepts mix of bare word and quoted phrase with OR", () => {
    expect(() => validateSearchQuery('btree OR "binary tree"')).not.toThrow();
  });

  it("accepts field-scoped searches", () => {
    expect(() => validateSearchQuery("deck:programming")).not.toThrow();
  });

  it("accepts field-scoped with bare word", () => {
    expect(() => validateSearchQuery("tag:leech kafka")).not.toThrow();
  });

  it("accepts negated quoted phrase", () => {
    expect(() => validateSearchQuery('-"excluded phrase"')).not.toThrow();
  });

  it("accepts a single hyphenated word", () => {
    expect(() => validateSearchQuery("B-tree")).not.toThrow();
  });

  it("accepts empty-ish query after stripping", () => {
    expect(() => validateSearchQuery('"only quoted"')).not.toThrow();
  });

  // --- Should fail ---

  it("rejects bare multi-word query without operators and suggests AND/OR", () => {
    expect(() => validateSearchQuery("binary tree")).toThrow(
      "Multi-word search \"binary tree\" must use AND/OR operators or quotes. Examples: 'binary AND tree' or '\"binary tree\"'",
    );
  });

  it("rejects three bare words without operators and suggests AND/OR", () => {
    expect(() => validateSearchQuery("red black tree")).toThrow("must use AND/OR operators or quotes");
  });

  it("rejects multi-word segments with operators and lists all that need quotes", () => {
    expect(() => validateSearchQuery("system design OR distributed systems OR scalability")).toThrow(
      'Multi-word terms must be wrapped in quotes: "system design", "distributed systems"',
    );
  });

  it("rejects bare words even with extra spaces", () => {
    expect(() => validateSearchQuery("binary   tree")).toThrow("must use AND/OR operators or quotes");
  });

  it("rejects multi-word segment mixed with single words and OR", () => {
    expect(() => validateSearchQuery("kubernetes pod OR deployment")).toThrow(
      'Multi-word terms must be wrapped in quotes: "kubernetes pod"',
    );
  });
});

describe("prepareSearchQuery", () => {
  // --- Bare words get w: prefix ---

  it("prefixes a single bare word", () => {
    expect(prepareSearchQuery("WAL")).toBe("w:WAL");
  });

  it("prefixes a hyphenated bare word", () => {
    expect(prepareSearchQuery("B-tree")).toBe("w:B-tree");
  });

  it("prefixes bare words joined by OR", () => {
    expect(prepareSearchQuery("PostgreSQL OR postgres")).toBe("w:PostgreSQL OR w:postgres");
  });

  it("prefixes bare words joined by AND", () => {
    expect(prepareSearchQuery("kafka AND streams")).toBe("w:kafka AND w:streams");
  });

  it("prefixes multiple bare words with OR", () => {
    expect(prepareSearchQuery("PostgreSQL OR postgres OR psql")).toBe("w:PostgreSQL OR w:postgres OR w:psql");
  });

  // --- Quoted phrases stay as-is ---

  it("does not prefix a quoted phrase", () => {
    expect(prepareSearchQuery('"binary tree"')).toBe('"binary tree"');
  });

  it("does not prefix a negated quoted phrase", () => {
    expect(prepareSearchQuery('-"excluded phrase"')).toBe('-"excluded phrase"');
  });

  // --- Mixed cases ---

  it("prefixes bare word but not quoted phrase in OR", () => {
    expect(prepareSearchQuery('btree OR "binary tree"')).toBe('w:btree OR "binary tree"');
  });

  it("does not prefix field-scoped terms", () => {
    expect(prepareSearchQuery("tag:leech")).toBe("tag:leech");
  });

  it("prefixes bare word but not field-scoped term", () => {
    expect(prepareSearchQuery("tag:leech kafka")).toBe("tag:leech w:kafka");
  });

  it("handles quoted phrases joined by AND", () => {
    expect(prepareSearchQuery('"some text" AND "other text"')).toBe('"some text" AND "other text"');
  });

  it("prefixes bare word mixed with quoted phrases and OR", () => {
    expect(prepareSearchQuery('"system design" OR "distributed systems" OR scalability')).toBe(
      '"system design" OR "distributed systems" OR w:scalability',
    );
  });
});
