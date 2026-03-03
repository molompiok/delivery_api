import db from '@adonisjs/lucid/services/db';

async function run() {
  const result = await db.rawQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehicles'");
  console.log(result.rows);
  process.exit(0);
}
run();
