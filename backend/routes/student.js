const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { today, addDays, isDate, flash, wrap } = require('../lib/util');

const DAILY_QUOTA = parseInt(process.env.DAILY_QUOTA, 10) || 3;
const MAX_LOAN_DAYS = parseInt(process.env.MAX_LOAN_DAYS, 10) || 7;

const KINDS = {
  p3k: { type: 'ambil', medType: 'sekali_pakai', title: 'Pengambilan Obat (P3K)', button: 'Ajukan Pengambilan' },
  pinjam: { type: 'pinjam', medType: 'pinjam', title: 'Peminjaman Obat', button: 'Ajukan Peminjaman' },
};
const notFound = (res) => res.status(404).render('error', { message: 'Data tidak ditemukan.' });
const getMed = async (id, medType) => {
  const [rows] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ? AND type = ?', [id, medType]);
  return rows[0];
};

router.use(requireRole('mahasiswa'));

// Beranda
router.get('/', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const [meds] = await db.query('SELECT * FROM db_mtc_medicine WHERE stock > 0 ORDER BY stock DESC, name LIMIT 6');
  const [recent] = await db.query(
    `SELECT t.*, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 5`, [uid]);
  const [[c]] = await db.query(
    `SELECT SUM(type='ambil' AND status IN ('menunggu','disetujui')) AS ambil,
            SUM(type='pinjam' AND status IN ('menunggu','disetujui','diserahkan')) AS pinjam
       FROM db_mtc_transaction WHERE user_id = ?`, [uid]);
  const [[d]] = await db.query("SELECT COUNT(*) AS n FROM db_mtc_donation WHERE user_id = ? AND status = 'menunggu'", [uid]);
  res.render('home', { meds, recent, counts: { ambil: Number(c.ambil || 0), pinjam: Number(c.pinjam || 0), donasi: d.n } });
}));

// Katalog P3K / Peminjaman
router.get('/:kind(p3k|pinjam)', wrap(async (req, res) => {
  const k = KINDS[req.params.kind];
  const q = (req.query.q || '').trim();
  const cat = (req.query.kategori || '').trim();
  let sql = 'SELECT * FROM db_mtc_medicine WHERE type = ?';
  const p = [k.medType];
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  if (cat) { sql += ' AND category = ?'; p.push(cat); }
  const [meds] = await db.query(sql + ' ORDER BY name', p);
  const [cats] = await db.query('SELECT DISTINCT category FROM db_mtc_medicine WHERE type = ? ORDER BY category', [k.medType]);
  res.render('catalog', { k, kind: req.params.kind, meds, cats: cats.map((c) => c.category), q, cat });
}));

// Form pengajuan
router.get('/:kind(p3k|pinjam)/:id', wrap(async (req, res) => {
  const k = KINDS[req.params.kind];
  const med = await getMed(req.params.id, k.medType);
  if (!med) return notFound(res);
  res.render('request-form', { k, kind: req.params.kind, med, errors: [], form: {}, maxDays: MAX_LOAN_DAYS, quota: DAILY_QUOTA });
}));

