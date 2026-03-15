import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import ActionProof from '#models/action_proof'
import { generateVerificationCode } from '#utils/verification_code'

export type ValidationPhase = 'pickup' | 'delivery' | 'service'
export type ValidationSource = 'ACTION' | 'ITEM' | 'NONE'

export type ConfirmationRuleItem = {
    name: string
    pickup?: boolean
    delivery?: boolean
    compare?: boolean
    reference?: string | null
}

export type ConfirmationRuleSet = {
    photo: ConfirmationRuleItem[]
    code: ConfirmationRuleItem[]
}

export type ItemValidationRules = Partial<Record<ValidationPhase, ConfirmationRuleSet>>

const PHASES: ValidationPhase[] = ['pickup', 'delivery', 'service']

export default class ValidationRuleEngine {
    static emptyRuleSet(): ConfirmationRuleSet {
        return { photo: [], code: [] }
    }

    static hasRules(rules: any): boolean {
        const normalized = this.normalizeRuleSet(rules)
        return normalized.photo.length > 0 || normalized.code.length > 0
    }

    static normalizeRuleSet(raw: any): ConfirmationRuleSet {
        const normalized = this.emptyRuleSet()
        if (!raw || typeof raw !== 'object') return normalized

        const normalizeArray = (items: any[], fallbackName: string) => {
            return items
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    name: String(item.name || fallbackName),
                    pickup: item.pickup === true,
                    delivery: item.delivery === true,
                    compare: item.compare === true,
                    reference: item.reference !== undefined && item.reference !== null ? String(item.reference) : null,
                }))
        }

        normalized.photo = Array.isArray(raw.photo) ? normalizeArray(raw.photo, 'verify_photo') : []
        normalized.code = Array.isArray(raw.code) ? normalizeArray(raw.code, 'verify_code') : []
        return normalized
    }

    static normalizeItemValidationRules(raw: any): ItemValidationRules {
        if (!raw || typeof raw !== 'object') return {}

        const normalized: ItemValidationRules = {}

        // Fallback: if passed directly as { photo, code }, apply same set to pickup+delivery.
        if (raw.photo || raw.code) {
            const shared = this.normalizeRuleSet(raw)
            if (this.hasRules(shared)) {
                normalized.pickup = shared
                normalized.delivery = shared
            }
        }

        for (const phase of PHASES) {
            if (raw[phase] !== undefined) {
                const rules = this.normalizeRuleSet(raw[phase])
                if (this.hasRules(rules)) {
                    normalized[phase] = rules
                } else {
                    normalized[phase] = this.emptyRuleSet()
                }
            }
        }

        return normalized
    }

    static extractItemValidationRules(metadata: any): ItemValidationRules {
        const meta = metadata && typeof metadata === 'object' ? metadata : {}
        const raw = meta.validation_rules ?? meta.validationRules ?? meta.validation?.rules ?? {}
        return this.normalizeItemValidationRules(raw)
    }

    static mergeItemValidationRules(base: ItemValidationRules, patch: ItemValidationRules): ItemValidationRules {
        const merged = this.normalizeItemValidationRules(base)
        for (const phase of PHASES) {
            if (patch[phase] !== undefined) {
                const rules = this.normalizeRuleSet(patch[phase])
                if (this.hasRules(rules)) {
                    merged[phase] = rules
                } else {
                    delete merged[phase]
                }
            }
        }
        return merged
    }

    static setItemValidationRulesInMetadata(metadata: any, rules: ItemValidationRules): any {
        const next = { ...(metadata && typeof metadata === 'object' ? metadata : {}) }
        const normalized = this.normalizeItemValidationRules(rules)
        const hasAny = Object.values(normalized).some((ruleSet) => this.hasRules(ruleSet))

        if (hasAny) {
            next.validation_rules = normalized
        } else {
            delete next.validation_rules
        }

        return next
    }

    static splitActionRulesByScope(actionRules: any): {
        actionRules: ConfirmationRuleSet
        itemRulesPatch: ItemValidationRules
        hasItemScopedRules: boolean
    } {
        const normalized = this.normalizeRuleSet(actionRules)
        const actionScoped = this.emptyRuleSet()
        const itemPatch: ItemValidationRules = {}
        let hasItemScopedRules = false

        const pushPhaseRule = (phase: ValidationPhase, kind: 'photo' | 'code', rule: ConfirmationRuleItem) => {
            if (!itemPatch[phase]) itemPatch[phase] = this.emptyRuleSet()
            itemPatch[phase]![kind].push(rule)
        }

        const stripScopeFlags = (rule: ConfirmationRuleItem): ConfirmationRuleItem => ({
            name: rule.name,
            compare: rule.compare === true,
            reference: rule.reference ?? null,
        })

        for (const kind of ['photo', 'code'] as const) {
            for (const rule of normalized[kind]) {
                const appliesPickup = rule.pickup === true
                const appliesDelivery = rule.delivery === true
                const baseRule = stripScopeFlags(rule)

                if (appliesPickup || appliesDelivery) {
                    hasItemScopedRules = true
                    if (appliesPickup) pushPhaseRule('pickup', kind, baseRule)
                    if (appliesDelivery) pushPhaseRule('delivery', kind, baseRule)
                    continue
                }

                actionScoped[kind].push(baseRule)
            }
        }

        return {
            actionRules: actionScoped,
            itemRulesPatch: itemPatch,
            hasItemScopedRules,
        }
    }

    static phaseFromActionType(type: string): ValidationPhase {
        const value = String(type || '').toUpperCase()
        if (value === 'PICKUP') return 'pickup'
        if (value === 'DELIVERY') return 'delivery'
        return 'service'
    }

    static resolveEffectiveRulesForAction(params: {
        actionType: string
        actionRules: any
        itemRules?: ItemValidationRules
    }): { rules: ConfirmationRuleSet; source: ValidationSource; phase: ValidationPhase } {
        const phase = this.phaseFromActionType(params.actionType)
        const normalizedAction = this.normalizeRuleSet(params.actionRules)

        if (this.hasRules(normalizedAction)) {
            return { rules: normalizedAction, source: 'ACTION', phase }
        }

        const normalizedItem = this.normalizeItemValidationRules(params.itemRules || {})
        const fromItem = normalizedItem[phase] ? this.normalizeRuleSet(normalizedItem[phase]) : this.emptyRuleSet()

        if (this.hasRules(fromItem)) {
            return { rules: fromItem, source: 'ITEM', phase }
        }

        return { rules: this.emptyRuleSet(), source: 'NONE', phase }
    }

    static async applyProofsForAction(params: {
        actionId: string
        rules: any
        trx: TransactionClientContract
        source: ValidationSource
        phase: ValidationPhase
    }): Promise<void> {
        const normalizedRules = this.normalizeRuleSet(params.rules)

        await ActionProof.query({ client: params.trx })
            .where('actionId', params.actionId)
            .delete()

        if (!this.hasRules(normalizedRules)) return

        for (const photoRule of normalizedRules.photo) {
            await ActionProof.create({
                actionId: params.actionId,
                type: 'PHOTO',
                key: photoRule.name || 'verify_photo',
                expectedValue: photoRule.reference || null,
                isVerified: false,
                metadata: {
                    pickup: params.phase === 'pickup',
                    delivery: params.phase === 'delivery',
                    compare: photoRule.compare === true,
                    source: params.source,
                }
            }, { client: params.trx })
        }

        for (const codeRule of normalizedRules.code) {
            const expected = codeRule.reference ?? (codeRule.compare ? generateVerificationCode() : null)

            await ActionProof.create({
                actionId: params.actionId,
                type: 'CODE',
                key: codeRule.name || 'verify_code',
                expectedValue: expected,
                isVerified: false,
                metadata: {
                    pickup: params.phase === 'pickup',
                    delivery: params.phase === 'delivery',
                    compare: codeRule.compare === true,
                    source: params.source,
                }
            }, { client: params.trx })
        }
    }
}
