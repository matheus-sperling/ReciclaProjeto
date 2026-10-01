const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);
const hashKey = value => createHash('sha256').update(value).digest('hex');
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
async function verifyPassword(password, saved) {
  const [, salt, expected] = (saved || '').split(':');
  if (!salt || !expected) return false;
  const actual = await scrypt(password, salt, 64);
  const bytes = Buffer.from(expected, 'hex');
  return bytes.length === actual.length && timingSafeEqual(bytes, actual);
}
function equalSecret(actual, expected) {
  const a = Buffer.from(actual || ''); const b = Buffer.from(expected || '');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
async function signSession(user, secret) {
  const { SignJWT } = await import('jose');
  return new SignJWT({ email: user.email, version: user.authVersion }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id).setIssuer('recicla').setAudience('recicla-web').setIssuedAt().setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}
async function verifySession(token, secret) {
  const { jwtVerify } = await import('jose');
  return (await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], issuer: 'recicla', audience: 'recicla-web'
  })).payload;
}
module.exports = { hashKey, hashPassword, verifyPassword, equalSecret, signSession, verifySession };
