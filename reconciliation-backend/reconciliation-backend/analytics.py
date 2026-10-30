import sqlite3
import pandas as pd
import numpy as np
import json

DB_PATH = '/home/pratik/Desktop/dbms/miniproject/miniproject'
OUTPUT_CSV_PATH = '/home/pratik/Desktop/dbms/miniproject/reconciliation-backend/reconciliation-backend/cleaned_reconciliation_dataset.csv'

# Variance bands used by the heat map (upper bound inclusive)
BAND_BINS = [-np.inf, 0, 1, 5, 10, np.inf]
BAND_LABELS = ['Exact ($0)', '$0-1', '$1-5', '$5-10', '> $10']


def safe_merge(left, right, **kwargs):
    """Merge while dropping right-side columns that would collide (no _x/_y)."""
    on = kwargs.get('on', [])
    keys = set([on] if isinstance(on, str) else on)
    dup = [c for c in right.columns if c in left.columns and c not in keys]
    return left.merge(right.drop(columns=dup), **kwargs)


def run_data_pipeline():
    conn = sqlite3.connect(DB_PATH)

    # 1. Extraction
    df_reconcile = pd.read_sql_query("SELECT * FROM RECONCILIATION", conn)
    df_invoice = pd.read_sql_query("SELECT * FROM INVOICE", conn)
    df_bank = pd.read_sql_query("SELECT * FROM BANK_STATEMENT", conn)
    df_party = pd.read_sql_query("SELECT * FROM PARTY", conn)
    conn.close()

    # 2. Cleaning / master dataset
    df_master = pd.DataFrame()
    if not df_reconcile.empty:
        df_reconcile['variance_amt'] = df_reconcile['variance_amt'].fillna(0.0)
        df_master = safe_merge(df_reconcile, df_invoice, on=['invoice_no', 'party_id'], how='left')
        df_master = safe_merge(df_master, df_bank, on='statement_id', how='left')
        df_master = safe_merge(df_master, df_party, on='party_id', how='left')

        df_master.columns = [c.upper() for c in df_master.columns]
        df_master['VARIANCE_PCT'] = np.where(
            df_master['INVOICE_AMOUNT'] > 0,
            (df_master['VARIANCE_AMT'] / df_master['INVOICE_AMOUNT']) * 100,
            0.0,
        ).round(2)
        df_master.to_csv(OUTPUT_CSV_PATH, index=False)

    # 3a. Pie: match status. UNMATCHED = statements with no reconciliation row
    matched_ids = set(df_reconcile['statement_id'].dropna()) if not df_reconcile.empty else set()
    match_list = []
    if not df_reconcile.empty:
        for k, v in df_reconcile['match_status'].value_counts().to_dict().items():
            match_list.append({'name': k, 'value': int(v)})
    unmatched_count = int((~df_bank['statement_id'].isin(matched_ids)).sum()) if not df_bank.empty else 0
    if unmatched_count > 0 or len(match_list) == 0:
        match_list.append({'name': 'UNMATCHED', 'value': unmatched_count})

    # 3b. Bar: financials by party
    if not df_master.empty:
        pv = df_master.assign(PARTY_NAME=df_master['PARTY_NAME'].fillna('Unknown')) \
            .groupby('PARTY_NAME').agg(
                total_invoiced=('INVOICE_AMOUNT', 'sum'),
                total_paid=('AMOUNT', 'sum'),
                total_variance=('VARIANCE_AMT', 'sum'),
            ).reset_index()
        pv.columns = ['party_name', 'total_invoiced', 'total_paid', 'total_variance']
        pv[['total_invoiced', 'total_paid', 'total_variance']] = pv[['total_invoiced', 'total_paid', 'total_variance']].round(2)
        party_viz = pv.to_dict(orient='records')
    else:
        party_viz = []

    # 3c. Line chart: bank deposits over time, split matched / unmatched
    timeline = []
    if not df_bank.empty and 'txn_date' in df_bank.columns:
        tb = df_bank.copy()
        tb['date'] = pd.to_datetime(tb['txn_date'], errors='coerce')
        tb = tb.dropna(subset=['date'])
        tb['date'] = tb['date'].dt.strftime('%Y-%m-%d')
        tb['is_matched'] = tb['statement_id'].isin(matched_ids)
        tb['matched_amt'] = np.where(tb['is_matched'], tb['amount'], 0.0)
        tb['unmatched_amt'] = np.where(tb['is_matched'], 0.0, tb['amount'])
        tl = tb.groupby('date').agg(
            total_deposits=('amount', 'sum'),
            matched_amount=('matched_amt', 'sum'),
            unmatched_amount=('unmatched_amt', 'sum'),
        ).reset_index().sort_values('date').round(2)
        timeline = tl.to_dict(orient='records')

    # 3d. Heat map: party x variance band (count of matched records)
    heatmap = {'bands': BAND_LABELS, 'parties': [], 'cells': []}
    if not df_master.empty:
        hm = df_master.assign(PARTY_NAME=df_master['PARTY_NAME'].fillna('Unknown')).copy()
        hm['band'] = pd.cut(hm['VARIANCE_AMT'].astype(float), bins=BAND_BINS, labels=BAND_LABELS)
        counts = hm.groupby(['PARTY_NAME', 'band'], observed=False).size().to_dict()
        parties = sorted(hm['PARTY_NAME'].unique().tolist())
        heatmap['parties'] = parties
        heatmap['cells'] = [
            {'party': p, 'band': b, 'count': int(counts.get((p, b), 0))}
            for p in parties for b in BAND_LABELS
        ]

    return {
        'match_distribution': match_list,
        'party_analysis': party_viz,
        'timeline': timeline,
        'heatmap': heatmap,
    }


if __name__ == '__main__':
    print(json.dumps(run_data_pipeline()))
