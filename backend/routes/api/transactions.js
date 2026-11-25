const router = require('express').Router();
const db = require('../../db');
const { requireLogin, requireRole } = require('../../middleware/auth');
const { today, addDays, isDate, wrap, fail } = require('../../lib/util');

const DAILY_QUOTA = parseInt(process.env.DAILY_QUOTA, 10) || 3;
const MAX_LOAN_DAYS = parseInt(process.env.MAX_LOAN_DAYS, 10) || 7;

// GET /api/v1/student/dashboard (Ringkasan beranda mahasiswa)
router.get('/student/dashboard', requireRole('mahasiswa'), wrap(async (req, res) => {
  const uid = req.user.id;
  const [featured_medicines] = await db.query(
    'SELECT * FROM db_mtc_medicine WHERE stock > 0 ORDER BY stock DESC, name LIMIT 6'
  );
  const [recent_transactions] = await db.query(
    `SELECT t.*, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 5`,
    [uid]
  );
  const [[c]] = await db.query(
    `SELECT SUM(type='ambil' AND status IN ('menunggu','disetujui')) AS ambil,
            SUM(type='pinjam' AND status IN ('menunggu','disetujui','diserahkan')) AS pinjam
       FROM db_mtc_transaction WHERE user_id = ?`,
    [uid]
  );
  const [[d]] = await db.query(
    "SELECT COUNT(*) AS n FROM db_mtc_donation WHERE user_id = ? AND status = 'menunggu'",
    [uid]
  );

  res.json({
    data: {
      counts: {
        ambil: Number(c.ambil || 0),
        pinjam: Number(c.pinjam || 0),
        donasi: d.n,
      },
      featured_medicines,
      recent_transactions,
    },
  });
}));

