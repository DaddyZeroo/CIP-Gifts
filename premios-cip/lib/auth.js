// Contraseñas (scrypt) y sesiones firmadas en cookie (HMAC). Sin librerías externas.
const crypto = require('crypto');

const COOKIE = 'cip_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas

function hashPassword(pw) {
  return new Promise((res, rej) => {
    const sal = crypto.randomBytes(16);
    crypto.scrypt(pw, sal, 64, (e, k) => (e ? rej(e) : res(`scrypt$${sal.toString('hex')}$${k.toString('hex')}`)));
  });
}

function verificarPassword(pw, guardado) {
  return new Promise((res) => {
    const [alg, salHex, hashHex] = String(guardado || '').split('$');
    if (alg !== 'scrypt' || !salHex || !hashHex) return res(false);
    crypto.scrypt(pw, Buffer.from(salHex, 'hex'), 64, (e, k) => {
      if (e) return res(false);
      const h = Buffer.from(hashHex, 'hex');
      res(h.length === k.length && crypto.timingSafeEqual(h, k));
    });
  });
}

function secreto() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw Object.assign(new Error('SESSION_SECRET debe tener al menos 32 caracteres'), { status: 500 });
  return s;
}

function firmar(datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  const firma = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function leerFirmado(token) {
  const [cuerpo, firma] = String(token || '').split('.');
  if (!cuerpo || !firma) return null;
  const esperada = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  const a = Buffer.from(firma), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    return d.exp > Date.now() ? d : null;
  } catch (_) { return null; }
}

function leerCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function esHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted || !!process.env.VERCEL;
}

function cookieSesion(req, usuarioId) {
  const token = firmar({ u: usuarioId, exp: Date.now() + DURACION_MS });
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACION_MS / 1000}${esHttps(req) ? '; Secure' : ''}`;
}

function cookieBorrar(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${esHttps(req) ? '; Secure' : ''}`;
}

function sesionDe(req) {
  return leerFirmado(leerCookies(req)[COOKIE]);
}

module.exports = { hashPassword, verificarPassword, cookieSesion, cookieBorrar, sesionDe };
