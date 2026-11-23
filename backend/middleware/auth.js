const { flash } = require('../lib/util');

exports.requireLogin = (req, res, next) => {
  if (!req.session.user) {
    flash(req, 'error', 'Silakan masuk terlebih dahulu.');
    return res.redirect('/login');
  }
  next();
};

exports.requireRole = (role) => (req, res, next) => {
  const u = req.session.user;
  if (!u) {
    flash(req, 'error', 'Silakan masuk terlebih dahulu.');
    return res.redirect('/login');
  }
  if (u.role !== role) return res.redirect(u.role === 'admin' ? '/admin' : '/');
  next();
};
