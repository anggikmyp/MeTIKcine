const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../db');
const { wrap, fail } = require('../../lib/util');
const { requireLogin } = require('../../middleware/auth');

router.get('/config', (req, res) => {
  res.json({ data: {
    daily_quota: parseInt(process.env.DAILY_QUOTA, 10) || 3,
    max_loan_days: parseInt(process.env.MAX_LOAN_DAYS, 10) || 7,
    low_stock: parseInt(process.env.LOW_STOCK, 10) || 5,
    email_domain: process.env.ALLOWED_EMAIL_DOMAIN || null,
  } });
});

router.post('/auth/login', wrap(async (req, res) => {
  const id = (req.body.identifier || '').trim().toLowerCase();
  const pw = req.body.password || '';
  const [rows] = await db.query(
    `SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
       FROM db_mtc_users WHERE email = ? OR nim = ? LIMIT 1`, [id, id]);
  const u = rows[0];

  if (u && u.is_locked) fail('Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.', 423, 'ACCOUNT_LOCKED');
  if (!u || !(await bcrypt.compare(pw, u.password_hash))) {
    if (u) {
      const attempts = u.failed_attempts + 1;
      if (attempts >= 5) {
        await db.query('UPDATE db_mtc_users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?', [u.id]);
      } else {
        await db.query('UPDATE db_mtc_users SET failed_attempts = ? WHERE id = ?', [attempts, u.id]);
      }
    }
    fail('Email/NIM atau kata sandi salah.', 401, 'INVALID_CREDENTIALS');
  }

  await db.query('UPDATE db_mtc_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [u.id]);
  const user = { id: u.id, name: u.name, email: u.email, nim: u.nim, role: u.role };
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ data: { token, user } });
}));

router.post('/auth/register', wrap(async (req, res) => {
  const f = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
    nim: (req.body.nim || '').trim(),
    phone: (req.body.phone || '').trim(),
  };
  const pw = req.body.password || '';
  const errors = [];
  if (!f.name) errors.push('Nama wajib diisi.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors.push('Format email tidak valid.');
  const dom = process.env.ALLOWED_EMAIL_DOMAIN;
  if (dom && !f.email.endsWith('@' + dom)) errors.push(`Gunakan email kampus (@${dom}).`);
  if (!/^\d{8,12}$/.test(f.nim)) errors.push('NIM harus berupa angka 8 sampai 12 digit.');
  if (f.phone && !/^[0-9+\-\s]{8,20}$/.test(f.phone)) errors.push('Format nomor telepon tidak valid.');
  if (pw.length < 8) errors.push('Kata sandi minimal 8 karakter.');
  if (errors.length) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: errors[0], details: errors } });
  }

  const [dup] = await db.query('SELECT id FROM db_mtc_users WHERE email = ? OR nim = ?', [f.email, f.nim]);
  if (dup.length) fail('Email atau NIM sudah terdaftar.', 409, 'CONFLICT');

  const hash = await bcrypt.hash(pw, 10);
  await db.query(
    "INSERT INTO db_mtc_users (name, email, nim, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, 'mahasiswa')",
    [f.name, f.email, f.nim, f.phone || null, hash]);
  res.status(201).json({ data: { message: 'Akun berhasil dibuat. Silakan masuk.' } });
}));

router.get('/auth/me', requireLogin, (req, res) => {
  const { id, name, email, nim, role } = req.user;
  res.json({ data: { id, name, email, nim, role } });
});

module.exports = router;