const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { flash, wrap, fail } = require('../lib/util');

const LOW_STOCK = parseInt(process.env.LOW_STOCK, 10) || 5;
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
});
const uploadImage = (req, res, next) => upload.single('image')(req, res, (err) => {
  if (err) {
    flash(req, 'error', 'Gagal mengunggah gambar (maksimal 2 MB, format JPG, PNG, atau WEBP).');
    return res.redirect('back');
  }
  next();
});
const removeFile = (url) => {
  if (url && url.startsWith('/uploads/')) fs.unlink(path.join(__dirname, '..', 'public', url), () => {});
};
const notFound = (res) => res.status(404).render('error', { message: 'Data tidak ditemukan.' });

router.use(requireRole('admin'));

// Dashboard
router.get('/', wrap(async (req, res) => {
  const [[s]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM db_mtc_transaction WHERE status = 'menunggu') AS menunggu,
            (SELECT COUNT(*) FROM db_mtc_transaction WHERE type = 'pinjam' AND status = 'diserahkan') AS dipinjam,
            (SELECT COUNT(*) FROM db_mtc_donation WHERE status = 'menunggu') AS donasi,
            (SELECT COUNT(*) FROM db_mtc_medicine) AS obat`);
  const [low] = await db.query('SELECT id, name, stock FROM db_mtc_medicine WHERE stock <= ? ORDER BY stock, name', [LOW_STOCK]);
  const [latest] = await db.query(
    `SELECT t.*, u.name AS user_name, u.nim, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_users u ON u.id = t.user_id JOIN db_mtc_medicine m ON m.id = t.medicine_id
      ORDER BY t.updated_at DESC LIMIT 10`);
  const [donations] = await db.query(
    `SELECT d.*, u.name AS user_name FROM db_mtc_donation d JOIN db_mtc_users u ON u.id = d.user_id
      ORDER BY d.updated_at DESC LIMIT 5`);
  res.render('admin/dashboard', { s, low, latest, donations, LOW_STOCK });
}));

// ---------- Kelola obat (CRUD) ----------
const readMed = (b) => ({
  name: (b.name || '').trim(),
  category: (b.category || '').trim() || 'Umum',
  type: b.type === 'pinjam' ? 'pinjam' : 'sekali_pakai',
  description: (b.description || '').trim(),
  usage_info: (b.usage_info || '').trim(),
  stock: parseInt(b.stock, 10),
});
const checkMed = (f) => {
  const e = [];
  if (!f.name) e.push('Nama obat wajib diisi.');
  if (!Number.isInteger(f.stock) || f.stock < 0) e.push('Stok harus berupa angka 0 atau lebih.');
  return e;
};

router.get('/obat', wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  const [meds] = q
    ? await db.query('SELECT * FROM db_mtc_medicine WHERE name LIKE ? OR category LIKE ? ORDER BY name', [`%${q}%`, `%${q}%`])
    : await db.query('SELECT * FROM db_mtc_medicine ORDER BY name');
  res.render('admin/medicines', { meds, q, LOW_STOCK });
}));

router.get('/obat/tambah', (req, res) =>
  res.render('admin/medicine-form', { med: { type: 'sekali_pakai', stock: 0 }, errors: [], isNew: true }));

router.post('/obat', uploadImage, wrap(async (req, res) => {
  const f = readMed(req.body);
  const errors = checkMed(f);
  if (errors.length) {
    if (req.file) removeFile('/uploads/' + req.file.filename);
    return res.status(400).render('admin/medicine-form', { med: f, errors, isNew: true });
  }
  await db.query(
    'INSERT INTO db_mtc_medicine (name, category, type, description, usage_info, image_url, stock) VALUES (?,?,?,?,?,?,?)',
    [f.name, f.category, f.type, f.description, f.usage_info, req.file ? '/uploads/' + req.file.filename : null, f.stock]);
  flash(req, 'success', `Obat "${f.name}" ditambahkan.`);
  res.redirect('/admin/obat');
}));

router.get('/obat/:id/edit', wrap(async (req, res) => {
  const [[med]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ?', [req.params.id]);
  if (!med) return notFound(res);
  res.render('admin/medicine-form', { med, errors: [], isNew: false });
}));

router.post('/obat/:id', uploadImage, wrap(async (req, res) => {
  const [[old]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ?', [req.params.id]);
  if (!old) return notFound(res);
  const f = readMed(req.body);
  const errors = checkMed(f);
  if (errors.length) {
    if (req.file) removeFile('/uploads/' + req.file.filename);
    return res.status(400).render('admin/medicine-form', { med: { ...f, id: old.id, image_url: old.image_url }, errors, isNew: false });
  }
  const img = req.file ? '/uploads/' + req.file.filename : old.image_url;
  await db.query(
    'UPDATE db_mtc_medicine SET name=?, category=?, type=?, description=?, usage_info=?, image_url=?, stock=? WHERE id=?',
    [f.name, f.category, f.type, f.description, f.usage_info, img, f.stock, old.id]);
  if (req.file) removeFile(old.image_url);
  flash(req, 'success', 'Data obat diperbarui.');
  res.redirect('/admin/obat');
}));

router.post('/obat/:id/hapus', wrap(async (req, res) => {
  const [[med]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ?', [req.params.id]);
  if (!med) return notFound(res);
  try {
    await db.query('DELETE FROM db_mtc_medicine WHERE id = ?', [med.id]);
    removeFile(med.image_url);
    flash(req, 'success', `Obat "${med.name}" dihapus.`);
  } catch (e) {
    if (e.code !== 'ER_ROW_IS_REFERENCED_2') throw e;
    flash(req, 'error', `"${med.name}" sudah punya riwayat transaksi, jadi tidak bisa dihapus. Ubah stoknya menjadi 0 sebagai gantinya.`);
  }
  res.redirect('/admin/obat');
}));

// ---------- Status pengajuan ----------
const SECTIONS = {
  pengambilan: "t.type = 'ambil'",
  peminjaman: "t.type = 'pinjam' AND t.status IN ('menunggu','disetujui','ditolak','dibatalkan')",
  pengembalian: "t.type = 'pinjam' AND t.status IN ('diserahkan','dikembalikan')",
};
const TX_STATUS = ['menunggu', 'disetujui', 'ditolak', 'diserahkan', 'dikembalikan', 'dibatalkan'];
const DN_STATUS = ['menunggu', 'diterima', 'ditolak', 'dibatalkan'];

router.get('/status/:jenis(pengambilan|peminjaman|pengembalian)', wrap(async (req, res) => {
  const jenis = req.params.jenis;
  const q = (req.query.q || '').trim();
  const status = TX_STATUS.includes(req.query.status) ? req.query.status : '';
  let where = SECTIONS[jenis];
  const p = [];
  if (status) { where += ' AND t.status = ?'; p.push(status); }
  if (q) { where += ' AND (u.name LIKE ? OR u.nim LIKE ? OR m.name LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const [rows] = await db.query(
    `SELECT t.*, u.name AS user_name, u.nim, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_users u ON u.id = t.user_id JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE ${where}
      ORDER BY (t.status = 'menunggu') DESC, t.return_requested DESC, t.updated_at DESC`, p);
  res.render('admin/transactions', { jenis, rows, q, status, statuses: TX_STATUS });
}));

router.get('/status/donasi', wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  const status = DN_STATUS.includes(req.query.status) ? req.query.status : '';
  let where = '1=1';
  const p = [];
  if (status) { where += ' AND d.status = ?'; p.push(status); }
  if (q) { where += ' AND (u.name LIKE ? OR u.nim LIKE ? OR d.medicine_name LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const [rows] = await db.query(
    `SELECT d.*, u.name AS user_name, u.nim FROM db_mtc_donation d JOIN db_mtc_users u ON u.id = d.user_id
      WHERE ${where} ORDER BY (d.status = 'menunggu') DESC, d.updated_at DESC`, p);
  res.render('admin/donations', { rows, q, status, statuses: DN_STATUS });
}));

router.get('/transaksi/:id', wrap(async (req, res) => {
  const [[t]] = await db.query(
    `SELECT t.*, u.name AS user_name, u.nim, u.phone, m.name AS medicine_name, m.stock AS medicine_stock
       FROM db_mtc_transaction t JOIN db_mtc_users u ON u.id = t.user_id JOIN db_mtc_medicine m ON m.id = t.medicine_id
      WHERE t.id = ?`, [req.params.id]);
  if (!t) return notFound(res);
  res.render('admin/transaction', { t });
}));

// Aksi admin. Stok berubah saat obat diserahkan (berkurang) dan saat barang pinjaman kembali dalam kondisi baik (bertambah).
router.post('/transaksi/:id/:aksi(setujui|tolak|serahkan|kembali)', wrap(async (req, res) => {
  const { id, aksi } = req.params;
  const note = (req.body.admin_note || '').trim().slice(0, 255) || null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM db_mtc_transaction WHERE id = ? FOR UPDATE', [id]);
    if (!t) fail('Pengajuan tidak ditemukan.');
    const [[m]] = await conn.query('SELECT * FROM db_mtc_medicine WHERE id = ? FOR UPDATE', [t.medicine_id]);
    let msg;
    if (aksi === 'setujui') {
      if (t.status !== 'menunggu') fail('Pengajuan ini sudah diproses.');
      if (m.stock < t.qty) fail(`Stok ${m.name} tidak cukup (tersisa ${m.stock}).`);
      await conn.query("UPDATE db_mtc_transaction SET status = 'disetujui', admin_note = ? WHERE id = ?", [note, id]);
      msg = 'Pengajuan disetujui. Mahasiswa bisa mengambil obat di sekretariat.';
    } else if (aksi === 'tolak') {
      if (t.status !== 'menunggu') fail('Pengajuan ini sudah diproses.');
      await conn.query("UPDATE db_mtc_transaction SET status = 'ditolak', admin_note = ? WHERE id = ?", [note, id]);
      msg = 'Pengajuan ditolak.';
    } else if (aksi === 'serahkan') {
      if (t.status !== 'disetujui') fail('Hanya pengajuan berstatus Disetujui yang bisa diserahkan.');
      if (m.stock < t.qty) fail(`Stok ${m.name} tidak cukup (tersisa ${m.stock}).`);
      await conn.query('UPDATE db_mtc_medicine SET stock = stock - ? WHERE id = ?', [t.qty, m.id]);
      await conn.query("UPDATE db_mtc_transaction SET status = 'diserahkan' WHERE id = ?", [id]);
      msg = 'Penyerahan dikonfirmasi dan stok diperbarui.';
    } else {
      if (t.type !== 'pinjam' || t.status !== 'diserahkan') fail('Hanya barang yang sedang dipinjam yang bisa dikembalikan.');
      const cond = req.body.return_condition === 'rusak' ? 'rusak' : 'baik';
      if (cond === 'baik') await conn.query('UPDATE db_mtc_medicine SET stock = stock + ? WHERE id = ?', [t.qty, m.id]);
      await conn.query(
        "UPDATE db_mtc_transaction SET status = 'dikembalikan', return_condition = ?, admin_note = ? WHERE id = ?", [cond, note, id]);
      msg = cond === 'baik' ? 'Pengembalian dikonfirmasi dan stok bertambah.' : 'Pengembalian dicatat. Barang rusak tidak dimasukkan kembali ke stok.';
    }
    await conn.commit();
    flash(req, 'success', msg);
  } catch (e) {
    await conn.rollback();
    if (!e.user) throw e;
    flash(req, 'error', e.message);
  } finally {
    conn.release();
  }
  res.redirect('/admin/transaksi/' + id);
}));

// ---------- Donasi ----------
router.get('/donasi/:id', wrap(async (req, res) => {
  const [[d]] = await db.query(
    'SELECT d.*, u.name AS user_name, u.nim, u.phone FROM db_mtc_donation d JOIN db_mtc_users u ON u.id = d.user_id WHERE d.id = ?',
    [req.params.id]);
  if (!d) return notFound(res);
  const [meds] = await db.query('SELECT id, name, stock FROM db_mtc_medicine ORDER BY name');
  const guess = meds.find((m) => m.name.toLowerCase() === d.medicine_name.toLowerCase());
  res.render('admin/donation', { d, meds, guessId: guess ? guess.id : '' });
}));

router.post('/donasi/:id/terima', wrap(async (req, res) => {
  const id = req.params.id;
  const note = (req.body.admin_note || '').trim().slice(0, 255) || null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[d]] = await conn.query('SELECT * FROM db_mtc_donation WHERE id = ? FOR UPDATE', [id]);
    if (!d) fail('Donasi tidak ditemukan.');
    if (d.status !== 'menunggu') fail('Donasi ini sudah diproses.');
    let medId = req.body.medicine_id;
    if (medId === 'baru' || !medId) {
      const type = req.body.type_baru === 'pinjam' ? 'pinjam' : 'sekali_pakai';
      const [ins] = await conn.query(
        "INSERT INTO db_mtc_medicine (name, category, type, description, stock) VALUES (?, 'Donasi', ?, ?, ?)",
        [d.medicine_name, type, d.condition_desc, d.qty]);
      medId = ins.insertId;
    } else {
      const [r] = await conn.query('UPDATE db_mtc_medicine SET stock = stock + ? WHERE id = ?', [d.qty, medId]);
      if (!r.affectedRows) fail('Obat tujuan tidak ditemukan.');
    }
    await conn.query("UPDATE db_mtc_donation SET status = 'diterima', medicine_id = ?, admin_note = ? WHERE id = ?", [medId, note, id]);
    await conn.commit();
    flash(req, 'success', 'Donasi diterima dan stok obat bertambah.');
  } catch (e) {
    await conn.rollback();
    if (!e.user) throw e;
    flash(req, 'error', e.message);
  } finally {
    conn.release();
  }
  res.redirect('/admin/donasi/' + id);
}));

router.post('/donasi/:id/tolak', wrap(async (req, res) => {
  const note = (req.body.admin_note || '').trim().slice(0, 255) || null;
  const [r] = await db.query("UPDATE db_mtc_donation SET status = 'ditolak', admin_note = ? WHERE id = ? AND status = 'menunggu'", [note, req.params.id]);
  flash(req, r.affectedRows ? 'success' : 'error', r.affectedRows ? 'Donasi ditolak.' : 'Donasi ini sudah diproses.');
  res.redirect('/admin/donasi/' + req.params.id);
}));

// ---------- Data pengguna ----------
router.get('/pengguna', wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  const [rows] = q
    ? await db.query("SELECT * FROM db_mtc_users WHERE role = 'mahasiswa' AND (name LIKE ? OR nim LIKE ? OR email LIKE ?) ORDER BY name", [`%${q}%`, `%${q}%`, `%${q}%`])
    : await db.query("SELECT * FROM db_mtc_users WHERE role = 'mahasiswa' ORDER BY name");
  res.render('admin/users', { rows, q });
}));

module.exports = router;
