import { query, testConnection } from './connection.js'
import { migrateLegacyUsers } from '../data/userStore.js'
import { hashPassword, generateUserToken } from '../data/userStore.js'

function parseJson(value) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'object') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export async function initDatabase() {
  await testConnection()

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(50) PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      mobile VARCHAR(20) NOT NULL DEFAULT '',
      password_hash VARCHAR(255) NOT NULL,
      user_token VARCHAR(128) NULL UNIQUE,
      name VARCHAR(255) NOT NULL DEFAULT '',
      user_type VARCHAR(20) NOT NULL DEFAULT 'staff',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await migrateUsersTable()

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_user (user_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      mobile VARCHAR(20) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      pin VARCHAR(20) NOT NULL DEFAULT '',
      pan VARCHAR(10) NULL UNIQUE,
      businesses JSON NOT NULL,
      fy_closed_overrides JSON NOT NULL,
      fy_statement_type_overrides JSON NOT NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await migrateClientsTable()

  await query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      type VARCHAR(100) NOT NULL DEFAULT '',
      pan VARCHAR(10) NOT NULL,
      address TEXT NOT NULL,
      starting_fy VARCHAR(20) NOT NULL DEFAULT '',
      starting_year INT NOT NULL,
      gst_number VARCHAR(20) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      deleted_by_user_id VARCHAR(50) NULL,
      deleted_by_username VARCHAR(100) NULL,
      deleted_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      INDEX idx_businesses_client (client_id),
      INDEX idx_businesses_status (status)
    )
  `)

  const { migrateBusinessesFromClientJson } = await import('../data/businessStore.js')
  await migrateBusinessesTable()
  await migrateBusinessesFromClientJson()

  await query(`
    CREATE TABLE IF NOT EXISTS fs_data (
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      payload JSON NOT NULL,
      PRIMARY KEY (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      payload JSON NOT NULL
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS financial_years (
      id VARCHAR(50) PRIMARY KEY,
      label VARCHAR(20) NOT NULL DEFAULT '',
      start_year INT NOT NULL,
      end_year INT NOT NULL,
      statement_type VARCHAR(50) NOT NULL DEFAULT 'Actual',
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      deleted_by_user_id VARCHAR(50) NULL,
      deleted_by_username VARCHAR(100) NULL,
      deleted_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      INDEX idx_financial_years_deleted (is_deleted),
      INDEX idx_financial_years_start_year (start_year)
    )
  `)

  await migrateFinancialYearsTable()

  const { migrateFinancialYearsFromSettings } = await import('../data/fySettingsStore.js')
  await migrateFinancialYearsFromSettings()

  await query(`
    CREATE TABLE IF NOT EXISTS ca_profiles (
      id VARCHAR(50) PRIMARY KEY,
      firm_name VARCHAR(255) NOT NULL DEFAULT '',
      partner_name VARCHAR(255) NOT NULL DEFAULT '',
      firm_type VARCHAR(100) NOT NULL DEFAULT '',
      frn_number VARCHAR(100) NOT NULL DEFAULT '',
      membership_number VARCHAR(100) NOT NULL DEFAULT '',
      udin VARCHAR(100) NOT NULL DEFAULT '',
      seal_signature_name VARCHAR(255) NOT NULL DEFAULT '',
      seal_signature_data_url LONGTEXT NULL,
      address TEXT NOT NULL,
      city VARCHAR(100) NOT NULL DEFAULT '',
      pin VARCHAR(20) NOT NULL DEFAULT '',
      place VARCHAR(100) NOT NULL DEFAULT '',
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      deleted_by_user_id VARCHAR(50) NULL,
      deleted_by_username VARCHAR(100) NULL,
      deleted_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      INDEX idx_ca_profiles_deleted (is_deleted)
    )
  `)

  await migrateCaProfilesTable()

  const { migrateCaProfilesFromSettings } = await import('../data/caSettingsStore.js')
  await migrateCaProfilesFromSettings()

  await query(`
    CREATE TABLE IF NOT EXISTS ledgers (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      note_group VARCHAR(100) NOT NULL DEFAULT 'otherAdministrativeExpenses',
      sign VARCHAR(10) NOT NULL DEFAULT 'add',
      sort_order INT NOT NULL DEFAULT 0,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL,
      deleted_by_user_id VARCHAR(50) NULL,
      deleted_by_username VARCHAR(100) NULL,
      deleted_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      INDEX idx_ledgers_deleted (is_deleted),
      INDEX idx_ledgers_group (note_group)
    )
  `)

  await migrateLedgersTable()

  const { migrateLedgersFromSettings } = await import('../data/ledgerStore.js')
  await migrateLedgersFromSettings()

  await query(`
    CREATE TABLE IF NOT EXISTS udin_records (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      ca_profile_id VARCHAR(50) NOT NULL DEFAULT '',
      ca_partner_name VARCHAR(255) NOT NULL DEFAULT '',
      ca_firm_name VARCHAR(255) NOT NULL DEFAULT '',
      udin_number VARCHAR(100) NOT NULL DEFAULT '',
      issue_date DATE NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_udin_fs (client_id, fy_id, business_id),
      INDEX idx_udin_ca (ca_profile_id),
      INDEX idx_udin_client_fy (client_id, fy_id)
    )
  `)

  await migrateUdinRecordsTable()

  const { migrateUdinFromFsData } = await import('../data/udinStore.js')
  await migrateUdinFromFsData()

  await query(`
    CREATE TABLE IF NOT EXISTS depreciation_schedule_rows (
      id VARCHAR(50) NOT NULL,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      ledger_id VARCHAR(50) NULL,
      asset_name VARCHAR(255) NOT NULL DEFAULT '',
      purchase_date DATE NULL,
      rate DECIMAL(8, 2) NOT NULL DEFAULT 0,
      opening_wdv DECIMAL(18, 2) NOT NULL DEFAULT 0,
      addition_before_oct3 DECIMAL(18, 2) NOT NULL DEFAULT 0,
      addition_on_after_oct3 DECIMAL(18, 2) NOT NULL DEFAULT 0,
      asset_deletion DECIMAL(18, 2) NOT NULL DEFAULT 0,
      depreciation DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_wdv DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (client_id, fy_id, business_id, id),
      INDEX idx_dep_schedule_fs (client_id, fy_id, business_id),
      INDEX idx_dep_schedule_ledger (ledger_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS depreciation_previous_year (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      opening_wdv DECIMAL(18, 2) NOT NULL DEFAULT 0,
      addition_before_oct3 DECIMAL(18, 2) NOT NULL DEFAULT 0,
      addition_on_after_oct3 DECIMAL(18, 2) NOT NULL DEFAULT 0,
      asset_deletion DECIMAL(18, 2) NOT NULL DEFAULT 0,
      depreciation DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_wdv DECIMAL(18, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_dep_prev_fs (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS asset_depreciation_history (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      ledger_id VARCHAR(50) NULL,
      asset_name VARCHAR(255) NOT NULL DEFAULT '',
      purchase_date DATE NULL,
      rate DECIMAL(8, 2) NOT NULL DEFAULT 0,
      opening_wdv DECIMAL(18, 2) NOT NULL DEFAULT 0,
      addition_before_oct3 DECIMAL(18, 2) NOT NULL DEFAULT 0,
      addition_on_after_oct3 DECIMAL(18, 2) NOT NULL DEFAULT 0,
      asset_deletion DECIMAL(18, 2) NOT NULL DEFAULT 0,
      depreciation_charged DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_wdv DECIMAL(18, 2) NOT NULL DEFAULT 0,
      schedule_row_id VARCHAR(50) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_asset_dep_history (client_id, business_id, fy_id, ledger_id),
      INDEX idx_asset_dep_history_lookup (client_id, business_id, ledger_id),
      INDEX idx_asset_dep_history_year (client_id, business_id, fy_start_year)
    )
  `)

  await migrateDepreciationTables()

  const { migrateDepreciationFromFsData } = await import('../data/depreciationStore.js')
  await migrateDepreciationFromFsData()

  await query(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id VARCHAR(50) NOT NULL,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      bank_name VARCHAR(255) NOT NULL DEFAULT '',
      account_number VARCHAR(100) NOT NULL DEFAULT '',
      account_type VARCHAR(20) NOT NULL DEFAULT 'current',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      closed_in_fy_id VARCHAR(50) NULL,
      started_in_fy_id VARCHAR(50) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (client_id, business_id, id),
      INDEX idx_bank_accounts_business (client_id, business_id),
      INDEX idx_bank_accounts_lookup (client_id, business_id, account_number)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS bank_account_fy_figures (
      bank_account_id VARCHAR(50) NOT NULL,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      opening_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      debit DECIMAL(18, 2) NOT NULL DEFAULT 0,
      credit DECIMAL(18, 2) NOT NULL DEFAULT 0,
      bank_charge DECIMAL(18, 2) NOT NULL DEFAULT 0,
      interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (client_id, business_id, fy_id, bank_account_id),
      INDEX idx_bank_fy_figures_account (client_id, business_id, bank_account_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS bank_account_rows (
      id VARCHAR(50) NOT NULL,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      bank_name VARCHAR(255) NOT NULL DEFAULT '',
      account_number VARCHAR(100) NOT NULL DEFAULT '',
      account_type VARCHAR(20) NOT NULL DEFAULT 'current',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      closed_in_fy_id VARCHAR(50) NULL,
      started_in_fy_id VARCHAR(50) NULL,
      opening_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      debit DECIMAL(18, 2) NOT NULL DEFAULT 0,
      credit DECIMAL(18, 2) NOT NULL DEFAULT 0,
      bank_charge DECIMAL(18, 2) NOT NULL DEFAULT 0,
      interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (client_id, fy_id, business_id, id),
      INDEX idx_bank_accounts_fs (client_id, fy_id, business_id),
      INDEX idx_bank_accounts_lookup (client_id, business_id, account_number)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS bank_account_history (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      bank_account_id VARCHAR(50) NOT NULL,
      bank_name VARCHAR(255) NOT NULL DEFAULT '',
      account_number VARCHAR(100) NOT NULL DEFAULT '',
      account_type VARCHAR(20) NOT NULL DEFAULT 'current',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      closed_in_fy_id VARCHAR(50) NULL,
      started_in_fy_id VARCHAR(50) NULL,
      opening_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      debit DECIMAL(18, 2) NOT NULL DEFAULT 0,
      credit DECIMAL(18, 2) NOT NULL DEFAULT 0,
      bank_charge DECIMAL(18, 2) NOT NULL DEFAULT 0,
      interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_bank_account_history (client_id, business_id, fy_id, bank_account_id),
      INDEX idx_bank_account_history_year (client_id, business_id, fy_start_year),
      INDEX idx_bank_account_history_account (client_id, business_id, bank_account_id)
    )
  `)

  await migrateBankAccountTables()

  const { migrateBankAccountsFromFsData } = await import('../data/bankAccountStore.js')
  await migrateBankAccountsFromFsData()

  await createGstRecoTables()
  await migrateGstRecoTables()

  const { migrateGstRecoFromFsData } = await import('../data/gstRecoStore.js')
  await migrateGstRecoFromFsData()

  await query(`
    CREATE TABLE IF NOT EXISTS loan_records (
      id VARCHAR(50) NOT NULL,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      lender VARCHAR(255) NOT NULL DEFAULT '',
      loan_type VARCHAR(20) NOT NULL DEFAULT 'long-term',
      opening_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      disbursement DECIMAL(18, 2) NOT NULL DEFAULT 0,
      disbursement_date DATE NULL,
      interest_rate DECIMAL(8, 4) NOT NULL DEFAULT 0,
      tenure_months INT NOT NULL DEFAULT 0,
      emi_start_date DATE NULL,
      prepayment_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      prepayment_date DATE NULL,
      is_closed TINYINT(1) NOT NULL DEFAULT 0,
      closing_adj_enabled TINYINT(1) NOT NULL DEFAULT 0,
      closing_adj_mode VARCHAR(32) NOT NULL DEFAULT 'principal-interest',
      closing_adj_principal DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_adj_interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_adj_target_balance DECIMAL(18, 2) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (client_id, fy_id, business_id, id),
      INDEX idx_loan_records_fs (client_id, fy_id, business_id),
      INDEX idx_loan_records_lookup (client_id, business_id, lender)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS loan_history (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      loan_id VARCHAR(50) NOT NULL,
      lender VARCHAR(255) NOT NULL DEFAULT '',
      loan_type VARCHAR(20) NOT NULL DEFAULT 'long-term',
      opening_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      disbursement DECIMAL(18, 2) NOT NULL DEFAULT 0,
      disbursement_date DATE NULL,
      interest_rate DECIMAL(8, 4) NOT NULL DEFAULT 0,
      tenure_months INT NOT NULL DEFAULT 0,
      emi_start_date DATE NULL,
      prepayment_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      prepayment_date DATE NULL,
      emi_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      interest_for_year DECIMAL(18, 2) NOT NULL DEFAULT 0,
      principal_repaid DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      schedule_closing_balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_adj_enabled TINYINT(1) NOT NULL DEFAULT 0,
      closing_adj_mode VARCHAR(32) NOT NULL DEFAULT 'principal-interest',
      closing_adj_principal DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_adj_interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_adj_target_balance DECIMAL(18, 2) NULL,
      closing_adj_principal_applied DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_adj_interest_applied DECIMAL(18, 2) NOT NULL DEFAULT 0,
      monthly_schedule JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_loan_history (client_id, business_id, fy_id, loan_id),
      INDEX idx_loan_history_year (client_id, business_id, fy_start_year),
      INDEX idx_loan_history_loan (client_id, business_id, loan_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS loan_schedule_rows (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      loan_id VARCHAR(50) NOT NULL,
      loan_history_id VARCHAR(50) NOT NULL,
      serial_no INT NOT NULL DEFAULT 0,
      month INT NOT NULL DEFAULT 0,
      month_label VARCHAR(10) NOT NULL DEFAULT '',
      year INT NOT NULL DEFAULT 0,
      emi DECIMAL(18, 2) NOT NULL DEFAULT 0,
      principal DECIMAL(18, 2) NOT NULL DEFAULT 0,
      interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      balance DECIMAL(18, 2) NOT NULL DEFAULT 0,
      is_prepayment TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      INDEX idx_loan_schedule_fs (client_id, fy_id, business_id),
      INDEX idx_loan_schedule_loan (client_id, business_id, fy_id, loan_id),
      INDEX idx_loan_schedule_history (loan_history_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS loan_fy_summary (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      long_term_closing DECIMAL(18, 2) NOT NULL DEFAULT 0,
      short_term_closing DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total_interest DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total_principal_repaid DECIMAL(18, 2) NOT NULL DEFAULT 0,
      consolidated_cash_flow JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_loan_fy_summary (client_id, fy_id, business_id),
      INDEX idx_loan_fy_summary_year (client_id, business_id, fy_start_year)
    )
  `)

  await migrateLoanTables()

  const { migrateLoansFromFsData } = await import('../data/loanStore.js')
  await migrateLoansFromFsData()

  await query(`
    CREATE TABLE IF NOT EXISTS note_sub_amount_rows (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      note_key VARCHAR(60) NOT NULL,
      sub_id VARCHAR(120) NOT NULL,
      current_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      previous_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_note_sub_amount (client_id, fy_id, business_id, note_key, sub_id),
      INDEX idx_note_sub_amount_fs (client_id, fy_id, business_id),
      INDEX idx_note_sub_amount_note (client_id, fy_id, business_id, note_key)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS note_line_rows (
      id VARCHAR(50) NOT NULL,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      line_kind VARCHAR(30) NOT NULL,
      note_key VARCHAR(60) NULL,
      reference_id VARCHAR(100) NOT NULL DEFAULT '',
      line_sign VARCHAR(10) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (client_id, fy_id, business_id, id),
      INDEX idx_note_line_rows_fs (client_id, fy_id, business_id),
      INDEX idx_note_line_rows_kind (client_id, fy_id, business_id, line_kind)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS note_total_rows (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      note_key VARCHAR(60) NOT NULL,
      current_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      previous_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_note_total (client_id, fy_id, business_id, note_key),
      INDEX idx_note_total_fs (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS note_cash_adjustment (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      current_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      previous_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_note_cash_adjustment (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS note_history (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      payload JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_note_history (client_id, business_id, fy_id),
      INDEX idx_note_history_year (client_id, business_id, fy_start_year)
    )
  `)

  await migrateNoteTables()

  const { migrateNotesFromFsData } = await import('../data/notesStore.js')
  await migrateNotesFromFsData()

  await query(`
    CREATE TABLE IF NOT EXISTS bs_statement_rows (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      row_id VARCHAR(120) NULL,
      label VARCHAR(500) NOT NULL DEFAULT '',
      current_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      previous_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      note_no VARCHAR(20) NULL,
      note_key VARCHAR(60) NULL,
      note_sub_id VARCHAR(120) NULL,
      is_header TINYINT(1) NOT NULL DEFAULT 0,
      is_sub_header TINYINT(1) NOT NULL DEFAULT 0,
      is_total TINYINT(1) NOT NULL DEFAULT 0,
      is_grand_total TINYINT(1) NOT NULL DEFAULT 0,
      is_sub_line TINYINT(1) NOT NULL DEFAULT 0,
      indent INT NOT NULL DEFAULT 0,
      blank_amounts TINYINT(1) NOT NULL DEFAULT 0,
      is_spacer TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_bs_statement_row (client_id, fy_id, business_id, sort_order),
      INDEX idx_bs_statement_fs (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS pl_statement_rows (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      row_id VARCHAR(120) NULL,
      label VARCHAR(500) NOT NULL DEFAULT '',
      current_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      previous_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      note_no VARCHAR(20) NULL,
      note_key VARCHAR(60) NULL,
      note_sub_id VARCHAR(120) NULL,
      is_header TINYINT(1) NOT NULL DEFAULT 0,
      is_sub_header TINYINT(1) NOT NULL DEFAULT 0,
      is_total TINYINT(1) NOT NULL DEFAULT 0,
      is_grand_total TINYINT(1) NOT NULL DEFAULT 0,
      is_sub_line TINYINT(1) NOT NULL DEFAULT 0,
      indent INT NOT NULL DEFAULT 0,
      blank_amounts TINYINT(1) NOT NULL DEFAULT 0,
      is_spacer TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_pl_statement_row (client_id, fy_id, business_id, sort_order),
      INDEX idx_pl_statement_fs (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS statement_fy_summary (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      sources_total_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sources_total_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      application_total_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      application_total_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      net_profit_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      net_profit_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      gross_profit_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      gross_profit_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total_income_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total_income_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total_expenses_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      total_expenses_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      cash_adjustment_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      cash_adjustment_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sources_application_diff_current DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sources_application_diff_previous DECIMAL(18, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_statement_fy_summary (client_id, fy_id, business_id),
      INDEX idx_statement_fy_summary_year (client_id, business_id, fy_start_year)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS statement_history (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      payload JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_statement_history (client_id, business_id, fy_id),
      INDEX idx_statement_history_year (client_id, business_id, fy_start_year)
    )
  `)

  await migrateStatementTables()

  await seedDefaults()
  await migrateLegacyUsers()
}

async function migrateUsersTable() {
  let columns = await query('SHOW COLUMNS FROM users')
  let columnNames = new Set(columns.map((col) => col.Field))

  if (columnNames.has('password') && !columnNames.has('password_hash')) {
    await query('ALTER TABLE users CHANGE password password_hash VARCHAR(255) NOT NULL')
    columns = await query('SHOW COLUMNS FROM users')
    columnNames = new Set(columns.map((col) => col.Field))
  }

  if (!columnNames.has('mobile')) {
    await query('ALTER TABLE users ADD COLUMN mobile VARCHAR(20) NOT NULL DEFAULT "" AFTER username')
    columnNames.add('mobile')
  }

  if (!columnNames.has('user_token')) {
    await query('ALTER TABLE users ADD COLUMN user_token VARCHAR(128) NULL UNIQUE AFTER password_hash')
    columnNames.add('user_token')
  }

  if (!columnNames.has('user_type')) {
    await query(
      "ALTER TABLE users ADD COLUMN user_type VARCHAR(20) NOT NULL DEFAULT 'staff' AFTER name",
    )
    await query("UPDATE users SET user_type = 'admin' WHERE username = 'admin' OR id = '1'")
    columnNames.add('user_type')
  }

  if (!columnNames.has('is_active')) {
    await query('ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1')
    columnNames.add('is_active')
  }

  if (!columnNames.has('created_at')) {
    await query('ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
  }
}

async function migrateClientsTable() {
  let columns = await query('SHOW COLUMNS FROM clients')
  let columnNames = new Set(columns.map((col) => col.Field))

  if (!columnNames.has('name')) {
    await query('ALTER TABLE clients ADD COLUMN name VARCHAR(255) NOT NULL DEFAULT "" AFTER id')
    columnNames.add('name')
  }

  if (!columnNames.has('mobile')) {
    await query('ALTER TABLE clients ADD COLUMN mobile VARCHAR(20) NOT NULL DEFAULT "" AFTER name')
    columnNames.add('mobile')
  }

  if (!columnNames.has('email')) {
    await query('ALTER TABLE clients ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT "" AFTER mobile')
    columnNames.add('email')
  }

  if (!columnNames.has('address')) {
    await query('ALTER TABLE clients ADD COLUMN address TEXT NOT NULL AFTER email')
    columnNames.add('address')
  }

  if (!columnNames.has('pin')) {
    await query('ALTER TABLE clients ADD COLUMN pin VARCHAR(20) NOT NULL DEFAULT "" AFTER address')
    columnNames.add('pin')
  }

  if (!columnNames.has('pan')) {
    await query('ALTER TABLE clients ADD COLUMN pan VARCHAR(10) NULL UNIQUE AFTER pin')
    columnNames.add('pan')
  }

  if (!columnNames.has('businesses')) {
    await query(
      "ALTER TABLE clients ADD COLUMN businesses JSON NOT NULL AFTER pin",
    )
    columnNames.add('businesses')
  }

  if (!columnNames.has('fy_closed_overrides')) {
    await query(
      "ALTER TABLE clients ADD COLUMN fy_closed_overrides JSON NOT NULL AFTER businesses",
    )
    columnNames.add('fy_closed_overrides')
  }

  if (!columnNames.has('fy_statement_type_overrides')) {
    await query(
      "ALTER TABLE clients ADD COLUMN fy_statement_type_overrides JSON NOT NULL AFTER fy_closed_overrides",
    )
    columnNames.add('fy_statement_type_overrides')
  }

  if (!columnNames.has('created_at')) {
    await query(
      'ALTER TABLE clients ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER fy_statement_type_overrides',
    )
    columnNames.add('created_at')
  }

  if (!columnNames.has('is_deleted')) {
    await query(
      'ALTER TABLE clients ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER fy_statement_type_overrides',
    )
    columnNames.add('is_deleted')
  }

  if (!columnNames.has('deleted_at')) {
    await query(
      'ALTER TABLE clients ADD COLUMN deleted_at TIMESTAMP NULL AFTER is_deleted',
    )
    columnNames.add('deleted_at')
  }

  if (!columnNames.has('status')) {
    await query(
      "ALTER TABLE clients ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER deleted_at",
    )
    columnNames.add('status')
  }

  if (columnNames.has('payload')) {
    const rows = await query('SELECT id, payload FROM clients WHERE payload IS NOT NULL')
    for (const row of rows) {
      const data = parseJson(row.payload)
      if (!data) {
        continue
      }

      await query(
        `UPDATE clients SET
           name = ?,
           mobile = ?,
           email = ?,
           address = ?,
           pin = ?,
           businesses = ?,
           fy_closed_overrides = ?,
           fy_statement_type_overrides = ?,
           created_at = COALESCE(created_at, ?)
         WHERE id = ?`,
        [
          data.name || '',
          data.mobile || '',
          data.email || '',
          data.address || '',
          data.pin || '',
          JSON.stringify(data.businesses || []),
          JSON.stringify(data.fyClosedOverrides || {}),
          JSON.stringify(data.fyStatementTypeOverrides || {}),
          data.createdAt ? new Date(data.createdAt) : new Date(),
          row.id,
        ],
      )
    }

    await query('ALTER TABLE clients DROP COLUMN payload')
  }

  await query(
    `UPDATE clients SET
       businesses = COALESCE(businesses, '[]'),
       fy_closed_overrides = COALESCE(fy_closed_overrides, '{}'),
       fy_statement_type_overrides = COALESCE(fy_statement_type_overrides, '{}'),
       is_deleted = COALESCE(is_deleted, 0),
       status = COALESCE(NULLIF(status, ''), 'active')
     WHERE businesses IS NULL
        OR fy_closed_overrides IS NULL
        OR fy_statement_type_overrides IS NULL
        OR is_deleted IS NULL
        OR status IS NULL
        OR status = ''`,
  )

  await query(
    `UPDATE clients SET pan = 'AAAAA1234A' WHERE id = '1' AND (pan IS NULL OR pan = '')`,
  )
}

async function migrateCaProfilesTable() {
  let columns = await query('SHOW COLUMNS FROM ca_profiles')
  let columnNames = new Set(columns.map((col) => col.Field))

  const auditColumns = [
    ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
    ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
    ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
    ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
    ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
    ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
    ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ['deleted_by_user_id', 'VARCHAR(50) NULL AFTER deleted_at'],
    ['deleted_by_username', 'VARCHAR(100) NULL AFTER deleted_by_user_id'],
    ['deleted_by_name', 'VARCHAR(255) NULL AFTER deleted_by_username'],
  ]

  for (const [name, definition] of auditColumns) {
    if (!columnNames.has(name)) {
      await query(`ALTER TABLE ca_profiles ADD COLUMN ${name} ${definition}`)
      columnNames.add(name)
    }
  }

  if (!columnNames.has('status')) {
    await query(
      "ALTER TABLE ca_profiles ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER place",
    )
    columnNames.add('status')
  }
}

async function migrateFinancialYearsTable() {
  let columns = await query('SHOW COLUMNS FROM financial_years')
  let columnNames = new Set(columns.map((col) => col.Field))

  const auditColumns = [
    ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
    ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
    ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
    ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
    ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
    ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
    ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ['deleted_by_user_id', 'VARCHAR(50) NULL AFTER deleted_at'],
    ['deleted_by_username', 'VARCHAR(100) NULL AFTER deleted_by_user_id'],
    ['deleted_by_name', 'VARCHAR(255) NULL AFTER deleted_by_username'],
  ]

  for (const [name, definition] of auditColumns) {
    if (!columnNames.has(name)) {
      await query(`ALTER TABLE financial_years ADD COLUMN ${name} ${definition}`)
      columnNames.add(name)
    }
  }

  if (!columnNames.has('status')) {
    await query(
      "ALTER TABLE financial_years ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER statement_type",
    )
    columnNames.add('status')
  }
}

async function ensureFyScopedCompositePrimaryKey(tableName) {
  const keyRows = await query(`SHOW KEYS FROM ${tableName} WHERE Key_name = 'PRIMARY'`)
  const primaryColumns = keyRows
    .slice()
    .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
    .map((row) => row.Column_name)

  const expected = ['client_id', 'fy_id', 'business_id', 'id']
  const alreadyComposite =
    primaryColumns.length === expected.length &&
    primaryColumns.every((column, index) => column === expected[index])

  if (alreadyComposite) {
    return
  }

  await query(`ALTER TABLE ${tableName} DROP PRIMARY KEY, ADD PRIMARY KEY (client_id, fy_id, business_id, id)`)
}

async function migrateDepreciationTables() {
  let scheduleColumns = await query('SHOW COLUMNS FROM depreciation_schedule_rows')
  let scheduleColumnNames = new Set(scheduleColumns.map((col) => col.Field))

  if (!scheduleColumnNames.has('ledger_id')) {
    await query(
      'ALTER TABLE depreciation_schedule_rows ADD COLUMN ledger_id VARCHAR(50) NULL AFTER business_id',
    )
    scheduleColumnNames.add('ledger_id')
  }

  if (!scheduleColumnNames.has('purchase_date')) {
    await query(
      'ALTER TABLE depreciation_schedule_rows ADD COLUMN purchase_date DATE NULL AFTER asset_name',
    )
    scheduleColumnNames.add('purchase_date')
  }

  for (const tableName of [
    'depreciation_schedule_rows',
    'depreciation_previous_year',
    'asset_depreciation_history',
  ]) {
    let columns = await query(`SHOW COLUMNS FROM ${tableName}`)
    let columnNames = new Set(columns.map((col) => col.Field))

    const auditColumns = [
      ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
      ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
      ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
      ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
      ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
      ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
      ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ]

    for (const [name, definition] of auditColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }
  }

  await ensureFyScopedCompositePrimaryKey('depreciation_schedule_rows')
}

async function migrateNoteTables() {
  for (const tableName of [
    'note_sub_amount_rows',
    'note_line_rows',
    'note_total_rows',
    'note_cash_adjustment',
    'note_history',
  ]) {
    let columns = await query(`SHOW COLUMNS FROM ${tableName}`)
    let columnNames = new Set(columns.map((col) => col.Field))

    const auditColumns = [
      ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
      ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
      ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
      ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
      ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
      ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
      ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ]

    for (const [name, definition] of auditColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }
  }

  await ensureFyScopedCompositePrimaryKey('note_line_rows')
}

async function migrateStatementTables() {
  for (const tableName of [
    'bs_statement_rows',
    'pl_statement_rows',
    'statement_fy_summary',
    'statement_history',
  ]) {
    let columns = await query(`SHOW COLUMNS FROM ${tableName}`)
    let columnNames = new Set(columns.map((col) => col.Field))

    const auditColumns = [
      ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
      ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
      ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
      ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
      ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
      ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
      ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ]

    for (const [name, definition] of auditColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }
  }
}

async function migrateLoanTables() {
  for (const tableName of ['loan_records', 'loan_history', 'loan_fy_summary']) {
    let columns = await query(`SHOW COLUMNS FROM ${tableName}`)
    let columnNames = new Set(columns.map((col) => col.Field))

    const auditColumns = [
      ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
      ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
      ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
      ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
      ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
      ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
      ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ]

    for (const [name, definition] of auditColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }
  }

  let loanRecordColumns = await query('SHOW COLUMNS FROM loan_records')
  let loanRecordColumnNames = new Set(loanRecordColumns.map((col) => col.Field))
  if (!loanRecordColumnNames.has('is_closed')) {
    await query(
      'ALTER TABLE loan_records ADD COLUMN is_closed TINYINT(1) NOT NULL DEFAULT 0 AFTER prepayment_date',
    )
    loanRecordColumnNames.add('is_closed')
  }

  const loanClosingAdjColumns = [
    ['closing_adj_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER is_closed'],
    ['closing_adj_mode', "VARCHAR(32) NOT NULL DEFAULT 'principal-interest' AFTER closing_adj_enabled"],
    ['closing_adj_principal', 'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_adj_mode'],
    ['closing_adj_interest', 'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_adj_principal'],
    ['closing_adj_target_balance', 'DECIMAL(18, 2) NULL AFTER closing_adj_interest'],
  ]

  for (const [name, definition] of loanClosingAdjColumns) {
    if (!loanRecordColumnNames.has(name)) {
      await query(`ALTER TABLE loan_records ADD COLUMN ${name} ${definition}`)
      loanRecordColumnNames.add(name)
    }
  }

  let loanHistoryColumns = await query('SHOW COLUMNS FROM loan_history')
  let loanHistoryColumnNames = new Set(loanHistoryColumns.map((col) => col.Field))
  const loanHistoryClosingAdjColumns = [
    ['closing_adj_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER closing_balance'],
    ['closing_adj_mode', "VARCHAR(32) NOT NULL DEFAULT 'principal-interest' AFTER closing_adj_enabled"],
    ['closing_adj_principal', 'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_adj_mode'],
    ['closing_adj_interest', 'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_adj_principal'],
    ['closing_adj_target_balance', 'DECIMAL(18, 2) NULL AFTER closing_adj_interest'],
  ]

  for (const [name, definition] of loanHistoryClosingAdjColumns) {
    if (!loanHistoryColumnNames.has(name)) {
      await query(`ALTER TABLE loan_history ADD COLUMN ${name} ${definition}`)
      loanHistoryColumnNames.add(name)
    }
  }

  const loanHistoryComputedColumns = [
    ['schedule_closing_balance', 'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_balance'],
    [
      'closing_adj_principal_applied',
      'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_adj_target_balance',
    ],
    [
      'closing_adj_interest_applied',
      'DECIMAL(18, 2) NOT NULL DEFAULT 0 AFTER closing_adj_principal_applied',
    ],
  ]

  for (const [name, definition] of loanHistoryComputedColumns) {
    if (!loanHistoryColumnNames.has(name)) {
      await query(`ALTER TABLE loan_history ADD COLUMN ${name} ${definition}`)
      loanHistoryColumnNames.add(name)
    }
  }

  await ensureFyScopedCompositePrimaryKey('loan_records')
}

async function createGstRecoTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS gst_reco_records (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      link_sales_to_revenue_note TINYINT(1) NOT NULL DEFAULT 0,
      link_closing_to_notes TINYINT(1) NOT NULL DEFAULT 0,
      closing_from_notes_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_from_notes_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      closing_from_notes_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sales_amount DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sales_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sales_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sales_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      amended_sales DECIMAL(18, 2) NOT NULL DEFAULT 0,
      amended_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      amended_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      amended_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_igst_to_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_igst_to_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_igst_to_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_cgst_to_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_cgst_to_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_sgst_to_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_sgst_to_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_cash_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_cash_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      ot_cash_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_3b_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_3b_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_3b_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_prev_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_prev_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_prev_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_2b_igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_2b_cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sr_2b_sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_gst_reco_fs (client_id, fy_id, business_id),
      INDEX idx_gst_reco_client_fy (client_id, fy_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS gst_reco_input_tax_rows (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      row_type VARCHAR(50) NOT NULL,
      particular VARCHAR(500) NOT NULL DEFAULT '',
      igst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      cgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sgst DECIMAL(18, 2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_gst_reco_input_row (client_id, fy_id, business_id, row_type),
      INDEX idx_gst_reco_input_fs (client_id, fy_id, business_id)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS gst_reco_history (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      fy_id VARCHAR(50) NOT NULL,
      fy_label VARCHAR(20) NOT NULL DEFAULT '',
      fy_start_year INT NOT NULL DEFAULT 0,
      payload JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id VARCHAR(50) NULL,
      created_by_username VARCHAR(100) NULL,
      created_by_name VARCHAR(255) NULL,
      updated_by_user_id VARCHAR(50) NULL,
      updated_by_username VARCHAR(100) NULL,
      updated_by_name VARCHAR(255) NULL,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY uniq_gst_reco_history (client_id, business_id, fy_id),
      INDEX idx_gst_reco_history_year (client_id, business_id, fy_start_year)
    )
  `)
}

export async function ensureGstRecoSchema() {
  await createGstRecoTables()
  await migrateGstRecoTables()
  const { migrateGstRecoFromFsData } = await import('../data/gstRecoStore.js')
  await migrateGstRecoFromFsData()
}

async function migrateGstRecoTables() {
  for (const tableName of ['gst_reco_records', 'gst_reco_input_tax_rows', 'gst_reco_history']) {
    let columns
    try {
      columns = await query(`SHOW COLUMNS FROM ${tableName}`)
    } catch (err) {
      if (err?.code === 'ER_NO_SUCH_TABLE') {
        await createGstRecoTables()
        columns = await query(`SHOW COLUMNS FROM ${tableName}`)
      } else {
        throw err
      }
    }

    let columnNames = new Set(columns.map((col) => col.Field))

    const auditColumns = [
      ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
      ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
      ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
      ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
      ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
      ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
      ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ]

    for (const [name, definition] of auditColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }
  }
}

async function migrateBankAccountTables() {
  for (const tableName of ['bank_account_rows', 'bank_account_history']) {
    let columns = await query(`SHOW COLUMNS FROM ${tableName}`)
    let columnNames = new Set(columns.map((col) => col.Field))

    const auditColumns = [
      ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
      ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
      ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
      ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
      ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
      ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
      ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ]

    for (const [name, definition] of auditColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }

    const lifecycleColumns = [
      ['status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER account_type"],
      ['closed_in_fy_id', 'VARCHAR(50) NULL AFTER status'],
      ['started_in_fy_id', 'VARCHAR(50) NULL AFTER closed_in_fy_id'],
    ]

    for (const [name, definition] of lifecycleColumns) {
      if (!columnNames.has(name)) {
        await query(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`)
        columnNames.add(name)
      }
    }
  }

  await ensureFyScopedCompositePrimaryKey('bank_account_rows')

  await query(`
    CREATE TABLE IF NOT EXISTS bank_account_exclusions (
      client_id VARCHAR(50) NOT NULL,
      business_id VARCHAR(50) NOT NULL,
      bank_account_id VARCHAR(50) NOT NULL,
      excluded_from_fy_id VARCHAR(50) NOT NULL,
      excluded_from_fy_start_year INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (client_id, business_id, bank_account_id),
      INDEX idx_bank_account_exclusions_year (client_id, business_id, excluded_from_fy_start_year)
    )
  `)

  const { backfillBankAccountStartedInFyFromHistory, migrateBankAccountsToGlobalModel, deduplicateAllBankAccountHistory } =
    await import('../data/bankAccountStore.js')
  await migrateBankAccountsToGlobalModel()
  await deduplicateAllBankAccountHistory()
  await backfillBankAccountStartedInFyFromHistory()
}

async function migrateUdinRecordsTable() {
  let columns = await query('SHOW COLUMNS FROM udin_records')
  let columnNames = new Set(columns.map((col) => col.Field))

  const auditColumns = [
    ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
    ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
    ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
    ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
    ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
    ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
    ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
  ]

  for (const [name, definition] of auditColumns) {
    if (!columnNames.has(name)) {
      await query(`ALTER TABLE udin_records ADD COLUMN ${name} ${definition}`)
      columnNames.add(name)
    }
  }
}

async function migrateLedgersTable() {
  let columns = await query('SHOW COLUMNS FROM ledgers')
  let columnNames = new Set(columns.map((col) => col.Field))

  const auditColumns = [
    ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
    ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
    ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
    ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
    ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
    ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
    ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ['deleted_by_user_id', 'VARCHAR(50) NULL AFTER deleted_at'],
    ['deleted_by_username', 'VARCHAR(100) NULL AFTER deleted_by_user_id'],
    ['deleted_by_name', 'VARCHAR(255) NULL AFTER deleted_by_username'],
  ]

  for (const [name, definition] of auditColumns) {
    if (!columnNames.has(name)) {
      await query(`ALTER TABLE ledgers ADD COLUMN ${name} ${definition}`)
      columnNames.add(name)
    }
  }
}

async function migrateBusinessesTable() {
  let columns = await query('SHOW COLUMNS FROM businesses')
  let columnNames = new Set(columns.map((col) => col.Field))

  const auditColumns = [
    ['created_by_user_id', 'VARCHAR(50) NULL AFTER created_at'],
    ['created_by_username', 'VARCHAR(100) NULL AFTER created_by_user_id'],
    ['created_by_name', 'VARCHAR(255) NULL AFTER created_by_username'],
    ['updated_by_user_id', 'VARCHAR(50) NULL AFTER created_by_name'],
    ['updated_by_username', 'VARCHAR(100) NULL AFTER updated_by_user_id'],
    ['updated_by_name', 'VARCHAR(255) NULL AFTER updated_by_username'],
    ['updated_at', 'TIMESTAMP NULL AFTER updated_by_name'],
    ['deleted_by_user_id', 'VARCHAR(50) NULL AFTER deleted_at'],
    ['deleted_by_username', 'VARCHAR(100) NULL AFTER deleted_by_user_id'],
    ['deleted_by_name', 'VARCHAR(255) NULL AFTER deleted_by_username'],
  ]

  for (const [name, definition] of auditColumns) {
    if (!columnNames.has(name)) {
      await query(`ALTER TABLE businesses ADD COLUMN ${name} ${definition}`)
      columnNames.add(name)
    }
  }
}

async function seedDefaults() {
  const users = await query('SELECT id FROM users LIMIT 1')
  if (users.length === 0) {
    const adminToken = generateUserToken()
    const adminHash = await hashPassword('admin123')
    await query(
      `INSERT INTO users (id, username, mobile, password_hash, user_token, name, user_type, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ['1', 'admin', '', adminHash, adminToken, 'Administrator', 'admin'],
    )
  }

  const fyRows = await query('SELECT setting_key FROM app_settings WHERE setting_key = ?', [
    'financial_years',
  ])
  if (fyRows.length === 0) {
    await query('INSERT INTO app_settings (setting_key, payload) VALUES (?, ?)', [
      'financial_years',
      JSON.stringify([
        {
          id: 'fy1',
          label: '24-25',
          startYear: 2024,
          endYear: 2025,
          statementType: 'Actual',
          createdAt: new Date().toISOString(),
        },
      ]),
    ])
  }

  const fyTableRows = await query('SELECT id FROM financial_years LIMIT 1')
  if (fyTableRows.length === 0) {
    const defaultFy = {
      id: 'fy1',
      label: '24-25',
      startYear: 2024,
      endYear: 2025,
      statementType: 'Actual',
      createdAt: new Date().toISOString(),
    }
    await query(
      `INSERT INTO financial_years (
         id, label, start_year, end_year, statement_type,
         is_deleted, deleted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
      [
        defaultFy.id,
        defaultFy.label,
        defaultFy.startYear,
        defaultFy.endYear,
        defaultFy.statementType,
        new Date(defaultFy.createdAt),
      ],
    )
  }

  const clientRows = await query('SELECT id FROM clients LIMIT 1')
  if (clientRows.length === 0) {
    const defaultClient = {
      id: '1',
      name: 'John Smith',
      mobile: '9876543210',
      email: 'john@example.com',
      address: '123 Main Street, Mumbai',
      pin: '400001',
      pan: 'AAAAA1234A',
      createdAt: new Date().toISOString(),
      businesses: [
        {
          id: '1',
          name: 'Smith Retail',
          type: 'Retail',
          startingFy: '20-21',
          startingYear: 2020,
          createdAt: new Date().toISOString(),
        },
      ],
      fyClosedOverrides: {},
      fyStatementTypeOverrides: {},
    }
    await query(
      `INSERT INTO clients (
         id, name, mobile, email, address, pin, pan,
         businesses, fy_closed_overrides, fy_statement_type_overrides, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        defaultClient.id,
        defaultClient.name,
        defaultClient.mobile,
        defaultClient.email,
        defaultClient.address,
        defaultClient.pin,
        defaultClient.pan,
        JSON.stringify(defaultClient.businesses),
        JSON.stringify(defaultClient.fyClosedOverrides),
        JSON.stringify(defaultClient.fyStatementTypeOverrides),
        new Date(defaultClient.createdAt),
      ],
    )

    const defaultBusiness = defaultClient.businesses[0]
    if (defaultBusiness) {
      await query(
        `INSERT INTO businesses (
           id, client_id, name, type, pan, address, starting_fy, starting_year,
           gst_number, status, is_deleted, deleted_at, created_at,
           created_by_user_id, created_by_username, created_by_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, NULL, NULL)`,
        [
          defaultBusiness.id,
          defaultClient.id,
          defaultBusiness.name,
          defaultBusiness.type,
          defaultClient.pan,
          defaultClient.address,
          defaultBusiness.startingFy,
          defaultBusiness.startingYear,
          null,
          'active',
          new Date(defaultBusiness.createdAt),
        ],
      )
    }
  }

  const caRows = await query('SELECT setting_key FROM app_settings WHERE setting_key = ?', [
    'ca_settings',
  ])
  if (caRows.length === 0) {
    await query('INSERT INTO app_settings (setting_key, payload) VALUES (?, ?)', [
      'ca_settings',
      JSON.stringify({ caProfiles: [], selectedCaProfileId: '' }),
    ])
  }

  const ledgerRows = await query('SELECT setting_key FROM app_settings WHERE setting_key = ?', [
    'ledgers',
  ])
  if (ledgerRows.length === 0) {
    await query('INSERT INTO app_settings (setting_key, payload) VALUES (?, ?)', [
      'ledgers',
      JSON.stringify([]),
    ])
  }
}

export async function getSetting(key) {
  const rows = await query('SELECT payload FROM app_settings WHERE setting_key = ?', [key])
  if (!rows.length) {
    return null
  }
  return parseJson(rows[0].payload)
}

export async function setSetting(key, value) {
  await query(
    'INSERT INTO app_settings (setting_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload)',
    [key, JSON.stringify(value)],
  )
}

export { parseJson }
