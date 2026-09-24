// Minimal static file server for local development.
// No npm dependencies, no build step: run `node server.js` and open the URL it prints.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.sog': 'application/zip',
};

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${filePath}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    // Never cache small source files so edits always show up on reload.
    const noCache = /\.(html|js|json)$/i.test(filePath);
    const cacheHeader = { 'Cache-Control': noCache ? 'no-store' : 'public, max-age=3600' };

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      ...cacheHeader,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(ROOT_DIR, reqPath));

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  serveFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log(`Serving from: ${ROOT_DIR}`);
  if (!fs.existsSync(path.join(ROOT_DIR, 'index.html'))) {
    console.warn('WARNING: index.html not found.');
  }
  if (!fs.existsSync(path.join(ROOT_DIR, 'models', 'Model.sog'))) {
    console.warn('WARNING: models/Model.sog not found.');
  }
  if (!fs.existsSync(path.join(ROOT_DIR, 'camera_animation.json'))) {
    console.warn('WARNING: camera_animation.json not found.');
  }
});
