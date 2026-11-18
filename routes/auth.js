const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { flash, wrap } = require('../lib/util');
const { requireLogin } = require('../middleware/auth');

const home = (u) => (u.role === 'admin' ? '/admin' : '/');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(home(req.session.user));
  res.render('login');
});

router.post('/login', wrap(async (req, res, next) => {
  const id = (req.body.identifier || '').trim().toLowerCase();
  const pw = req.body.password || '';
  const [rows] = await db.query(
    `SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked
       FROM db_mtc_users WHERE email = ? OR nim = ? LIMIT 1`, [id, id]);
  const u = rows[0];

  if (u && u.is_locked) {
    flash(req, 'error', 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
    return res.redirect('/login');
  }
  if (!u || !(await bcrypt.compare(pw, u.password_hash))) {
    if (u) {
      const attempts = u.failed_attempts + 1;
      if (attempts >= 5) {
        await db.query(
          'UPDATE db_mtc_users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?', [u.id]);
      } else {
        await db.query('UPDATE db_mtc_users SET failed_attempts = ? WHERE id = ?', [attempts, u.id]);
      }
    }
    flash(req, 'error', 'Email/NIM atau kata sandi salah.');
    return res.redirect('/login');
  }

  await db.query('UPDATE db_mtc_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [u.id]);
  const sess = { id: u.id, name: u.name, email: u.email, nim: u.nim, role: u.role };
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = sess;
    res.redirect(home(sess));
  });
}));

router.get('/register', (req, res) => res.render('register', { errors: [], form: {} }));

router.post('/register', wrap(async (req, res) => {
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
  if (pw !== req.body.password2) errors.push('Konfirmasi kata sandi tidak sama.');
  if (!errors.length) {
    const [dup] = await db.query('SELECT id FROM db_mtc_users WHERE email = ? OR nim = ?', [f.email, f.nim]);
    if (dup.length) errors.push('Email atau NIM sudah terdaftar.');
  }
  if (errors.length) return res.status(400).render('register', { errors, form: f });

  const hash = await bcrypt.hash(pw, 10);
  await db.query(
    "INSERT INTO db_mtc_users (name, email, nim, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, 'mahasiswa')",
    [f.name, f.email, f.nim, f.phone || null, hash]);
  flash(req, 'success', 'Akun berhasil dibuat. Silakan masuk.');
  res.redirect('/login');
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Profil dipakai bersama oleh mahasiswa dan admin
router.get('/profil', requireLogin, wrap(async (req, res) => {
  const [[me]] = await db.query('SELECT * FROM db_mtc_users WHERE id = ?', [req.session.user.id]);
  res.render('profil', { me });
}));

router.post('/profil', requireLogin, wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  const phone = (req.body.phone || '').trim() || null;
  if (!name) {
    flash(req, 'error', 'Nama tidak boleh kosong.');
    return res.redirect('/profil');
  }
  await db.query('UPDATE db_mtc_users SET name = ?, phone = ?, class_name = ?, job_title = ? WHERE id = ?',
    [name, phone, (req.body.class_name || '').trim() || null, (req.body.job_title || '').trim() || null, req.session.user.id]);
  req.session.user.name = name;
  flash(req, 'success', 'Profil diperbarui.');
  res.redirect('/profil');
}));

module.exports = router;
