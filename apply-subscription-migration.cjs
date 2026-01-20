const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function applyMigration() {
    const config = {
        // Try to parse connection string if available, otherwise use individual params
        connectionString: process.env.DATABASE_URL,
        // Fallback if DATABASE_URL is not set or if we want to use specific params
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: false } // Supabase usually requires SSL
    };

    // If we don't have a connection string, we might need to rely on the individual params.
    // Ideally, Supabase projects provide a direct connection string.

    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
        console.error("No database configuration found in .env (DATABASE_URL or DB_HOST/etc)");
        process.exit(1);
    }

    const client = new Client(config);

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('Connected successfully!');

        const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260113212000_create_subscriptions_table.sql');
        console.log(`Reading migration file from: ${migrationPath}`);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Split by semicolon, but handle cases where semicolon might be in quotes/strings if possible.
        // For this simple migration, splitting by ';' is likely fine as long as we don't have ; inside the text.
        // Our migration has ; inside the function body! 
        // Naive splitting will break the function definition.
        // Better to run the whole thing as one query if possible, or use a customized splitter.
        // pg client client.query() can often handle multiple statements. Let's try sending the whole block.

        console.log('Applying migration...');
        await client.query(migrationSQL);
        console.log('Migration applied successfully!');

    } catch (error) {
        console.error('Error applying migration:', error);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyMigration();
