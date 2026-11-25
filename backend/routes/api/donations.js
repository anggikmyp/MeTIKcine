const router = require('express').Router();
const db = require('../../db');
const { requireLogin, requireRole } = require('../../middleware/auth');
const { today, isDate, wrap, fail } = require('../../lib/util');

// GET /api/v1/donations (Mahasiswa: milik sendiri | Admin: semua)
router.get('/donations', requireLogin, wrap(async (req, res) => {
  const status = ['menunggu', 'diterima', 'ditolak', 'dibatalkan'].includes(req.query.status)
    ? req.query.status
    : '';
  const q = (req.query.q || '').trim();

  let where = '1=1';
  const p = [];

  if (req.user.role === 'mahasiswa') {
    where += ' AND d.user_id = ?';
    p.push(req.user.id);
  }
  if (status) {
    where += ' AND d.status = ?';
    p.push(status);
  }
  if (q && req.user.role === 'admin') {
    where += ' AND (u.name LIKE ? OR u.nim LIKE ? OR d.medicine_name LIKE ?)';
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await db.query(
    `SELECT d.*, u.name AS user_name, u.nim, u.phone
       FROM db_mtc_donation d
       JOIN db_mtc_users u ON u.id = d.user_id
      WHERE ${where}
      ORDER BY (d.status = 'menunggu') DESC, d.created_at DESC`,
    p
  );

  res.json({ data: rows });
}));

// POST /api/v1/donations (Mahasiswa ajukan donasi obat)
router.post('/donations', requireRole('mahasiswa'), wrap(async (req, res) => {
  const f = {
    medicine_name: (req.body.medicine_name || '').trim(),
    qty: parseInt(req.body.qty, 10),
    expiry_date: req.body.expiry_date,
    condition_type: req.body.condition_type === 'sisa' ? 'sisa' : 'baru',
    condition_desc: (req.body.condition_desc || '').trim(),
  };

  const errors = [];
  if (!f.medicine_name) errors.push('Nama obat wajib diisi.');
  if (!(f.qty >= 1)) errors.push('Jumlah minimal 1.');
  if (!isDate(f.expiry_date) || f.expiry_date <= today()) errors.push('Tanggal kadaluwarsa harus di masa depan.');
  if (!f.condition_desc) errors.push('Jelaskan kondisi obat.');

  if (errors.length) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: errors[0], details: errors } });
  }

  const [ins] = await db.query(
    `INSERT INTO db_mtc_donation (user_id, medicine_name, qty, expiry_date, condition_type, condition_desc)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, f.medicine_name, f.qty, f.expiry_date, f.condition_type, f.condition_desc]
  );

  res.status(201).json({
    data: {
      id: ins.insertId,
      status: 'menunggu',
      message: 'Donasi terkirim dengan status Menunggu Verifikasi. Terima kasih!',
    },
  });
}));

// PATCH /api/v1/donations/:id/cancel (Mahasiswa batalkan donasi)
router.patch('/donations/:id/cancel', requireRole('mahasiswa'), wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE db_mtc_donation SET status = 'dibatalkan' WHERE id = ? AND user_id = ? AND status = 'menunggu'",
    [req.params.id, req.user.id]
  );
  if (!r.affectedRows) fail('Donasi tidak ditemukan atau sudah tidak bisa dibatalkan.');
  res.json({ data: { message: 'Donasi dibatalkan.' } });
}));

// PATCH /api/v1/donations/:id/verify (Admin terima atau tolak donasi)
router.patch('/donations/:id/verify', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id;
  const action = req.body.action;
  const note = (req.body.admin_note || '').trim().slice(0, 255) || null;

  if (!['terima', 'tolak'].includes(action)) {
    fail('Aksi tidak valid. Gunakan: terima atau tolak.');
  }

  if (action === 'tolak') {
    const [r] = await db.query(
      "UPDATE db_mtc_donation SET status = 'ditolak', admin_note = ? WHERE id = ? AND status = 'menunggu'",
      [note, id]
    );
    if (!r.affectedRows) fail('Donasi tidak ditemukan atau sudah diproses.');
    return res.json({ data: { message: 'Donasi ditolak.' } });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[d]] = await conn.query('SELECT * FROM db_mtc_donation WHERE id = ? FOR UPDATE', [id]);
    if (!d) fail('Donasi tidak ditemukan.', 404, 'NOT_FOUND');
    if (d.status !== 'menunggu') fail('Donasi ini sudah diproses.');

    let medId = req.body.medicine_id;
    if (medId === 'baru' || !medId) {
      const type = req.body.type_baru === 'pinjam' ? 'pinjam' : 'sekali_pakai';
      const [ins] = await conn.query(
        "INSERT INTO db_mtc_medicine (name, category, type, description, stock) VALUES (?, 'Donasi', ?, ?, ?)",
        [d.medicine_name, type, d.condition_desc, d.qty]
      );
      medId = ins.insertId;
    } else {
      const [r] = await conn.query('UPDATE db_mtc_medicine SET stock = stock + ? WHERE id = ?', [d.qty, medId]);
      if (!r.affectedRows) fail('Obat tujuan tidak ditemukan.', 404, 'NOT_FOUND');
    }

    await conn.query(
      "UPDATE db_mtc_donation SET status = 'diterima', medicine_id = ?, admin_note = ? WHERE id = ?",
      [medId, note, id]
    );
    await conn.commit();
    res.json({ data: { message: 'Donasi diterima dan stok obat bertambah.' } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
