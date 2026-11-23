// Pakai: npm run seed:admin -- "Nama Admin" email@pnj.ac.id NIM_ATAU_- kataSandi
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

(async () => {
  const [name, email, nim, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.log('Pakai: npm run seed:admin -- "Nama Admin" email@pnj.ac.id NIM_ATAU_- kataSandi');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    "INSERT INTO db_mtc_users (name, email, nim, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
    [name, email.toLowerCase(), nim && nim !== '-' ? nim : null, hash]
  );
  console.log('Admin dibuat:', email);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
