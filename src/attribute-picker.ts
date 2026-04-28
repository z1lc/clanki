import { exec } from "node:child_process";
import * as http from "node:http";

export interface PickerData {
  headers: string[];
  rows: Array<Array<{ value: string; hint?: string }>>;
  attributeLabels: Array<{ label: string; index: number }>;
  itemLabels: string[];
  isOrientationA: boolean;
}

interface PendingPicker {
  html: string;
  resolve: (result: { selectedAttributes: number[]; clozeItems: boolean }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`, () => {});
}

function generatePickerHtml(data: PickerData): string {
  const { headers, rows, attributeLabels, isOrientationA } = data;

  const tableRows = rows
    .map((row) => {
      const cells = row.map((cell) => `<td>${cell.value}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n        ");

  const headerCells = headers.map((h) => `<th>${h}</th>`).join("");

  const attrCheckboxes = attributeLabels
    .map(
      (a, i) =>
        `<label class="checkbox-row"><input type="checkbox" name="attr" value="${i}" checked data-attr-index="${a.index}" /><span class="attr-label">${a.label}</span></label>`,
    )
    .join("\n        ");

  const itemsLabel = isOrientationA ? "first column" : "header row";

  // biome-ignore format: inline HTML template
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cloze Table — Select Attributes</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f7;
      color: #1d1d1f;
      display: flex;
      justify-content: center;
      padding: 40px 20px;
    }
    .container { max-width: 860px; width: 100%; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
    h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #555; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 32px;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 10px 14px;
      border: 1px solid #e5e5e7;
      text-align: left;
      font-size: 14px;
      transition: background 0.15s;
    }
    th { background: #fafafa; font-weight: 600; }
    td.highlighted, th.highlighted { background: #dbeafe; }
    td.item-highlighted, th.item-highlighted { background: #dcfce7; }
    .options {
      background: #fff;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 24px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      font-size: 15px;
      cursor: pointer;
    }
    .checkbox-row input { width: 18px; height: 18px; cursor: pointer; }
    .divider { border-top: 1px solid #e5e5e7; margin: 16px 0; }
    button[type="submit"] {
      display: block;
      width: 100%;
      padding: 14px;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      background: #2563eb;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    button[type="submit"]:hover { background: #1d4ed8; }
    .done { text-align: center; padding: 60px 20px; font-size: 18px; color: #16a34a; font-weight: 600; }
    .reformulating { font-size: 13px; color: #888; margin-bottom: 16px; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Cloze Table — Select Attributes</h1>
    <div id="reformulating" class="reformulating">Reformulating headers...</div>
    <table id="preview">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <form id="form">
      <div class="options">
        <h2>Attributes to cloze</h2>
        ${attrCheckboxes}
        <div class="divider"></div>
        <label class="checkbox-row"><input type="checkbox" id="clozeItems" checked /><span>Cloze item labels (${itemsLabel})</span></label>
      </div>
      <button type="submit">Create Card</button>
    </form>
  </div>
  <script>
    const isOrientationA = ${isOrientationA};
    const attrCheckboxes = document.querySelectorAll('input[name="attr"]');
    const clozeItemsCheckbox = document.getElementById('clozeItems');
    const table = document.getElementById('preview');
    let reformulationDone = false;

    function updateHighlights() {
      table.querySelectorAll('.highlighted, .item-highlighted').forEach(function(el) { el.classList.remove('highlighted', 'item-highlighted'); });
      attrCheckboxes.forEach(function(cb) {
        if (!cb.checked) return;
        const idx = parseInt(cb.dataset.attrIndex);
        if (isOrientationA) {
          table.querySelectorAll('thead tr').forEach(function(tr) { if (tr.children[idx]) tr.children[idx].classList.add('highlighted'); });
          table.querySelectorAll('tbody tr').forEach(function(tr) { if (tr.children[idx]) tr.children[idx].classList.add('highlighted'); });
        } else {
          const row = table.querySelectorAll('tbody tr')[idx];
          if (row) row.querySelectorAll('td').forEach(function(td) { td.classList.add('highlighted'); });
        }
      });
      if (clozeItemsCheckbox.checked) {
        if (isOrientationA) {
          table.querySelectorAll('tbody tr').forEach(function(tr) { if (tr.children[0]) tr.children[0].classList.add('item-highlighted'); });
        } else {
          const hr = table.querySelector('thead tr');
          Array.from(hr.children).forEach(function(th, i) { if (i > 0) th.classList.add('item-highlighted'); });
        }
      }
    }

    attrCheckboxes.forEach(function(cb) { cb.addEventListener('change', updateHighlights); });
    clozeItemsCheckbox.addEventListener('change', updateHighlights);
    updateHighlights();

    const pollInterval = setInterval(async function() {
      try {
        const res = await fetch('/updates');
        const data = await res.json();
        if (!data.ready) return;
        clearInterval(pollInterval);
        reformulationDone = true;
        const el = document.getElementById('reformulating');
        if (el) el.remove();
        const headerRow = table.querySelector('thead tr');
        data.headers.forEach(function(h, i) { if (headerRow.children[i]) headerRow.children[i].textContent = h; });
        const bodyRows = table.querySelectorAll('tbody tr');
        data.rows.forEach(function(row, ri) {
          if (!bodyRows[ri]) return;
          row.forEach(function(cell, ci) { if (bodyRows[ri].children[ci]) bodyRows[ri].children[ci].textContent = cell.value; });
        });
        const labels = document.querySelectorAll('.attr-label');
        data.attributeLabels.forEach(function(a, i) { if (labels[i]) labels[i].textContent = a.label; });
        updateHighlights();
      } catch(e) {}
    }, 500);

    document.getElementById('form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const selected = Array.from(attrCheckboxes).filter(function(cb) { return cb.checked; }).map(function(cb) { return parseInt(cb.value); });
      const clozeItems = clozeItemsCheckbox.checked;
      const res = await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAttributes: selected, clozeItems }),
      });
      if (res.ok) {
        const msg = reformulationDone
          ? 'Card created. You can close this tab.'
          : 'Selection submitted. Card will be created once header reformulation completes. You can close this tab.';
        document.querySelector('.container').innerHTML = '<div class="done">' + msg + '</div>';
      }
    });
  </script>
</body>
</html>`;
}

const PICKER_TIMEOUT_MS = 5 * 60 * 1000;
let pendingPicker: PendingPicker | null = null;
let updatedData: PickerData | null = null;
let serverUrl: string | null = null;

export function updatePickerData(data: PickerData): void {
  updatedData = data;
  if (pendingPicker) {
    pendingPicker.html = generatePickerHtml(data);
  }
}

export function startPickerServer(): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        if (!pendingPicker) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><p>No cloze table pending. This page will refresh automatically.</p></body></html>");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(pendingPicker.html);
        return;
      }

      if (req.method === "GET" && req.url === "/updates") {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (updatedData) {
          res.end(JSON.stringify({ ready: true, ...updatedData }));
        } else {
          res.end(JSON.stringify({ ready: false }));
        }
        return;
      }

      if (req.method === "POST" && req.url === "/submit") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (!pendingPicker) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No pending picker" }));
            return;
          }
          try {
            const parsed = JSON.parse(body) as { selectedAttributes: number[]; clozeItems: boolean };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            clearTimeout(pendingPicker.timeout);
            pendingPicker.resolve(parsed);
            pendingPicker = null;
            updatedData = null;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        serverUrl = `http://localhost:${addr.port}`;
        console.error(`Attribute picker server running at ${serverUrl}`);
        resolve(serverUrl);
      }
    });
  });
}

export function showAttributePicker(data: PickerData): Promise<{ selectedAttributes: number[]; clozeItems: boolean }> {
  return new Promise((resolve, reject) => {
    const html = generatePickerHtml(data);
    updatedData = null;

    const timeout = setTimeout(() => {
      if (pendingPicker) {
        pendingPicker = null;
        reject(new Error("Attribute picker timed out (5 minutes). Please try again."));
      }
    }, PICKER_TIMEOUT_MS);

    pendingPicker = { html, resolve, reject, timeout };

    if (serverUrl) {
      openBrowser(serverUrl);
    }
  });
}