router.post('/:kind(p3k|pinjam)/:id', wrap(async (req, res) => {
  const k = KINDS[req.params.kind];
  const med = await getMed(req.params.id, k.medType);
  if (!med) return notFound(res);
  const uid = req.session.user.id;
  const f = {
    qty: parseInt(req.body.qty, 10),
    reason: (req.body.reason || '').trim(),
    pickup_date: req.body.pickup_date,
    due_date: req.body.due_date || null,
  };
  const errors = [];
  if (!(f.qty >= 1)) errors.push('Jumlah minimal 1.');
  else if (f.qty > med.stock) errors.push(`Jumlah melebihi stok yang tersedia (${med.stock}).`);
  if (!f.reason) errors.push('Alasan wajib diisi.');
  const pickOk = isDate(f.pickup_date) && f.pickup_date >= today();
  if (!pickOk) errors.push('Tanggal pengambilan tidak valid atau sudah lewat.');
  if (k.type === 'ambil' && f.qty >= 1) {
    const [[u]] = await db.query(
      `SELECT COALESCE(SUM(qty),0) AS used FROM db_mtc_transaction
        WHERE user_id = ? AND type = 'ambil' AND DATE(created_at) = CURDATE()
          AND status NOT IN ('ditolak','dibatalkan')`, [uid]);
    if (Number(u.used) + f.qty > DAILY_QUOTA)
      errors.push(`Kuota pengambilan harian ${DAILY_QUOTA} item (hari ini sudah ${u.used}).`);
  }
  if (k.type === 'pinjam' &&
      (!pickOk || !isDate(f.due_date) || f.due_date < f.pickup_date || f.due_date > addDays(f.pickup_date, MAX_LOAN_DAYS)))
    errors.push(`Tanggal pengembalian harus sesudah tanggal ambil dan maksimal ${MAX_LOAN_DAYS} hari.`);

  if (errors.length)
    return res.status(400).render('request-form', { k, kind: req.params.kind, med, errors, form: req.body, maxDays: MAX_LOAN_DAYS, quota: DAILY_QUOTA });

  await db.query(
    `INSERT INTO db_mtc_transaction (user_id, medicine_id, type, qty, reason, pickup_date, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uid, med.id, k.type, f.qty, f.reason, f.pickup_date, k.type === 'pinjam' ? f.due_date : null]);
  flash(req, 'success', 'Pengajuan terkirim dengan status Menunggu Persetujuan.');
  res.redirect('/riwayat?jenis=' + k.type);
}));

// Batalkan pengajuan (hanya saat masih menunggu)
router.post('/transaksi/:id/batal', wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE db_mtc_transaction SET status = 'dibatalkan' WHERE id = ? AND user_id = ? AND status = 'menunggu'",
    [req.params.id, req.session.user.id]);
  flash(req, r.affectedRows ? 'success' : 'error', r.affectedRows ? 'Pengajuan dibatalkan.' : 'Pengajuan tidak bisa dibatalkan.');
  res.redirect('back');
}));

// Pengembalian: tampilkan semua pinjaman yang disetujui atau sedang dipinjam
router.get('/pengembalian', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const [rows] = await db.query(
    `SELECT t.*, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE t.user_id = ? AND t.type = 'pinjam' AND t.status IN ('disetujui','diserahkan')
      ORDER BY (t.status = 'diserahkan') DESC, t.due_date`, [uid]);
  const [done] = await db.query(
    `SELECT t.*, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE t.user_id = ? AND t.type = 'pinjam' AND t.status = 'dikembalikan'
      ORDER BY t.updated_at DESC LIMIT 5`, [uid]);
  res.render('return', { rows, done });
}));

router.post('/pengembalian/:id', wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE db_mtc_transaction SET return_requested = 1 WHERE id = ? AND user_id = ? AND type = 'pinjam' AND status = 'diserahkan'",
    [req.params.id, req.session.user.id]);
  flash(req, r.affectedRows ? 'success' : 'error',
    r.affectedRows ? 'Pengajuan pengembalian terkirim. Serahkan barang ke sekretariat untuk dikonfirmasi admin.' : 'Pengembalian tidak dapat diajukan.');
  res.redirect('/pengembalian');
}));

// Donasi
router.get('/donasi', wrap(async (req, res) => {
  const [rows] = await db.query('SELECT * FROM db_mtc_donation WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
  res.render('donation', { rows, errors: [], form: {} });
}));

router.post('/donasi', wrap(async (req, res) => {
  const uid = req.session.user.id;
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
    const [rows] = await db.query('SELECT * FROM db_mtc_donation WHERE user_id = ? ORDER BY created_at DESC', [uid]);
    return res.status(400).render('donation', { rows, errors, form: req.body });
  }
  await db.query(
    `INSERT INTO db_mtc_donation (user_id, medicine_name, qty, expiry_date, condition_type, condition_desc)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uid, f.medicine_name, f.qty, f.expiry_date, f.condition_type, f.condition_desc]);
  flash(req, 'success', 'Donasi terkirim dengan status Menunggu Verifikasi. Terima kasih!');
  res.redirect('/donasi');
}));

router.post('/donasi/:id/batal', wrap(async (req, res) => {
  const [r] = await db.query(
    "UPDATE db_mtc_donation SET status = 'dibatalkan' WHERE id = ? AND user_id = ? AND status = 'menunggu'",
    [req.params.id, req.session.user.id]);
  flash(req, r.affectedRows ? 'success' : 'error', r.affectedRows ? 'Donasi dibatalkan.' : 'Donasi tidak bisa dibatalkan.');
  res.redirect('back');
}));

// Riwayat gabungan
router.get('/riwayat', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const jenis = ['ambil', 'pinjam', 'kembali', 'donasi'].includes(req.query.jenis) ? req.query.jenis : 'semua';
  let rows = [];
  if (jenis !== 'donasi') {
    let where = 't.user_id = ?';
    if (jenis === 'ambil') where += " AND t.type = 'ambil'";
    if (jenis === 'pinjam') where += " AND t.type = 'pinjam'";
    if (jenis === 'kembali') where += " AND t.status = 'dikembalikan'";
    const [tx] = await db.query(
      `SELECT t.*, m.name AS medicine_name FROM db_mtc_transaction t
         JOIN db_mtc_medicine m ON m.id = t.medicine_id WHERE ${where} ORDER BY t.created_at DESC`, [uid]);
    rows = tx.map((t) => ({
      jenis: t.type, label: t.type === 'ambil' ? 'Pengambilan' : 'Peminjaman',
      name: t.medicine_name, qty: t.qty, date: t.created_at, status: t.status, note: t.admin_note,
      detail: t.type === 'ambil' ? `Jadwal ambil ${t.pickup_date}` : `Ambil ${t.pickup_date}, kembali ${t.due_date}`,
      cancelUrl: t.status === 'menunggu' ? `/transaksi/${t.id}/batal` : null,
    }));
  }
  if (jenis === 'semua' || jenis === 'donasi') {
    const [dn] = await db.query('SELECT * FROM db_mtc_donation WHERE user_id = ? ORDER BY created_at DESC', [uid]);
    rows = rows.concat(dn.map((d) => ({
      jenis: 'donasi', label: 'Donasi', name: d.medicine_name, qty: d.qty, date: d.created_at,
      status: d.status, note: d.admin_note, detail: `Kadaluwarsa ${d.expiry_date}`,
      cancelUrl: d.status === 'menunggu' ? `/donasi/${d.id}/batal` : null,
    })));
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  res.render('history', { rows, jenis });
}));

module.exports = router;
