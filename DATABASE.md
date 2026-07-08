# Database setup (Hostinger)

This project uses **MySQL** via `mysql2`. Credentials are stored in `server/.env` (not committed to git).

## Production (tools.bmtaxopc.com)

When the Node server runs on the same Hostinger account as the database:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=u438764371_tools
DB_USER=u438764371_bmtax
DB_PASSWORD=your_password
PORT=3001
```

On first start, the server automatically creates these tables:

- `users` — login accounts
- `sessions` — auth tokens
- `clients` — client & business data (JSON)
- `fs_data` — financial statement data (JSON)
- `financial_years` — global financial year settings
- `ca_profiles` — chartered accountant profiles
- `ledgers` — global ledger list (name, note group, sign)
- `udin_records` — UDIN per client / FY / business, linked to CA profile
- `depreciation_schedule_rows` — depreciation asset rows per financial statement (includes `ledger_id`, `purchase_date`)
- `depreciation_previous_year` — previous-year depreciation summary per financial statement
- `asset_depreciation_history` — year-wise depreciation per asset/ledger across financial years (synced on FS save)
- `bank_account_rows` — bank account rows per client / FY / business
- `bank_account_history` — year-wise bank account balances (synced on FS save)
- `gst_reco_records` — GST reconciliation header (sales, outward tax, simple reco) per FY
- `gst_reco_input_tax_rows` — GST input tax schedule rows per FY
- `gst_reco_history` — year-wise GST reco snapshots (synced on FS save)
- `loan_records` — loan input rows per client / FY / business (lender, type, balances, rate, tenure, dates)
- `loan_history` — year-wise loan snapshots with computed EMI, interest, principal, closing balance
- `loan_schedule_rows` — normalized monthly EMI schedule rows (per loan per FY)
- `loan_fy_summary` — FY-level totals and consolidated cash-flow across all loans (synced on FS save)
- `note_sub_amount_rows` — note sub-line amounts (current / previous) per note key and sub-line id
- `note_line_rows` — dynamic note lines (admin expenses, capital account, manual notes, ST borrowings, P&L appropriation)
- `note_total_rows` — 24 note header totals per financial statement
- `note_cash_adjustment` — cash flow adjustment amounts per financial statement
- `note_history` — year-wise notes snapshots (synced on FS save)
- `bs_statement_rows` — balance sheet line items per financial statement (synced on FS save)
- `pl_statement_rows` — profit & loss line items per financial statement (synced on FS save)
- `statement_fy_summary` — year-wise BS/PL totals (sources, application, net profit, cash adjustment, etc.)
- `statement_history` — year-wise BS/PL snapshots (synced on FS save)
- `app_settings` — misc JSON settings (selected CA, legacy keys)

Default login: `admin` / `admin123`

## Local development

`localhost` only works if MySQL is on your machine. To use the Hostinger database from your PC:

1. In **Hostinger hPanel → Databases → Remote MySQL**, allow your IP address.
2. Copy the **MySQL hostname** from hPanel (often `srvXXXX.hstgr.io`, not `localhost`).
3. Set that hostname in `server/.env` as `DB_HOST`.

## Run server

```bash
cd server
npm install
npm run dev
```

Check connection: `GET /api/health` should return `"database": "connected"`.
