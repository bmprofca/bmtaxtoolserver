const CALENDAR_MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function parseLoanYearMonth(value) {
  if (!value) {
    return null
  }

  const parts = String(value).split('-')
  if (parts.length < 2) {
    return null
  }

  const year = Number(parts[0])
  const month = Number(parts[1])

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }

  return { year, month }
}

function yearMonthKey(year, month) {
  return year * 12 + month
}

function isBeforeYearMonth(left, right) {
  return yearMonthKey(left.year, left.month) < yearMonthKey(right.year, right.month)
}

function isAfterYearMonth(left, right) {
  return yearMonthKey(left.year, left.month) > yearMonthKey(right.year, right.month)
}

function normalizeLoanMonthField(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    return ''
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})/)
  if (!match) {
    return ''
  }

  return `${match[1]}-${match[2]}-01`
}

function toLoanMonthStartIso(value) {
  return normalizeLoanMonthField(value)
}

function resolveEmiStartDate(input, fyStartYear) {
  if (input.emiStartDate) {
    return toLoanMonthStartIso(input.emiStartDate)
  }

  if (input.disbursementDate) {
    return toLoanMonthStartIso(input.disbursementDate)
  }

  return `${fyStartYear}-04-01`
}

export function calculateEmi(principal, annualRate, tenureMonths) {
  const p = n(principal)
  const months = Math.max(1, Math.floor(n(tenureMonths)))

  if (p <= 0) {
    return 0
  }

  const monthlyRate = annualRate / 12 / 100

  if (monthlyRate === 0) {
    return Math.round(p / months)
  }

  const factor = Math.pow(1 + monthlyRate, months)
  return Math.round((p * monthlyRate * factor) / (factor - 1))
}

function addCalendarMonths(ym, delta) {
  const index = ym.year * 12 + (ym.month - 1) + delta
  return {
    year: Math.floor(index / 12),
    month: (index % 12) + 1,
  }
}

function sameCalendarMonth(dateValue, ym) {
  const parsed = parseLoanYearMonth(
    String(dateValue).includes('T') ? dateValue : toLoanMonthStartIso(dateValue),
  )
  if (!parsed) {
    return false
  }

  return parsed.year === ym.year && parsed.month === ym.month
}

export function isCalendarMonthInFinancialYear(year, month, fyStartYear, fyEndYear) {
  if (month >= 4) {
    return year === fyStartYear
  }

  return year === fyEndYear
}

export function isLoanFullyRepaid(loan) {
  const tenureMonths = Math.floor(n(loan.tenureMonths))
  if (tenureMonths < 1) {
    return false
  }

  const principal = n(loan.openingBalance) + n(loan.disbursement)
  if (principal <= 0) {
    return false
  }

  if (!loan.monthlySchedule?.length) {
    return false
  }

  return loan.monthlySchedule[loan.monthlySchedule.length - 1].balance <= 0
}

function resolveClosingBalanceAtFyEnd(input, fullSchedule, fyStartYear, fyEndYear) {
  const fyEndYm = { year: fyEndYear, month: 3 }
  const rowsOnOrBefore = fullSchedule.filter((row) => {
    const ym = { year: row.year, month: row.month }
    return !isAfterYearMonth(ym, fyEndYm)
  })

  if (rowsOnOrBefore.length > 0) {
    return rowsOnOrBefore[rowsOnOrBefore.length - 1].balance
  }

  let balance = n(input.openingBalance)
  const disbYm = input.disbursementDate
    ? parseLoanYearMonth(toLoanMonthStartIso(input.disbursementDate))
    : null
  const fyStartYm = { year: fyStartYear, month: 4 }

  if (n(input.disbursement) > 0 && disbYm && !isAfterYearMonth(disbYm, fyEndYm)) {
    if (!isBeforeYearMonth(disbYm, fyStartYm)) {
      balance += n(input.disbursement)
    } else {
      balance += n(input.disbursement)
    }
  }

  return Math.max(0, balance)
}

