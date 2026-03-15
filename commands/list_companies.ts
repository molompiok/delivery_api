import { BaseCommand } from '@adonisjs/core/ace'
import db from '@adonisjs/lucid/services/db'

export default class ListCompanies extends BaseCommand {
    static commandName = 'list:companies'
    static description = 'List all companies in the database'

    async run() {
        const companies = await db.from('companies').select('id', 'name')
        this.logger.info('Companies in database:')
        companies.forEach(c => {
            this.logger.info(`ID: ${c.id} | Name: ${c.name}`)
        })
    }
}
