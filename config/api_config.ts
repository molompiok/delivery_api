
export const apiConfig = {
    search_place: {
        // Restrict search to specific country (e.g. 'ci' for Côte d'Ivoire)
        countryCode: 'ci',

        // Order of providers for location search
        providerOrder: ['google', 'nominatim'] as const,

        // Rate limiting for socket search
        rateLimit: {
            window: 60, // seconds
            maxRequests: 30,
            batchInterval: 500, // ms (server-side debounce/batching)
        },

        // Timeouts (ms)
        timeouts: {
            nominatim: 5000,
            google: 5000,
            valhalla: 20000,
        },
    }
}