export function computeFullLoanSchedule(input, fyStartYear) {
  const resolvedEmiStartDate = resolveEmiStartDate(input, fyStartYear)
  const emiStartYm = parseLoanYearMonth(resolvedEmiStartDate)
  if (!emiStartYm) {
    return []
  }

  const monthlyRate = n(input.interestRate) / 12 / 100
  let balance = n(input.openingBalance)

  const disbYm = input.disbursementDate
    ? parseLoanYearMonth(toLoanMonthStartIso(input.disbursementDate))
    : null
  const disbAddedUpfront = Boolean(
    disbYm && n(input.disbursement) > 0 && !isAfterYearMonth(disbYm, emiStartYm),
  )

  if (disbAddedUpfront) {
    balance += n(input.disbursement)
  }

  const baseForEmi = balance > 0 ? balance : n(input.openingBalance) + n(input.disbursement)
  const tenureMonths = Math.floor(n(input.tenureMonths))
  if (tenureMonths < 1 || baseForEmi <= 0) {
    return []
  }

  const emiAmount = calculateEmi(baseForEmi, n(input.interestRate), tenureMonths)
  const maxInstallments = tenureMonths

  const schedule = []
  let serialNo = 0
  let installments = 0
  let prepaymentApplied = false
  let currentYm = emiStartYm
  let disbApplied = disbAddedUpfront

  while (balance > 0 && installments < maxInstallments) {
    if (!disbApplied && disbYm && n(input.disbursement) > 0) {
      if (currentYm.year === disbYm.year && currentYm.month === disbYm.month) {
        balance += n(input.disbursement)
        disbApplied = true
      }
    }

    if (balance <= 0) {
      break
    }

    if (!prepaymentApplied && n(input.prepaymentAmount) > 0 && input.prepaymentDate) {
      if (sameCalendarMonth(input.prepaymentDate, currentYm)) {
        const prepay = Math.min(balance, n(input.prepaymentAmount))
        balance -= prepay
        serialNo += 1
        schedule.push({
          serialNo,
          month: currentYm.month,
          monthLabel: CALENDAR_MONTH_LABELS[currentYm.month - 1],
          year: currentYm.year,
          emi: prepay,
          principal: prepay,
          interest: 0,
          balance: Math.max(0, balance),
          isPrepayment: true,
          isPreClosure: true,
        })
        prepaymentApplied = true
        if (balance <= 0) {
          break
        }
      }
    }

    const interest = Math.round(balance * monthlyRate)
    const principal = Math.min(balance, Math.max(0, emiAmount - interest))
    const emi = interest + principal

    balance -= principal
    serialNo += 1
    schedule.push({
      serialNo,
      month: currentYm.month,
      monthLabel: CALENDAR_MONTH_LABELS[currentYm.month - 1],
      year: currentYm.year,
      emi,
      principal,
      interest,
      balance: Math.max(0, balance),
    })

    installments += 1
    currentYm = addCalendarMonths(currentYm, 1)
  }

  return schedule
}

function normalizeClosingAdjustmentMode(value) {
  return value === 'target-balance' ? 'target-balance' : 'principal-interest'
}

function defaultClosingAdjustmentFields() {
  return {
    closingAdjustmentEnabled: false,
    closingAdjustmentMode: 'principal-interest',
    closingAdjustmentPrincipal: 0,
    closingAdjustmentInterest: 0,
    closingAdjustmentTargetBalance: 0,
  }
}

export function applyClosingBalanceAdjustments(computed, input) {
  if (!input.closingAdjustmentEnabled) {
    return {
      interestForYear: computed.interestForYear,
      principalRepaid: computed.principalRepaid,
      closingBalance: computed.closingBalance,
      principalAdjustment: 0,
      interestAdjustment: 0,
      scheduleClosingBalance: computed.closingBalance,
    }
  }

  if (input.closingAdjustmentMode === 'target-balance') {
    const target = Math.max(0, n(input.closingAdjustmentTargetBalance))
    const principalAdjustment = computed.closingBalance - target
    return {
      interestForYear: computed.interestForYear,
      principalRepaid: computed.principalRepaid + principalAdjustment,
      closingBalance: target,
      principalAdjustment,
      interestAdjustment: 0,
      scheduleClosingBalance: computed.closingBalance,
    }
  }

  const principalAdjustment = n(input.closingAdjustmentPrincipal)
  const interestAdjustment = n(input.closingAdjustmentInterest)
  return {
    interestForYear: computed.interestForYear + interestAdjustment,
    principalRepaid: computed.principalRepaid + principalAdjustment,
    closingBalance: Math.max(0, computed.closingBalance - principalAdjustment),
    principalAdjustment,
    interestAdjustment,
    scheduleClosingBalance: computed.closingBalance,
  }
}

export function computeLoanForFinancialYear(input, fyStartYear, fyEndYear) {
  const resolvedEmiStartDate = resolveEmiStartDate(input, fyStartYear)
  const fullSchedule = computeFullLoanSchedule(input, fyStartYear)

  let interestForYear = 0
  let principalRepaid = 0
  for (const row of fullSchedule) {
    if (isCalendarMonthInFinancialYear(row.year, row.month, fyStartYear, fyEndYear)) {
      interestForYear += row.interest
      principalRepaid += row.principal
    }
  }

  const closingBalance = resolveClosingBalanceAtFyEnd(input, fullSchedule, fyStartYear, fyEndYear)

  let balance = n(input.openingBalance)
  const disbYm = input.disbursementDate
    ? parseLoanYearMonth(toLoanMonthStartIso(input.disbursementDate))
    : null
  const emiStartYm = parseLoanYearMonth(resolvedEmiStartDate)
  const disbAddedUpfront = Boolean(
    disbYm && emiStartYm && n(input.disbursement) > 0 && !isAfterYearMonth(disbYm, emiStartYm),
  )

  if (disbAddedUpfront) {
    balance += n(input.disbursement)
  }

  const baseForEmi = balance > 0 ? balance : n(input.openingBalance) + n(input.disbursement)
  const emiAmount = calculateEmi(baseForEmi, n(input.interestRate), n(input.tenureMonths))

  const adjusted = applyClosingBalanceAdjustments(
    { interestForYear, principalRepaid, closingBalance },
    input,
  )

  return {
    id: input.id || '',
    lender: String(input.lender || '').trim(),
    loanType: input.loanType === 'short-term' ? 'short-term' : 'long-term',
    openingBalance: n(input.openingBalance),
    disbursement: n(input.disbursement),
    disbursementDate: input.disbursementDate || '',
    interestRate: n(input.interestRate),
    tenureMonths: n(input.tenureMonths),
    emiStartDate: resolvedEmiStartDate,
    prepaymentAmount: n(input.prepaymentAmount),
    prepaymentDate: input.prepaymentDate || '',
    emiAmount,
    interestForYear: adjusted.interestForYear,
    principalRepaid: adjusted.principalRepaid,
    closingBalance: adjusted.closingBalance,
    monthlySchedule: fullSchedule,
    scheduleClosingBalance: adjusted.scheduleClosingBalance,
    closingAdjustmentPrincipalApplied: adjusted.principalAdjustment,
    closingAdjustmentInterestApplied: adjusted.interestAdjustment,
  }
}

