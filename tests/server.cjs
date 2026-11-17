'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
]);

function reply(request, response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reply(request, response, 405, 'Method Not Allowed\n', { Allow: 'GET, HEAD' });
    return;
  }

  // Match the raw pathname: never decode or normalize untrusted paths.
  // Only fixed filenames below are passed to the filesystem.
  const pathname = (request.url || '').split('?')[0];
  if (pathname === '/favicon.ico') {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }

  const file = files.get(pathname);
  if (!file) {
    reply(request, response, 404, 'Not Found\n');
    return;
  }

  try {
    const body = await readFile(path.join(root, file[0]));
    reply(request, response, 200, body, { 'Content-Type': file[1] });
  } catch {
    reply(request, response, 500, 'Internal Server Error\n');
  }
});

module.exports = server;

if (require.main === module) {
  server.on('error', (error) => {
    console.error(`Static server failed: ${error.code || 'unknown error'}`);
    process.exitCode = 1;
  });

  server.listen(4174, '127.0.0.1', () => {
    console.log('Static server listening at http://127.0.0.1:4174');
  });
}
