export const WAVE_LEDGER_CATEGORIES = [
  'DEPOSIT',
  'PAYOUT',
  'PAYMENT',
  'REFUND',
  'COMMISSION',
  'FEE',
  'REWARD',
  'TRANSFER',
  'ADJUSTMENT',
  'RELEASE',
  'SUBSCRIPTION',
] as const

export type WaveLedgerCategory = (typeof WAVE_LEDGER_CATEGORIES)[number]

/**
 * Catégories spécifiques au métier Logistique (Delivery API).
 * Elles sont systématiquement mappées vers les enums Wave API lors des échanges.
 */
export const DELIVERY_LEDGER_CATEGORIES = [
  'ORDER_PAYMENT',
  'SERVICE_PAYMENT',
  'COMMISSION',
  'DEPOSIT',
  'PAYOUT',
  'REFUND',
  'ADJUSTMENT',
  'SUBSCRIPTION',
  'TRANSFER',
  'SALARY',
  'DRIVER_PAYMENT',
  'COMPANY_COMMISSION',
  'PLATFORM_COMMISSION',
  'COD_SETTLEMENT',
  'RELEASE',
  'SUBSCRIPTION_FEE',
] as const

export type DeliveryLedgerCategory = (typeof DELIVERY_LEDGER_CATEGORIES)[number]

export function isWaveLedgerCategory(value: string): value is WaveLedgerCategory {
  return (WAVE_LEDGER_CATEGORIES as readonly string[]).includes(value)
}

export function isDeliveryLedgerCategory(value: string): value is DeliveryLedgerCategory {
  return (DELIVERY_LEDGER_CATEGORIES as readonly string[]).includes(value)
}
