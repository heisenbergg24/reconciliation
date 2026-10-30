import sys
import json
import sqlite3
import pandas as pd

DB_PATH = '/home/pratik/Desktop/dbms/miniproject/miniproject'


def clean_currency(val):
    if pd.isna(val) or val is None:
        return 0.0
    val_str = str(val).replace('$', '').replace(',', '').strip()
    try:
        return float(val_str)
    except ValueError:
        return 0.0


def table_columns(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def insert_ignore(conn, table, df):
    """
    Insert rows one-by-one semantics with INSERT OR IGNORE: any row that would
    violate a UNIQUE / PRIMARY KEY constraint (e.g. an invoice that already
    exists) is silently skipped by SQLite instead of crashing the whole upload.
    Returns (inserted, skipped).
    """
    cols = [c for c in df.columns if c in table_columns(conn, table)]
    if not cols:
        raise ValueError(f"CSV has no columns matching table {table}")
    data = df[cols].astype(object).where(df[cols].notna(), None)
    sql = f"INSERT OR IGNORE INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    before = conn.total_changes
    conn.executemany(sql, data.values.tolist())
    inserted = conn.total_changes - before
    return inserted, len(df) - inserted


def process_csv(file_path, data_type):
    conn = sqlite3.connect(DB_PATH)
    try:
        df = pd.read_csv(file_path)
        df.columns = [c.strip().lower() for c in df.columns]

        if data_type == 'statements':
            df['amount'] = df['amount'].apply(clean_currency)
            # Always start as PENDING, whatever the CSV says ("Pending", blank, "CLEARED"...)
            df['status'] = 'PENDING'

            csv_rows = len(df)
            # Skip rows already loaded (same reference_no) so re-uploads don't duplicate
            if 'reference_no' in df.columns:
                df['reference_no'] = df['reference_no'].astype(str).str.strip()
                df = df.drop_duplicates(subset=['reference_no'])
                existing = set(
                    pd.read_sql_query("SELECT reference_no FROM BANK_STATEMENT", conn)['reference_no'].astype(str)
                )
                df = df[~df['reference_no'].isin(existing)]
            inserted, skipped = insert_ignore(conn, 'BANK_STATEMENT', df)
            skipped += csv_rows - len(df)

        elif data_type == 'invoices':
            df['invoice_no'] = df['invoice_no'].astype(str).str.strip().str.upper()
            df['invoice_amount'] = df['invoice_amount'].apply(clean_currency)
            df['due_date'] = pd.to_datetime(df['due_date'], errors='coerce').dt.strftime('%Y-%m-%d')
            df['due_date'] = df['due_date'].fillna('2026-11-30')
            if 'party_id' in df.columns:
                # "1", "1.0", 1 -> 1  (so it compares equal to what is stored in the DB)
                df['party_id'] = pd.to_numeric(df['party_id'], errors='coerce').astype('Int64')
                df = df.dropna(subset=['party_id'])
                df = df.drop_duplicates(subset=['party_id', 'invoice_no'])
            # (party_id, invoice_no) already in DB -> ignored by SQLite, not a crash
            inserted, skipped = insert_ignore(conn, 'INVOICE', df)

        else:
            return {"status": "error", "error": f"Unknown data type: {data_type}"}

        conn.commit()
        return {"status": "success", "inserted": inserted, "skipped_duplicates": skipped}
    finally:
        conn.close()


if __name__ == '__main__':
    try:
        print(json.dumps(process_csv(sys.argv[1], sys.argv[2])))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)
