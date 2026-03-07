export const WAVE_LEDGER_CATEGORIES = [
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

export type WaveLedgerCategory = (typeof WAVE_LEDGER_CATEGORIES)[number]

export type DeliveryLedgerCategory = WaveLedgerCategory

export function isWaveLedgerCategory(value: string): value is WaveLedgerCategory {
  return (WAVE_LEDGER_CATEGORIES as readonly string[]).includes(value)
}

