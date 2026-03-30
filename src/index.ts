import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Constants
const _ANKI_CONNECT_URL = "http://localhost:8765";
const SEARCH_PAGE_SIZE = 100;
const DEFAULT_DECK = "z::1 \u221E (manual catch-all)::0 interview prep::0 mcp";
const MCP_TAG = "mcp_generated";

// Type definitions for Anki responses
interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

// Validation schemas
const CreateCardArgumentsSchema = z.object({
  front: z.string(),
  back: z.string(),
  context: z.string().optional(),
  extra: z.string().optional(),
  source: z.string().optional(),
});

const CreateClozeCardArgumentsSchema = z.object({
  text: z.string(),
  backExtra: z.string().optional(),
  context: z.string().optional(),
  source: z.string().optional(),
});

const ClozeTableCellSchema = z.object({
  value: z.string(),
  hint: z.string().optional(),
});

const CreateClozeTableArgumentsSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(ClozeTableCellSchema)),
  context: z.string().optional(),
  source: z.string().optional(),
  selectedAttributes: z.array(z.number()).optional(),
  clozeItems: z.boolean().optional(),
});

const UpdateCardArgumentsSchema = z.object({
  noteId: z.number(),
  front: z.string().optional(),
  back: z.string().optional(),
  context: z.string().optional(),
  extra: z.string().optional(),
  source: z.string().optional(),
});

const UpdateClozeCardArgumentsSchema = z.object({
  noteId: z.number(),
  text: z.string().optional(),
  backExtra: z.string().optional(),
  context: z.string().optional(),
  source: z.string().optional(),
});

const CreateProgrammingCardArgumentsSchema = z.object({
  functionName: z.string(),
  programmingLanguage: z.string(),
  returnType: z.string(),
  functionDescription: z.string(),
  library: z.string().optional(),
  arguments: z.string().optional(),
  input: z.string().optional(),
  inputTransformation: z.string().optional(),
  transformationResult: z.string().optional(),
  timeComplexity: z.string().optional(),
  complexitySpecification: z.string().optional(),
  context: z.string().optional(),
  source: z.string().optional(),
});

const UpdateProgrammingCardArgumentsSchema = z.object({
  noteId: z.number(),
  functionName: z.string().optional(),
  programmingLanguage: z.string().optional(),
  returnType: z.string().optional(),
  functionDescription: z.string().optional(),
  library: z.string().optional(),
  arguments: z.string().optional(),
  input: z.string().optional(),
  inputTransformation: z.string().optional(),
  transformationResult: z.string().optional(),
  timeComplexity: z.string().optional(),
  complexitySpecification: z.string().optional(),
  context: z.string().optional(),
  source: z.string().optional(),
});

const CreateInterviewCardArgumentsSchema = z.object({
  title: z.string(),
  question: z.string(),
  exampleInputOutput: z.string(),
  insight: z.string(),
  timeComplexity: z.string(),
  spaceComplexity: z.string(),
  additionalCriteria: z.string().optional(),
  insightExplanation: z.string().optional(),
  complexitySpecifications: z.string().optional(),
  keyDataStructure: z.string().optional(),
  solutionAlgorithm: z.string().optional(),
  context: z.string().optional(),
  source: z.string().optional(),
});

const UpdateInterviewCardArgumentsSchema = z.object({
  noteId: z.number(),
  title: z.string().optional(),
  question: z.string().optional(),
  exampleInputOutput: z.string().optional(),
  insight: z.string().optional(),
  timeComplexity: z.string().optional(),
  spaceComplexity: z.string().optional(),
  additionalCriteria: z.string().optional(),
  insightExplanation: z.string().optional(),
  complexitySpecifications: z.string().optional(),
  keyDataStructure: z.string().optional(),
  solutionAlgorithm: z.string().optional(),
  context: z.string().optional(),
  source: z.string().optional(),
});

const SearchCollectionArgumentsSchema = z.object({
  query: z.string(),
  offset: z.number().optional().default(0),
});

// Helper functions for cloze table generation
type ClozeTableCell = z.infer<typeof ClozeTableCellSchema>;

export function validatePlaceholders(headers: string[], rows: ClozeTableCell[][]): string | null {
  for (const header of headers) {
    if (header.includes("__") && !header.endsWith("?") && !header.endsWith(":")) {
      return `"${header}" contains "__" but must end with "?" or ":"`;
    }
  }
  for (let i = 0; i < rows.length; i++) {
    for (const cell of rows[i]) {
      if (cell.value.includes("__") && !cell.value.endsWith("?") && !cell.value.endsWith(":")) {
        return `Cell "${cell.value}" in row ${i + 1} contains "__" but must end with "?" or ":"`;
      }
    }
  }
  return null;
}

export function transposeTable(
  headers: string[],
  rows: ClozeTableCell[][],
): { headers: string[]; rows: ClozeTableCell[][] } {
  if (headers.length <= rows.length) {
    return { headers, rows };
  }
  const newHeaders = ["", ...rows.map((r) => r[0].value)];
  const newRows: ClozeTableCell[][] = [];
  for (let col = 1; col < headers.length; col++) {
    const newRow: ClozeTableCell[] = [{ value: headers[col] }];
    for (const row of rows) {
      newRow.push(row[col] ?? { value: "" });
    }
    newRows.push(newRow);
  }
  return { headers: newHeaders, rows: newRows };
}

export function generateClozeTable(
  headers: string[],
  rows: ClozeTableCell[][],
  clozeCells?: Set<string>,
  clozeHeaders?: Set<number>,
): string {
  let clozeNum = 1;
  const lines: string[] = [];
  lines.push("<table>");
  lines.push("  <thead>");
  lines.push("    <tr>");
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const shouldCloze =
      clozeCells !== undefined ? (clozeHeaders?.has(i) ?? false) : header !== "" && !header.includes("__");
    if (shouldCloze) {
      lines.push(`      <th>{{c${clozeNum}::${header}}}</th>`);
      clozeNum++;
    } else {
      lines.push(`      <th>${header}</th>`);
    }
  }
  lines.push("    </tr>");
  lines.push("  </thead>");
  lines.push("  <tbody>");
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    lines.push("    <tr>");
    for (let colIdx = 0; colIdx < rows[rowIdx].length; colIdx++) {
      const cell = rows[rowIdx][colIdx];
      const shouldCloze =
        clozeCells !== undefined
          ? clozeCells.has(`${rowIdx},${colIdx}`)
          : cell.value !== "" && !cell.value.includes("__");
      if (shouldCloze) {
        const cloze = cell.hint ? `{{c${clozeNum}::${cell.value}::${cell.hint}}}` : `{{c${clozeNum}::${cell.value}}}`;
        lines.push(`      <td>${cloze}</td>`);
        clozeNum++;
      } else {
        lines.push(`      <td>${cell.value}</td>`);
      }
    }
    lines.push("    </tr>");
  }
  lines.push("  </tbody>");
  lines.push("</table>");
  return lines.join("\n");
}

