import express from "express";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "../dev.db");

const app = express();
const port = 5555;
const db = new Database(dbPath, { readonly: true });

app.use(express.json());

// API: Get all tables and row counts
app.get("/api/tables", (req, res) => {
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%' ORDER BY name ASC"
      )
      .all();

    const data = tables.map((t) => {
      const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get();
      return {
        name: t.name,
        count: countResult ? countResult.count : 0
      };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get rows and column info for a specific table
app.get("/api/table/:name", (req, res) => {
  try {
    const tableName = req.params.name;
    // Validate table name to prevent SQL injection
    const tableCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName);

    if (!tableCheck) {
      return res.status(404).json({ error: "Table not found" });
    }

    const columnsInfo = db.prepare(`PRAGMA table_info("${tableName}")`).all();
    const columns = columnsInfo.map((col) => col.name);

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const search = req.query.search ? req.query.search.trim() : "";

    let rows;
    let totalCount;

    if (search && columns.length > 0) {
      const whereClauses = columns.map((col) => `CAST("${col}" AS TEXT) LIKE ?`).join(" OR ");
      const searchPattern = `%${search}%`;
      const searchParams = columns.map(() => searchPattern);

      const countQuery = `SELECT COUNT(*) as count FROM "${tableName}" WHERE ${whereClauses}`;
      totalCount = db.prepare(countQuery).get(...searchParams).count;

      const dataQuery = `SELECT * FROM "${tableName}" WHERE ${whereClauses} LIMIT ? OFFSET ?`;
      rows = db.prepare(dataQuery).all(...searchParams, limit, offset);
    } else {
      totalCount = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get().count;
      rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(limit, offset);
    }

    res.json({
      tableName,
      columns,
      rows,
      totalCount,
      limit,
      offset
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UI: SQLite Web GUI (Prisma Studio Style)
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SQLite Studio - Port 5555</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --badge-bg: #334155;
      --row-hover: #1e293b;
      --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    
    /* Top Header */
    header {
      background: #090d16;
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; color: #fff; }
    .logo-badge { background: #0284c7; color: white; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
    .header-info { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--text-muted); }
    .db-badge { background: #1e293b; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); color: #38bdf8; font-family: monospace; }
    
    /* Main Layout */
    .layout { display: flex; flex: 1; overflow: hidden; }
    
    /* Sidebar */
    aside {
      width: 260px;
      background: #0d1322;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      padding: 14px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .table-list { list-style: none; overflow-y: auto; flex: 1; padding: 8px; }
    .table-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 12px;
      border-radius: 6px;
      cursor: pointer;
      color: #cbd5e1;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s ease;
      margin-bottom: 2px;
    }
    .table-item:hover { background: #1e293b; color: #fff; }
    .table-item.active { background: #0284c7; color: #fff; font-weight: 600; }
    .table-count {
      font-size: 11px;
      background: rgba(255,255,255,0.1);
      padding: 2px 6px;
      border-radius: 12px;
      min-width: 20px;
      text-align: center;
    }
    .table-item.active .table-count { background: rgba(0,0,0,0.3); }

    /* Content Area */
    main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #0f172a; }
    .toolbar {
      padding: 12px 20px;
      background: #131c31;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .active-title { display: flex; align-items: baseline; gap: 10px; }
    .active-title h2 { font-size: 17px; font-weight: 600; color: #fff; }
    .active-title span { font-size: 13px; color: var(--text-muted); }
    
    .toolbar-actions { display: flex; align-items: center; gap: 12px; }
    .search-box {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      color: #fff;
      font-size: 13px;
      outline: none;
      width: 220px;
    }
    .search-box:focus { border-color: var(--primary); }
    .btn {
      background: #1e293b;
      border: 1px solid var(--border);
      color: #cbd5e1;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .btn:hover { background: #334155; color: #fff; }
    .btn-primary { background: #0284c7; border-color: #0284c7; color: white; }
    .btn-primary:hover { background: #0369a1; }

    /* Table Container */
    .table-container {
      flex: 1;
      overflow: auto;
      padding: 0;
      position: relative;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    th {
      background: #172138;
      color: #94a3b8;
      padding: 10px 14px;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 10;
      white-space: nowrap;
    }
    td {
      padding: 9px 14px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.4);
      color: #e2e8f0;
      max-width: 320px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    tr:hover td { background: #19243c; }
    .cell-null { color: #64748b; font-style: italic; }
    .cell-id { color: #38bdf8; font-weight: 500; }
    .cell-status-APPROVED { color: #4ade80; font-weight: 600; }
    .cell-status-DENIED { color: #f87171; font-weight: 600; }
    .cell-status-SUBMITTED { color: #fbbf24; font-weight: 600; }

    /* Modal / Inspector */
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(2px);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    .modal.show { display: flex; }
    .modal-content {
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 600px;
      max-width: 90vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
    }
    .modal-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
    }
    .modal-body {
      padding: 16px 18px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      color: #e2e8f0;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <span>⚡ SQLite Studio</span>
      <span class="logo-badge">PORT 5555</span>
    </div>
    <div class="header-info">
      <span>Database:</span>
      <span class="db-badge">backend/dev.db</span>
    </div>
  </header>

  <div class="layout">
    <aside>
      <div class="sidebar-header">Database Tables</div>
      <ul class="table-list" id="tableList">
        <li style="padding: 12px; color: #64748b; font-size: 12px;">Loading tables...</li>
      </ul>
    </aside>

    <main>
      <div class="toolbar">
        <div class="active-title">
          <h2 id="currentTableName">Select a table</h2>
          <span id="rowCountBadge"></span>
        </div>
        <div class="toolbar-actions">
          <input type="text" id="searchInput" class="search-box" placeholder="Filter rows..." onkeyup="handleSearch(event)">
          <button class="btn btn-primary" onclick="loadTable(activeTable)">🔄 Refresh</button>
        </div>
      </div>

      <div class="table-container" id="tableContainer">
        <div style="padding: 40px; text-align: center; color: #64748b;">
          Select a table from the left menu to view records.
        </div>
      </div>
    </main>
  </div>

  <div id="inspectorModal" class="modal" onclick="closeModal(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span id="modalTitle">Record Detail</span>
        <button class="btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" id="modalBody"></div>
    </div>
  </div>

  <script>
    let activeTable = null;
    let tablesData = [];

    async function fetchTables() {
      try {
        const res = await fetch('/api/tables');
        tablesData = await res.json();
        renderTablesList();
        if (tablesData.length > 0 && !activeTable) {
          const defaultTable = tablesData.find(t => t.name === 'Claim') || tablesData[0];
          loadTable(defaultTable.name);
        }
      } catch (err) {
        document.getElementById('tableList').innerHTML = '<li style="padding:12px; color:#f87171;">Failed to connect to SQLite</li>';
      }
    }

    function renderTablesList() {
      const container = document.getElementById('tableList');
      container.innerHTML = tablesData.map(t => \`
        <li class="table-item \${activeTable === t.name ? 'active' : ''}" onclick="loadTable('\${t.name}')">
          <span>\${t.name}</span>
          <span class="table-count">\${t.count}</span>
        </li>
      \`).join('');
    }

    async function loadTable(tableName, search = '') {
      if (!tableName) return;
      activeTable = tableName;
      renderTablesList();

      document.getElementById('currentTableName').innerText = tableName;
      document.getElementById('rowCountBadge').innerText = 'Loading...';

      const url = \`/api/table/\${encodeURIComponent(tableName)}?search=\${encodeURIComponent(search)}\`;
      try {
        const res = await fetch(url);
        const data = await res.json();

        document.getElementById('rowCountBadge').innerText = \`(\${data.totalCount} records\${search ? ' matching search' : ''})\`;

        if (data.rows.length === 0) {
          document.getElementById('tableContainer').innerHTML = \`
            <div style="padding: 40px; text-align: center; color: #64748b;">
              No records found \${search ? 'matching \"' + search + '\"' : 'in ' + tableName}.
            </div>\`;
          return;
        }

        let html = '<table><thead><tr>';
        data.columns.forEach(col => {
          html += \`<th>\${col}</th>\`;
        });
        html += '</tr></thead><tbody>';

        data.rows.forEach(row => {
          html += \`<tr onclick='showInspector(\${JSON.stringify(row).replace(/'/g, "&apos;")})' style="cursor:pointer;" title="Click to view full row">\`;
          data.columns.forEach(col => {
            let val = row[col];
            let cls = '';
            if (val === null || val === undefined) {
              val = 'null';
              cls = 'cell-null';
            } else if (typeof val === 'object') {
              val = JSON.stringify(val);
            } else {
              val = String(val);
              if (col.toLowerCase().includes('id')) cls = 'cell-id';
              if (col.toLowerCase() === 'status') cls = \`cell-status-\${val}\`;
            }
            html += \`<td class="\${cls}">\${escapeHtml(val)}</td>\`;
          });
          html += '</tr>';
        });

        html += '</tbody></table>';
        document.getElementById('tableContainer').innerHTML = html;
      } catch (err) {
        document.getElementById('tableContainer').innerHTML = \`<div style="padding: 40px; color: #f87171;">Error: \${err.message}</div>\`;
      }
    }

    let searchTimer = null;
    function handleSearch(e) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        loadTable(activeTable, e.target.value);
      }, 300);
    }

    function showInspector(row) {
      document.getElementById('modalTitle').innerText = \`\${activeTable} Record\`;
      document.getElementById('modalBody').innerText = JSON.stringify(row, null, 2);
      document.getElementById('inspectorModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('inspectorModal').classList.remove('show');
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    fetchTables();
  </script>
</body>
</html>`);
});

app.listen(port, () => {
  console.log(`\n==================================================`);
  console.log(`⚡ SQLite Studio running at: http://localhost:${port}`);
  console.log(`📁 Connected Database: ${dbPath}`);
  console.log(`==================================================\n`);
});

