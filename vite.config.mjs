import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const SUNSET_SKY_PORT = 57210;

const presetsFileEnv = process.env.SUNSET_SKY_PRESETS_FILE || process.env.ISLAND_PRESETS_FILE || process.env.CLOUDS_PRESETS_FILE;
const cacheDirEnv = process.env.SUNSET_SKY_CACHE_DIR || process.env.ISLAND_CACHE_DIR || process.env.CLOUDS_CACHE_DIR;

const PRESETS_FILE = presetsFileEnv
  ? path.resolve(presetsFileEnv)
  : path.resolve('presets.json');

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return {}; }
}

async function writeJsonAtomic(file, map) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`);
  await fs.rename(tmp, file);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function presetsPlugin() {
  return {
    name: 'sunset-sky-presets-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const isPresetPath = url.pathname === '/__sunset-sky-presets';
        if (!isPresetPath) return next();
        try {
          if (req.method === 'GET') {
            return sendJson(res, 200, { presets: await readJson(PRESETS_FILE) });
          }
          if (req.method === 'POST') {
            const body = await readBody(req);
            const map = await readJson(PRESETS_FILE);
            map[String(body.slot)] = body.preset;
            await writeJsonAtomic(PRESETS_FILE, map);
            return sendJson(res, 200, { ok: true });
          }
          return sendJson(res, 404, { error: 'unknown presets endpoint' });
        } catch (e) {
          return sendJson(res, 500, { error: e.message });
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [presetsPlugin()],
  base: command === 'build' ? './' : '/',
  cacheDir: cacheDirEnv
    ? path.resolve(cacheDirEnv)
    : 'node_modules/.vite-sunset-sky',
  server: { host: '127.0.0.1', port: SUNSET_SKY_PORT, strictPort: true },
  preview: { host: '127.0.0.1', port: SUNSET_SKY_PORT, strictPort: true },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve('index.html'),
      },
    },
  },
}));
