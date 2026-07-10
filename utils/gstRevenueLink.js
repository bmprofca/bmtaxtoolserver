function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

export function getGstTaxableSalesTotal(gstReco) {
  if (!gstReco?.sales) {
    return 0
  }
  return n(gstReco.sales.sales) + n(gstReco.sales.amendedSales)
}

/** Sync taxable sales from GST Reco into Note 19 gst-sales row. */
export function applyGstSalesFromRecoToRevenue(noteSubAmounts = {}, gstReco) {
  const total = getGstTaxableSalesTotal(gstReco)
  const revenue = noteSubAmounts.revenueFromOperations || {}
  const existingGstSales = revenue['gst-sales'] || { current: 0, previous: 0 }
  const existingGoods = revenue['sales-goods'] || { current: 0, previous: 0 }
  const existingServices = revenue['sales-services'] || { current: 0, previous: 0 }

  const goodsCurrent =
    existingGstSales.current === 0 &&
    existingGoods.current === total &&
    existingServices.current === 0
      ? 0
      : existingGoods.current

  return {
    ...noteSubAmounts,
    revenueFromOperations: {
      ...revenue,
      'sales-goods': { ...existingGoods, current: goodsCurrent },
      'gst-sales': { ...existingGstSales, current: total },
    },
  }
}
