# MatikCine

Website peminjaman, pengambilan, dan donasi obat P3K untuk mahasiswa TIK PNJ.
Stack: Node.js + Express, EJS, Tailwind CSS (CDN), MySQL 8.

## Cara menjalankan

1. Pasang Node.js 18+ dan MySQL 8.
2. Buat database dan tabel:  `mysql -u root -p < schema.sql`
3. Salin konfigurasi:  `cp .env.example .env`  lalu isi `DB_PASSWORD` dan `SESSION_SECRET`.
4. Pasang dependensi:  `npm install`
5. Buat akun admin:  `npm run seed:admin -- "Admin TIK" admin@pnj.ac.id - KataSandi123`
6. Jalankan:  `npm start`  lalu buka http://localhost:3000

Mahasiswa mendaftar sendiri lewat halaman Daftar (email harus @mhsw.pnj.ac.id, atur di `.env`).
