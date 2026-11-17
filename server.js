'use strict';

// 零依赖静态站点服务：只用 node:http / node:fs / node:path / node:net。
// 普通 HTTP 请求返回 public/ 下的静态文件；
// 符合 WS_PATH 的 HTTP Upgrade 请求转发到本机 10000 端口的后端服务。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const PORT = parseInt(process.env.PORT || '8080', 10);
const WS_PATH = process.env.WS_PATH || '/assets/v2/config';
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  serveStatic(req, res);
});

server.on('upgrade', (req, socket, head) => {
  let urlPath;
  try {
    urlPath = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    socket.destroy();
    return;
  }
  if (urlPath !== WS_PATH) {
    socket.destroy();
    return;
  }
  const target = net.connect(BACKEND_PORT, BACKEND_HOST, () => {
    // 把原始 upgrade 请求行和请求头原样写给后端，再双向转发。
    const lines = [req.method + ' ' + req.url + ' HTTP/' + req.httpVersion];
    for (const [name, value] of Object.entries(req.headers)) {
      lines.push(name + ': ' + value);
    }
    target.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('homepage listening on 0.0.0.0:' + PORT);
});
