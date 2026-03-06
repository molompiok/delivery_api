import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .reduce((acc, line) => {
        const [key, ...value] = line.split('=');
        acc[key.trim()] = value.join('=').trim();
        return acc;
    }, {});

const client = new pg.Client({
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT || '5432'),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
});

async function run() {
    await client.connect();
    try {
        const companyId = 'cmp_m1lweyvo8dfmytbgx7';
        console.log(`--- Checking Unpaid Invoices for: ${companyId} ---`);
        const invRes = await client.query(
            "SELECT id, status, due_at FROM subscription_invoices WHERE company_id = $1 AND status IN ('ISSUED', 'OVERDUE') AND due_at <= NOW() - INTERVAL '7 days'",
            [companyId]
        );
        console.log('BLOCKING INVOICES:', JSON.stringify(invRes.rows, null, 2));

        if (invRes.rows.length > 0) {
            console.log('STILL BLOCKED!');
        } else {
            console.log('CLEAN! NO BLOCKAGE.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
