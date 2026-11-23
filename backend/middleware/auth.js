const jwt = require('jsonwebtoken');
const { fail } = require('../lib/util');

exports.requireLogin = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) fail('Silakan masuk terlebih dahulu.', 401, 'UNAUTHORIZED');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    fail('Sesi habis, silakan masuk lagi.', 401, 'UNAUTHORIZED');
  }
  next();
};

exports.requireRole = (role) => [
  exports.requireLogin,
  (req, res, next) => {
    if (req.user.role !== role) fail('Anda tidak punya akses.', 403, 'FORBIDDEN');
    next();
  },
];