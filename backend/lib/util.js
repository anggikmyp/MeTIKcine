// Tanggal hari ini (YYYY-MM-DD) dalam zona waktu Jakarta
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s));

const flash = (req, type, text) => { req.session.flash = { type, text }; };

// Express 4 tidak menangkap error dari async handler, jadi dibungkus
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Error yang pesannya aman ditampilkan ke pengguna
const fail = (msg, status = 400, code = 'BAD_REQUEST') => {
  const e = new Error(msg);
  e.user = true;
  e.status = status;
  e.code = code;
  throw e;
};
module.exports = { today, addDays, isDate, flash, wrap, fail };
