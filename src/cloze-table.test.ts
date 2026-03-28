import { describe, expect, it } from "vitest";
import { generateClozeTable, transposeTable, validatePlaceholders } from "./index.js";

describe("validatePlaceholders", () => {
  it("returns null when all __ values end with ? or :", () => {
    expect(validatePlaceholders(["", "__ workload:"], [[{ value: "SQLite" }, { value: "OLTP" }]])).toBeNull();
    expect(validatePlaceholders(["", "Who created __?"], [[{ value: "Linux" }, { value: "Linus" }]])).toBeNull();
  });

  it("rejects a header with __ not ending in ? or :", () => {
    expect(validatePlaceholders(["", "__ workload"], [])).toContain('must end with "?" or ":"');
  });

  it("rejects a cell with __ not ending in ? or :", () => {
    expect(validatePlaceholders(["", "SQLite"], [[{ value: "__ workload" }, { value: "OLTP" }]])).toContain(
      'must end with "?" or ":"',
    );
  });

  it("allows empty headers and cells without __", () => {
    expect(validatePlaceholders(["", "SQLite"], [[{ value: "" }, { value: "OLTP" }]])).toBeNull();
  });
});

describe("transposeTable", () => {
  it("does not transpose when rows >= columns", () => {
    const headers = ["", "__ workload:"];
    const rows = [
      [{ value: "SQLite" }, { value: "OLTP" }],
      [{ value: "DuckDB" }, { value: "OLAP" }],
    ];
    const result = transposeTable(headers, rows);
    expect(result.headers).toEqual(headers);
    expect(result.rows).toEqual(rows);
  });

  it("transposes when columns > rows", () => {
    const headers = ["", "__ workload:", "__ storage:"];
    const rows = [[{ value: "SQLite" }, { value: "OLTP" }, { value: "Row-oriented" }]];
    const result = transposeTable(headers, rows);
    expect(result.headers).toEqual(["", "SQLite"]);
    expect(result.rows).toEqual([
      [{ value: "__ workload:" }, { value: "OLTP" }],
      [{ value: "__ storage:" }, { value: "Row-oriented" }],
    ]);
  });

  it("preserves hints when transposing", () => {
    const headers = ["", "__ workload:", "__ storage:"];
    const rows = [[{ value: "SQLite" }, { value: "OLTP", hint: "type" }, { value: "Row-oriented" }]];
    const result = transposeTable(headers, rows);
    expect(result.rows[0][1]).toEqual({ value: "OLTP", hint: "type" });
  });
});

