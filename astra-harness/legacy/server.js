const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};
const port = Number(process.env.PORT) || 4173;

function inside(file, base) {
  const rel = path.relative(base, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(root, urlPath);
  if (!inside(file, root)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('Harness Pro http://127.0.0.1:' + port);
});
