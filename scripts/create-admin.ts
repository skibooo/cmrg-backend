import bcrypt from 'bcrypt';
import { pool } from '../src/db';
import dotenv from 'dotenv';

dotenv.config();

async function createAdmin() {
  const name = process.argv[2];
  const email = process.argv[3];
  const password = process.argv[4];
  const orgId = process.argv[5] || 1;

  if (!name || !email || !password) {
    console.error('Usage: npx ts-node scripts/create-admin.ts "Full Name" "email@cmrg.com" "password" [org_id]');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    'INSERT INTO users (org_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
    [orgId, name, email, password_hash, 'admin']
  );

  console.log('Admin account created:', result.rows[0]);
  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});