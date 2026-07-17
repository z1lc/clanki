import { describe, expect, it } from "vitest";
import { buildSearchQuery, formatSearchNote, isAllowedZdoneBasicNote } from "./index.js";

function makeNote(modelName: string, idValue?: string) {
  return {
    noteId: 123,
    modelName,
    fields: {
      "zdone Unified ID": { value: idValue ?? "" },
      "Front Text": { value: "Which system is row-oriented?" },
      "Front Replacement Text for Back": { value: "System A is row-oriented." },
      Answer: { value: "System A" },
      Hint: { value: "database" },
      "Extra Text": { value: "Additional context" },
      "Is Multi Answer?": { value: "yes" },
      "Front Image": { value: "front.png" },
      "Back Image": { value: "back.png" },
      Source: { value: "https://example.com" },
      Debug: { value: "generation details" },
    },
  };
}

describe("buildSearchQuery", () => {
  it("allows only the two selected zdone Basic ID markers", () => {
    expect(buildSearchQuery("w:database")).toBe(
      'deck:z -is:suspended -is:new (-note:Basic OR (note:Basic ("zdone Unified ID:*SOFTWARE\\_A\\_VS\\_B*" OR "zdone Unified ID:*HISTORICAL\\_EVENT\\_DESCRIPTION\\_TO\\_NAME*"))) (w:database)',
    );
  });

  it("preserves a prepared compound query as a grouped condition", () => {
    expect(buildSearchQuery('w:PostgreSQL OR "relational database"')).toContain(
      '(w:PostgreSQL OR "relational database")',
    );
  });
});

describe("isAllowedZdoneBasicNote", () => {
  it.each([
    "SOFTWARE_A_VS_B",
    "HISTORICAL_EVENT_DESCRIPTION_TO_NAME",
  ])("accepts a Basic note whose ID contains %s", (marker) => {
    expect(isAllowedZdoneBasicNote(makeNote("Basic", `zdone:example:1/${marker}`))).toBe(true);
  });

  it("matches ID markers case-insensitively", () => {
    expect(isAllowedZdoneBasicNote(makeNote("Basic", "zdone:example:1/software_a_vs_b"))).toBe(true);
  });

  it("rejects unrelated Basic notes", () => {
    expect(isAllowedZdoneBasicNote(makeNote("Basic", "zdone:example:1/OTHER_TEMPLATE"))).toBe(false);
  });

  it("rejects non-Basic notes even when the ID contains an allowed marker", () => {
    expect(isAllowedZdoneBasicNote(makeNote("Video", "zdone:example:1/SOFTWARE_A_VS_B"))).toBe(false);
  });

  it("rejects Basic notes without a zdone ID", () => {
    expect(isAllowedZdoneBasicNote(makeNote("Basic"))).toBe(false);
  });
});

describe("formatSearchNote", () => {
  it("hides metadata fields for an allowed zdone Basic note", () => {
    const formatted = formatSearchNote(makeNote("Basic", "zdone:example:1/SOFTWARE_A_VS_B"));

    expect(formatted).toContain("Note ID: 123");
    expect(formatted).toContain("Front Text: Which system is row-oriented?");
    expect(formatted).toContain("Front Replacement Text for Back: System A is row-oriented.");
    expect(formatted).toContain("Answer: System A");
    expect(formatted).toContain("Hint: database");
    expect(formatted).toContain("Extra Text: Additional context");
    expect(formatted).not.toContain("zdone Unified ID:");
    expect(formatted).not.toContain("Is Multi Answer?:");
    expect(formatted).not.toContain("Front Image:");
    expect(formatted).not.toContain("Back Image:");
    expect(formatted).not.toContain("Source:");
    expect(formatted).not.toContain("Debug:");
  });

  it("does not hide fields on unrelated Basic notes", () => {
    const formatted = formatSearchNote(makeNote("Basic", "zdone:example:1/OTHER_TEMPLATE"));

    expect(formatted).toContain("zdone Unified ID: zdone:example:1/OTHER_TEMPLATE");
    expect(formatted).toContain("Source: https://example.com");
    expect(formatted).toContain("Debug: generation details");
  });

  it("does not hide fields on non-Basic notes", () => {
    const formatted = formatSearchNote(makeNote("Video", "zdone:example:1/SOFTWARE_A_VS_B"));

    expect(formatted).toContain("zdone Unified ID: zdone:example:1/SOFTWARE_A_VS_B");
    expect(formatted).toContain("Source: https://example.com");
    expect(formatted).toContain("Debug: generation details");
  });
});
