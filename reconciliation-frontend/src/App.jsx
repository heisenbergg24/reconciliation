import React, { useState, useEffect } from "react";
import {
  Activity,
  DollarSign,
  RefreshCw,
  Trash2,
  Play,
  BarChart2,
  PieChart as PieIcon,
  TrendingUp,
  Grid3x3,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

// Paste the Power BI embed / "Publish to web" URL here once the report is published
const POWERBI_URL = "";

const STATUS_COLORS = {
  MATCHED: "#10b981",
  PARTIAL: "#f59e0b",
  UNMATCHED: "#ef4444",
};
const FALLBACK = ["#2563eb", "#8b5cf6", "#06b6d4", "#64748b"];

const cardStyle = {
  background: "#fff",
  padding: "20px",
  borderRadius: "12px",
  height: "340px",
  boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
};

// Heat map: parties (rows) x variance bands (columns), colour = record count
function HeatMap({ data }) {
  const parties = data?.parties || [];
  const bands = data?.bands || [];
  const cells = data?.cells || [];
  if (!parties.length) {
    return (
      <div style={{ color: "#64748b", fontSize: "14px", padding: "24px 0" }}>
        No reconciled records yet. Run auto-reconciliation to populate the heat
        map.
      </div>
    );
  }
  const max = Math.max(1, ...cells.map((c) => c.count));
  const get = (p, b) =>
    cells.find((c) => c.party === p && c.band === b)?.count || 0;
  return (
    <div style={{ overflow: "auto", height: "80%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `110px repeat(${bands.length}, 1fr)`,
          gap: "4px",
          fontSize: "12px",
        }}
      >
        <div />
        {bands.map((b) => (
          <div
            key={b}
            style={{ textAlign: "center", color: "#64748b", fontWeight: 600 }}
          >
            {b}
          </div>
        ))}
        {parties.map((p) => (
          <React.Fragment key={p}>
            <div
              style={{ display: "flex", alignItems: "center", fontWeight: 600 }}
            >
              {p}
            </div>
            {bands.map((b) => {
              const n = get(p, b);
              const t = n / max;
              return (
                <div
                  key={p + b}
                  title={`${p} / ${b}: ${n} record(s)`}
                  style={{
                    background:
                      n === 0
                        ? "#f1f5f9"
                        : `rgba(37, 99, 235, ${0.15 + 0.85 * t})`,
                    color: t > 0.55 ? "#fff" : "#1e293b",
                    borderRadius: "6px",
                    height: "44px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                  }}
                >
                  {n}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [tolerance, setTolerance] = useState(5.0);

  const fetchData = async () => {
    setLoading(true);
    const getJson = async (url, fallback) => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url} -> ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error(err);
        return fallback;
      }
    };
    const [sum, unm, ana] = await Promise.all([
      getJson("http://localhost:5000/api/dashboard/summary", null),
      getJson("http://localhost:5000/api/reconcile/unmatched", []),
      getJson("http://localhost:5000/api/analytics/pipeline", null),
    ]);
    setSummary(sum);
    setUnmatched(Array.isArray(unm) ? unm : []);
    setAnalytics(ana);
    setLoading(false);
  };

  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const r = await fetch(`http://localhost:5000/api/upload/${type}`, {
        method: "POST",
        body: formData,
      });
      const out = await r.json();
      if (!r.ok || out.status === "error")
        throw new Error(out.error || "Upload failed");
      if (out.skipped_duplicates) {
        alert(
          `Uploaded ${out.inserted} rows (${out.skipped_duplicates} duplicates skipped).`,
        );
      }
    } catch (err) {
      alert(`Upload error: ${err.message}`);
    }
    e.target.value = "";
    fetchData();
  };

  const runAutoReconcile = async () => {
    setReconciling(true);
    try {
      const response = await fetch("http://localhost:5000/api/reconcile/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tolerance: parseFloat(tolerance) || 0,
          user_id: 1,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to complete reconciliation");
      }

      const result = await response.json();
      console.log("Reconciliation success:", result);

      // Refresh UI data after server transaction commits
      await fetchData();
    } catch (err) {
      console.error("Auto-reconciliation error:", err);
      alert(`Error running reconciliation: ${err.message}`);
    } finally {
      setReconciling(false);
    }
  };
  const handleDownloadCleaned = () => {
    window.open("http://localhost:5000/api/dataset/download-cleaned", "_blank");
  };

  const handleReset = async () => {
    if (window.confirm("Clear all database entries and start clean?")) {
      await fetch("http://localhost:5000/api/db/reset", { method: "POST" });
      fetchData();
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        padding: "24px",
        backgroundColor: "#f4f6f9",
        minHeight: "100vh",
        color: "#1e293b",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          background: "#fff",
          padding: "20px",
          borderRadius: "12px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: "700",
              color: "#1e293b",
            }}
          >
            Reconciliation Management & DataViz Dashboard
          </h2>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={handleDownloadCleaned}
            style={{
              background: "#059669",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: "600",
            }}
          >
            <Download size={16} /> Download Cleaned CSV
          </button>
          <button
            onClick={handleReset}
            style={{
              background: "#ef4444",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: "600",
            }}
          >
            <Trash2 size={16} /> Reset DB
          </button>
          <button
            onClick={fetchData}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: "600",
            }}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </header>

      {/* Step 1: Bulk Ingestion Controls */}
      <div
        style={{
          background: "#fff",
          padding: "20px",
          borderRadius: "12px",
          marginBottom: "24px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", fontSize: "16px" }}>
          1. Data Ingestion (Upload Raw Feeds)
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
          }}
        >
          <div
            style={{
              padding: "16px",
              border: "2px dashed #cbd5e1",
              borderRadius: "8px",
              background: "#f8fafc",
            }}
          >
            <label
              style={{
                display: "block",
                fontWeight: "600",
                marginBottom: "8px",
              }}
            >
              Upload Invoices CSV:
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileUpload(e, "invoices")}
            />
          </div>
          <div
            style={{
              padding: "16px",
              border: "2px dashed #cbd5e1",
              borderRadius: "8px",
              background: "#f8fafc",
            }}
          >
            <label
              style={{
                display: "block",
                fontWeight: "600",
                marginBottom: "8px",
              }}
            >
              Upload Bank Statements CSV:
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileUpload(e, "statements")}
            />
          </div>
        </div>
      </div>

      {/* Step 2: Interactive Auto-Reconciliation Control Panel */}
      <div
        style={{
          background: "#fff",
          padding: "20px",
          borderRadius: "12px",
          marginBottom: "24px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "16px" }}>
            2. Reconciliation Logic Engine
          </h3>
          <p
            style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}
          >
            Set tolerance limit to match bank statement transactions against
            open invoices.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div>
            <label
              style={{
                fontSize: "13px",
                fontWeight: "600",
                marginRight: "8px",
              }}
            >
              Variance Tolerance ($):
            </label>
            <input
              type="number"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              style={{
                width: "80px",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
              }}
            />
          </div>
          <button
            onClick={runAutoReconcile}
            disabled={reconciling}
            style={{
              background: reconciling ? "#94a3b8" : "#10b981",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: "8px",
              cursor: reconciling ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            {reconciling ? (
              <RefreshCw className="animate-spin" size={18} />
            ) : (
              <Play size={18} />
            )}
            {reconciling ? "Reconciling Data..." : "Run Auto-Reconciliation"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            background: "#fff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              color: "#64748b",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <DollarSign size={16} /> Total Processed
          </div>
          <h3 style={{ fontSize: "22px", margin: "8px 0 0 0" }}>
            $
            {summary?.total_processed
              ? Number(summary.total_processed).toLocaleString()
              : "0"}
          </h3>
        </div>
        <div
          style={{
            background: "#fff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              color: "#64748b",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Activity size={16} /> Total Variance
          </div>
          <h3
            style={{
              fontSize: "22px",
              margin: "8px 0 0 0",
              color: summary?.total_variance > 0 ? "#ef4444" : "#1e293b",
            }}
          >
            $
            {summary?.total_variance
              ? Number(summary.total_variance).toFixed(2)
              : "0.00"}
          </h3>
        </div>
      </div>

      {/* Data Visualizations */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "24px",
          marginBottom: "32px",
        }}
      >
        <div
          style={{
            background: "#fff",
            padding: "20px",
            borderRadius: "12px",
            height: "340px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            <BarChart2 size={18} color="#2563eb" />
            <h3 style={{ margin: 0, fontSize: "15px" }}>
              Financial Breakdown by Party (Pandas ETL)
            </h3>
          </div>
          <ResponsiveContainer width="100%" height="80%">
            <BarChart data={analytics?.party_analysis || []}>
              <XAxis dataKey="party_name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="total_invoiced"
                name="Invoiced ($)"
                fill="#3b82f6"
              />
              <Bar dataKey="total_paid" name="Paid ($)" fill="#10b981" />
              <Bar
                dataKey="total_variance"
                name="Variance ($)"
                fill="#ef4444"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div
          style={{
            background: "#fff",
            padding: "20px",
            borderRadius: "12px",
            height: "340px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            <PieIcon size={18} color="#10b981" />
            <h3 style={{ margin: 0, fontSize: "15px" }}>
              Reconciliation Match Status Breakdown
            </h3>
          </div>
          <ResponsiveContainer width="100%" height="80%">
            <PieChart>
              <Pie
                data={analytics?.match_distribution || []}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="value"
                label
              >
                {(analytics?.match_distribution || []).map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      STATUS_COLORS[entry.name] ||
                      FALLBACK[index % FALLBACK.length]
                    }
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Data Visualizations - row 2 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "24px",
          marginBottom: "32px",
        }}
      >
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            <TrendingUp size={18} color="#8b5cf6" />
            <h3 style={{ margin: 0, fontSize: "15px" }}>
              Bank Deposits Over Time (Matched vs Unmatched)
            </h3>
          </div>
          <ResponsiveContainer width="100%" height="80%">
            <LineChart data={analytics?.timeline || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="total_deposits"
                name="Total ($)"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="matched_amount"
                name="Matched ($)"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="unmatched_amount"
                name="Unmatched ($)"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            <Grid3x3 size={18} color="#2563eb" />
            <h3 style={{ margin: 0, fontSize: "15px" }}>
              Variance Heat Map (Party vs Variance Band)
            </h3>
          </div>
          <HeatMap data={analytics?.heatmap} />
        </div>
      </div>

      {/* Data Visualizations (Power BI) */}
      <div
        style={{
          background: "#fff",
          padding: "20px",
          borderRadius: "12px",
          marginBottom: "32px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <BarChart2 size={18} color="#f2c811" />
          <h3 style={{ margin: 0, fontSize: "15px" }}>Power BI Dashboard</h3>
        </div>
        {POWERBI_URL ? (
          <iframe title="Power BI Report" src={POWERBI_URL} width="100%" height="620" style={{ border: "none" }} allowFullScreen />
        ) : (
          <p style={{ color: "#64748b", fontSize: "14px" }}>
            Download the workbook, upload it to Power BI (replace the old file), then refresh your report.
          </p>
        )}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "12px", justifyContent: "center" }}>
          <a href="http://localhost:5000/api/powerbi/download" style={{ fontSize: "13px", fontWeight: 600, color: "#2563eb" }}>
            Download Power BI workbook (.xlsx)
          </a>
        </div>
      </div>

      {/* Unmatched Exceptions Table */}
      <div
        style={{
          background: "#fff",
          padding: "20px",
          borderRadius: "12px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "16px" }}>
              3. Unmatched Transactions & Exceptions (Requires Action)
            </h3>
            <p
              style={{
                margin: "4px 0 0 0",
                color: "#64748b",
                fontSize: "13px",
              }}
            >
              Bank statement entries that failed tolerance check or have missing
              invoice matches.
            </p>
          </div>
          <span
            style={{
              background: "#fef3c7",
              color: "#b45309",
              padding: "4px 12px",
              borderRadius: "12px",
              fontWeight: "600",
              fontSize: "12px",
            }}
          >
            {unmatched.length} Unmatched Items
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                textAlign: "left",
                borderBottom: "2px solid #e2e8f0",
                color: "#64748b",
                fontSize: "13px",
              }}
            >
              <th style={{ padding: "10px" }}>Statement ID</th>
              <th style={{ padding: "10px" }}>Txn Date</th>
              <th style={{ padding: "10px" }}>Reference No</th>
              <th style={{ padding: "10px" }}>Bank Deposit Amount</th>
              <th style={{ padding: "10px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {unmatched.length === 0 ? (
              <tr>
                <td
                  colSpan="5"
                  style={{
                    padding: "16px",
                    textAlign: "center",
                    color: "#64748b",
                  }}
                >
                  No pending unmatched statements found. Run auto-reconciliation
                  or upload a new CSV feed.
                </td>
              </tr>
            ) : (
              unmatched.map((stmt, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    fontSize: "14px",
                  }}
                >
                  <td style={{ padding: "10px", fontWeight: "600" }}>
                    #{stmt.statement_id}
                  </td>
                  <td style={{ padding: "10px" }}>{stmt.txn_date}</td>
                  <td style={{ padding: "10px", color: "#64748b" }}>
                    {stmt.reference_no}
                  </td>
                  <td
                    style={{
                      padding: "10px",
                      fontWeight: "600",
                      color: "#ef4444",
                    }}
                  >
                    ${stmt.amount}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <span
                      style={{
                        background: "#fee2e2",
                        color: "#991b1b",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: "600",
                      }}
                    >
                      {stmt.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
