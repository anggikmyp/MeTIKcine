const mysql = require('mysql2/promise');

module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'matikcine',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // DATE/DATETIME dikembalikan sebagai string, aman dari masalah timezone
});
