import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseModelJson } from "./index.js";

const CardSchema = z.object({
  front: z.string(),
  back: z.string(),
  extra: z.string().optional(),
});

describe("parseModelJson", () => {
  it("parses strict JSON", () => {
    expect(parseModelJson('{"front":"f","back":"b"}', "test", CardSchema)).toEqual({ front: "f", back: "b" });
  });

  it("parses JSON wrapped in a code fence", () => {
    const raw = '```json\n{"front":"f","back":"b"}\n```';
    expect(parseModelJson(raw, "test", CardSchema)).toEqual({ front: "f", back: "b" });
  });

  it("parses the first complete JSON value when the model appends prose", () => {
    const raw = '{"front":"f","back":"b"}\nThis fixes the card.';
    expect(parseModelJson(raw, "test", CardSchema)).toEqual({ front: "f", back: "b" });
  });

  it("parses the first complete JSON value when the model emits a second JSON value", () => {
    const raw = '{"front":"f","back":"b"}\n{"ignored":true}';
    expect(parseModelJson(raw, "test", CardSchema)).toEqual({ front: "f", back: "b" });
  });

  it("handles braces inside strings while finding the end of the JSON value", () => {
    const raw = '{"front":"What does {{c1::x}} mean?","back":"Use } literally"}\nDone.';
    expect(parseModelJson(raw, "test", CardSchema)).toEqual({
      front: "What does {{c1::x}} mean?",
      back: "Use } literally",
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseModelJson('{"front":"f","back":"unterminated}', "test", CardSchema)).toThrow();
  });
});
