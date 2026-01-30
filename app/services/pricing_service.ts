import logger from '@adonisjs/core/services/logger'

export interface SimplePackageInfo {
    dimensions: {
        weight_g?: number
        depth_cm?: number
        width_cm?: number
        height_cm?: number
    }
    quantity: number
    mention_warning?: string
}

// Pricing Constants in XOF (CFA)
const BASE_FEE = 500
const PER_KM_FEE = 150
const PER_MINUTE_FEE = 0.6
const WEIGHT_SURCHARGE_THRESHOLD_G = 5000
const WEIGHT_SURCHARGE_PER_KG_OVER = 100
const VOLUME_SURCHARGE_THRESHOLD_M3 = 0.2
const VOLUME_SURCHARGE_AMOUNT = 500
const FRAGILE_SURCHARGE = 300
const DRIVER_PERCENTAGE = 0.95
const PLATFORM_MARGIN_FACTOR = 1.05

import { PricingDetails } from '../types/logistics.js'

class PricingService {
    /**
     * Calculates estimated client fees and driver remuneration.
     */
    async calculateFees(
        distanceMeters: number,
        durationSeconds: number,
        packages: SimplePackageInfo[]
    ): Promise<PricingDetails> {
        try {
            const distanceKm = distanceMeters / 1000
            const durationMinutes = durationSeconds / 60

            let totalWeightG = 0
            let totalVolumeM3 = 0
            let hasFragile = false

            for (const pkg of packages) {
                const quantity = pkg.quantity || 1
                const weight = pkg.dimensions?.weight_g || 10 * quantity
                totalWeightG += weight

                if (pkg.dimensions?.depth_cm && pkg.dimensions?.width_cm && pkg.dimensions?.height_cm) {
                    const volumeCm3 =
                        pkg.dimensions.depth_cm * pkg.dimensions.width_cm * pkg.dimensions.height_cm
                    totalVolumeM3 += (volumeCm3 / 1_000_000) * quantity
                }

                if (pkg.mention_warning === 'fragile') {
                    hasFragile = true
                }
            }

            totalVolumeM3 = Math.round(totalVolumeM3 * 1000) / 1000

            logger.debug(
                {
                    distanceKm,
                    durationMinutes,
                    packageCount: packages.length,
                    totalWeightG,
                    totalVolumeM3,
                    hasFragile,
                },
                'Calculating fees based on ride data'
            )

            // 1. Base cost calculation
            let calculatedCost = BASE_FEE + distanceKm * PER_KM_FEE + durationMinutes * PER_MINUTE_FEE

            // 2. Add surcharges
            if (totalWeightG > WEIGHT_SURCHARGE_THRESHOLD_G) {
                const overweightKg = (totalWeightG - WEIGHT_SURCHARGE_THRESHOLD_G) / 1000
                const weightSurcharge = overweightKg * WEIGHT_SURCHARGE_PER_KG_OVER
                calculatedCost += weightSurcharge
            }
            if (totalVolumeM3 > VOLUME_SURCHARGE_THRESHOLD_M3) {
                calculatedCost += VOLUME_SURCHARGE_AMOUNT
            }
            if (hasFragile) {
                calculatedCost += FRAGILE_SURCHARGE
            }

            // 3. Driver remuneration
            const variableCostPart = calculatedCost - BASE_FEE
            let driverRemuneration = BASE_FEE * 0.5 + variableCostPart * DRIVER_PERCENTAGE

            // 4. Client fee (with platform margin)
            let clientFee = calculatedCost * PLATFORM_MARGIN_FACTOR

            // 5. Round and verify minimums
            clientFee = Math.max(500, Math.round(clientFee))
            driverRemuneration = Math.max(300, Math.round(driverRemuneration))

            logger.info(`Calculated Fees - Client: ${clientFee} XOF, Driver: ${driverRemuneration} XOF`)

            return {
                clientFee,
                driverRemuneration,
                currency: 'XOF',
                breakdown: {
                    baseFee: BASE_FEE,
                    distanceFee: Math.round(distanceKm * PER_KM_FEE),
                    durationFee: Math.round(durationMinutes * PER_MINUTE_FEE),
                    surcharges: {
                        weight: totalWeightG > WEIGHT_SURCHARGE_THRESHOLD_G ? Math.round(((totalWeightG - WEIGHT_SURCHARGE_THRESHOLD_G) / 1000) * WEIGHT_SURCHARGE_PER_KG_OVER) : 0,
                        volume: totalVolumeM3 > VOLUME_SURCHARGE_THRESHOLD_M3 ? VOLUME_SURCHARGE_AMOUNT : 0,
                        fragile: hasFragile ? FRAGILE_SURCHARGE : 0
                    }
                }
            }
        } catch (error) {
            logger.error({ err: error, distanceMeters, durationSeconds }, 'Error calculating fees')
            throw new Error('Pricing calculation failed')
        }
    }
}

export default new PricingService()
