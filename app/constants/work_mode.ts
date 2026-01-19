/**
 * Driver Work Mode
 * 
 * Définit les différents modes de travail d'un chauffeur :
 * - IDEP : Mode indépendant (travaille pour lui-même)
 * - ETP : Mode entreprise (travaille pour une ETP)
 * - IDEP_TO_ETP : Transition (shift ETP commence mais mission IDEP en cours)
 * - ETP_TO_IDEP : Transition (shift ETP fini mais mission ETP en cours)
 * 
 * Les états de transition (*_TO_*) empêchent l'attribution de nouvelles missions
 * pendant qu'une livraison en cours se termine.
 */

export enum WorkMode {
    IDEP = 'IDEP',
    ETP = 'ETP',
    IDEP_TO_ETP = 'IDEP_TO_ETP',
    ETP_TO_IDEP = 'ETP_TO_IDEP',
}

/**
 * Vérifie si le mode permet d'attribuer de nouvelles missions
 */
export function canReceiveNewMissions(mode: WorkMode): boolean {
    return mode === WorkMode.IDEP || mode === WorkMode.ETP
}

/**
 * Vérifie si le mode est en transition
 */
export function isTransitioning(mode: WorkMode): boolean {
    return mode === WorkMode.IDEP_TO_ETP || mode === WorkMode.ETP_TO_IDEP
}

/**
 * Retourne le mode cible d'une transition
 */
export function getTargetMode(mode: WorkMode): WorkMode | null {
    if (mode === WorkMode.IDEP_TO_ETP) return WorkMode.ETP
    if (mode === WorkMode.ETP_TO_IDEP) return WorkMode.IDEP
    return null
}
