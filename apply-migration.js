#!/usr/bin/env node

/**
 * Script to manually apply the customer fields migration to the Supabase database
 * 
 * Usage:
 * 1. Install required dependencies:
 *    npm install pg dotenv
 * 2. Set your database connection details in environment variables:
 *    - DB_HOST
 *    - DB_PORT
 *    - DB_NAME
 *    - DB_USER
 *    - DB_PASSWORD
 * 3. Run the script:
 *    node apply-migration.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if it exists
require('dotenv').config();

async function applyMigration() {
  // Database connection configuration
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };

  // Create a new PostgreSQL client
  const client = new Client(config);

  try {
    // Connect to the database
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20250925100000_add_customer_fields_to_sales.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split the migration into individual statements (simple approach)
    // In a production environment, you might want to use a proper SQL parser
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    console.log(`Found ${statements.length} statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`Executing statement ${i + 1}: ${statement.substring(0, 50)}...`);
      await client.query(statement);
      console.log(`Statement ${i + 1} executed successfully`);
    }

    console.log('Migration applied successfully!');
  } catch (error) {
    console.error('Error applying migration:', error.message);
    process.exit(1);
  } finally {
    // Close the database connection
    await client.end();
    console.log('Database connection closed');
  }
}

// Run the migration
applyMigration();