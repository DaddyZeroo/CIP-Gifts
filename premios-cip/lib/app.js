// API de Premios CIP. Un solo manejador (req, res) que funciona igual en Vercel y en Docker.
const { query, tx, sembrarCatalogo } = require('./db');
const { hashPassword, verificarPassword, cookieSesion, cookieBorrar, sesionDe } = require('./auth');
const { uid } = require('./catalogo');

const LIMITE_CUERPO = 4 * 1024 * 1024; // 4 MB (Vercel admite 4.5 MB)

/* ---------- utilidades ---------- */
function falla(status, mensaje) { return Object.assign(new Error(mensaje), { status }); }

function enviar(res, status, datos, extra = {}) {
  const cuerpo = JSON.stringify(datos ?? {});
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(cuerpo);
}

async function leerCuerpo(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  // En Vercel el cuerpo ya viene interpretado en req.body.
  if (process.env.VERCEL && req.body !== undefined) {
    const b = req.body;
    if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
    if (typeof b === 'string' || Buffer.isBuffer(b)) return b.length ? JSON.parse(b.toString()) : {};
    return {};
  }
  return new Promise((resolve, reject) => {
    let total = 0; const partes = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITE_CUERPO) { reject(falla(413, 'La información enviada es demasiado grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const t = Buffer.concat(partes).toString('utf8');
      if (!t) return resolve({});
      try { resolve(JSON.parse(t)); } catch (_) { reject(falla(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const texto = (v, max = 200) => String(v ?? '').trim().slice(0, max);
function entero(v, min, nombre) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw falla(400, `${nombre} debe ser un número entero mayor o igual a ${min}`);
  return n;
}
function fotoValida(f) {
  return typeof f === 'string' && /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(f) && f.length < 1_500_000;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- lecturas ---------- */
const filaPremio = (p) => ({
  id: p.id, nombre: p.nombre, puntos: p.puntos, max: p.max, activo: p.activo,
  foto: p.foto_v ? `/api/premios/${encodeURIComponent(p.id)}/foto?v=${p.foto_v}` : null,
});
const filaTrabajador = (t) => ({
  id: t.id, nombre: t.nombre, puntos: t.puntos, items: t.items, usados: t.usados, restantes: t.restantes,
  fecha: new Date(t.fecha).toISOString(), registradoPor: t.registrado_por || undefined,
});
const filaLote = (l) => ({
  id: l.id, fecha: new Date(l.fecha).toISOString(), catalogo: l.catalogo,
  trabajadores: l.trabajadores, premiosCol: l.premios_col, cerradoPor: l.cerrado_por || undefined,
});

async function leerAnio(c = { query }) {
  const r = await c.query("SELECT valor FROM config WHERE clave='anio'");
  return r.rows[0]?.valor || 'Premios CIP';
}

async function estado() {
  const [anio, premios, lote, historial] = await Promise.all([
    leerAnio(),
    query('SELECT id, nombre, puntos, max, activo, foto_v FROM premios ORDER BY orden'),
    query('SELECT * FROM lote_actual ORDER BY orden'),
    query('SELECT * FROM lotes ORDER BY fecha DESC'),
  ]);
  return {
    anio,
    premios: premios.rows.map(filaPremio),
    lote: lote.rows.map(filaTrabajador),
    historial: historial.rows.map(filaLote),
  };
}

/* ---------- rutas ---------- */
const rutas = [];
function ruta(metodo, patron, fn, { publica = false } = {}) {
  const claves = [];
  const re = new RegExp('^' + patron.replace(/:(\w+)/g, (_, k) => { claves.push(k); return '([^/]+)'; }) + '/?$');
  rutas.push({ metodo, re, claves, fn, publica });
}

// --- sesión ---
ruta('POST', '/api/login', async ({ req, res, cuerpo }) => {
  const usuario = texto(cuerpo.usuario, 60).toLowerCase();
  const password = String(cuerpo.password || '');
  const r = await query('SELECT id, hash FROM usuarios WHERE usuario=$1', [usuario]);
  const ok = r.rows[0] && (await verificarPassword(password, r.rows[0].hash));
  if (!ok) { await esperar(600); throw falla(401, 'Usuario o contraseña incorrectos'); }
  enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSesion(req, r.rows[0].id) });
}, { publica: true });

ruta('POST', '/api/logout', async ({ req, res }) => {
  enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieBorrar(req) });
}, { publica: true });

ruta('GET', '/api/me', async ({ usuario }) => usuario);

// --- estado completo ---
ruta('GET', '/api/estado', async () => estado());

// --- catálogo ---
ruta('PUT', '/api/config', async ({ cuerpo }) => {
  const anio = texto(cuerpo.anio, 120) || 'Premios CIP';
  await query(`INSERT INTO config (clave, valor) VALUES ('anio',$1) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor`, [anio]);
  return { anio };
});

ruta('POST', '/api/premios', async ({ cuerpo }) => {
  const nombre = texto(cuerpo.nombre);
  if (!nombre) throw falla(400, 'Escribe el nombre del premio');
  const puntos = entero(cuerpo.puntos, 1, 'Puntos');
  const max = cuerpo.max === '' || cuerpo.max == null ? 0 : entero(cuerpo.max, 0, 'Máximo por persona');
  const id = uid();
  await query('INSERT INTO premios (id, nombre, puntos, max, activo) VALUES ($1,$2,$3,$4,true)', [id, nombre, puntos, max]);
  return { id };
});

ruta('PATCH', '/api/premios/:id', async ({ params, cuerpo }) => {
  const cambios = []; const valores = [];
  if ('nombre' in cuerpo) { const n = texto(cuerpo.nombre); if (n) { valores.push(n); cambios.push(`nombre=$${valores.length}`); } }
  if ('puntos' in cuerpo) { valores.push(entero(cuerpo.puntos, 1, 'Puntos')); cambios.push(`puntos=$${valores.length}`); }
  if ('max' in cuerpo) { valores.push(entero(cuerpo.max, 0, 'Máximo por persona')); cambios.push(`max=$${valores.length}`); }
  if ('activo' in cuerpo) { valores.push(!!cuerpo.activo); cambios.push(`activo=$${valores.length}`); }
  if (!cambios.length) return { ok: true };
  valores.push(params.id);
  const r = await query(`UPDATE premios SET ${cambios.join(', ')} WHERE id=$${valores.length}`, valores);
  if (!r.rowCount) throw falla(404, 'El premio ya no existe');
  return { ok: true };
});

ruta('DELETE', '/api/premios/:id', async ({ params }) => {
  await query('DELETE FROM premios WHERE id=$1', [params.id]);
  return { ok: true };
});

ruta('PUT', '/api/premios/:id/foto', async ({ params, cuerpo }) => {
  if (!fotoValida(cuerpo.foto)) throw falla(400, 'La imagen no es válida o es demasiado grande');
  const r = await query('UPDATE premios SET foto=$1, foto_v=$2 WHERE id=$3', [cuerpo.foto, Date.now(), params.id]);
  if (!r.rowCount) throw falla(404, 'El premio ya no existe');
  return { ok: true };
});

ruta('DELETE', '/api/premios/:id/foto', async ({ params }) => {
  await query('UPDATE premios SET foto=NULL, foto_v=NULL WHERE id=$1', [params.id]);
  return { ok: true };
});

ruta('GET', '/api/premios/:id/foto', async ({ params, res }) => {
  const r = await query('SELECT foto FROM premios WHERE id=$1', [params.id]);
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(r.rows[0]?.foto || '');
  if (!m) throw falla(404, 'Sin foto');
  const bin = Buffer.from(m[2], 'base64');
  res.writeHead(200, { 'Content-Type': m[1], 'Content-Length': bin.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.end(bin);
});

// --- lote actual ---
ruta('POST', '/api/lote', async ({ cuerpo, usuario }) => {
  const nombre = texto(cuerpo.nombre);
  if (!nombre) throw falla(400, 'Escribe el nombre del trabajador');
  const puntos = entero(cuerpo.puntos, 0, 'Puntos disponibles');
  const pedidos = Array.isArray(cuerpo.items) ? cuerpo.items : [];
  const ids = pedidos.map((i) => String(i.premioId));
  const r = await query('SELECT id, nombre, puntos, max FROM premios WHERE activo AND id = ANY($1::text[])', [ids]);
  const items = pedidos.map((i) => {
    const p = r.rows.find((x) => x.id === String(i.premioId));
    if (!p) throw falla(409, 'Uno de los premios elegidos ya no está disponible. Recarga la página.');
    const cant = entero(i.cant, 1, 'Cantidad');
    if (p.max && cant > p.max) throw falla(400, `"${p.nombre}": máximo ${p.max} por persona`);
    return { nombre: p.nombre, puntos: p.puntos, cant };
  });
  const usados = items.reduce((s, i) => s + i.puntos * i.cant, 0);
  if (usados <= 0) throw falla(400, 'Elige al menos un premio');
  if (usados > puntos) throw falla(400, 'Los puntos seleccionados superan los disponibles');
  const registro = [nombre, puntos, JSON.stringify(items), usados, puntos - usados, usuario.nombre];
  if (cuerpo.id) {
    const u = await query(`UPDATE lote_actual SET nombre=$1, puntos=$2, items=$3, usados=$4, restantes=$5, registrado_por=$6, fecha=now()
                           WHERE id=$7`, [...registro, String(cuerpo.id)]);
    if (!u.rowCount) throw falla(404, 'Ese trabajador ya no está en el lote (¿se cerró el lote?)');
    return { id: cuerpo.id };
  }
  const id = uid();
  await query(`INSERT INTO lote_actual (nombre, puntos, items, usados, restantes, registrado_por, id)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`, [...registro, id]);
  return { id };
});

ruta('DELETE', '/api/lote/:id', async ({ params }) => {
  await query('DELETE FROM lote_actual WHERE id=$1', [params.id]);
  return { ok: true };
});

ruta('DELETE', '/api/lote', async () => {
  await query('DELETE FROM lote_actual');
  return { ok: true };
});

ruta('POST', '/api/lote/cerrar', async ({ usuario }) => tx(async (c) => {
  const t = await c.query('SELECT * FROM lote_actual ORDER BY orden FOR UPDATE');
  if (!t.rowCount) throw falla(400, 'El lote está vacío');
  const col = await c.query('SELECT nombre, puntos FROM premios WHERE activo ORDER BY orden');
  const lote = {
    id: uid(),
    fecha: new Date().toISOString(),
    catalogo: await leerAnio(c),
    trabajadores: t.rows.map(filaTrabajador),
    premiosCol: col.rows,
    cerradoPor: usuario.nombre,
  };
  await c.query(`INSERT INTO lotes (id, fecha, catalogo, premios_col, trabajadores, cerrado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
    [lote.id, lote.fecha, lote.catalogo, JSON.stringify(lote.premiosCol), JSON.stringify(lote.trabajadores), usuario.nombre]);
  await c.query('DELETE FROM lote_actual WHERE id = ANY($1::text[])', [t.rows.map((x) => x.id)]);
  return lote;
}));

// --- historial ---
ruta('DELETE', '/api/historial/:id', async ({ params }) => {
  await query('DELETE FROM lotes WHERE id=$1', [params.id]);
  return { ok: true };
});

// --- respaldo ---
ruta('GET', '/api/respaldo', async () => {
  const e = await estado();
  const fotos = await query('SELECT id, foto FROM premios WHERE foto IS NOT NULL');
  const mapa = Object.fromEntries(fotos.rows.map((f) => [f.id, f.foto]));
  e.premios = e.premios.map((p) => { const q = { ...p }; if (mapa[p.id]) q.foto = mapa[p.id]; else delete q.foto; return q; });
  e.lote = e.lote.map(({ registradoPor, ...t }) => t);
  e.historial = e.historial.map(({ cerradoPor, ...l }) => l);
  return e;
});

function limpiarItems(items) {
  return (Array.isArray(items) ? items : []).map((i) => ({
    nombre: texto(i.nombre), puntos: Number(i.puntos) || 0, cant: Number(i.cant) || 0,
  }));
}
function limpiarTrabajador(t) {
  return {
    id: texto(t.id, 60) || uid(), nombre: texto(t.nombre), puntos: Number(t.puntos) || 0, items: limpiarItems(t.items),
    usados: Number(t.usados) || 0, restantes: Number(t.restantes) || 0, fecha: t.fecha || new Date().toISOString(),
  };
}

ruta('POST', '/api/respaldo', async ({ cuerpo }) => {
  if (!Array.isArray(cuerpo.premios) || !Array.isArray(cuerpo.historial)) throw falla(400, 'El archivo no es un respaldo válido');
  return tx(async (c) => {
    await c.query('DELETE FROM premios'); await c.query('DELETE FROM lote_actual'); await c.query('DELETE FROM lotes');
    await c.query(`INSERT INTO config (clave, valor) VALUES ('anio',$1) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor`,
      [texto(cuerpo.anio, 120) || 'Premios CIP']);
    const vistos = new Set();
    for (const p of cuerpo.premios) {
      let id = texto(p.id, 60) || uid(); if (vistos.has(id)) id = uid(); vistos.add(id);
      const foto = fotoValida(p.foto) ? p.foto : null;
      await c.query('INSERT INTO premios (id, nombre, puntos, max, activo, foto, foto_v) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, texto(p.nombre) || 'Premio', Math.max(1, parseInt(p.puntos) || 1), Math.max(0, parseInt(p.max) || 0),
          p.activo !== false, foto, foto ? Date.now() : null]);
    }
    for (const t of (Array.isArray(cuerpo.lote) ? cuerpo.lote : []).map(limpiarTrabajador)) {
      await c.query(`INSERT INTO lote_actual (id, nombre, puntos, items, usados, restantes, fecha) VALUES ($1,$2,$3,$4,$5,$6,$7)
                     ON CONFLICT (id) DO NOTHING`,
        [t.id, t.nombre, t.puntos, JSON.stringify(t.items), t.usados, t.restantes, t.fecha]);
    }
    for (const l of cuerpo.historial) {
      await c.query(`INSERT INTO lotes (id, fecha, catalogo, premios_col, trabajadores) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (id) DO NOTHING`,
        [texto(l.id, 60) || uid(), l.fecha || new Date().toISOString(), texto(l.catalogo, 120) || 'Premios CIP',
          JSON.stringify((Array.isArray(l.premiosCol) ? l.premiosCol : []).map((p) => ({ nombre: texto(p.nombre), puntos: Number(p.puntos) || 0 }))),
          JSON.stringify((Array.isArray(l.trabajadores) ? l.trabajadores : []).map(limpiarTrabajador))]);
    }
    return { ok: true };
  });
});

ruta('POST', '/api/borrar-todo', async () => tx(async (c) => {
  await c.query('DELETE FROM premios'); await c.query('DELETE FROM lote_actual'); await c.query('DELETE FROM lotes');
  await sembrarCatalogo(c);
  return { ok: true };
}));

// --- usuarios ---
ruta('GET', '/api/usuarios', async () => {
  const r = await query('SELECT id, usuario, nombre, creado FROM usuarios ORDER BY usuario');
  return r.rows;
});

ruta('POST', '/api/usuarios', async ({ cuerpo }) => {
  const usuario = texto(cuerpo.usuario, 40).toLowerCase();
  const nombre = texto(cuerpo.nombre, 80);
  const password = String(cuerpo.password || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw falla(400, 'El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo');
  if (!nombre) throw falla(400, 'Escribe el nombre de la persona');
  if (password.length < 8) throw falla(400, 'La contraseña debe tener al menos 8 caracteres');
  const r = await query('INSERT INTO usuarios (usuario, nombre, hash) VALUES ($1,$2,$3) ON CONFLICT (usuario) DO NOTHING RETURNING id',
    [usuario, nombre, await hashPassword(password)]);
  if (!r.rowCount) throw falla(409, 'Ese usuario ya existe');
  return { id: r.rows[0].id };
});

ruta('PUT', '/api/usuarios/:id/password', async ({ params, cuerpo }) => {
  const password = String(cuerpo.password || '');
  if (password.length < 8) throw falla(400, 'La contraseña debe tener al menos 8 caracteres');
  const r = await query('UPDATE usuarios SET hash=$1 WHERE id=$2', [await hashPassword(password), Number(params.id) || 0]);
  if (!r.rowCount) throw falla(404, 'Usuario no encontrado');
  return { ok: true };
});

ruta('DELETE', '/api/usuarios/:id', async ({ params, usuario }) => {
  const id = Number(params.id) || 0;
  if (id === usuario.id) throw falla(400, 'No puedes eliminar tu propio usuario');
  const r = await query('DELETE FROM usuarios WHERE id=$1', [id]);
  if (!r.rowCount) throw falla(404, 'Usuario no encontrado');
  return { ok: true };
});

/* ---------- manejador principal ---------- */
async function manejar(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    let ruta = url.pathname;
    // En Vercel, la reescritura manda /api/loquesea -> /api?__ruta=loquesea
    if (url.searchParams.has('__ruta')) ruta = '/api/' + url.searchParams.get('__ruta');
    ruta = ruta.replace(/\/+$/, '') || '/';

    const cands = rutas.filter((r) => r.re.test(ruta));
    if (!cands.length) throw falla(404, 'Ruta no encontrada');
    const r = cands.find((x) => x.metodo === req.method);
    if (!r) throw falla(405, 'Método no permitido');

    const m = r.re.exec(ruta);
    const params = Object.fromEntries(r.claves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

    // Solo aceptamos JSON en escrituras (protege contra envíos de formularios de otros sitios).
    if (!['GET', 'HEAD'].includes(req.method) && !/application\/json/i.test(req.headers['content-type'] || '')) {
      throw falla(415, 'Se esperaba JSON');
    }

    let usuario = null;
    if (!r.publica) {
      const s = sesionDe(req);
      if (!s) throw falla(401, 'Inicia sesión');
      const u = await query('SELECT id, usuario, nombre FROM usuarios WHERE id=$1', [s.u]);
      if (!u.rowCount) throw falla(401, 'Inicia sesión');
      usuario = u.rows[0];
    }

    const cuerpo = await leerCuerpo(req);
    const resultado = await r.fn({ req, res, params, cuerpo, usuario, query: url.searchParams });
    if (!res.headersSent) enviar(res, 200, resultado ?? { ok: true });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) enviar(res, status, { error: status >= 500 && !e.status ? 'Error interno del servidor' : e.message });
  }
}

module.exports = manejar;
