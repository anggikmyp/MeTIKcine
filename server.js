require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');

fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-ganti-di-produksi',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

// Label & warna status dipakai di semua view
const LABEL = {
  menunggu: 'Menunggu Persetujuan', disetujui: 'Disetujui', ditolak: 'Ditolak',
  diserahkan: 'Obat Telah Diserahkan', dikembalikan: 'Dikembalikan',
  dibatalkan: 'Dibatalkan', diterima: 'Diterima',
};
const COLOR = {
  menunggu: 'bg-amber-100 text-amber-800', disetujui: 'bg-sky-100 text-sky-800',
  diterima: 'bg-emerald-100 text-emerald-800', diserahkan: 'bg-emerald-100 text-emerald-800',
  dikembalikan: 'bg-slate-200 text-slate-700', ditolak: 'bg-rose-100 text-rose-800',
  dibatalkan: 'bg-slate-100 text-slate-500',
};
app.locals.statusLabel = (s, jenis) => {
  if (jenis === 'donasi' && s === 'menunggu') return 'Menunggu Verifikasi';
  if (jenis === 'pinjam' && s === 'diserahkan') return 'Sedang Dipinjam';
  return LABEL[s] || s;
};
app.locals.statusClass = (s) =>
  'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' + (COLOR[s] || 'bg-slate-100');
app.locals.today = require('./lib/util').today;

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/student'));

app.use((req, res) => res.status(404).render('error', { message: 'Halaman tidak ditemukan.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Terjadi kesalahan pada server. Coba lagi sebentar lagi.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MatikCine berjalan di http://localhost:${port}`));
