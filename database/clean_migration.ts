
import db from '@adonisjs/lucid/services/db'

async function run() {
    console.log('Cleaning up corrupted migration entries...')
    try {
        await db.from('adonis_schema').where('name', 'like', '%alter_orders_for_advanced_dispatches_table%').delete()
        console.log('Cleanup successful.')
    } catch (error) {
        console.error('Cleanup failed:', error)
    }
}

run()
