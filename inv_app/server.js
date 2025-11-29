const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'inventory.json');
const DEFAULT_STATE = {
  alcohols: [
    { name: 'Vodka', quantity: 700 },
    { name: 'Gin', quantity: 700 },
    { name: 'Tequila', quantity: 700 },
    { name: 'Whisky', quantity: 700 },
    { name: 'Beileys', quantity: 700 },
    { name: 'Blue Curacao', quantity: 700 },
    { name: 'Aperol', quantity: 700 },
  ],
  shishas: [],
};
const SERVER_PORT = process.env.PORT || 4000;
const AUTH_PASSWORD = loadPassword();

function loadPassword() {
  const explicit = process.env.APP_PASSWORD || process.env.PASSWORD;
  if (explicit) {
    return explicit;
  }

  const envPath = path.join(__dirname, '..', '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      const value = rest.join('=').trim();
      if (key.trim() === 'APP_PASSWORD' || key.trim() === 'PASSWORD') {
        return value;
      }
    }
  } catch (err) {
    // No .env found; fall through to default.
  }

  console.warn('APP_PASSWORD not set; using default fallback password.');
  return 'makepussygreatagain';
}

async function ensureDataFile() {
  try {
    await fsp.access(DATA_PATH);
  } catch {
    await fsp.mkdir(path.dirname(DATA_PATH), { recursive: true });
    await fsp.writeFile(DATA_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
  }
}

async function readState() {
  await ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read inventory file, resetting to defaults', err);
    await fsp.writeFile(DATA_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

async function saveState(state) {
  await fsp.writeFile(DATA_PATH, JSON.stringify(state, null, 2));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Password');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  const provided = req.headers['x-password'];
  return Boolean(provided && provided === AUTH_PASSWORD);
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function findItem(list, name) {
  const target = normalizeName(name).toLowerCase();
  return list.find((item) => item.name.toLowerCase() === target);
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleLogin(req, res) {
  try {
    const body = await parseBody(req);
    const provided = body.password || '';
    if (provided !== AUTH_PASSWORD) {
      return sendJson(res, 401, { message: 'Invalid password' });
    }
    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 400, { message: 'Invalid request body' });
  }
}

async function handleGetState(res) {
  const state = await readState();
  return sendJson(res, 200, state);
}

async function handleAlcoholConsume(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const amount = Number(body.amount || 40);
    if (!name || Number.isNaN(amount) || amount <= 0) {
      return sendJson(res, 400, { message: 'Name and positive amount are required' });
    }

    const state = await readState();
    const item = findItem(state.alcohols, name);
    if (!item) {
      return sendJson(res, 404, { message: 'Alcohol not found' });
    }

    item.quantity = Math.max(0, item.quantity - amount);
    await saveState(state);
    return sendJson(res, 200, { alcohols: state.alcohols });
  } catch (err) {
    console.error('Error consuming alcohol', err);
    return sendJson(res, 500, { message: 'Failed to update alcohol' });
  }
}

async function handleAlcoholAdd(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const quantity = Number(body.quantity || 700);
    if (!name || Number.isNaN(quantity) || quantity <= 0) {
      return sendJson(res, 400, { message: 'Name and positive quantity are required' });
    }

    const state = await readState();
    const existing = findItem(state.alcohols, name);
    if (existing) {
      existing.quantity = quantity;
    } else {
      state.alcohols.push({ name, quantity });
    }
    await saveState(state);
    return sendJson(res, 200, { alcohols: state.alcohols });
  } catch (err) {
    console.error('Error adding alcohol', err);
    return sendJson(res, 500, { message: 'Failed to add alcohol' });
  }
}

async function handleAlcoholDelete(req, res, nameParam) {
  const name = normalizeName(nameParam);
  if (!name) {
    return sendJson(res, 400, { message: 'Name is required' });
  }
  const state = await readState();
  const initialLength = state.alcohols.length;
  state.alcohols = state.alcohols.filter(
    (item) => item.name.toLowerCase() !== name.toLowerCase()
  );
  if (state.alcohols.length === initialLength) {
    return sendJson(res, 404, { message: 'Alcohol not found' });
  }
  await saveState(state);
  return sendJson(res, 200, { alcohols: state.alcohols });
}

async function handleShishaAdd(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const quantity = Number(body.quantity || 10);
    if (!name || Number.isNaN(quantity) || quantity < 0) {
      return sendJson(res, 400, { message: 'Name and non-negative quantity are required' });
    }

    const state = await readState();
    const existing = findItem(state.shishas, name);
    if (existing) {
      existing.quantity = quantity;
    } else {
      state.shishas.push({ name, quantity });
    }
    await saveState(state);
    return sendJson(res, 200, { shishas: state.shishas });
  } catch (err) {
    console.error('Error adding shisha flavour', err);
    return sendJson(res, 500, { message: 'Failed to add shisha flavour' });
  }
}

async function handleShishaAdjust(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const delta = Number(body.delta || -1);
    if (!name || Number.isNaN(delta) || delta === 0) {
      return sendJson(res, 400, { message: 'Name and non-zero delta are required' });
    }
    const state = await readState();
    const item = findItem(state.shishas, name);
    if (!item) {
      return sendJson(res, 404, { message: 'Shisha flavour not found' });
    }
    item.quantity = Math.max(0, item.quantity + delta);
    await saveState(state);
    return sendJson(res, 200, { shishas: state.shishas });
  } catch (err) {
    console.error('Error adjusting shisha flavour', err);
    return sendJson(res, 500, { message: 'Failed to adjust shisha flavour' });
  }
}

async function handleShishaDelete(req, res, nameParam) {
  const name = normalizeName(nameParam);
  if (!name) {
    return sendJson(res, 400, { message: 'Name is required' });
  }
  const state = await readState();
  const initialLength = state.shishas.length;
  state.shishas = state.shishas.filter(
    (item) => item.name.toLowerCase() !== name.toLowerCase()
  );
  if (state.shishas.length === initialLength) {
    return sendJson(res, 404, { message: 'Shisha flavour not found' });
  }
  await saveState(state);
  return sendJson(res, 200, { shishas: state.shishas });
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/login' && req.method === 'POST') {
    return handleLogin(req, res);
  }

  if (url.pathname.startsWith('/api/') && !isAuthorized(req)) {
    return sendJson(res, 401, { message: 'Unauthorized' });
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    return handleGetState(res);
  }

  if (url.pathname === '/api/alcohols/consume' && req.method === 'POST') {
    return handleAlcoholConsume(req, res);
  }

  if (url.pathname === '/api/alcohols' && req.method === 'POST') {
    return handleAlcoholAdd(req, res);
  }

  if (url.pathname.startsWith('/api/alcohols/') && req.method === 'DELETE') {
    const [, , , rawName] = url.pathname.split('/');
    const decoded = decodeURIComponent(rawName || '');
    return handleAlcoholDelete(req, res, decoded);
  }

  if (url.pathname === '/api/shishas' && req.method === 'POST') {
    return handleShishaAdd(req, res);
  }

  if (url.pathname === '/api/shishas/adjust' && req.method === 'POST') {
    return handleShishaAdjust(req, res);
  }

  if (url.pathname.startsWith('/api/shishas/') && req.method === 'DELETE') {
    const [, , , rawName] = url.pathname.split('/');
    const decoded = decodeURIComponent(rawName || '');
    return handleShishaDelete(req, res, decoded);
  }

  res.writeHead(404);
  return res.end();
});

server.listen(SERVER_PORT, () => {
  console.log(`Inventory API running on port ${SERVER_PORT}`);
});
