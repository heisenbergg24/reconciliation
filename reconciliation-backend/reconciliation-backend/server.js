const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const multer = require('multer');
const path = require('path');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs'); 

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = '/home/pratik/Desktop/dbms/miniproject/miniproject';

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database successfully at:', DB_PATH);
  }
});

// 1. GET: Dashboard Summary
app.get('/api/dashboard/summary', (req, res) => {
  const query = `
    SELECT
      COALESCE(SUM(b.amount), 0) AS total_processed,
      COALESCE(SUM(r.variance_amt), 0) AS total_variance
    FROM RECONCILIATION r
    LEFT JOIN BANK_STATEMENT b ON r.statement_id = b.statement_id;
  `;
  db.get(query, [], (err, row) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(row || {});
  });
});

// 2. GET: Match Status Breakdown
app.get('/api/dashboard/match-status', (req, res) => {
  const query = `
    SELECT match_status, COUNT(*) as count 
    FROM RECONCILIATION 
    GROUP BY match_status;
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// 3. GET: Discrepancy Breakdown
app.get('/api/dashboard/discrepancies', (req, res) => {
  const query = `
    SELECT discrepancy_type, COUNT(*) as count, COALESCE(SUM(amount_diff), 0) as total_amount
    FROM DISCREPANCY
    GROUP BY discrepancy_type;
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// 4. GET: Party Invoices & Line Items
app.get('/api/invoices/details', (req, res) => {
  const query = `
    SELECT 
      p.party_name,
      p.party_type,
      i.invoice_no,
      i.invoice_amount,
      i.due_date,
      li.line_item
    FROM PARTY p
    JOIN INVOICE i ON p.party_id = i.party_id
    LEFT JOIN INVOICE_LINE_ITEMS li ON i.party_id = li.party_id AND i.invoice_no = li.invoice_no;
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// 5. GET: Users & Roles
app.get('/api/users/roles', (req, res) => {
  const query = `
    SELECT 
      u.user_id,
      u.first_name || ' ' || u.last_name AS full_name,
      u.email,
      ur.role
    FROM USERS u
    LEFT JOIN USER_ROLES ur ON u.user_id = ur.user_id;
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// 6. POST: Manual Match
app.post('/api/reconcile/manual', (req, res) => {
  const { user_id, party_id, invoice_no, statement_id } = req.body;

  if (!user_id || !party_id || !invoice_no || !statement_id) {
    return res.status(400).json({ error: 'Missing required parameters: user_id, party_id, invoice_no, statement_id' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');

    const insertQuery = `
      INSERT INTO RECONCILIATION (match_date, match_status, variance_amt, user_id, statement_id, invoice_no, party_id)
      VALUES (datetime('now'), 'MATCHED', 0.00, ?, ?, ?, ?);
    `;

    db.run(insertQuery, [user_id, statement_id, invoice_no, party_id], function (err) {
      if (err) {
        db.run('ROLLBACK;');
        return res.status(500).json({ error: err.message });
      }

      const updateBankQuery = `UPDATE BANK_STATEMENT SET status = 'RECONCILED' WHERE statement_id = ?;`;
      db.run(updateBankQuery, [statement_id], (updateErr) => {
        if (updateErr) {
          db.run('ROLLBACK;');
          return res.status(500).json({ error: updateErr.message });
        }

        db.run('COMMIT;', (commitErr) => {
          if (commitErr) return res.status(500).json({ error: commitErr.message });
          res.json({ message: 'Manual reconciliation successful', reconciliation_id: this.lastID });
        });
      });
    });
  });
});

// 7. PATCH: Resolve Discrepancy
app.patch('/api/discrepancies/:id/resolve', (req, res) => {
  const discrepancyId = req.params.id;
  const { resolution_status = 'RESOLVED' } = req.body;

  const query = `
    UPDATE DISCREPANCY 
    SET resolution_status = ? 
    WHERE reconciliation_id = ?;
  `;

  db.run(query, [resolution_status, discrepancyId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Discrepancy record not found' });
    res.json({ message: `Discrepancy status updated to ${resolution_status}`, affected_rows: this.changes });
  });
});

// ---- promise helpers (so every statement runs strictly in order) ----
const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    })
  );
const all = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

/**
 * Matching rules
 *  Phase 1: exact amount matches (diff = 0) are always taken first -> MATCHED
 *  Phase 2: remaining items are matched within +/- tolerance using a sorted
 *           two-pointer sweep, which finds the MAXIMUM number of pairs.
 *           This guarantees that raising the tolerance can never reduce the
 *           number of matches (so unmatched items can only go down).
 *  An invoice is identified by (party_id, invoice_no), never invoice_no alone.
 */
function computeMatches(statements, invoices, tolerance) {
  const toCents = (x) => Math.round(Number(x) * 100);
  const tolC = Math.max(0, Math.round(tolerance * 100));

  const stmts = statements
    .filter((s) => s.amount !== null && !isNaN(Number(s.amount)))
    .map((s) => ({ ...s, c: toCents(s.amount) }));
  const invs = invoices
    .filter((i) => i.invoice_amount !== null && !isNaN(Number(i.invoice_amount)))
    .map((i) => ({ ...i, c: toCents(i.invoice_amount) }));

  const matches = [];
  const usedStmt = new Set();
  const usedInv = new Set();
  const invKey = (i) => `${i.party_id}|${i.invoice_no}`;
  const take = (s, i) => {
    usedStmt.add(s.statement_id);
    usedInv.add(invKey(i));
    const diffC = Math.abs(i.c - s.c);
    matches.push({
      statement_id: s.statement_id,
      invoice_no: i.invoice_no,
      party_id: i.party_id,
      variance: diffC / 100,
      matchStatus: diffC === 0 ? 'MATCHED' : 'PARTIAL',
    });
  };

  // Phase 1: exact
  const byAmount = new Map();
  invs.forEach((i) => {
    if (!byAmount.has(i.c)) byAmount.set(i.c, []);
    byAmount.get(i.c).push(i);
  });
  stmts.forEach((s) => {
    const list = byAmount.get(s.c);
    if (!list) return;
    const inv = list.find((i) => !usedInv.has(invKey(i)));
    if (inv) take(s, inv);
  });

  // Phase 2: tolerance sweep
  if (tolC > 0) {
    const rs = stmts.filter((s) => !usedStmt.has(s.statement_id)).sort((a, b) => a.c - b.c);
    const ri = invs.filter((i) => !usedInv.has(invKey(i))).sort((a, b) => a.c - b.c);
    let j = 0;
    for (const s of rs) {
      while (j < ri.length && ri[j].c < s.c - tolC) j++;
      if (j < ri.length && ri[j].c <= s.c + tolC) {
        take(s, ri[j]);
        j++;
      }
    }
  }
  return { matches, total: stmts.length };
}

// 8. POST: Auto-Reconciliation Engine
let reconcileBusy = false;
app.post('/api/reconcile/auto', async (req, res) => {
  const tolerance = parseFloat(req.body.tolerance);
  const tolValue = isNaN(tolerance) || tolerance < 0 ? 0 : tolerance;
  const user_id = req.body.user_id || 1;

  if (reconcileBusy) return res.status(409).json({ error: 'Reconciliation already running' });
  reconcileBusy = true;

  try {
    const statements = await all('SELECT statement_id, amount FROM BANK_STATEMENT ORDER BY statement_id ASC');
    const invoices = await all('SELECT invoice_no, party_id, invoice_amount FROM INVOICE ORDER BY party_id, invoice_no');
    const { matches, total } = computeMatches(statements, invoices, tolValue);

    await run('BEGIN TRANSACTION;');
    try {
      await run('DELETE FROM DISCREPANCY;'); // child table first
      await run('DELETE FROM RECONCILIATION;');
      await run("UPDATE BANK_STATEMENT SET status = 'PENDING';");

      for (const m of matches) {
        await run(
          `INSERT INTO RECONCILIATION (match_date, match_status, variance_amt, user_id, statement_id, invoice_no, party_id)
           VALUES (datetime('now'), ?, ?, ?, ?, ?, ?);`,
          [m.matchStatus, m.variance, user_id, m.statement_id, m.invoice_no, m.party_id]
        );
        await run("UPDATE BANK_STATEMENT SET status = 'RECONCILED' WHERE statement_id = ?;", [m.statement_id]);
      }
      await run('COMMIT;');
    } catch (txErr) {
      await run('ROLLBACK;').catch(() => {});
      throw txErr;
    }

    res.json({
      message: 'Auto-reconciliation complete',
      tolerance: tolValue,
      matched_count: matches.length,
      exact_count: matches.filter((m) => m.matchStatus === 'MATCHED').length,
      partial_count: matches.filter((m) => m.matchStatus === 'PARTIAL').length,
      unmatched_count: total - matches.length,
    });
  } catch (err) {
    console.error('Auto-reconcile error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    reconcileBusy = false;
  }
});

// 9. GET: Pandas Cleaned Analytics Pipeline
app.get('/api/analytics/pipeline', (req, res) => {
  const scriptPath = '/home/pratik/Desktop/dbms/miniproject/reconciliation-backend/reconciliation-backend/analytics.py';
  
  exec(`python3 ${scriptPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error('Python Script Error:', stderr);
      return res.status(500).json({ error: 'Failed to run data pipeline' });
    }
    try {
      const data = JSON.parse(stdout);
      res.json(data);
    } catch (parseErr) {
      res.status(500).json({ error: 'Invalid JSON output from Python script' });
    }
  });
});

// 10. POST: Bulk CSV Upload Endpoint
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  const dataType = req.params.type;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = req.file.path;
  const scriptPath = path.join(__dirname, 'bulk_ingest.py');

  exec(`python3 ${scriptPath} "${filePath}" "${dataType}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Bulk ingest error:', stderr);
      return res.status(500).json({ error: 'Failed to process CSV file' });
    }
    try {
      const result = JSON.parse(stdout);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Invalid response from parser' });
    }
  });
});

// 11. POST: Wipe Database & Re-seed
app.post('/api/db/reset', (req, res) => {
  db.serialize(() => {
    db.run('DELETE FROM DISCREPANCY;');
    db.run('DELETE FROM RECONCILIATION;');
    db.run('DELETE FROM INVOICE_LINE_ITEMS;');
    db.run('DELETE FROM INVOICE;');
    db.run('DELETE FROM BANK_STATEMENT;');
    db.run('DELETE FROM USER_ROLES;');
    db.run('DELETE FROM USERS;');
    db.run('DELETE FROM PARTY;');

    db.run(`INSERT INTO PARTY (party_id, party_name, email, party_type) VALUES 
      (1, 'Acme Corp', 'billing@acme.com', 'CUSTOMER'),
      (2, 'Global Supplies', 'accounts@globalsupplies.com', 'VENDOR'),
      (3, 'Nexus Tech', 'finance@nexus.io', 'CUSTOMER');`);

    db.run(`INSERT INTO USERS (user_id, first_name, last_name, email) VALUES 
      (1, 'Alex', 'Smith', 'alex@example.com');`);
    
    db.run(`INSERT INTO USER_ROLES (user_id, role) VALUES (1, 'ADMIN');`);

    res.json({ message: 'Database wiped and reset with clean base tables' });
  });
});

// 12. GET: Download Cleaned CSV
app.get('/api/dataset/download-cleaned', (req, res) => {
  const filePath = path.join(__dirname, 'cleaned_reconciliation_dataset.csv');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'cleaned_reconciliation_dataset.csv');
  } else {
    res.status(404).json({ error: 'Cleaned dataset file not found. Please run reconciliation first.' });
  }
});


// 13. GET: Fetch Unmatched Transactions for Exception Management
// A statement is unmatched when it has no row in RECONCILIATION
// (independent of whatever text is stored in BANK_STATEMENT.status).
app.get('/api/reconcile/unmatched', (req, res) => {
  const query = `
    SELECT b.statement_id, b.txn_date, b.amount, b.reference_no, 'PENDING' AS status
    FROM BANK_STATEMENT b
    WHERE NOT EXISTS (
      SELECT 1 FROM RECONCILIATION r WHERE r.statement_id = b.statement_id
    )
    ORDER BY b.statement_id ASC;
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// ALL ROUTES ARE DEFINED ABOVE THIS LINE

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