export function loanToRecord(loan) {
  return {
    id: loan.id,
    lender: loan.lender,
    loanType: loan.loanType,
    openingBalance: loan.openingBalance,
    disbursement: loan.disbursement,
    disbursementDate: loan.disbursementDate,
    interestRate: loan.interestRate,
    tenureMonths: loan.tenureMonths,
    emiStartDate: loan.emiStartDate,
    prepaymentAmount: loan.prepaymentAmount,
    prepaymentDate: loan.prepaymentDate,
    ...defaultClosingAdjustmentFields(),
    ...(loan.closingAdjustmentEnabled
      ? {
          closingAdjustmentEnabled: true,
          closingAdjustmentMode: normalizeClosingAdjustmentMode(loan.closingAdjustmentMode),
          closingAdjustmentPrincipal: n(loan.closingAdjustmentPrincipal),
          closingAdjustmentInterest: n(loan.closingAdjustmentInterest),
          closingAdjustmentTargetBalance: n(loan.closingAdjustmentTargetBalance),
        }
      : {}),
  }
}

export function migrateRepaymentSchedule(rows, fyStartYear, fyEndYear) {
  return rows
    .filter((row) => row.lender || row.openingBalance || row.addition)
    .map((row) => {
      const loan = computeLoanForFinancialYear(
        {
          id: row.id,
          lender: row.lender,
          loanType: 'long-term',
          openingBalance: row.openingBalance,
          disbursement: row.addition,
          disbursementDate: `${fyStartYear}-04-01`,
          interestRate: 0,
          tenureMonths: 12,
          emiStartDate: `${fyStartYear}-04-01`,
          prepaymentAmount: row.repayment,
          prepaymentDate: row.repayment ? `${fyEndYear}-03-01` : '',
          ...defaultClosingAdjustmentFields(),
        },
        fyStartYear,
        fyEndYear,
      )
      return loanToRecord(loan)
    })
}

export function summarizeLoans(loans) {
  return loans.reduce(
    (acc, loan) => {
      if (loan.loanType === 'long-term') {
        acc.longTermClosing += loan.closingBalance
      } else {
        acc.shortTermClosing += loan.closingBalance
      }
      acc.totalInterest += loan.interestForYear
      acc.totalPrincipalRepaid += loan.principalRepaid
      return acc
    },
    {
      longTermClosing: 0,
      shortTermClosing: 0,
      totalInterest: 0,
      totalPrincipalRepaid: 0,
    },
  )
}

function summarizeCashFlowByYear(schedule) {
  const byYear = new Map()

  for (const row of schedule || []) {
    const entry = byYear.get(row.year) || { interestPaid: 0, principalPaid: 0 }
    entry.interestPaid += n(row.interest)
    entry.principalPaid += n(row.principal)
    byYear.set(row.year, entry)
  }

  return [...byYear.entries()]
    .sort(([yearA], [yearB]) => yearA - yearB)
    .map(([year, amounts]) => ({
      year,
      interestPaid: amounts.interestPaid,
      principalPaid: amounts.principalPaid,
      totalPaid: amounts.interestPaid + amounts.principalPaid,
    }))
}

export function mergeCashFlowByYear(loans) {
  const byYear = new Map()

  for (const loan of loans || []) {
    for (const row of summarizeCashFlowByYear(loan.monthlySchedule)) {
      const entry = byYear.get(row.year) || { interestPaid: 0, principalPaid: 0 }
      entry.interestPaid += row.interestPaid
      entry.principalPaid += row.principalPaid
      byYear.set(row.year, entry)
    }
  }

  return [...byYear.entries()]
    .sort(([yearA], [yearB]) => yearA - yearB)
    .map(([year, amounts]) => ({
      year,
      interestPaid: amounts.interestPaid,
      principalPaid: amounts.principalPaid,
      totalPaid: amounts.interestPaid + amounts.principalPaid,
    }))
}
