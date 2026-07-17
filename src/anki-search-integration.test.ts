import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSearchQuery, formatSearchNote, isAllowedZdoneBasicNote, prepareSearchQuery } from "./index.js";

const HIDDEN_FIELDS = ["zdone Unified ID", "Is Multi Answer?", "Front Image", "Back Image", "Source", "Debug"];

interface FixtureNote {
  fixtureLabel: string;
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}

describe("search with the Anki backend", () => {
  it("applies the Clanki query and result formatting to a temporary Anki collection", { timeout: 120_000 }, () => {
    const query = buildSearchQuery(prepareSearchQuery("fixtureterm"));
    const fixturePath = fileURLToPath(new URL("../tests/anki_search_fixture.py", import.meta.url));
    const result = spawnSync("uv", ["run", "--locked", "python", fixturePath], {
      cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
      encoding: "utf8",
      env: {
        ...process.env,
        UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "clanki-uv-cache"),
      },
      input: JSON.stringify({ query }),
    });

    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);

    const response = JSON.parse(result.stdout) as { notes: FixtureNote[] };
    expect(response.notes.map((note) => note.fixtureLabel).sort()).toEqual([
      "historical_review",
      "non_basic_review",
      "software_review",
    ]);

    for (const label of ["software_review", "historical_review"]) {
      const note = response.notes.find((candidate) => candidate.fixtureLabel === label);
      expect(note).toBeDefined();
      expect(isAllowedZdoneBasicNote(note)).toBe(true);

      const formatted = formatSearchNote(note);
      expect(formatted).toContain("Front Text: fixtureterm");
      const formattedLines = formatted.split("\n");
      for (const fieldName of HIDDEN_FIELDS) {
        expect(note?.fields[fieldName].value).not.toBe("");
        expect(formattedLines.some((line) => line.startsWith(`${fieldName}:`))).toBe(false);
      }
    }

    const nonBasicNote = response.notes.find((note) => note.fixtureLabel === "non_basic_review");
    expect(nonBasicNote).toBeDefined();
    expect(isAllowedZdoneBasicNote(nonBasicNote)).toBe(false);
    const nonBasicFormatted = formatSearchNote(nonBasicNote);
    for (const fieldName of HIDDEN_FIELDS) {
      expect(nonBasicFormatted).toContain(`${fieldName}:`);
    }
  });
});
