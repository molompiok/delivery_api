/**
 * Configuration unique pour la logistique et le dispatching de Sublymus
 */
export const logisticsConfig = {
    // --- Gestion du Dispatching ---
    dispatch: {
        // Temps accordé au chauffeur pour accepter (après ack)
        offerTimeoutSeconds: 15,

        // Système de vérification de connexion (ACK)
        ack: {
            pingIntervalMs: 2000,   // Intervalle entre les pings
            maxAttempts: 10,        // Nombre de tentatives (10 * 2s = 20s total)
        },

        // Nombre de cycles complets de re-essai avant d'abandonner
        maxAutoRetries: 2,

        // Rayon de recherche initial (km)
        searchRadiusKm: 10,
    },

    // --- Chaînage de Missions ---
    chaining: {
        // Nombre max de missions simultanées (modifiable par Admin)
        defaultMaxConcurrentMissions: 2,

        // Distance max entre destination actuelle et prochain pickup (km)
        maxDirectRadiusKm: 1,
    },

    // --- Sécurité & Validation ---
    validation: {
        // Type de validation par défaut
        defaultMethod: 'OTP', // 'OTP' | 'SCAN' | 'SIGNATURE'

        // Longueur des codes OTP générés
        otpLength: 6,
    }
}

export default logisticsConfig
