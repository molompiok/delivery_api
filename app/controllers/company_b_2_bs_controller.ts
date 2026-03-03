import type { HttpContext } from '@adonisjs/core/http'
import Company from '#models/company'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

export default class CompanyB2BsController {

    /**
     * List all authorized B2B clients for a given company
     */
    async index({ params, response, auth }: HttpContext) {
        const user = auth.user!
        const company = await Company.query().where('id', params.companyId).where('owner_id', user.id).firstOrFail()

        await company.load('b2bClients')

        // We can format the output directly mapping Pivot elements
        const mapped = company.b2bClients.map(client => ({
            id: client.id,
            email: client.email,
            name: client.name,
            status: client.$extras.pivot_status,
            partneredAt: client.$extras.pivot_created_at
        }))

        return response.ok(mapped)
    }

    /**
     * Add a new B2B Partner to the company
     */
    async store({ params, request, response, auth }: HttpContext) {
        const user = auth.user!
        const company = await Company.query().where('id', params.companyId).where('owner_id', user.id).firstOrFail()

        const clientEmail = request.input('email')
        const clientId = request.input('client_id')

        let targetClient: User | null = null
        if (clientId) {
            targetClient = await User.find(clientId)
        } else if (clientEmail) {
            targetClient = await User.findBy('email', clientEmail)
        }

        if (!targetClient) {
            return response.badRequest({ message: 'Client not found. They must have an active User account.' })
        }

        if (targetClient.id === company.ownerId) {
            return response.badRequest({ message: 'Owner cannot be added as a B2B partner (implicit bypass exists).' })
        }

        // Attach via ManyToMany
        try {
            await company.related('b2bClients').attach({
                [targetClient.id]: {
                    status: 'ACTIVE',
                    created_at: new Date()
                }
            })
            return response.created({ message: 'B2B Client authorized successfully' })
        } catch (e) {
            return response.badRequest({ message: 'Client might already be partnered.' })
        }
    }

    /**
     * Update the status of a partnered client (ACTIVE/SUSPENDED)
     */
    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.user!
        const company = await Company.query().where('id', params.companyId).where('owner_id', user.id).firstOrFail()

        const status = request.input('status')
        if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
            return response.badRequest({ message: 'Invalid status' })
        }

        await db.from('company_b2b_partners')
            .where('company_id', company.id)
            .where('client_id', params.id)
            .update({ status, updated_at: new Date() })

        return response.ok({ message: `Client status updated to ${status}` })
    }

    /**
     * Delete a partnered relationship entirely
     */
    async destroy({ params, response, auth }: HttpContext) {
        const user = auth.user!
        const company = await Company.query().where('id', params.companyId).where('owner_id', user.id).firstOrFail()

        await company.related('b2bClients').detach([params.id])

        return response.ok({ message: 'B2B Client authorization revoked' })
    }
}