// Helper function for making AnkiConnect requests with retries
async function ankiRequest<T>(action: string, params: Record<string, any> = {}, retries = 3, delay = 1000): Promise<T> {
  console.error(`Attempting AnkiConnect request: ${action} with params:`, params);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await new Promise<T>((resolve, reject) => {
        const data = JSON.stringify({
          action,
          version: 6,
          params,
        });

        console.error("Request payload:", data);

        const options = {
          hostname: "127.0.0.1",
          port: 8765,
          path: "/",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        };

        const req = http.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk: Buffer) => {
            responseData += chunk.toString();
          });

          res.on("end", () => {
            console.error(`AnkiConnect response status: ${res.statusCode}`);
            console.error(`AnkiConnect response body: ${responseData}`);

            if (res.statusCode !== 200) {
              reject(new Error(`AnkiConnect request failed with status ${res.statusCode}: ${responseData}`));
              return;
            }

            try {
              const parsedData = JSON.parse(responseData) as AnkiResponse<T>;
              console.error("Parsed response:", parsedData);

              if (parsedData.error) {
                const err = new Error(`AnkiConnect error: ${parsedData.error}`);
                (err as any).ankiError = true;
                reject(err);
                return;
              }

              // Some actions like updateNoteFields return null on success
              if (parsedData.result === null || parsedData.result === undefined) {
                // For actions that are expected to return null/undefined, return an empty success response
                if (action === "updateNoteFields") {
                  resolve({} as T);
                  return;
                }
                // For other actions, treat null/undefined as an error
                reject(new Error("AnkiConnect returned null/undefined result"));
                return;
              }

              resolve(parsedData.result);
            } catch (parseError) {
              console.error("Parse error:", parseError);
              reject(new Error(`Failed to parse AnkiConnect response: ${responseData}`));
            }
          });
        });

        req.on("error", (error: Error) => {
          console.error(`Error in ankiRequest (attempt ${attempt}/${retries}):`, error);
          reject(error);
        });

        // Write data to request body
        req.write(data);
        req.end();
      });

      return result;
    } catch (error) {
      if ((error as any).ankiError || attempt === retries) {
        throw error;
      }
      console.error(`Attempt ${attempt}/${retries} failed, retrying after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Increase delay for next attempt
      delay *= 2;
    }
  }

  throw new Error(`Failed after ${retries} attempts`);
}

// Gemini API helpers
const GEMINI_API_KEY = fs
  .readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".gemini-api-key"), "utf-8")
  .trim();

const RULES = `
* Be clear and specific in the 'front' field. Ask only a single question that can be answered by the user. If there are multiple potential answers to this question, you must ask for "a," "one of," "an example," etc. in this field -- you cannot ask for a full list or parts of an answer.
* Be brief and simple in the 'back' field. There must either be (a) only a single possible answer to the question in this field or (b) an exhaustive list. If (b), the 'front' could have only asked for a single item of this list.
* Provide more detailed contextual information in the 'extra' field (up to 3 sentences).
* For all fields, try to simplify text structure as much as possible -- the user wants to optimize for fast reviews, and the more 'filler' text that is contained, the worse things are.
* Questions should NEVER ask for only a concrete numerical value, like a specific percentage.
* An answer should NEVER be only a specific command, function name, class name.
`;

const EXTRA_RULES = `
If you need to style elements in fields, you can use HTML and LaTeX. For example:
  * Whenever displaying math equations, use LaTeX, surrounded by delimiters \`\\(...\\)\` / \`\\[...\\]\` for inline / displayed symbols respectively.
  * use \`<code>functionCall();</code>\` when wanting to show code, software-related variable names, bash commands or other monospaced output
  * use \`<i>the i element</i>\` when wanting to use italics
  * use HTML lists (\`<ul><li>item</li></ul>\`) when listing multiple items, especially if they are the answer to a question`;

const VALIDATION_PROMPT = `What follows is a list of rules for creation of flashcards, as well as an example flashcard. Your task is to evaluate if the example flashcard follows the rules. Output a JSON dictionary with two keys: a \`result\` key, which contains \`true\` or \`false\`, for whether the rules were mostly followed. And \`details\`, that is a very short description of what rules, if any, were violated.

Rules:
"""
${RULES}
"""

Example flashcard:
"""`;

const AUTOFIX_PROMPT = `You are given a flashcard that violates formatting rules. Fix the card to comply with the rules and return ONLY a JSON object with "front", "back", and "extra" keys containing the corrected values. Do not include any other text.

Rules:
"""
${RULES}
${EXTRA_RULES}
"""

Violation details: `;

async function geminiRequest(model: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function validateCard(
  front: string,
  back: string,
  extra: string,
): Promise<{ front: string; back: string; extra: string; details?: string }> {
  const cardJson = JSON.stringify({ front, back, extra });
  const validationText = `${VALIDATION_PROMPT}\n${cardJson}\n"""`;
  const raw = await geminiRequest("gemini-3-flash-preview", validationText);
  const result = JSON.parse(raw);
  console.error("Card validation result:", result);

  if (result.result === true) {
    return { front, back, extra };
  }

  // Auto-fix with Gemini 3.1 Pro
  const fixPrompt = `${AUTOFIX_PROMPT}${result.details}\n\nOriginal flashcard:\n${cardJson}`;
  const fixRaw = await geminiRequest("gemini-3.1-pro-preview", fixPrompt);
  const fixed = JSON.parse(fixRaw);
  console.error("Card auto-fixed:", fixed);
  return { front: fixed.front, back: fixed.back, extra: fixed.extra ?? extra, details: result.details };
}

async function reformulatePlaceholders(
  headers: string[],
  rows: ClozeTableCell[][],
): Promise<{ headers: string[]; rows: ClozeTableCell[][] }> {
  const placeholders: { location: string; index: number; value: string }[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].includes("__")) {
      placeholders.push({ location: "header", index: i, value: headers[i] });
    }
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      if (rows[i][j].value.includes("__")) {
        placeholders.push({ location: `row${i}_col${j}`, index: -1, value: rows[i][j].value });
      }
    }
  }

  if (placeholders.length === 0) {
    return { headers, rows };
  }

  const prompt = `You are reformulating table header/label text for Anki flashcard cloze tables. Each string contains "__" (double underscore) which is a placeholder that gets replaced with a value during review.

Your job: rewrite each string to sound natural and read like a clear question or prompt. Keep "__" exactly as-is in the output. Each string must still end with "?" or ":".

Keep them concise — these appear in a table, so brevity matters. Do not add filler words.

Return a JSON array of strings in the same order, one per input.

Input strings:
${JSON.stringify(placeholders.map((p) => p.value))}`;

  const raw = await geminiRequest("gemini-3.1-pro-preview", prompt);
  const reformulated: string[] = JSON.parse(raw);
  console.error("Reformulated placeholders:", reformulated);

  const newHeaders = [...headers];
  const newRows = rows.map((r) => r.map((c) => ({ ...c })));

  let idx = 0;
  for (const p of placeholders) {
    const newValue = reformulated[idx] ?? p.value;
    if (p.location === "header") {
      newHeaders[p.index] = newValue;
    } else {
      const match = p.location.match(/^row(\d+)_col(\d+)$/);
      if (match) {
        newRows[Number(match[1])][Number(match[2])].value = newValue;
      }
    }
    idx++;
  }

  return { headers: newHeaders, rows: newRows };
}

