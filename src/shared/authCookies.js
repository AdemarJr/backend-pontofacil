const REFRESH_COOKIE = 'pf_refresh';

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function cookieOptions(maxAgeMs) {
  const crossSite = process.env.REFRESH_COOKIE_SAME_SITE === 'lax' ? 'lax' : 'none';
  return {
    httpOnly: true,
    secure: isProduction() || crossSite === 'none',
    sameSite: isProduction() ? crossSite : 'lax',
    path: '/api/auth',
    maxAge: maxAgeMs,
  };
}

function refreshMaxAgeMs() {
  const raw = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const m = /^(\d+)([dhms])$/.exec(String(raw).trim());
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return n * 1000;
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(refreshMaxAgeMs()));
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProduction() || process.env.REFRESH_COOKIE_SAME_SITE !== 'lax',
    sameSite: isProduction()
      ? (process.env.REFRESH_COOKIE_SAME_SITE === 'lax' ? 'lax' : 'none')
      : 'lax',
    path: '/api/auth',
  });
}

function readRefreshToken(req) {
  if (req.cookies && req.cookies[REFRESH_COOKIE]) {
    return req.cookies[REFRESH_COOKIE];
  }
  return req.body?.refreshToken || null;
}

module.exports = {
  REFRESH_COOKIE,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshToken,
};
