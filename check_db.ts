import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'

async function checkTable() {
    await app.boot()
    const columns = await db.connection().rawQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'zone_drivers'")
    console.log('Columns in zone_drivers:', columns.rows.map((r: any) => r.column_name))
    process.exit(0)
}

checkTable()