// GET /api/v1/transactions (Mahasiswa: milik sendiri | Admin: semua)
router.get('/transactions', requireLogin, wrap(async (req, res) => {
  const type = ['ambil', 'pinjam'].includes(req.query.type) ? req.query.type : '';
  const status = ['menunggu', 'disetujui', 'ditolak', 'diserahkan', 'dikembalikan', 'dibatalkan'].includes(req.query.status)
    ? req.query.status
    : '';
  const q = (req.query.q || '').trim();

  let where = '1=1';
  const p = [];

  if (req.user.role === 'mahasiswa') {
    where += ' AND t.user_id = ?';
    p.push(req.user.id);
  }
  if (type) {
    where += ' AND t.type = ?';
    p.push(type);
  }
  if (status) {
    where += ' AND t.status = ?';
    p.push(status);
  }
  if (q && req.user.role === 'admin') {
    where += ' AND (u.name LIKE ? OR u.nim LIKE ? OR m.name LIKE ?)';
    p.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await db.query(
    `SELECT t.*, u.name AS user_name, u.nim, u.phone, m.name AS medicine_name, m.stock AS medicine_stock
       FROM db_mtc_transaction t
       JOIN db_mtc_users u ON u.id = t.user_id
       JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE ${where}
      ORDER BY (t.status = 'menunggu') DESC, t.return_requested DESC, t.created_at DESC`,
    p
  );

  res.json({ data: rows });
}));

// POST /api/v1/transactions (Mahasiswa ajukan pengambilan / peminjaman)
router.post('/transactions', requireRole('mahasiswa'), wrap(async (req, res) => {
  const uid = req.user.id;
  const medicine_id = parseInt(req.body.medicine_id, 10);
  const type = req.body.type === 'pinjam' ? 'pinjam' : req.body.type === 'ambil' ? 'ambil' : '';
  const qty = parseInt(req.body.qty, 10);
  const reason = (req.body.reason || '').trim();
  const pickup_date = req.body.pickup_date;
  const due_date = req.body.due_date || null;

  if (!medicine_id || !type) fail('Obat dan jenis transaksi (ambil/pinjam) wajib diisi.');

  const expectedMedType = type === 'ambil' ? 'sekali_pakai' : 'pinjam';
  const [[med]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ? AND type = ?', [medicine_id, expectedMedType]);
  if (!med) fail('Obat tidak ditemukan atau tidak sesuai dengan jenis pengajuan.', 404, 'NOT_FOUND');

  const errors = [];
  if (!(qty >= 1)) errors.push('Jumlah minimal 1.');
  else if (qty > med.stock) errors.push(`Jumlah melebihi stok yang tersedia (${med.stock}).`);
  if (!reason) errors.push('Alasan wajib diisi.');

  const pickOk = isDate(pickup_date) && pickup_date >= today();
  if (!pickOk) errors.push('Tanggal pengambilan tidak valid atau sudah lewat.');

  if (type === 'ambil' && qty >= 1) {
    const [[u]] = await db.query(
      `SELECT COALESCE(SUM(qty),0) AS used FROM db_mtc_transaction
        WHERE user_id = ? AND type = 'ambil' AND DATE(created_at) = CURDATE()
          AND status NOT IN ('ditolak','dibatalkan')`,
      [uid]
    );
    if (Number(u.used) + qty > DAILY_QUOTA) {
      errors.push(`Kuota pengambilan harian ${DAILY_QUOTA} item (hari ini sudah ${u.used}).`);
    }
  }

  if (
    type === 'pinjam' &&
    (!pickOk || !isDate(due_date) || due_date < pickup_date || due_date > addDays(pickup_date, MAX_LOAN_DAYS))
  ) {
    errors.push(`Tanggal pengembalian harus sesudah tanggal ambil dan maksimal ${MAX_LOAN_DAYS} hari.`);
  }

  if (errors.length) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: errors[0], details: errors } });
  }

  const [ins] = await db.query(
    `INSERT INTO db_mtc_transaction (user_id, medicine_id, type, qty, reason, pickup_date, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uid, med.id, type, qty, reason, pickup_date, type === 'pinjam' ? due_date : null]
  );

  res.status(201).json({
    data: {
      id: ins.insertId,
      status: 'menunggu',
      message: 'Pengajuan terkirim dengan status Menunggu Persetujuan.',
    },
  });
}));

// PATCH /api/v1/transactions/:id/cancel (Mahasiswa batalkan saat masih menunggu)
router.patch('/transactions/:id/cancel', requireRole('mahasiswa'), wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE db_mtc_transaction SET status = 'dibatalkan' WHERE id = ? AND user_id = ? AND status = 'menunggu'",
    [req.params.id, req.user.id]
  );
  if (!r.affectedRows) fail('Pengajuan tidak ditemukan atau sudah tidak bisa dibatalkan.');
  res.json({ data: { message: 'Pengajuan dibatalkan.' } });
}));

// PATCH /api/v1/transactions/:id/request-return (Mahasiswa ajukan pengembalian)
router.patch('/transactions/:id/request-return', requireRole('mahasiswa'), wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE db_mtc_transaction SET return_requested = 1 WHERE id = ? AND user_id = ? AND type = 'pinjam' AND status = 'diserahkan'",
    [req.params.id, req.user.id]
  );
  if (!r.affectedRows) fail('Pengembalian tidak dapat diajukan.');
  res.json({
    data: { message: 'Pengajuan pengembalian terkirim. Serahkan barang ke sekretariat untuk dikonfirmasi admin.' },
  });
}));

// PATCH /api/v1/transactions/:id/status (Admin: setujui | tolak | serahkan | kembali)
router.patch('/transactions/:id/status', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id;
  const action = req.body.action;
  const note = (req.body.admin_note || '').trim().slice(0, 255) || null;

  if (!['setujui', 'tolak', 'serahkan', 'kembali'].includes(action)) {
    fail('Aksi tidak valid. Gunakan: setujui, tolak, serahkan, atau kembali.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM db_mtc_transaction WHERE id = ? FOR UPDATE', [id]);
    if (!t) fail('Pengajuan tidak ditemukan.', 404, 'NOT_FOUND');

    const [[m]] = await conn.query('SELECT * FROM db_mtc_medicine WHERE id = ? FOR UPDATE', [t.medicine_id]);
    let msg;

    if (action === 'setujui') {
      if (t.status !== 'menunggu') fail('Pengajuan ini sudah diproses.');
      if (m.stock < t.qty) fail(`Stok ${m.name} tidak cukup (tersisa ${m.stock}).`);
      await conn.query("UPDATE db_mtc_transaction SET status = 'disetujui', admin_note = ? WHERE id = ?", [note, id]);
      msg = 'Pengajuan disetujui. Mahasiswa bisa mengambil obat di sekretariat.';
    } else if (action === 'tolak') {
      if (t.status !== 'menunggu') fail('Pengajuan ini sudah diproses.');
      await conn.query("UPDATE db_mtc_transaction SET status = 'ditolak', admin_note = ? WHERE id = ?", [note, id]);
      msg = 'Pengajuan ditolak.';
    } else if (action === 'serahkan') {
      if (t.status !== 'disetujui') fail('Hanya pengajuan berstatus Disetujui yang bisa diserahkan.');
      if (m.stock < t.qty) fail(`Stok ${m.name} tidak cukup (tersisa ${m.stock}).`);
      await conn.query('UPDATE db_mtc_medicine SET stock = stock - ? WHERE id = ?', [t.qty, m.id]);
      await conn.query("UPDATE db_mtc_transaction SET status = 'diserahkan' WHERE id = ?", [id]);
      msg = 'Penyerahan dikonfirmasi dan stok diperbarui.';
    } else {
      if (t.type !== 'pinjam' || t.status !== 'diserahkan') {
        fail('Hanya barang yang sedang dipinjam yang bisa dikembalikan.');
      }
      const cond = req.body.return_condition === 'rusak' ? 'rusak' : 'baik';
      if (cond === 'baik') {
        await conn.query('UPDATE db_mtc_medicine SET stock = stock + ? WHERE id = ?', [t.qty, m.id]);
      }
      await conn.query(
        "UPDATE db_mtc_transaction SET status = 'dikembalikan', return_condition = ?, admin_note = ? WHERE id = ?",
        [cond, note, id]
      );
      msg =
        cond === 'baik'
          ? 'Pengembalian dikonfirmasi dan stok bertambah.'
          : 'Pengembalian dicatat. Barang rusak tidak dimasukkan kembali ke stok.';
    }

    await conn.commit();
    res.json({ data: { message: msg } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
