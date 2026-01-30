/**
 * Required documents for Driver registration (User table)
 */
export const REQUIRED_DRIVER_DOCUMENTS = [
    {
        type: 'dct_id_card',
        name: 'Carte d\'Identité (Recto/Verso)',
        description: 'Document d\'identité en cours de validité'
    },
    {
        type: 'dct_driving_license',
        name: 'Permis de Conduire',
        description: 'Permis de conduire correspondant à votre catégorie de véhicule'
    },
    {
        type: 'dct_criminal_record',
        name: 'Casier Judiciaire',
        description: 'Extrait de casier judiciaire (moins de 3 mois)'
    }
]

/**
 * Required documents for Vehicle registration
 * Note: These are often managed dynamically in the service based on vehicle type
 */
export const REQUIRED_VEHICLE_DOCUMENTS = [
    {
        type: 'VEHICLE_REGISTRATION',
        name: 'Carte Grise',
    },
    {
        type: 'VEHICLE_INSURANCE',
        name: 'Assurance',
    },
    {
        type: 'VEHICLE_TECHNICAL_VISIT',
        name: 'Visite Technique',
    }
]
