const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../../db');
const { requireLogin, requireRole } = require('../../middleware/auth');
const { wrap, fail } = require('../../lib/util');

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
});

const uploadImage = (req, res, next) => upload.single('image')(req, res, (err) => {
  if (err) return next(fail('Gagal mengunggah gambar (maks 2MB, JPG/PNG/WEBP).', 400, 'UPLOAD_ERROR'));
  next();
});

const removeFile = (url) => {
  if (url && url.startsWith('/uploads/')) fs.unlink(path.join(__dirname, '..', '..', 'public', url), () => {});
};

// GET /api/v1/medicines
router.get('/medicines', requireLogin, wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  const cat = (req.query.category || '').trim();
  const type = ['sekali_pakai', 'pinjam'].includes(req.query.type) ? req.query.type : '';

  let sql = 'SELECT * FROM db_mtc_medicine WHERE 1=1';
  const p = [];
  if (type) { sql += ' AND type = ?'; p.push(type); }
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  if (cat) { sql += ' AND category = ?'; p.push(cat); }

  const [medicines] = await db.query(sql + ' ORDER BY name', p);
  const [cats] = await db.query('SELECT DISTINCT category FROM db_mtc_medicine ORDER BY category');
  res.json({ data: { medicines, categories: cats.map(c => c.category) } });
}));

// GET /api/v1/medicines/:id
router.get('/medicines/:id', requireLogin, wrap(async (req, res) => {
  const [[med]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ?', [req.params.id]);
  if (!med) fail('Obat tidak ditemukan.', 404, 'NOT_FOUND');
  res.json({ data: med });
}));

// POST /api/v1/medicines (Admin)
router.post('/medicines', requireRole('admin'), uploadImage, wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  const category = (req.body.category || '').trim() || 'Umum';
  const type = req.body.type === 'pinjam' ? 'pinjam' : 'sekali_pakai';
  const description = (req.body.description || '').trim();
  const usage_info = (req.body.usage_info || '').trim();
  const stock = parseInt(req.body.stock, 10);

  if (!name) {
    if (req.file) removeFile('/uploads/' + req.file.filename);
    fail('Nama obat wajib diisi.', 400, 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(stock) || stock < 0) {
    if (req.file) removeFile('/uploads/' + req.file.filename);
    fail('Stok harus angka 0 atau lebih.', 400, 'VALIDATION_ERROR');
  }

  const imageUrl = req.file ? '/uploads/' + req.file.filename : null;
  const [ins] = await db.query(
    'INSERT INTO db_mtc_medicine (name, category, type, description, usage_info, image_url, stock) VALUES (?,?,?,?,?,?,?)',
    [name, category, type, description, usage_info, imageUrl, stock]
  );
  res.status(201).json({ data: { id: ins.insertId, message: `Obat "${name}" berhasil ditambahkan.` } });
}));

// PUT /api/v1/medicines/:id (Admin)
router.put('/medicines/:id', requireRole('admin'), uploadImage, wrap(async (req, res) => {
  const [[old]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ?', [req.params.id]);
  if (!old) {
    if (req.file) removeFile('/uploads/' + req.file.filename);
    fail('Obat tidak ditemukan.', 404, 'NOT_FOUND');
  }

  const name = (req.body.name || '').trim();
  const category = (req.body.category || '').trim() || 'Umum';
  const type = req.body.type === 'pinjam' ? 'pinjam' : 'sekali_pakai';
  const description = (req.body.description || '').trim();
  const usage_info = (req.body.usage_info || '').trim();
  const stock = parseInt(req.body.stock, 10);

  if (!name || !Number.isInteger(stock) || stock < 0) {
    if (req.file) removeFile('/uploads/' + req.file.filename);
    fail('Nama wajib diisi dan stok minimal 0.', 400, 'VALIDATION_ERROR');
  }

  const img = req.file ? '/uploads/' + req.file.filename : old.image_url;
  await db.query(
    'UPDATE db_mtc_medicine SET name=?, category=?, type=?, description=?, usage_info=?, image_url=?, stock=? WHERE id=?',
    [name, category, type, description, usage_info, img, stock, old.id]
  );
  if (req.file) removeFile(old.image_url);
  res.json({ data: { message: 'Data obat diperbarui.' } });
}));

// DELETE /api/v1/medicines/:id (Admin)
router.delete('/medicines/:id', requireRole('admin'), wrap(async (req, res) => {
  const [[med]] = await db.query('SELECT * FROM db_mtc_medicine WHERE id = ?', [req.params.id]);
  if (!med) fail('Obat tidak ditemukan.', 404, 'NOT_FOUND');
  try {
    await db.query('DELETE FROM db_mtc_medicine WHERE id = ?', [med.id]);
    removeFile(med.image_url);
    res.json({ data: { message: `Obat "${med.name}" dihapus.` } });
  } catch (e) {
    if (e.code === 'ER_ROW_IS_REFERENCED_2') {
      fail(`"${med.name}" sudah punya riwayat transaksi, ubah stok menjadi 0 sebagai gantinya.`, 400, 'REFERENCED_RECORD');
    }
    throw e;
  }
}));

module.exports = router;
