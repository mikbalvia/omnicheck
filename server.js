const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 20128);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM_API_BASE = process.env.UPSTREAM_API_BASE || 'http://127.0.0.1:20127';
const TOPUP_PRICE_IDR = Number(process.env.TOPUP_PRICE_IDR || 20000);
const TOPUP_PRODUCT_PATH = '/api/topup/product';
const TOPUP_CREATE_PATH = '/api/topup/create';
const upstream = new URL(UPSTREAM_API_BASE);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'content-type': 'application/json; charset=utf-8' });
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/v1' || pathname.startsWith('/v1/');
}

function normalizeTopupProductPayload(payload) {
  if (payload && payload.product && typeof payload.product === 'object') {
    payload.product.priceIdr = TOPUP_PRICE_IDR;
  }
  return payload;
}

function shouldRewriteJsonProxyResponse(parsedUrl) {
  return parsedUrl.pathname === TOPUP_PRODUCT_PATH;
}

function shouldRewriteJsonProxyRequest(req, parsedUrl) {
  return req.method === 'POST'
    && parsedUrl.pathname === TOPUP_CREATE_PATH
    && String(req.headers['content-type'] || '').toLowerCase().includes('application/json');
}

function applyTopupPriceToRequestBody(body) {
  const payload = JSON.parse(body || '{}');
  payload.priceIdr = TOPUP_PRICE_IDR;
  return JSON.stringify(payload);
}

function proxyApi(req, res, parsedUrl) {
  const headers = { ...req.headers };
  for (const key of Object.keys(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) delete headers[key];
  }
  const rewriteJsonResponse = shouldRewriteJsonProxyResponse(parsedUrl);
  const rewriteJsonRequest = shouldRewriteJsonProxyRequest(req, parsedUrl);
  if (rewriteJsonResponse) delete headers['accept-encoding'];

  headers.host = upstream.host;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';

  const options = {
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: parsedUrl.pathname + parsedUrl.search,
    headers,
  };

  const client = upstream.protocol === 'https:' ? https : http;
  const proxyReq = client.request(options, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    for (const key of Object.keys(responseHeaders)) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) delete responseHeaders[key];
    }

    if (!rewriteJsonResponse) {
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      proxyRes.pipe(res);
      return;
    }

    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const body = JSON.stringify(normalizeTopupProductPayload(payload));
        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        responseHeaders['content-type'] = 'application/json; charset=utf-8';
        responseHeaders['content-length'] = Buffer.byteLength(body);
        res.writeHead(proxyRes.statusCode || 502, responseHeaders);
        res.end(body);
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 502, { error: 'Bad Gateway', message: 'Gagal memproses produk topup' });
        } else {
          res.destroy(err);
        }
      }
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'Bad Gateway', message: err.message });
    } else {
      res.destroy(err);
    }
  });

  if (!rewriteJsonRequest) {
    req.pipe(proxyReq);
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let body = Buffer.concat(chunks).toString('utf8');
    try {
      body = applyTopupPriceToRequestBody(body);
      proxyReq.setHeader('content-type', 'application/json');
    } catch {
      // Forward the original request body if it is not valid JSON.
    }
    proxyReq.setHeader('content-length', Buffer.byteLength(body));
    proxyReq.end(body);
  });
  req.on('error', (err) => proxyReq.destroy(err));
}

function resolveStaticFile(pathname) {
  let safePath;
  try {
    safePath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (safePath === '/' || safePath === '') safePath = '/index.html';
  if (safePath.endsWith('/')) safePath += 'index.html';
  else if (!path.posix.extname(safePath)) safePath += '/index.html';

  safePath = safePath.replace(/\\/g, '/');
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function serveStatic(req, res, parsedUrl) {
  const filePath = resolveStaticFile(parsedUrl.pathname);
  if (!filePath) return send(res, 400, 'Bad Request');

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      return send(res, 404, 'Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    };
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      headers['cache-control'] = 'public, max-age=86400';
    } else {
      headers['cache-control'] = 'no-cache';
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (parsedUrl.pathname === '/healthz') {
    return sendJson(res, 200, {
      ok: true,
      service: 'omnicheck',
      upstream: UPSTREAM_API_BASE,
      topupPriceIdr: TOPUP_PRICE_IDR,
    });
  }

  if (isApiPath(parsedUrl.pathname)) {
    return proxyApi(req, res, parsedUrl);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { allow: 'GET, HEAD' });
  }

  serveStatic(req, res, parsedUrl);
});

server.on('error', (err) => {
  console.error(`[omnicheck] server error: ${err.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[omnicheck] listening on http://${HOST}:${PORT}`);
  console.log(`[omnicheck] proxying /api and /v1 to ${UPSTREAM_API_BASE}`);
});
