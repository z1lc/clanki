import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AnkiRequestFunction, createMcpServer } from "./index.js";

const DEFAULT_DECK = "z::1 ∞ (manual catch-all)::0 interview prep::0 mcp";
const CLOZE_TABLE_DECK = "z::ClozeTableManager Fixtures";
const MCP_TAG = "mcp_generated";
const EXTRA_IMAGE_FIELD = "Extra Image \uD83D\uDDBC\uFE0F";

interface NoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  cards: number[];
}

interface BridgeResponse<T> {
  result: T;
  error: string | null;
}

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const bridgePath = fileURLToPath(new URL("../tests/anki_backend_bridge.py", import.meta.url));
const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "clanki-tools-e2e-"));
const collectionPath = path.join(fixtureDirectory, "collection.anki2");

const requestAnki: AnkiRequestFunction = <T>(action: string, params: Record<string, any> = {}): Promise<T> => {
  const result = spawnSync("uv", ["run", "--locked", "python", bridgePath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "clanki-uv-cache"),
    },
    input: JSON.stringify({ collectionPath, action, params }),
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Anki fixture process failed (${result.status}): ${result.stderr}`);
  }

  const response = JSON.parse(result.stdout) as BridgeResponse<T>;
  if (response.error) {
    const error = new Error(`AnkiConnect error: ${response.error}`);
    Object.assign(error, { ankiError: true });
    throw error;
  }
  return Promise.resolve(response.result);
};

function resultText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Tool result did not contain content");
  }
  return result.content
    .filter((item): item is { type: "text"; text: string } => {
      return typeof item === "object" && item !== null && (item as { type?: string }).type === "text";
    })
    .map((item) => item.text)
    .join("\n");
}

function noteIdFrom(result: unknown): number {
  const match = resultText(result).match(/noteId: (\d+)/);
  if (!match) throw new Error(`Tool result did not contain a note ID: ${resultText(result)}`);
  return Number(match[1]);
}

async function getNote(noteId: number): Promise<NoteInfo> {
  const notes = await requestAnki<NoteInfo[]>("notesInfo", { notes: [noteId] });
  if (notes.length !== 1) throw new Error(`Expected note ${noteId} to exist`);
  return notes[0];
}

async function addFixtureNote(
  modelName: string,
  fields: Record<string, string>,
  tags: string[] = [],
  deckName = DEFAULT_DECK,
): Promise<number> {
  return requestAnki<number>("addNote", {
    note: { deckName, modelName, fields, tags },
  });
}

describe("public MCP tools with the Anki backend", () => {
  let server: Server;
  let client: Client;

  beforeAll(async () => {
    await requestAnki("deckNames");
    server = createMcpServer({
      ankiRequest: requestAnki,
      validateCard: async (front, back, extra) => ({ front, back, extra }),
      reformulatePlaceholders: async (headers, rows) => ({ headers, rows }),
      showAttributePicker: async (data) => ({
        selectedAttributes: data.attributeLabels.map((_, index) => index),
        clozeItems: true,
        clozeItemHints: false,
      }),
      updatePickerData: () => {},
    });
    client = new Client({ name: "clanki-e2e", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await server?.close();
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("advertises only public tools and serves the card guidelines resource", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "create-basic-card",
      "update-basic-card",
      "create-abbreviation-definition-card",
      "create-programming-language-function-card",
      "update-programming-language-function-card",
      "create-leetcode-question-card",
      "update-leetcode-question-card",
      "search-collection",
      "create-cloze-table",
    ]);
    expect(tools.tools.map((tool) => tool.name)).not.toContain("create-cloze-card");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("update-cloze-card");

    const resources = await client.listResources();
    expect(resources.resources).toHaveLength(1);
    expect(resources.resources[0].uri).toBe("anki://basic-card-creation-guidelines");

    const resource = await client.readResource({ uri: resources.resources[0].uri });
    expect(resource.contents[0]).toMatchObject({
      uri: "anki://basic-card-creation-guidelines",
      mimeType: "text/plain",
    });
    expect((resource.contents[0] as { text: string }).text).toContain("Ask only a single question");
  });

  it("creates and updates a basic card and rejects updates to an untagged note", async () => {
    const created = await client.callTool({
      name: "create-basic-card",
      arguments: {
        front: "What protocol maps names to IP addresses?",
        back: "DNS",
        context: "Networking",
        extra: "It commonly uses UDP port 53.",
        source: "RFC 1035",
      },
    });
    expect(created.isError).not.toBe(true);
    const noteId = noteIdFrom(created);

    expect(await getNote(noteId)).toMatchObject({
      modelName: "1 Basic",
      tags: [MCP_TAG],
      fields: {
        Front: { value: "What protocol maps names to IP addresses?" },
        Back: { value: "DNS" },
        "Context 💡": { value: "Networking" },
        "Extra ➕": { value: "It commonly uses UDP port 53." },
        "Source 🎯": { value: "RFC 1035" },
      },
    });

    const updated = await client.callTool({
      name: "update-basic-card",
      arguments: { noteId, back: "Domain Name System", extra: "", source: "Updated source" },
    });
    expect(updated.isError).not.toBe(true);
    expect(await getNote(noteId)).toMatchObject({
      fields: {
        Back: { value: "Domain Name System" },
        "Extra ➕": { value: "" },
        "Source 🎯": { value: "Updated source" },
      },
    });

    const untaggedNoteId = await addFixtureNote("1 Basic", { Front: "Existing", Back: "Card" });
    const rejected = await client.callTool({
      name: "update-basic-card",
      arguments: { noteId: untaggedNoteId, back: "Changed" },
    });
    expect(rejected.isError).toBe(true);
    expect(resultText(rejected)).toContain("was not created by the MCP tool");
    expect((await getNote(untaggedNoteId)).fields.Back.value).toBe("Card");
  });

  it("stores an image reference placeholder and rejects HTML in place of a pointer", async () => {
    const created = await client.callTool({
      name: "create-basic-card",
      arguments: {
        front: "Which shard count minimized p99 latency in the benchmark?",
        back: "Eight shards",
        imageReference: "the p99 latency vs. shard count chart above  ",
      },
    });
    expect(created.isError).not.toBe(true);
    expect(resultText(created)).toContain("Image placeholder written");
    expect((await getNote(noteIdFrom(created))).fields[EXTRA_IMAGE_FIELD].value).toBe(
      "INSERT_IMAGE_HERE the p99 latency vs. shard count chart above",
    );

    const html = await client.callTool({
      name: "create-basic-card",
      arguments: { front: "Which valve did the figure label?", back: "Mitral", imageReference: '<img src="x.png">' },
    });
    expect(html.isError).toBe(true);
    expect(resultText(html)).toContain("plain-text pointer");

    // update-basic-card does not expose imageReference; a pasted image is only ever edited in Anki.
    const untouched = await client.callTool({
      name: "create-basic-card",
      arguments: { front: "Which layer caches reads?", back: "The buffer pool" },
    });
    expect((await getNote(noteIdFrom(untouched))).fields[EXTRA_IMAGE_FIELD].value).toBe("");
  });

  it("creates a valid abbreviation card and rejects answer-leaking descriptions", async () => {
    const created = await client.callTool({
      name: "create-abbreviation-definition-card",
      arguments: {
        abbreviation: "DASH",
        boldedExpandedAbbreviation: "<b>D</b>ietary <b>A</b>pproaches to <b>S</b>top <b>H</b>ypertension",
        description: "Eating pattern shown to decrease blood pressure",
        context: "Health",
        extra: "Emphasizes vegetables and whole grains.",
      },
    });
    expect(created.isError).not.toBe(true);
    const note = await getNote(noteIdFrom(created));
    expect(note).toMatchObject({
      modelName: "1 Basic",
      tags: [MCP_TAG],
      fields: {
        "🔹Abbrev Short 🆎": { value: "DASH" },
        Front: { value: "<b>D</b>ietary <b>A</b>pproaches to <b>S</b>top <b>H</b>ypertension" },
        Back: { value: "Eating pattern shown to decrease blood pressure" },
        "🔹Add Reverse 🔀": { value: "y" },
      },
    });

    const rejected = await client.callTool({
      name: "create-abbreviation-definition-card",
      arguments: {
        abbreviation: "DASH",
        boldedExpandedAbbreviation: "<b>D</b>ietary <b>A</b>pproaches to <b>S</b>top <b>H</b>ypertension",
        description: "The DASH dietary plan",
      },
    });
    expect(rejected.isError).toBe(true);
    expect(resultText(rejected)).toContain("give away the answer");
  });

  it("creates and updates programming cards and enforces tag and model guards", async () => {
    const created = await client.callTool({
      name: "create-programming-language-function-card",
      arguments: {
        functionName: "compact",
        programmingLanguage: "Ruby",
        returnType: "Array",
        functionDescription: "Returns a copy without nil elements.",
        library: "Array",
        arguments: "none",
        input: "arr = [1, nil, 2]",
        inputTransformation: "arr.compact",
        transformationResult: "[1, 2]",
        timeComplexity: "O(n)",
        complexitySpecification: "n is the array length",
        context: "Ruby collections",
        source: "Ruby docs",
      },
    });
    expect(created.isError).not.toBe(true);
    const noteId = noteIdFrom(created);
    expect(await getNote(noteId)).toMatchObject({
      modelName: "7 Programming Language Function",
      tags: [MCP_TAG],
      fields: {
        "⭐Function Name": { value: "compact" },
        "⭐🔳Programming Language (Excel / Java / JavaScript / Python / R / Ruby / Scala / SQL)": {
          value: "Ruby",
        },
        "🔹Library/Package": { value: "Array" },
        "Transformation Result": { value: "[1, 2]" },
        "Source 🎯": { value: "Ruby docs" },
      },
    });

    const updated = await client.callTool({
      name: "update-programming-language-function-card",
      arguments: { noteId, functionDescription: "Removes nil elements from a copy.", library: "", source: "Core docs" },
    });
    expect(updated.isError).not.toBe(true);
    expect(await getNote(noteId)).toMatchObject({
      fields: {
        "⭐Function Description": { value: "Removes nil elements from a copy." },
        "🔹Library/Package": { value: "" },
        "Source 🎯": { value: "Core docs" },
      },
    });

    const untaggedId = await addFixtureNote("7 Programming Language Function", {
      "⭐Function Name": "map",
      "⭐🔳Programming Language (Excel / Java / JavaScript / Python / R / Ruby / Scala / SQL)": "Ruby",
      "⭐Return Type": "Array",
      "⭐Function Description": "Transforms values",
    });
    const untagged = await client.callTool({
      name: "update-programming-language-function-card",
      arguments: { noteId: untaggedId, functionDescription: "Changed" },
    });
    expect(untagged.isError).toBe(true);
    expect(resultText(untagged)).toContain("was not created by the MCP tool");

    const wrongModelId = await addFixtureNote("8 Interview Question", { "⭐Title": "Wrong model" }, [MCP_TAG]);
    const wrongModel = await client.callTool({
      name: "update-programming-language-function-card",
      arguments: { noteId: wrongModelId, functionDescription: "Changed" },
    });
    expect(wrongModel.isError).toBe(true);
    expect(resultText(wrongModel)).toContain("not a programming language function note");
  });

  it("creates and updates interview cards and rejects a tagged note of the wrong model", async () => {
    const created = await client.callTool({
      name: "create-leetcode-question-card",
      arguments: {
        title: "Two Sum",
        question: "Find two indices whose values sum to a target.",
        exampleInputOutput: "[2,7,11,15], 9 → [0,1]",
        insight: "Store previously seen complements.",
        timeComplexity: "O(n)",
        spaceComplexity: "O(n)",
        additionalCriteria: "Return exactly one solution.",
        insightExplanation: "A hash map avoids a nested scan.",
        complexitySpecifications: "n is the input length",
        keyDataStructure: "Hash map",
        solutionAlgorithm: "for each value, check its complement",
        context: "Arrays",
        source: "LeetCode 1",
      },
    });
    expect(created.isError).not.toBe(true);
    const noteId = noteIdFrom(created);
    expect(await getNote(noteId)).toMatchObject({
      modelName: "8 Interview Question",
      tags: [MCP_TAG],
      fields: {
        "⭐Title": { value: "Two Sum" },
        "⭐Insight": { value: "Store previously seen complements." },
        "🔹Key Data Structure": { value: "Hash map" },
        "Solution Algorithm": { value: "for each value, check its complement" },
        "Source 🎯": { value: "LeetCode 1" },
      },
    });

    const updated = await client.callTool({
      name: "update-leetcode-question-card",
      arguments: { noteId, insight: "Look up each needed complement.", solutionAlgorithm: "", context: "Hashing" },
    });
    expect(updated.isError).not.toBe(true);
    expect(await getNote(noteId)).toMatchObject({
      fields: {
        "⭐Insight": { value: "Look up each needed complement." },
        "Solution Algorithm": { value: "" },
        "Context 💡": { value: "Hashing" },
      },
    });

    const wrongModelId = await addFixtureNote("7 Programming Language Function", { "⭐Function Name": "wrong_model" }, [
      MCP_TAG,
    ]);
    const wrongModel = await client.callTool({
      name: "update-leetcode-question-card",
      arguments: { noteId: wrongModelId, insight: "Changed" },
    });
    expect(wrongModel.isError).toBe(true);
    expect(resultText(wrongModel)).toContain("not an interview question note");
  });

  it("creates a cloze table in the matching deck and rejects malformed tables", async () => {
    const created = await client.callTool({
      name: "create-cloze-table",
      arguments: {
        headers: ["", "Primary use of __?"],
        rows: [
          [{ value: "SQLite" }, { value: "Embedded transactional storage" }],
          [{ value: "DuckDB" }, { value: "Embedded analytical queries", hint: "workload" }],
        ],
        context: "Databases",
        source: "Project documentation",
      },
    });
    expect(created.isError).not.toBe(true);
    const noteId = noteIdFrom(created);
    const note = await getNote(noteId);
    expect(note).toMatchObject({
      modelName: "2 Cloze",
      tags: [MCP_TAG],
      fields: {
        "Context 💡": { value: "Databases" },
        "Source 🏴": { value: "Project documentation" },
      },
    });
    expect(note.fields["⭐Text"].value).toContain("<table>");
    expect(note.fields["⭐Text"].value).toContain("{{c1::SQLite}}");
    expect(note.fields["⭐Text"].value).toContain("{{c2::Embedded transactional storage}}");
    expect(await requestAnki<number[]>("findNotes", { query: `nid:${noteId} deck:"${CLOZE_TABLE_DECK}"` })).toEqual([
      noteId,
    ]);

    const malformed = await client.callTool({
      name: "create-cloze-table",
      arguments: {
        headers: ["", "Attribute of __?"],
        rows: [[{ value: "Only one cell" }]],
      },
    });
    expect(malformed.isError).toBe(true);
    expect(resultText(malformed)).toContain("1 cells but expected 2");

    const invalidPlaceholder = await client.callTool({
      name: "create-cloze-table",
      arguments: {
        headers: ["", "Attribute of __"],
        rows: [[{ value: "Item" }, { value: "Value" }]],
      },
    });
    expect(invalidPlaceholder.isError).toBe(true);
    expect(resultText(invalidPlaceholder)).toContain('must end with "?" or ":"');
  });
});
