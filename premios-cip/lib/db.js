// Conexión a PostgreSQL (Neon en Vercel, contenedor "db" en Docker) y creación del esquema.
const { Pool } = require('pg');
const { hashPassword } = require('./auth');
const { CATALOGO_INICIAL, uid } = require('./catalogo');

let pool;
function obtenerPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw Object.assign(new Error('Falta la variable DATABASE_URL'), { status: 500 });
    pool = new Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10, idleTimeoutMillis: 10000 });
  }
  return pool;
}

async function query(texto, params) {
  await asegurarEsquema();
  return obtenerPool().query(texto, params);
}

// Ejecuta fn(cliente) dentro de una transacción.
async function tx(fn) {
  await asegurarEsquema();
  const c = await obtenerPool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    c.release();
  }
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (
  clave text PRIMARY KEY,
  valor text NOT NULL
);
CREATE TABLE IF NOT EXISTS premios (
  id      text PRIMARY KEY,
  orden   bigserial,
  nombre  text NOT NULL,
  puntos  integer NOT NULL CHECK (puntos > 0),
  max     integer NOT NULL DEFAULT 0 CHECK (max >= 0),
  activo  boolean NOT NULL DEFAULT true,
  foto    text,
  foto_v  bigint
);
CREATE TABLE IF NOT EXISTS lote_actual (
  id         text PRIMARY KEY,
  orden      bigserial,
  nombre     text NOT NULL,
  puntos     integer NOT NULL,
  items      jsonb NOT NULL,
  usados     integer NOT NULL,
  restantes  integer NOT NULL,
  fecha      timestamptz NOT NULL DEFAULT now(),
  registrado_por text
);
CREATE TABLE IF NOT EXISTS lotes (
  id            text PRIMARY KEY,
  fecha         timestamptz NOT NULL,
  catalogo      text NOT NULL,
  premios_col   jsonb NOT NULL,
  trabajadores  jsonb NOT NULL,
  cerrado_por   text
);
CREATE INDEX IF NOT EXISTS lotes_fecha_idx ON lotes (fecha DESC);
CREATE TABLE IF NOT EXISTS usuarios (
  id       serial PRIMARY KEY,
  usuario  text UNIQUE NOT NULL,
  nombre   text NOT NULL,
  hash     text NOT NULL,
  creado   timestamptz NOT NULL DEFAULT now()
);
`;

async function sembrarCatalogo(c) {
  await c.query(`INSERT INTO config (clave, valor) VALUES ('anio', $1)
                 ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [CATALOGO_INICIAL.anio]);
  for (const [nombre, puntos, max] of CATALOGO_INICIAL.premios) {
    await c.query('INSERT INTO premios (id, nombre, puntos, max, activo) VALUES ($1,$2,$3,$4,true)',
      [uid(), nombre, puntos, max || 0]);
  }
}

let listo = null;
function asegurarEsquema() {
  if (!listo) {
    listo = (async () => {
      const c = await obtenerPool().connect();
      try {
        await c.query('BEGIN');
        // Candado para que dos instancias no inicialicen a la vez.
        await c.query('SELECT pg_advisory_xact_lock(482917)');
        await c.query(ESQUEMA);
        const ini = await c.query(`INSERT INTO config (clave, valor) VALUES ('inicializado','1')
                                   ON CONFLICT (clave) DO NOTHING RETURNING clave`);
        if (ini.rowCount) await sembrarCatalogo(c);
        const u = await c.query('SELECT count(*)::int AS n FROM usuarios');
        const adminU = (process.env.ADMIN_USUARIO || '').trim().toLowerCase();
        const adminP = process.env.ADMIN_PASSWORD || '';
        if (u.rows[0].n === 0 && adminU && adminP) {
          await c.query('INSERT INTO usuarios (usuario, nombre, hash) VALUES ($1,$2,$3)',
            [adminU, 'Administrador', await hashPassword(adminP)]);
        }
        await c.query('COMMIT');
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch (_) {}
        listo = null;
        throw e;
      } finally {
        c.release();
      }
    })();
  }
  return listo;
}

module.exports = { query, tx, sembrarCatalogo };
