// Servidor para Docker / uso local: sirve la carpeta public/ y la API en /api.
const http = require('http');
const fs = require('fs');
const path = require('path');
const manejar = require('./lib/app');

const PUBLICO = path.join(__dirname, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const SEGURIDAD = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };

const servidor = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(SEGURIDAD)) res.setHeader(k, v);
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta === '/api' || ruta.startsWith('/api/')) return manejar(req, res);
  if (ruta === '/salud') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  let archivo = path.normalize(path.join(PUBLICO, ruta === '/' ? 'index.html' : ruta));
  if (!archivo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
  fs.stat(archivo, (e, st) => {
    if (e || !st.isFile()) archivo = path.join(PUBLICO, 'index.html');
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(archivo).pipe(res);
  });
});

const PUERTO = Number(process.env.PORT) || 3000;
servidor.listen(PUERTO, () => console.log(`Premios CIP escuchando en http://localhost:${PUERTO}`));
