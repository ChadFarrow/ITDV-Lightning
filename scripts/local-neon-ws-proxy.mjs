// Dev and test only: lets @vercel/postgres reach a plain local Postgres.
//
//   node scripts/local-neon-ws-proxy.mjs [listen-port=54330] [postgres-port=54329]
//
// @vercel/postgres runs on Neon's serverless driver, which has two ways to reach a database, and
// this relay stands in for Neon's proxy on both. It binds to 127.0.0.1 only.
//
// - WebSocket (db.connect(), pool queries): the Postgres wire protocol inside a WebSocket. The
//   relay pipes each socket's bytes to the local Postgres and back.
// - HTTP (the `sql` template tag, which @vercel/postgres always sends through `neon()`): a POST of
//   {query, params} to /sql that answers {command, rowCount, rows, fields} with every value as raw
//   text, which the driver then parses by each field's type id. The relay runs the query over its
//   own WebSocket path with the same driver.
//
// lib/helipad-storage.ts points the driver here only when LOCAL_NEON_PROXY is set. See
// scripts/local-db.md.

import http from 'node:http';
import net from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { Client, neonConfig } from '@neondatabase/serverless';

const [listenPort = '54330', pgPort = '54329'] = process.argv.slice(2);

neonConfig.webSocketConstructor = WebSocket;
neonConfig.wsProxy = `127.0.0.1:${listenPort}`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;

const rawText = { getTypeParser: () => value => value };
const errorFields = ['severity', 'code', 'detail', 'hint', 'position', 'internalPosition', 'internalQuery',
  'where', 'schema', 'table', 'column', 'dataType', 'constraint', 'file', 'line', 'routine'];

async function runQuery(connectionString, body) {
  const client = new Client({ connectionString, types: rawText });
  await client.connect();
  try {
    const result = await client.query({ text: body.query, values: body.params || [], rowMode: 'array' });
    return {
      command: result.command,
      rowCount: result.rowCount,
      rows: result.rows,
      fields: result.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/sql')) return reply(res, 404, { message: 'not found' });
  let text = '';
  req.on('data', chunk => (text += chunk));
  req.on('end', async () => {
    try {
      const body = JSON.parse(text);
      if (Array.isArray(body.queries)) return reply(res, 400, { message: 'local relay: batch queries are not supported' });
      reply(res, 200, await runQuery(req.headers['neon-connection-string'], body));
    } catch (error) {
      const out = { message: error instanceof Error ? error.message : String(error) };
      errorFields.forEach(field => {
        if (error && error[field] !== undefined) out[field] = error[field];
      });
      reply(res, 400, out);
    }
  });
});

const sockets = new WebSocketServer({ server });
sockets.on('connection', socket => {
  const tcp = net.connect(Number(pgPort), '127.0.0.1');
  const close = () => {
    socket.close();
    tcp.destroy();
  };
  socket.on('message', data => tcp.write(data));
  tcp.on('data', chunk => socket.send(chunk));
  socket.on('close', close);
  socket.on('error', close);
  tcp.on('close', close);
  tcp.on('error', close);
});

server.listen(Number(listenPort), '127.0.0.1', () => {
  console.log(`local-neon-ws-proxy: ws and http on 127.0.0.1:${listenPort} -> postgres 127.0.0.1:${pgPort}`);
});
