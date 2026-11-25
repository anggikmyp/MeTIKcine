CREATE DATABASE IF NOT EXISTS matikcine CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE matikcine;

CREATE TABLE IF NOT EXISTS db_mtc_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  nim VARCHAR(20) UNIQUE,
  phone VARCHAR(20),
  class_name VARCHAR(30),
  job_title VARCHAR(60),
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('mahasiswa','admin') NOT NULL DEFAULT 'mahasiswa',
  failed_attempts TINYINT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS db_mtc_medicine (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'Umum',
  type ENUM('sekali_pakai','pinjam') NOT NULL DEFAULT 'sekali_pakai',
  description TEXT,
  usage_info TEXT,
  image_url VARCHAR(255),
  stock INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS db_mtc_transaction (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  medicine_id INT NOT NULL,
  type ENUM('ambil','pinjam') NOT NULL,
  qty INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  pickup_date DATE NOT NULL,
  due_date DATE NULL,
  status ENUM('menunggu','disetujui','ditolak','diserahkan','dikembalikan','dibatalkan') NOT NULL DEFAULT 'menunggu',
  return_requested TINYINT(1) NOT NULL DEFAULT 0,
  return_condition ENUM('baik','rusak') NULL,
  admin_note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES db_mtc_users(id),
  FOREIGN KEY (medicine_id) REFERENCES db_mtc_medicine(id)
);

CREATE TABLE IF NOT EXISTS db_mtc_donation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  medicine_id INT NULL,
  medicine_name VARCHAR(120) NOT NULL,
  qty INT NOT NULL,
  expiry_date DATE NOT NULL,
  condition_type ENUM('baru','sisa') NOT NULL DEFAULT 'baru',
  condition_desc VARCHAR(255) NOT NULL,
  status ENUM('menunggu','diterima','ditolak','dibatalkan') NOT NULL DEFAULT 'menunggu',
  admin_note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES db_mtc_users(id),
  FOREIGN KEY (medicine_id) REFERENCES db_mtc_medicine(id) ON DELETE SET NULL
);

-- Data contoh (daftar final masih TBD di SRS, silakan ubah lewat menu Kelola Obat)
INSERT INTO db_mtc_medicine (name, category, type, description, usage_info, stock) VALUES
('Panadol', 'Pereda nyeri', 'sekali_pakai', 'Paracetamol untuk sakit kepala dan demam ringan.', 'Sesuai petunjuk di kemasan. Jangan melebihi dosis harian.', 20),
('Promag', 'Pencernaan', 'sekali_pakai', 'Obat sakit maag dan perut kembung.', 'Dikunyah sesuai petunjuk di kemasan.', 15),
('Pembalut', 'Perlengkapan', 'sekali_pakai', 'Pembalut sekali pakai.', 'Sekali pakai.', 25),
('Plester luka', 'P3K', 'sekali_pakai', 'Plester untuk luka ringan.', 'Bersihkan luka sebelum menempel.', 30),
('Betadine', 'P3K', 'pinjam', 'Antiseptik untuk luka ringan.', 'Teteskan secukupnya pada luka yang sudah dibersihkan.', 5),
('Minyak kayu putih', 'Pereda nyeri', 'pinjam', 'Untuk menghangatkan badan dan meredakan perut kembung.', 'Oleskan tipis, hindari mata dan luka terbuka.', 4),
('Termometer', 'Perlengkapan', 'pinjam', 'Termometer digital.', 'Bersihkan dengan alkohol setelah dipakai.', 2);