describe("generateClozeTable", () => {
  it("wraps regular cells in cloze deletions with incrementing numbers", () => {
    const headers = ["", "__ workload:"];
    const rows = [
      [{ value: "SQLite" }, { value: "OLTP" }],
      [{ value: "DuckDB" }, { value: "OLAP" }],
    ];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("{{c1::SQLite}}");
    expect(html).toContain("{{c2::OLTP}}");
    expect(html).toContain("{{c3::DuckDB}}");
    expect(html).toContain("{{c4::OLAP}}");
  });

  it("includes hints when provided", () => {
    const headers = ["", "__ openness:"];
    const rows = [[{ value: "UNIX" }, { value: "closed", hint: "open / closed" }]];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("{{c1::UNIX}}");
    expect(html).toContain("{{c2::closed::open / closed}}");
  });

  it("does not cloze empty cells", () => {
    const headers = ["", "__ workload:"];
    const rows = [[{ value: "" }, { value: "OLTP" }]];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("<td></td>");
    expect(html).toContain("{{c1::OLTP}}");
    expect(html).not.toContain("{{c2::");
  });

  it("does not cloze cells containing __", () => {
    const headers = ["", "SQLite", "DuckDB"];
    const rows = [
      [{ value: "__ workload:" }, { value: "OLTP" }, { value: "OLAP" }],
      [{ value: "__ storage:" }, { value: "Row-oriented" }, { value: "Columnar" }],
    ];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("<td>__ workload:</td>");
    expect(html).toContain("<td>__ storage:</td>");
    expect(html).toContain("<th>{{c1::SQLite}}</th>");
    expect(html).toContain("<th>{{c2::DuckDB}}</th>");
    expect(html).toContain("{{c3::OLTP}}");
    expect(html).toContain("{{c4::OLAP}}");
    expect(html).toContain("{{c5::Row-oriented}}");
    expect(html).toContain("{{c6::Columnar}}");
  });

  it("skips __ and empty cells in cloze numbering", () => {
    const headers = ["", "Val:"];
    const rows = [
      [{ value: "__ attr:" }, { value: "A" }],
      [{ value: "__ attr2:" }, { value: "B" }],
    ];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("{{c1::Val:}}");
    expect(html).toContain("{{c2::A}}");
    expect(html).toContain("{{c3::B}}");
    expect(html).not.toContain("{{c4::");
  });

  it("generates correct table structure", () => {
    const headers = ["", "__ creator:"];
    const rows = [[{ value: "UNIX" }, { value: "Ken Thompson" }]];
    const html = generateClozeTable(headers, rows);
    expect(html).toBe(
      [
        "<table>",
        "  <thead>",
        "    <tr>",
        "      <th></th>",
        "      <th>__ creator:</th>",
        "    </tr>",
        "  </thead>",
        "  <tbody>",
        "    <tr>",
        "      <td>{{c1::UNIX}}</td>",
        "      <td>{{c2::Ken Thompson}}</td>",
        "    </tr>",
        "  </tbody>",
        "</table>",
      ].join("\n"),
    );
  });

  it("numbers clozes sequentially in row-major order", () => {
    const headers = ["", "__ a:", "__ b:"];
    const rows = [
      [{ value: "X" }, { value: "1" }, { value: "2" }],
      [{ value: "Y" }, { value: "3" }, { value: "4" }],
    ];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("{{c1::X}}");
    expect(html).toContain("{{c2::1}}");
    expect(html).toContain("{{c3::2}}");
    expect(html).toContain("{{c4::Y}}");
    expect(html).toContain("{{c5::3}}");
    expect(html).toContain("{{c6::4}}");
  });

  it("handles HTML content in cells", () => {
    const headers = ["", "__ examples:"];
    const rows = [[{ value: "Linux" }, { value: "<ul><li>Ubuntu</li><li>Debian</li></ul>" }]];
    const html = generateClozeTable(headers, rows);
    expect(html).toContain("{{c1::Linux}}");
    expect(html).toContain("{{c2::<ul><li>Ubuntu</li><li>Debian</li></ul>}}");
  });

  it("works when __ headers are in either orientation", () => {
    // __ in headers (normal orientation)
    const html1 = generateClozeTable(["", "__ workload:"], [[{ value: "SQLite" }, { value: "OLTP" }]]);
    expect(html1).toContain("{{c1::SQLite}}");
    expect(html1).toContain("{{c2::OLTP}}");

    // __ in first column (transposed orientation)
    const html2 = generateClozeTable(["", "SQLite"], [[{ value: "__ workload:" }, { value: "OLTP" }]]);
    expect(html2).toContain("<th>{{c1::SQLite}}</th>");
    expect(html2).toContain("<td>__ workload:</td>");
    expect(html2).toContain("{{c2::OLTP}}");
  });

  it("uses clozeCells to selectively cloze body cells (orientation A)", () => {
    const headers = ["", "__ workload:", "__ storage:"];
    const rows = [
      [{ value: "SQLite" }, { value: "OLTP" }, { value: "Row-oriented" }],
      [{ value: "DuckDB" }, { value: "OLAP" }, { value: "Columnar" }],
    ];
    // Only cloze the workload column (index 1) and items (column 0)
    const clozeCells = new Set(["0,0", "0,1", "1,0", "1,1"]);
    const html = generateClozeTable(headers, rows, clozeCells, new Set());
    expect(html).toContain("{{c1::SQLite}}");
    expect(html).toContain("{{c2::OLTP}}");
    expect(html).toContain("<td>Row-oriented</td>");
    expect(html).toContain("{{c3::DuckDB}}");
    expect(html).toContain("{{c4::OLAP}}");
    expect(html).toContain("<td>Columnar</td>");
    // Headers should not be clozed (empty clozeHeaders)
    expect(html).toContain("<th>__ workload:</th>");
    expect(html).toContain("<th>__ storage:</th>");
  });

  it("uses clozeHeaders to selectively cloze headers (orientation B)", () => {
    const headers = ["", "SQLite", "DuckDB"];
    const rows = [
      [{ value: "__ workload:" }, { value: "OLTP" }, { value: "OLAP" }],
      [{ value: "__ storage:" }, { value: "Row-oriented" }, { value: "Columnar" }],
    ];
    // Only cloze workload row (row 0) data cells, and item headers
    const clozeCells = new Set(["0,1", "0,2"]);
    const clozeHeaders = new Set([1, 2]);
    const html = generateClozeTable(headers, rows, clozeCells, clozeHeaders);
    expect(html).toContain("<th>{{c1::SQLite}}</th>");
    expect(html).toContain("<th>{{c2::DuckDB}}</th>");
    expect(html).toContain("{{c3::OLTP}}");
    expect(html).toContain("{{c4::OLAP}}");
    // Storage row should not be clozed
    expect(html).toContain("<td>Row-oriented</td>");
    expect(html).toContain("<td>Columnar</td>");
  });

  it("clozes nothing when clozeCells is empty", () => {
    const headers = ["", "__ workload:"];
    const rows = [[{ value: "SQLite" }, { value: "OLTP" }]];
    const html = generateClozeTable(headers, rows, new Set(), new Set());
    expect(html).not.toContain("{{c");
    expect(html).toContain("<td>SQLite</td>");
    expect(html).toContain("<td>OLTP</td>");
  });
});
