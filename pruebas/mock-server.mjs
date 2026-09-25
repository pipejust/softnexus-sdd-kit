// Servidor falso: registra cada petición (REST, webhook, Matrix) en requests.jsonl y verifica la firma HMAC.
import { createHmac } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import http from 'node:http';

const PORT = Number(process.argv[2] || 4599);
const LOG = process.argv[3] || 'requests.jsonl';
const SECRET = 'webhook-secret-test';
const issues = []; // GitHub falso: los issues creados por el conector "github"

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const entry = { method: req.method, url: req.url, auth: req.headers.authorization || '', idem: req.headers['idempotency-key'] || '' };
    if (req.url.startsWith('/hook')) {
      const expected = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
      entry.signature_ok = req.headers['x-sn-signature'] === expected;
    }
    try { entry.body = JSON.parse(body); } catch { entry.body = body; }
    appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
    // ---- GitHub falso (conector "github"): issues por ítem bajo /gh ----
    const gh = req.url.match(/^\/gh\/repos\/[^/]+\/[^/]+(\/issues(?:\/(\d+))?)?/);
    if (req.url === '/gh-state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(issues));
      return;
    }
    if (gh) {
      const numero = gh[2] ? Number(gh[2]) : null;
      if (req.method === 'GET' && !gh[1]) { // /repos/{repo}: la prueba de conexión
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"full_name":"softnexus/clientes"}');
        return;
      }
      if (req.method === 'GET') { // lista de issues (paginada: la segunda página va vacía)
        const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(page === 1 ? issues : []));
        return;
      }
      if (req.method === 'POST') {
        const nuevo = { number: issues.length + 1, state: 'open', ...entry.body };
        issues.push(nuevo);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nuevo));
        return;
      }
      if (req.method === 'PATCH' && numero) {
        const issue = issues.find((i) => i.number === numero);
        if (issue) Object.assign(issue, entry.body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(issue || {}));
        return;
      }
    }
    if (req.method === 'GET' && req.url.startsWith('/api/tasks/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ALT-77', title: 'Exportar clientes a Excel', type: 'feature', description: 'Como admin quiero exportar…' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(PORT, () => console.log(`mock en ${PORT}`));
