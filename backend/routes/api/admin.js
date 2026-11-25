const router = require('express').Router();
const db = require('../../db');
const { requireRole } = require('../../middleware/auth');
const { wrap } = require('../../lib/util');

const LOW_STOCK = parseInt(process.env.LOW_STOCK, 10) || 5;

router.use(requireRole('admin'));

// GET /api/v1/admin/dashboard
router.get('/admin/dashboard', wrap(async (req, res) => {
  const [[stats]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM db_mtc_transaction WHERE status = 'menunggu') AS menunggu,
            (SELECT COUNT(*) FROM db_mtc_transaction WHERE type = 'pinjam' AND status = 'diserahkan') AS dipinjam,
            (SELECT COUNT(*) FROM db_mtc_donation WHERE status = 'menunggu') AS donasi,
            (SELECT COUNT(*) FROM db_mtc_medicine) AS obat`
  );
  const [low_stock_medicines] = await db.query(
    'SELECT id, name, stock FROM db_mtc_medicine WHERE stock <= ? ORDER BY stock, name',
    [LOW_STOCK]
  );
  const [latest_transactions] = await db.query(
    `SELECT t.*, u.name AS user_name, u.nim, m.name AS medicine_name FROM db_mtc_transaction t
       JOIN db_mtc_users u ON u.id = t.user_id
       JOIN db_mtc_medicine m ON m.id = t.medicine_id
      ORDER BY t.updated_at DESC LIMIT 10`
  );
  const [latest_donations] = await db.query(
    `SELECT d.*, u.name AS user_name FROM db_mtc_donation d
       JOIN db_mtc_users u ON u.id = d.user_id
      ORDER BY d.updated_at DESC LIMIT 5`
  );

  res.json({
    data: {
      stats,
      low_stock_medicines,
      latest_transactions,
      latest_donations,
    },
  });
}));

// GET /api/v1/admin/users
router.get('/admin/users', wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  const [rows] = q
    ? await db.query(
        "SELECT id, name, email, nim, phone, class_name, created_at FROM db_mtc_users WHERE role = 'mahasiswa' AND (name LIKE ? OR nim LIKE ? OR email LIKE ?) ORDER BY name",
        [`%${q}%`, `%${q}%`, `%${q}%`]
      )
    : await db.query(
        "SELECT id, name, email, nim, phone, class_name, created_at FROM db_mtc_users WHERE role = 'mahasiswa' ORDER BY name"
      );

  res.json({ data: rows });
}));

module.exports = router;