export function validateSearchQuery(query: string): void {
  const hasOperators = /\bAND\b|\bOR\b/.test(query);
  const segments = query.split(/\bAND\b|\bOR\b/);
  const multiWordPhrases: string[] = [];
  for (const segment of segments) {
    const stripped = segment.replace(/-?"[^"]*"/g, "").trim();
    const bareWords = stripped.split(/\s+/).filter((t) => t && !t.includes(":"));
    if (bareWords.length > 1) {
      multiWordPhrases.push(bareWords.join(" "));
    }
  }
  if (multiWordPhrases.length > 0) {
    if (hasOperators) {
      const quoted = multiWordPhrases.map((p) => `"${p}"`).join(", ");
      throw new Error(`Multi-word terms must be wrapped in quotes: ${quoted}`);
    } else {
      const phrase = multiWordPhrases[0];
      const words = phrase.split(" ");
      throw new Error(
        `Multi-word search "${phrase}" must use AND/OR operators or quotes. Examples: '${words.join(" AND ")}' or '"${phrase}"'`,
      );
    }
  }
}

export function prepareSearchQuery(query: string): string {
  // Tokenize preserving quoted strings, then add w: to bare words
  const tokens: string[] = [];
  const regex = /-?"[^"]*"|(\S+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    const token = match[0];
    if (token.startsWith('"') || token.startsWith('-"')) {
      // Quoted phrase — keep as-is
      tokens.push(token);
    } else if (token === "AND" || token === "OR") {
      // Operator — keep as-is
      tokens.push(token);
    } else if (token.includes(":")) {
      // Field-scoped (e.g., tag:leech, deck:z) — keep as-is
      tokens.push(token);
    } else {
      // Bare word — add w: prefix
      tokens.push(`w:${token}`);
    }
  }
  return tokens.join(" ");
}

