/**
 * Liste des templates de commande officiels.
 * Utilisé pour le typage et la validation à travers le système.
 */
export const OrderTemplates = {
    COMMANDE: 'COMMANDE', // Livraison standard (colis, repas, etc.)
    VOYAGE: 'VOYAGE',     // Transport de personnes (VTC)
    MISSION: 'MISSION',   // Services sur site ou missions complexes
} as const

export type OrderTemplate = typeof OrderTemplates[keyof typeof OrderTemplates] | string
