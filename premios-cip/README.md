# Premios CIP — versión web

Canje de puntos por premios para trabajadores, ahora como aplicación web con base de datos PostgreSQL, inicio de sesión y varios usuarios.

- **Vercel** (en internet): la app corre en Vercel y la base de datos vive en **Neon** (PostgreSQL en la nube, plan gratuito).
- **Docker** (en una PC o servidor de la empresa): `docker compose up` levanta la app y su propia base PostgreSQL.

El funcionamiento es el mismo que la versión de un solo archivo HTML: canje con fotos, lote actual, cerrar lote con Excel de 3 hojas (el Excel se sigue generando en el navegador, sin librerías), historial y respaldo .json. Lo nuevo: los datos se guardan en la base de datos, se comparten entre usuarios, y hay pestaña **Usuarios**.

---

## 1. Subir el código a GitHub

1. Crea una cuenta en <https://github.com> si no tienes.
2. Crea un repositorio **privado** llamado `premios-cip`.
3. En la página del repositorio elige **"uploading an existing file"** y arrastra todo el contenido de esta carpeta (no subas el archivo `.env`). Pulsa **Commit changes**.

## 2. Crear la base de datos en Neon

1. Entra a <https://neon.tech> e inicia sesión con tu cuenta de GitHub.
2. **Create project** → nombre `premios-cip`, región **AWS US East (Ohio)** o la más cercana.
3. En **Connect** copia la cadena de conexión con **Connection pooling** activado. Se ve así:
   `postgresql://usuario:clave@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`

(También puedes crearla desde Vercel: *Storage → Create Database → Neon*. En ese caso Vercel pone `DATABASE_URL` por ti.)

## 3. Desplegar en Vercel

1. Entra a <https://vercel.com> con tu cuenta de GitHub → **Add New… → Project** → importa `premios-cip`.
2. **Framework Preset:** `Other`. No cambies los comandos de build.
3. En **Environment Variables** agrega:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la cadena de Neon del paso 2 |
| `SESSION_SECRET` | texto aleatorio de 64 caracteres (ver abajo) |
| `ADMIN_USUARIO` | `admin` (o el que quieras) |
| `ADMIN_PASSWORD` | la contraseña del primer administrador |

Para generar `SESSION_SECRET` puedes usar <https://generate-secret.vercel.app/32> o, si tienes Node:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

4. Pulsa **Deploy**. Al terminar, abre la URL (`https://premios-cip-xxxx.vercel.app`) e inicia sesión con `ADMIN_USUARIO` / `ADMIN_PASSWORD`.
5. La primera vez la app crea las tablas y carga el catálogo CIP 2026 + Hilti automáticamente.

> Después de entrar, crea un usuario para cada persona en la pestaña **Usuarios**. `ADMIN_PASSWORD` solo se usa para crear el primer usuario; cambiarla después en Vercel no cambia la contraseña. Para cambiarla usa **Usuarios → Cambiar contraseña**.

## 4. Pasar los datos de la versión anterior

1. En el HTML anterior: **Respaldo → Exportar respaldo (.json)**.
2. En la app web: **Respaldo → Importar respaldo** y elige ese archivo. Se pasan catálogo, fotos, lote actual e historial.

Límite: el archivo debe pesar menos de 4 MB (límite de Vercel).

---

## Correr con Docker (PC o servidor interno)

Requisitos: Docker Desktop (Windows/Mac) o Docker Engine (Linux).

```bash
cp .env.example .env      # en Windows: copy .env.example .env
# edita .env: pon DB_PASSWORD, SESSION_SECRET y ADMIN_PASSWORD
docker compose up -d --build
```

Abre <http://localhost:3000>. Desde otras PCs de la red: `http://IP-DE-ESA-PC:3000`.

- Ver logs: `docker compose logs -f app`
- Detener: `docker compose down` (los datos se conservan en el volumen `datos`)
- Borrar también los datos: `docker compose down -v`

Si quieres que el contenedor use la base de Neon en vez de la local, corre solo la imagen de la app:

```bash
docker build -t premios-cip .
docker run -p 3000:3000 -e DATABASE_URL="..." -e SESSION_SECRET="..." -e ADMIN_USUARIO=admin -e ADMIN_PASSWORD="..." premios-cip
```

---

## Estructura

```
api/index.js        función de Vercel (todas las rutas /api/*)
lib/app.js          API: canje, premios, fotos, lotes, historial, respaldo, usuarios
lib/db.js           conexión a PostgreSQL y creación automática de tablas
lib/auth.js         contraseñas (scrypt) y sesión en cookie firmada
lib/catalogo.js     catálogo inicial CIP 2026 + Hilti
public/index.html   interfaz (mismo diseño y generador de Excel de la versión anterior)
servidor.js         servidor para Docker / local
Dockerfile, docker-compose.yml, vercel.json
```

Tablas: `premios`, `lote_actual`, `lotes` (historial), `usuarios`, `config`.

## Seguridad

- Nadie ve datos sin iniciar sesión. La sesión dura 12 horas.
- Contraseñas guardadas con hash (scrypt), nunca en texto.
- Cookie `HttpOnly`, `SameSite=Lax` y `Secure` en HTTPS.
- El servidor vuelve a validar cada canje: premios activos, máximo por persona y que no se excedan los puntos.
- Haz un respaldo .json de vez en cuando (Neon también guarda historial de la base de datos).