async function main() {
  // Create server instance
  const server = new Server(
    {
      name: "anki-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "create-basic-card",
          description: `Create a new basic flashcard. You MUST follow these rules:\n${RULES}\n${EXTRA_RULES}`,
          inputSchema: {
            type: "object",
            properties: {
              front: {
                type: "string",
                description: "Front side content of the card",
              },
              back: {
                type: "string",
                description: "Back side content of the card",
              },
              context: {
                type: "string",
                description: "Contextual label shown on the card, e.g. a language name or category",
              },
              extra: {
                type: "string",
                description: "Extra information shown on the back of the card",
              },
              source: {
                type: "string",
                description: "Source reference for the card content",
              },
            },
            required: ["front", "back"],
          },
        },
        {
          name: "update-basic-card",
          description: "Update an existing flashcard",
          inputSchema: {
            type: "object",
            properties: {
              noteId: {
                type: "number",
                description: "ID of the note to update",
              },
              front: {
                type: "string",
                description: "New front side content",
              },
              back: {
                type: "string",
                description: "New back side content",
              },
              context: {
                type: "string",
                description: "Contextual label shown on the card, e.g. a language name or category",
              },
              extra: {
                type: "string",
                description: "Extra information shown on the back of the card",
              },
              source: {
                type: "string",
                description: "Source reference for the card content",
              },
            },
            required: ["noteId"],
          },
        },
        // Cloze card tools disabled — handlers remain below for re-enablement
        {
          name: "create-programming-card",
          description: "Create a new programming language function card.",
          inputSchema: {
            type: "object",
            properties: {
              functionName: {
                type: "string",
                description:
                  "Function or method name, e.g. 'compact' or 'Core::AbstractPolicy.challenge_required_and_reason'",
              },
              programmingLanguage: {
                type: "string",
                description: "Programming language name, e.g. Java, JavaScript, Python, Ruby, Scala, SQL",
              },
              returnType: {
                type: "string",
                description: "Return type of the function, e.g. 'void', 'Array', 'K', 'T.nilable(ErrorCategoryType)'",
              },
              functionDescription: {
                type: "string",
                description:
                  "Description of what the function does. May include HTML like <code> and <b> for formatting",
              },
              library: {
                type: "string",
                description:
                  "Library, package, module, or class the function belongs to, e.g. 'Array', 'NavigableMap', 'Minitest::Assertions'",
              },
              arguments: {
                type: "string",
                description:
                  "Typed argument list using the language's style, e.g. 'K key' or 'context: Context::Context, metadata: Core::Metadata'",
              },
              input: {
                type: "string",
                description:
                  'Concrete setup code with specific variable/data definitions (not just imports). Must provide enough context that, combined with the transformation result, the function call can be deduced. E.g. \'arr = ["a", nil, "b", nil, "c"]\' rather than just \'import math\'. May use HTML (<div>, <br>) for formatting',
              },
              inputTransformation: {
                type: "string",
                description:
                  "The actual function call showing how the function is invoked on the input, e.g. 'arr.compact' or 'map.ceilingKey(3)'",
              },
              transformationResult: {
                type: "string",
                description:
                  'The expected output/result of the function call on the input. Must be specific to the concrete input provided, e.g. \'["a", "b", "c"]\' for the compact example',
              },
              timeComplexity: {
                type: "string",
                description: "Big-O time complexity using LaTeX, e.g. 'O(\\log(n))', 'O(n)'",
              },
              complexitySpecification: {
                type: "string",
                description: "Definitions of variables used in complexity expressions",
              },
              context: {
                type: "string",
                description: "Additional context shown on the card",
              },
              source: {
                type: "string",
                description: "Source reference for the card content",
              },
            },
            required: ["functionName", "programmingLanguage", "returnType", "functionDescription"],
          },
        },
        {
          name: "update-programming-card",
          description: "Update an existing programming language function card",
          inputSchema: {
            type: "object",
            properties: {
              noteId: {
                type: "number",
                description: "ID of the note to update",
              },
              functionName: {
                type: "string",
                description:
                  "Function or method name, e.g. 'compact' or 'Core::AbstractPolicy.challenge_required_and_reason'",
              },
              programmingLanguage: {
                type: "string",
                description: "Programming language name, e.g. Java, JavaScript, Python, Ruby, Scala, SQL",
              },
              returnType: {
                type: "string",
                description: "Return type of the function, e.g. 'void', 'Array', 'K', 'T.nilable(ErrorCategoryType)'",
              },
              functionDescription: {
                type: "string",
                description:
                  "Description of what the function does. May include HTML like <code> and <b> for formatting",
              },
              library: {
                type: "string",
                description: "Library, package, module, or class the function belongs to, e.g. 'Array', 'NavigableMap'",
              },
              arguments: {
                type: "string",
                description: "Typed argument list using the language's style, e.g. 'K key'",
              },
              input: {
                type: "string",
                description:
                  "Concrete setup code with specific variable/data definitions (not just imports). Must provide enough context that, combined with the transformation result, the function call can be deduced. May use HTML for formatting",
              },
              inputTransformation: {
                type: "string",
                description: "The actual function call showing how the function is invoked on the input",
              },
              transformationResult: {
                type: "string",
                description:
                  "The expected output/result of the function call on the input. Must be specific to the concrete input provided",
              },
              timeComplexity: {
                type: "string",
                description: "Big-O time complexity using LaTeX, e.g. 'O(\\log(n))', 'O(n)'",
              },
              complexitySpecification: {
                type: "string",
                description: "Definitions of variables used in complexity expressions",
              },
              context: {
                type: "string",
                description: "Additional context shown on the card",
              },
              source: {
                type: "string",
                description: "Source reference for the card content",
              },
            },
            required: ["noteId"],
          },
        },
        {
          name: "create-interview-card",
          description:
            "Create a new interview question card for coding/algorithm problems. Keep questions simple; avoid lists, sets, and enumerations; ask only a single question per card.",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Short title for the problem, e.g. 'LRU Cache', 'Longest Palindromic Subsequence'",
              },
              question: {
                type: "string",
                description:
                  "The interview question/problem statement. May use HTML like <code>, <i>, <ul>, <li> for formatting",
              },
              exampleInputOutput: {
                type: "string",
                description:
                  'Concrete example inputs and their expected outputs, e.g. \'"bbbab" => 4 ("bbbb")\'. May use HTML for formatting',
              },
              insight: {
                type: "string",
                description:
                  "The key insight or approach needed to solve the problem, e.g. 'dynamic programming based on increasing-length substrings', 'math question', 'reimplement OrderedDict'",
              },
              timeComplexity: {
                type: "string",
                description: "Big-O time complexity of the solution using LaTeX, e.g. 'O(n^2)', 'O(1)'",
              },
              spaceComplexity: {
                type: "string",
                description: "Big-O space complexity of the solution using LaTeX, e.g. 'O(n^2)', 'O(c)'",
              },
              additionalCriteria: {
                type: "string",
                description:
                  "Additional constraints or assumptions, e.g. 'You may assume that the maximum length of s is 1000'",
              },
              insightExplanation: {
                type: "string",
                description:
                  "Detailed explanation of how the insight/approach works. May use HTML and LaTeX (\\(...\\)) for formatting",
              },
              complexitySpecifications: {
                type: "string",
                description:
                  "Definitions of variables used in complexity expressions, e.g. 'n = length of string s', 'c = capacity'",
              },
              keyDataStructure: {
                type: "string",
                description:
                  "Primary data structure(s) used in the solution, e.g. 'DP array', 'dictionary + doubly-linked list'",
              },
              solutionAlgorithm: {
                type: "string",
                description: "The solution code. May use HTML for formatting",
              },
              context: {
                type: "string",
                description: "Additional context shown on the card",
              },
              source: {
                type: "string",
                description: "Source URLs for the problem, e.g. LeetCode links",
              },
            },
            required: ["title", "question", "exampleInputOutput", "insight", "timeComplexity", "spaceComplexity"],
          },
        },
        {
          name: "update-interview-card",
          description: "Update an existing interview question card",
          inputSchema: {
            type: "object",
            properties: {
              noteId: {
                type: "number",
                description: "ID of the note to update",
              },
              title: {
                type: "string",
                description: "Short title for the problem",
              },
              question: {
                type: "string",
                description: "The interview question/problem statement. May use HTML for formatting",
              },
              exampleInputOutput: {
                type: "string",
                description: "Concrete example inputs and their expected outputs",
              },
              insight: {
                type: "string",
                description: "The key insight or approach needed to solve the problem",
              },
              timeComplexity: {
                type: "string",
                description: "Big-O time complexity of the solution using LaTeX",
              },
              spaceComplexity: {
                type: "string",
                description: "Big-O space complexity of the solution using LaTeX",
              },
              additionalCriteria: {
                type: "string",
                description: "Additional constraints or assumptions",
              },
              insightExplanation: {
                type: "string",
                description: "Detailed explanation of the insight/approach. May use HTML and LaTeX",
              },
              complexitySpecifications: {
                type: "string",
                description: "Definitions of variables used in complexity expressions",
              },
              keyDataStructure: {
                type: "string",
                description: "Primary data structure(s) used in the solution",
              },
              solutionAlgorithm: {
                type: "string",
                description: "The solution code. May use HTML for formatting",
              },
              context: {
                type: "string",
                description: "Additional context shown on the card",
              },
              source: {
                type: "string",
                description: "Source URLs for the problem",
              },
            },
            required: ["noteId"],
          },
        },
        {
          name: "search-collection",
          description:
            "Search the Anki collection for notes matching a query. Rules: (1) Multiple terms MUST be joined with AND/OR. (2) Multi-word phrases MUST be wrapped in quotes. (3) A single word can be searched alone. Examples: 'kafka', 'PostgreSQL OR postgres', 'btree OR \"binary tree\"', '\"system design\" OR \"distributed systems\" OR scalability'.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Anki search query string",
              },
              offset: {
                type: "number",
                description: "Number of results to skip (for pagination)",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "create-cloze-table",
          description:
            'Create a cloze deletion card with an HTML table. ALL body cells are wrapped in cloze deletions with auto-incrementing numbers. Each non-empty header MUST contain "__" (double underscore) as a placeholder — a JavaScript function on the card replaces "__" with the row\'s first-column value to form a question (e.g. "Who is the creator of __?" becomes "Who is the creator of UNIX?"). The first header is an empty string. CRITICAL ORIENTATION RULE: The items being compared (e.g. UNIX vs Linux, SQLite vs DuckDB) MUST be the ROW LABELS (first column of each row). The attributes/properties being compared across those items (e.g. creator, licensing, workload, storage layout) MUST be the HEADERS with "__" placeholders. Think of it as: rows = things, columns = attributes of those things. Example: comparing SQLite vs DuckDB → headers are ["", "Target workload of __:", "__ storage layout:", ...] and each row starts with "SQLite" or "DuckDB". IMPORTANT: Before calling this tool, you MUST (1) discuss with the user what headers and rows the table should contain, (2) show the user a preview of the table, and (3) get explicit confirmation before invoking this tool.',
          inputSchema: {
            type: "object",
            properties: {
              headers: {
                type: "array",
                items: { type: "string" },
                description:
                  'Table header labels representing ATTRIBUTES/PROPERTIES being compared. The first header should be an empty string. Every other header MUST contain "__" (double underscore) as a placeholder for the row label. Example: ["", "Who is the creator of __?", "__ licensing:"]',
              },
              rows: {
                type: "array",
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      value: { type: "string", description: "Cell content (may include HTML)" },
                      hint: { type: "string", description: "Optional cloze hint shown during review" },
                    },
                    required: ["value"],
                  },
                },
                description:
                  "Table rows. Each row represents one ITEM being compared (e.g. one technology, one concept). The first cell of each row is the item name/label. ALL cells (including the first column) are wrapped in cloze deletions.",
              },
              context: {
                type: "string",
                description: "Additional context shown on the card",
              },
              source: {
                type: "string",
                description: "Source reference for the card content",
              },
              selectedAttributes: {
                type: "array",
                items: { type: "number" },
                description:
                  "Indices of attributes to cloze (from the preview response). Omit on first call to get a preview.",
              },
              clozeItems: {
                type: "boolean",
                description: "Whether to cloze the item labels. Defaults to true.",
              },
            },
            required: ["headers", "rows"],
          },
        },
      ],
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "create-basic-card") {
        const { front, back, context = "", extra = "", source = "" } = CreateCardArgumentsSchema.parse(args);

        const validated = await validateCard(front, back, extra);
        const wasFixed = validated.front !== front || validated.back !== back || validated.extra !== extra;

        const fields: Record<string, string> = {
          Front: validated.front,
          Back: validated.back,
        };
        if (context) fields["Context \uD83D\uDCA1"] = context;
        if (validated.extra) fields["Extra \u2795"] = validated.extra;
        if (source) fields["Source \uD83C\uDFAF"] = source;

        const noteId = await ankiRequest<number>("addNote", {
          note: {
            deckName: DEFAULT_DECK,
            modelName: "1 Basic",
            fields,
            tags: [MCP_TAG],
          },
        });

        let responseText = `Successfully created new card in deck "${DEFAULT_DECK}" (noteId: ${noteId})`;
        if (wasFixed) {
          responseText += `\n\nNote: Card was auto-corrected: ${validated.details}\nFront: ${validated.front}\nBack: ${validated.back}\nExtra: ${validated.extra}`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      }

      if (name === "update-basic-card") {
        const { noteId, front, back, context, extra, source } = UpdateCardArgumentsSchema.parse(args);

        const noteInfo = await ankiRequest<any[]>("notesInfo", {
          notes: [noteId],
        });

        if (noteInfo.length === 0) {
          throw new Error(`No note found with ID ${noteId}`);
        }

        if (!noteInfo[0].tags.includes(MCP_TAG)) {
          throw new Error("This note was not created by the MCP tool and cannot be updated");
        }

        const fields: Record<string, string> = {};
        if (front !== undefined) fields.Front = front;
        if (back !== undefined) fields.Back = back;

        if (context !== undefined) fields["Context \uD83D\uDCA1"] = context;
        if (extra !== undefined) fields["Extra \u2795"] = extra;
        if (source !== undefined) fields["Source \uD83C\uDFAF"] = source;

        if (Object.keys(fields).length > 0) {
          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated note ${noteId}`,
            },
          ],
        };
      }

      if (name === "create-cloze-card") {
        const { text, backExtra = "", context = "", source = "" } = CreateClozeCardArgumentsSchema.parse(args);

        // Validate that the text contains at least one cloze deletion
        if (!text.includes("{{c") || !text.includes("}}")) {
          throw new Error("Text must contain at least one cloze deletion using {{c1::text}} syntax");
        }

        const fields: Record<string, string> = {
          "\u2B50Text": text,
          "Extra Text": backExtra,
        };
        if (context) fields["Context \uD83D\uDCA1"] = context;
        if (source) fields["Source \uD83C\uDFAF"] = source;

        const noteId = await ankiRequest<number>("addNote", {
          note: {
            deckName: DEFAULT_DECK,
            modelName: "2 Cloze",
            fields,
            tags: [MCP_TAG],
          },
        });

        return {
          content: [
            {
              type: "text",
              text: `Successfully created new cloze card in deck "${DEFAULT_DECK}" (noteId: ${noteId})`,
            },
          ],
        };
      }

      if (name === "update-cloze-card") {
        const { noteId, text, backExtra, context, source } = UpdateClozeCardArgumentsSchema.parse(args);

        // Get the current note info to verify it's a cloze note
        const noteInfo = await ankiRequest<any[]>("notesInfo", {
          notes: [noteId],
        });

        if (noteInfo.length === 0) {
          throw new Error(`No note found with ID ${noteId}`);
        }

        if (!noteInfo[0].tags.includes(MCP_TAG)) {
          throw new Error("This note was not created by the MCP tool and cannot be updated");
        }

        if (noteInfo[0].modelName !== "2 Cloze") {
          throw new Error("This note is not a cloze deletion note");
        }

        // Update fields if provided
        const fields: Record<string, string> = {};
        if (text) {
          // Validate that the text contains at least one cloze deletion
          if (!text.includes("{{c") || !text.includes("}}")) {
            throw new Error("Text must contain at least one cloze deletion using {{c1::text}} syntax");
          }
          fields["\u2B50Text"] = text;
        }
        if (backExtra !== undefined) fields["Extra Text"] = backExtra;
        if (context !== undefined) fields["Context \uD83D\uDCA1"] = context;
        if (source !== undefined) fields["Source \uD83C\uDFAF"] = source;

        if (Object.keys(fields).length > 0) {
          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated cloze note ${noteId}`,
            },
          ],
        };
      }

      if (name === "create-programming-card") {
        const {
          functionName,
          programmingLanguage,
          returnType,
          functionDescription,
          library = "",
          arguments: funcArguments = "",
          input = "",
          inputTransformation = "",
          transformationResult = "",
          timeComplexity = "",
          complexitySpecification = "",
          context = "",
          source = "",
        } = CreateProgrammingCardArgumentsSchema.parse(args);

        const fields: Record<string, string> = {
          "\u2B50Function Name": functionName,
          "\u2B50\uD83D\uDD33Programming Language (Excel / Java / JavaScript / Python / R / Ruby / Scala / SQL)":
            programmingLanguage,
          "\u2B50Return Type": returnType,
          "\u2B50Function Description": functionDescription,
        };
        if (library) fields["\uD83D\uDD39Library/Package"] = library;
        if (funcArguments) fields["\uD83D\uDD39Arguments"] = funcArguments;
        if (input) fields["\uD83D\uDD39Input"] = input;
        if (inputTransformation) fields["\uD83D\uDD39Input Transformation"] = inputTransformation;
        if (transformationResult) fields["Transformation Result"] = transformationResult;
        if (timeComplexity) fields["\uD83D\uDD39Time Complexity"] = timeComplexity;
        if (complexitySpecification) fields["Complexity Specification"] = complexitySpecification;
        if (context) fields["Context \uD83D\uDCA1"] = context;
        if (source) fields["Source \uD83C\uDFAF"] = source;

        const noteId = await ankiRequest<number>("addNote", {
          note: {
            deckName: DEFAULT_DECK,
            modelName: "7 Programming Language Function",
            fields,
            tags: [MCP_TAG],
          },
        });

        return {
          content: [
            {
              type: "text",
              text: `Successfully created new programming card for "${functionName}" in deck "${DEFAULT_DECK}" (noteId: ${noteId})`,
            },
          ],
        };
      }

      if (name === "update-programming-card") {
        const {
          noteId,
          functionName,
          programmingLanguage,
          returnType,
          functionDescription,
          library,
          arguments: funcArguments,
          input,
          inputTransformation,
          transformationResult,
          timeComplexity,
          complexitySpecification,
          context,
          source,
        } = UpdateProgrammingCardArgumentsSchema.parse(args);

        // Get the current note info to verify it's a programming card
        const noteInfo = await ankiRequest<any[]>("notesInfo", {
          notes: [noteId],
        });

        if (noteInfo.length === 0) {
          throw new Error(`No note found with ID ${noteId}`);
        }

        if (!noteInfo[0].tags.includes(MCP_TAG)) {
          throw new Error("This note was not created by the MCP tool and cannot be updated");
        }

        if (noteInfo[0].modelName !== "7 Programming Language Function") {
          throw new Error("This note is not a programming language function note");
        }

        const fields: Record<string, string> = {};
        if (functionName !== undefined) fields["\u2B50Function Name"] = functionName;
        if (programmingLanguage !== undefined)
          fields[
            "\u2B50\uD83D\uDD33Programming Language (Excel / Java / JavaScript / Python / R / Ruby / Scala / SQL)"
          ] = programmingLanguage;
        if (returnType !== undefined) fields["\u2B50Return Type"] = returnType;
        if (functionDescription !== undefined) fields["\u2B50Function Description"] = functionDescription;
        if (library !== undefined) fields["\uD83D\uDD39Library/Package"] = library;
        if (funcArguments !== undefined) fields["\uD83D\uDD39Arguments"] = funcArguments;
        if (input !== undefined) fields["\uD83D\uDD39Input"] = input;
        if (inputTransformation !== undefined) fields["\uD83D\uDD39Input Transformation"] = inputTransformation;
        if (transformationResult !== undefined) fields["Transformation Result"] = transformationResult;
        if (timeComplexity !== undefined) fields["\uD83D\uDD39Time Complexity"] = timeComplexity;
        if (complexitySpecification !== undefined) fields["Complexity Specification"] = complexitySpecification;
        if (context !== undefined) fields["Context \uD83D\uDCA1"] = context;
        if (source !== undefined) fields["Source \uD83C\uDFAF"] = source;

        if (Object.keys(fields).length > 0) {
          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated programming note ${noteId}`,
            },
          ],
        };
      }

      if (name === "create-interview-card") {
        const {
          title,
          question,
          exampleInputOutput,
          insight,
          timeComplexity,
          spaceComplexity,
          additionalCriteria = "",
          insightExplanation = "",
          complexitySpecifications = "",
          keyDataStructure = "",
          solutionAlgorithm = "",
          context = "",
          source = "",
        } = CreateInterviewCardArgumentsSchema.parse(args);

        const fields: Record<string, string> = {
          "\u2B50Title": title,
          "\u2B50Question": question,
          "\u2B50Example Input/Output": exampleInputOutput,
          "\u2B50Insight": insight,
          "\u2B50Time Complexity": timeComplexity,
          "\u2B50Space Complexity": spaceComplexity,
        };
        if (additionalCriteria) fields["Additional Criteria"] = additionalCriteria;
        if (insightExplanation) fields["Insight Explanation"] = insightExplanation;
        if (complexitySpecifications) fields["Complexity specifications"] = complexitySpecifications;
        if (keyDataStructure) fields["\uD83D\uDD39Key Data Structure"] = keyDataStructure;
        if (solutionAlgorithm) fields["Solution Algorithm"] = solutionAlgorithm;
        if (context) fields["Context \uD83D\uDCA1"] = context;
        if (source) fields["Source \uD83C\uDFAF"] = source;

        const noteId = await ankiRequest<number>("addNote", {
          note: {
            deckName: DEFAULT_DECK,
            modelName: "8 Interview Question",
            fields,
            tags: [MCP_TAG],
          },
        });

        return {
          content: [
            {
              type: "text",
              text: `Successfully created new interview card "${title}" in deck "${DEFAULT_DECK}" (noteId: ${noteId})`,
            },
          ],
        };
      }

      if (name === "update-interview-card") {
        const {
          noteId,
          title,
          question,
          exampleInputOutput,
          insight,
          timeComplexity,
          spaceComplexity,
          additionalCriteria,
          insightExplanation,
          complexitySpecifications,
          keyDataStructure,
          solutionAlgorithm,
          context,
          source,
        } = UpdateInterviewCardArgumentsSchema.parse(args);

        const noteInfo = await ankiRequest<any[]>("notesInfo", {
          notes: [noteId],
        });

        if (noteInfo.length === 0) {
          throw new Error(`No note found with ID ${noteId}`);
        }

        if (!noteInfo[0].tags.includes(MCP_TAG)) {
          throw new Error("This note was not created by the MCP tool and cannot be updated");
        }

        if (noteInfo[0].modelName !== "8 Interview Question") {
          throw new Error("This note is not an interview question note");
        }

        const fields: Record<string, string> = {};
        if (title !== undefined) fields["\u2B50Title"] = title;
        if (question !== undefined) fields["\u2B50Question"] = question;
        if (exampleInputOutput !== undefined) fields["\u2B50Example Input/Output"] = exampleInputOutput;
        if (insight !== undefined) fields["\u2B50Insight"] = insight;
        if (timeComplexity !== undefined) fields["\u2B50Time Complexity"] = timeComplexity;
        if (spaceComplexity !== undefined) fields["\u2B50Space Complexity"] = spaceComplexity;
        if (additionalCriteria !== undefined) fields["Additional Criteria"] = additionalCriteria;
        if (insightExplanation !== undefined) fields["Insight Explanation"] = insightExplanation;
        if (complexitySpecifications !== undefined) fields["Complexity specifications"] = complexitySpecifications;
        if (keyDataStructure !== undefined) fields["\uD83D\uDD39Key Data Structure"] = keyDataStructure;
        if (solutionAlgorithm !== undefined) fields["Solution Algorithm"] = solutionAlgorithm;
        if (context !== undefined) fields["Context \uD83D\uDCA1"] = context;
        if (source !== undefined) fields["Source \uD83C\uDFAF"] = source;

        if (Object.keys(fields).length > 0) {
          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated interview note ${noteId}`,
            },
          ],
        };
      }

      if (name === "search-collection") {
        const { query, offset } = SearchCollectionArgumentsSchema.parse(args);

        validateSearchQuery(query);
        const preparedQuery = prepareSearchQuery(query);

        const fullQuery = `deck:z -is:suspended -is:new -note:Basic (${preparedQuery})`;
        const noteIds = (await ankiRequest<number[]>("findNotes", { query: fullQuery })).sort((a, b) => b - a);

        if (noteIds.length === 0) {
          return {
            content: [{ type: "text", text: "No notes found." }],
          };
        }

        const totalCount = noteIds.length;
        const pageNoteIds = noteIds.slice(offset, offset + SEARCH_PAGE_SIZE);

        const chunkSize = 5;
        let allNotes: any[] = [];
        for (let i = 0; i < pageNoteIds.length; i += chunkSize) {
          const chunk = pageNoteIds.slice(i, i + chunkSize);
          const chunkNotes = await ankiRequest<any[]>("notesInfo", {
            notes: chunk,
          });
          allNotes = allNotes.concat(chunkNotes);
        }

        const allTags = new Set<string>();
        const formatted = allNotes
          .map((note) => {
            for (const tag of note.tags) {
              if (tag !== "leech") allTags.add(tag);
            }
            const lines: string[] = [`Note ID: ${note.noteId}`];
            for (const [fieldName, field] of Object.entries(note.fields)) {
              const val = (field as any).value;
              if (val) {
                lines.push(`${fieldName}: ${val}`);
              }
            }
            return lines.join("\n");
          })
          .join("\n---\n");

        const tagsList = [...allTags].sort().join(", ");

        const rangeStart = offset + 1;
        const rangeEnd = offset + allNotes.length;
        let header =
          totalCount > SEARCH_PAGE_SIZE
            ? `Showing ${rangeStart}-${rangeEnd} of ${totalCount} notes`
            : `Found ${totalCount} note(s)`;
        if (rangeEnd < totalCount) {
          header += `\nUse offset: ${offset + SEARCH_PAGE_SIZE} to see the next page`;
        }

        return {
          content: [
            {
              type: "text",
              text: `${header}\n\n${formatted}${tagsList ? `\n\n---\nAll tags: ${tagsList}` : ""}`,
            },
          ],
        };
      }

      if (name === "create-cloze-table") {
        const parsed = CreateClozeTableArgumentsSchema.parse(args);
        let { headers, rows } = parsed;
        const { context = "", source = "" } = parsed;

        // Validate that all rows have the same number of cells as headers
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].length !== headers.length) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Row ${i + 1} has ${rows[i].length} cells but expected ${headers.length} (matching headers)`,
                },
              ],
              isError: true,
            };
          }
        }

        const placeholderError = validatePlaceholders(headers, rows);
        if (placeholderError) {
          return {
            content: [{ type: "text" as const, text: placeholderError }],
            isError: true,
          };
        }

        // Auto-transpose if wider than tall
        const transposed = transposeTable(headers, rows);
        headers = transposed.headers;
        rows = transposed.rows;

        // Reformulate __ placeholders to sound more natural
        const reformulated = await reformulatePlaceholders(headers, rows);
        headers = reformulated.headers;
        rows = reformulated.rows;

        // Detect orientation and collect attribute/item labels
        const isOrientationA = headers.some((h) => h.includes("__"));
        const isOrientationB = rows.some((r) => r[0]?.value.includes("__"));

        let attributeLabels: { label: string; index: number }[] = [];
        let itemLabels: string[] = [];

        if (isOrientationA) {
          attributeLabels = headers.map((h, i) => ({ label: h, index: i })).filter((h) => h.label.includes("__"));
          itemLabels = rows.map((r) => r[0].value);
        } else if (isOrientationB) {
          attributeLabels = rows.map((r, i) => ({ label: r[0].value, index: i })).filter((r) => r.label.includes("__"));
          itemLabels = headers.filter((h) => h !== "");
        }

        // Two-step cloze selection: if selectedAttributes is not provided, return a preview
        let clozeCells: Set<string> | undefined;
        let clozeHeaders: Set<number> | undefined;

        if (attributeLabels.length > 0 && parsed.selectedAttributes === undefined) {
          const attributeList = attributeLabels.map((a, i) => `  ${i}: ${a.label}`).join("\n");
          const itemList = itemLabels.map((label) => `  - ${label}`).join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: [
                  "Before creating this cloze table, please select which attributes should have cloze deletions.",
                  "",
                  "**Attributes** (pass desired indices as `selectedAttributes`):",
                  attributeList,
                  "",
                  "**Items** (set `clozeItems` to true/false, default true):",
                  itemList,
                  "",
                  "Please present these options to the user, then call this tool again with the same `headers`, `rows`, `context`, and `source`, plus `selectedAttributes` (array of index numbers) and optionally `clozeItems` (boolean).",
                ].join("\n"),
              },
            ],
          };
        }

        if (attributeLabels.length > 0 && parsed.selectedAttributes !== undefined) {
          const shouldClozeItems = parsed.clozeItems ?? true;

          clozeCells = new Set<string>();
          clozeHeaders = new Set<number>();
          const selectedIndices = new Set(parsed.selectedAttributes.map((s) => attributeLabels[s].index));

          if (isOrientationA) {
            for (const colIdx of selectedIndices) {
              for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                const cell = rows[rowIdx][colIdx];
                if (cell.value !== "" && !cell.value.includes("__")) {
                  clozeCells.add(`${rowIdx},${colIdx}`);
                }
              }
            }
            if (shouldClozeItems) {
              for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                if (rows[rowIdx][0].value !== "") {
                  clozeCells.add(`${rowIdx},0`);
                }
              }
            }
          } else if (isOrientationB) {
            for (const rowIdx of selectedIndices) {
              for (let colIdx = 1; colIdx < rows[rowIdx].length; colIdx++) {
                const cell = rows[rowIdx][colIdx];
                if (cell.value !== "" && !cell.value.includes("__")) {
                  clozeCells.add(`${rowIdx},${colIdx}`);
                }
              }
            }
            if (shouldClozeItems) {
              for (let i = 1; i < headers.length; i++) {
                if (headers[i] !== "") {
                  clozeHeaders.add(i);
                }
              }
            }
          }
        }

        const html = generateClozeTable(headers, rows, clozeCells, clozeHeaders);

        // Look up the deck containing "ClozeTableManager" via AnkiConnect
        const allDecks = await ankiRequest<string[]>("deckNames");
        const clozeTableDeck = allDecks.find((d) => d.includes("ClozeTableManager"));
        if (!clozeTableDeck) {
          return {
            content: [
              {
                type: "text" as const,
                text: 'No deck containing "ClozeTableManager" found in Anki. Please create one first.',
              },
            ],
            isError: true,
          };
        }

        const fields: Record<string, string> = {
          "⭐Text": html,
        };
        if (context) fields["Context 💡"] = context;
        if (source) fields["Source 🏴"] = source;

        const noteId = await ankiRequest<number>("addNote", {
          note: {
            deckName: clozeTableDeck,
            modelName: "2 Cloze",
            fields,
            tags: [MCP_TAG],
          },
        });

        return {
          content: [
            {
              type: "text",
              text: `Successfully created cloze table card in deck "${clozeTableDeck}" (noteId: ${noteId})\n\nGenerated HTML:\n${html}`,
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
        );
      }
      if ((error as any).ankiError) {
        return {
          content: [
            {
              type: "text",
              text: (error as Error).message,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "anki://basic-card-creation-guidelines",
          name: "Card Creation Guidelines",
          description: "Rules and formatting guidelines for creating flashcards. Read before creating cards.",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "anki://basic-card-creation-guidelines") {
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `You must follow the rules below when creating flashcards.\n${RULES}\n${EXTRA_RULES}`,
          },
        ],
      };
    }
    throw new Error(`Invalid resource URI: ${uri}`);
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Anki MCP Server running on stdio");
}

// Run the server
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
