require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use('/api/v1', require('./routes/api/auth'));
// route lain ditambahkan di sini nanti, mis.:
// app.use('/api/v1', require('./routes/api/medicines'));

app.use((req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Format JSON tidak valid.' } });
  }
  if (err.user) {
    return res.status(err.status || 400).json({ error: { code: err.code || 'BAD_REQUEST', message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Terjadi kesalahan pada server.' } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API berjalan di http://localhost:${port}`));

