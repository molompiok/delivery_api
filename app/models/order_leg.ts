import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Address from '#models/address'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class OrderLeg extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(leg: OrderLeg) {
        leg.id = generateId('leg')
    }

    /**
     * ID de la commande parente
     */
    @column()
    declare orderId: string

    /**
     * Point de départ du segment (Adresse)
     */
    @column()
    declare startAddressId: string | null

    /**
     * Point d'arrivée du segment (Adresse)
     */
    @column()
    declare endAddressId: string | null

    /**
     * Coordonnées GPS de départ (pour affichage et calcul rapide)
     */
    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare startCoordinates: { type: 'Point'; coordinates: [number, number] } | null

    /**
     * Coordonnées GPS d'arrivée
     */
    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare endCoordinates: { type: 'Point'; coordinates: [number, number] } | null

    /**
     * Géométrie complète de l'itinéraire (LineString) calculée par Valhalla
     * Utilisée pour l'affichage statique sur la map sans recalcule.
     */
    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare geometry: { type: 'LineString'; coordinates: number[][] } | null

    /**
     * Durée estimée du trajet en secondes
     */
    @column()
    declare durationSeconds: number | null

    /**
     * Distance estimée en mètres
     */
    @column()
    declare distanceMeters: number | null

    /**
     * Liste des instructions de navigation (tourner à gauche, etc.)
     */
    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare maneuvers: any[] | null

    /**
     * Données brutes renvoyées par le moteur de routing (Valhalla)
     */
    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare rawData: any | null

    /**
     * État actuel du segment
     */
    @column()
    declare status: 'PLANNED' | 'IN_TRANSIT' | 'COMPLETED' | 'FAILED'

    /**
     * Historique des changements de statut pour ce segment précis
     */
    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify([]),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare statusHistory: Array<{ status: string; timestamp: string; note?: string }>

    /**
     * Tracé réel effectué par le driver (coordonnées GPS relevées durant le trajet)
     */
    @column({
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare actualPath: { type: 'LineString'; coordinates: number[][] } | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => Address, { foreignKey: 'startAddressId' })
    declare startAddress: BelongsTo<typeof Address>

    @belongsTo(() => Address, { foreignKey: 'endAddressId' })
    declare endAddress: BelongsTo<typeof Address>
}
