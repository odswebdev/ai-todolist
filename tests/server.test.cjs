'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const server = require('./server.cjs');

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('static server exposes only the allowed local assets', async t => {
  assert.equal(server.listening, false, 'requiring the module must not start a listener');
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const { port } = server.address();
    const assets = [
      ['/', 'index.html', 'text/html; charset=utf-8'],
      ['/index.html', 'index.html', 'text/html; charset=utf-8'],
      ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
      ['/script.js', 'script.js', 'text/javascript; charset=utf-8'],
    ];

    await t.test('GET and HEAD provide correct bytes, MIME types and headers', async () => {
      for (const [url, filename, mime] of assets) {
        const expected = await readFile(path.resolve(__dirname, '..', filename));
        const get = await request(port, url);
        assert.equal(get.status, 200, url);
        assert.deepEqual(get.body, expected, url);
        assert.equal(get.headers['content-type'], mime, url);
        assert.equal(get.headers['content-length'], String(expected.length), url);
        assert.equal(get.headers['x-content-type-options'], 'nosniff', url);
        assert.equal(get.headers['cache-control'], 'no-store', url);
        const head = await request(port, url, 'HEAD');
        assert.equal(head.status, 200, url);
        assert.equal(head.body.length, 0, url);
        assert.equal(head.headers['content-type'], mime, url);
        assert.equal(head.headers['content-length'], get.headers['content-length'], url);
      }
    });

    await t.test('query strings do not affect allowlisted paths', async () => {
      for (const [url] of assets) {
        const plain = await request(port, url);
        const queried = await request(port, `${url}?v=1&file=../../README.md`);
        assert.equal(queried.status, 200, url);
        assert.deepEqual(queried.body, plain.body, url);
      }
    });

    await t.test('unknown paths and traversal variants cannot expose other files', async () => {
      for (const url of [
        '/README.md', '/package.json', '/tests/server.cjs', '/unknown',
        '/../script.js', '/tests/../script.js', '/%2e%2e/script.js',
        '/%2e%2e%2fscript.js', '/%73cript.js', '//script.js', '/script.js/extra',
      ]) {
        const response = await request(port, url);
        assert.equal(response.status, 404, url);
        assert.equal(response.body.toString(), 'Not Found\n', url);
      }
      const head = await request(port, '/README.md', 'HEAD');
      assert.equal(head.status, 404);
      assert.equal(head.body.length, 0);
    });

    await t.test('POST and other unsupported methods return 405 with Allow', async () => {
      for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const response = await request(port, '/', method);
        assert.equal(response.status, 405, method);
        assert.equal(response.headers.allow, 'GET, HEAD', method);
      }
      assert.equal((await request(port, '/favicon.ico', 'POST')).status, 405);
    });

    await t.test('favicon GET and HEAD return an empty 204 response', async () => {
      for (const method of ['GET', 'HEAD']) {
        const response = await request(port, '/favicon.ico?version=1', method);
        assert.equal(response.status, 204, method);
        assert.equal(response.body.length, 0, method);
      }
    });
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});
