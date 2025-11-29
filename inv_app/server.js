const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data', 'inventory.json');
const DEFAULT_VOLUME = 700;
const DEFAULT_SHISHA_PACK = 1000; // grams per tin/pack
const DEFAULT_SHISHA_SERVE = 30; // grams per bowl
const DEFAULT_STATE = {
  alcohols: [
    { name: 'Vodka', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
    { name: 'Gin', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
    { name: 'Tequila', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
    { name: 'Whisky', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
    { name: 'Beileys', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
    { name: 'Blue Curacao', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
    { name: 'Aperol', quantity: DEFAULT_VOLUME, originalQuantity: DEFAULT_VOLUME },
  ],
  shishas: [],
  misc: [],
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

function normalizeState(state) {
  if (!state.alcohols) state.alcohols = [];
  if (!state.shishas) state.shishas = [];
  if (!state.misc) state.misc = [];
  state.alcohols = state.alcohols.map((item) => {
    const quantity = Number(item.quantity || DEFAULT_VOLUME);
    const originalQuantity = Number(item.originalQuantity || item.quantity || DEFAULT_VOLUME);
    return {
      name: item.name,
      quantity: quantity,
      originalQuantity: originalQuantity > 0 ? originalQuantity : DEFAULT_VOLUME,
    };
  });
  state.shishas = state.shishas.map((item) => {
    const packSize = Number(item.packSize || DEFAULT_SHISHA_PACK);
    const gramsPerServe = Number(item.gramsPerServe || DEFAULT_SHISHA_SERVE);
    const rawRemaining =
      item.gramsRemaining !== undefined
        ? Number(item.gramsRemaining)
        : item.quantity !== undefined
        ? Number(item.quantity) * gramsPerServe
        : packSize;
    const gramsRemaining = Number.isNaN(rawRemaining) ? packSize : Math.max(0, rawRemaining);
    return {
      name: item.name,
      packSize: packSize > 0 ? packSize : DEFAULT_SHISHA_PACK,
      gramsPerServe: gramsPerServe > 0 ? gramsPerServe : DEFAULT_SHISHA_SERVE,
      gramsRemaining,
    };
  });
  state.misc = state.misc.map((item) => {
    const qty = Number(item.quantity || 0);
    return {
      name: item.name,
      quantity: Number.isNaN(qty) || qty < 0 ? 0 : qty,
    };
  });
  return state;
}

async function readState() {
  await ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err) {
    console.error('Failed to read inventory file, resetting to defaults', err);
    await fsp.writeFile(DATA_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
    return normalizeState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
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
    const quantity = Number(body.quantity || DEFAULT_VOLUME);
    if (!name || Number.isNaN(quantity) || quantity <= 0) {
      return sendJson(res, 400, { message: 'Name and positive quantity are required' });
    }

    const state = await readState();
    const existing = findItem(state.alcohols, name);
    if (existing) {
      existing.quantity = quantity;
      existing.originalQuantity = quantity;
    } else {
      state.alcohols.push({ name, quantity, originalQuantity: quantity });
    }
    await saveState(state);
    return sendJson(res, 200, { alcohols: state.alcohols });
  } catch (err) {
    console.error('Error adding alcohol', err);
    return sendJson(res, 500, { message: 'Failed to add alcohol' });
  }
}

async function handleAlcoholAddBottle(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const bottleSize = body.bottleSize ? Number(body.bottleSize) : null;

    if (!name) {
      return sendJson(res, 400, { message: 'Name is required' });
    }
    if (bottleSize !== null && (Number.isNaN(bottleSize) || bottleSize <= 0)) {
      return sendJson(res, 400, { message: 'Bottle size must be positive when provided' });
    }

    const state = await readState();
    const item = findItem(state.alcohols, name);
    if (!item) {
      const size = bottleSize || DEFAULT_VOLUME;
      state.alcohols.push({
        name,
        quantity: size,
        originalQuantity: size,
      });
    } else {
      const size = bottleSize || item.originalQuantity || DEFAULT_VOLUME;
      item.quantity = Math.max(0, item.quantity) + size;
      if (bottleSize) {
        item.originalQuantity = size;
      }
    }
    await saveState(state);
    return sendJson(res, 200, { alcohols: state.alcohols });
  } catch (err) {
    console.error('Error adding bottle', err);
    return sendJson(res, 500, { message: 'Failed to add bottle' });
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

async function handleAlcoholRefill(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    if (!name) {
      return sendJson(res, 400, { message: 'Name is required' });
    }
    const state = await readState();
    const item = findItem(state.alcohols, name);
    if (!item) {
      return sendJson(res, 404, { message: 'Alcohol not found' });
    }
    const refillTo = item.originalQuantity || DEFAULT_VOLUME;
    item.quantity = refillTo;
    await saveState(state);
    return sendJson(res, 200, { alcohols: state.alcohols });
  } catch (err) {
    console.error('Error refilling alcohol', err);
    return sendJson(res, 500, { message: 'Failed to refill alcohol' });
  }
}

async function handleShishaAdd(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const packSize = Number(body.packSize || DEFAULT_SHISHA_PACK);
    const gramsPerServe = Number(body.gramsPerServe || DEFAULT_SHISHA_SERVE);
    const hasCurrent = body.currentGrams !== undefined && body.currentGrams !== null && body.currentGrams !== '';
    const currentGrams = hasCurrent ? Number(body.currentGrams) : null;

    if (!name) {
      return sendJson(res, 400, { message: 'Name is required' });
    }
    if (Number.isNaN(packSize) || packSize <= 0) {
      return sendJson(res, 400, { message: 'Pack size must be a positive number' });
    }
    if (Number.isNaN(gramsPerServe) || gramsPerServe <= 0) {
      return sendJson(res, 400, { message: 'Grams per shisha must be a positive number' });
    }
    if (hasCurrent && (Number.isNaN(currentGrams) || currentGrams < 0)) {
      return sendJson(res, 400, { message: 'Current grams must be zero or more' });
    }

    const state = await readState();
    const existing = findItem(state.shishas, name);
    if (existing) {
      existing.packSize = packSize;
      existing.gramsPerServe = gramsPerServe;
      if (hasCurrent) {
        existing.gramsRemaining = currentGrams;
      } else if (existing.gramsRemaining === undefined) {
        existing.gramsRemaining = packSize;
      }
    } else {
      state.shishas.push({
        name,
        packSize,
        gramsPerServe,
        gramsRemaining: hasCurrent ? currentGrams : packSize,
      });
    }
    await saveState(state);
    return sendJson(res, 200, { shishas: state.shishas });
  } catch (err) {
    console.error('Error adding shisha flavour', err);
    return sendJson(res, 500, { message: 'Failed to add shisha flavour' });
  }
}

async function handleShishaServe(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    if (!name) {
      return sendJson(res, 400, { message: 'Name is required' });
    }
    const state = await readState();
    const item = findItem(state.shishas, name);
    if (!item) {
      return sendJson(res, 404, { message: 'Shisha flavour not found' });
    }
    const gramsPerServe = item.gramsPerServe || DEFAULT_SHISHA_SERVE;
    item.gramsRemaining = Math.max(0, item.gramsRemaining - gramsPerServe);
    await saveState(state);
    return sendJson(res, 200, { shishas: state.shishas });
  } catch (err) {
    console.error('Error serving shisha flavour', err);
    return sendJson(res, 500, { message: 'Failed to serve shisha flavour' });
  }
}

async function handleShishaRestock(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    if (!name) {
      return sendJson(res, 400, { message: 'Name is required' });
    }
    const state = await readState();
    const item = findItem(state.shishas, name);
    if (!item) {
      return sendJson(res, 404, { message: 'Shisha flavour not found' });
    }
    const packSize = item.packSize || DEFAULT_SHISHA_PACK;
    item.gramsRemaining = Math.max(0, item.gramsRemaining) + packSize;
    await saveState(state);
    return sendJson(res, 200, { shishas: state.shishas });
  } catch (err) {
    console.error('Error restocking shisha flavour', err);
    return sendJson(res, 500, { message: 'Failed to restock shisha flavour' });
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

async function handleMiscAdd(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const quantity = Number(body.quantity || 0);
    if (!name) {
      return sendJson(res, 400, { message: 'Name is required' });
    }
    if (Number.isNaN(quantity) || quantity < 0) {
      return sendJson(res, 400, { message: 'Quantity must be zero or more' });
    }
    const state = await readState();
    const existing = findItem(state.misc, name);
    if (existing) {
      existing.quantity = quantity;
    } else {
      state.misc.push({ name, quantity });
    }
    await saveState(state);
    return sendJson(res, 200, { misc: state.misc });
  } catch (err) {
    console.error('Error adding misc item', err);
    return sendJson(res, 500, { message: 'Failed to add misc item' });
  }
}

async function handleMiscAdjust(req, res) {
  try {
    const body = await parseBody(req);
    const name = normalizeName(body.name);
    const delta = Number(body.delta || -1);
    if (!name || Number.isNaN(delta) || delta === 0) {
      return sendJson(res, 400, { message: 'Name and non-zero delta are required' });
    }
    const state = await readState();
    const item = findItem(state.misc, name);
    if (!item) {
      return sendJson(res, 404, { message: 'Misc item not found' });
    }
    item.quantity = Math.max(0, item.quantity + delta);
    await saveState(state);
    return sendJson(res, 200, { misc: state.misc });
  } catch (err) {
    console.error('Error adjusting misc item', err);
    return sendJson(res, 500, { message: 'Failed to adjust misc item' });
  }
}

async function handleMiscDelete(req, res, nameParam) {
  const name = normalizeName(nameParam);
  if (!name) {
    return sendJson(res, 400, { message: 'Name is required' });
  }
  const state = await readState();
  const initialLength = state.misc.length;
  state.misc = state.misc.filter((item) => item.name.toLowerCase() !== name.toLowerCase());
  if (state.misc.length === initialLength) {
    return sendJson(res, 404, { message: 'Misc item not found' });
  }
  await saveState(state);
  return sendJson(res, 200, { misc: state.misc });
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

  if (url.pathname === '/api/alcohols/add-bottle' && req.method === 'POST') {
    return handleAlcoholAddBottle(req, res);
  }

  if (url.pathname === '/api/alcohols/refill' && req.method === 'POST') {
    return handleAlcoholRefill(req, res);
  }

  if (url.pathname.startsWith('/api/alcohols/') && req.method === 'DELETE') {
    const [, , , rawName] = url.pathname.split('/');
    const decoded = decodeURIComponent(rawName || '');
    return handleAlcoholDelete(req, res, decoded);
  }

  if (url.pathname === '/api/shishas' && req.method === 'POST') {
    return handleShishaAdd(req, res);
  }

  if (url.pathname === '/api/shishas/serve' && req.method === 'POST') {
    return handleShishaServe(req, res);
  }

  if (url.pathname === '/api/shishas/restock' && req.method === 'POST') {
    return handleShishaRestock(req, res);
  }

  if (url.pathname === '/api/misc' && req.method === 'POST') {
    return handleMiscAdd(req, res);
  }

  if (url.pathname === '/api/misc/adjust' && req.method === 'POST') {
    return handleMiscAdjust(req, res);
  }

  if (url.pathname.startsWith('/api/misc/') && req.method === 'DELETE') {
    const [, , , rawName] = url.pathname.split('/');
    const decoded = decodeURIComponent(rawName || '');
    return handleMiscDelete(req, res, decoded);
  }

  if (url.pathname.startsWith('/api/shishas/') && req.method === 'DELETE') {
    const [, , , rawName] = url.pathname.split('/');
    const decoded = decodeURIComponent(rawName || '');
    return handleShishaDelete(req, res, decoded);
  }

  res.writeHead(404);
  return res.end();
});

server.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`Inventory API running on port ${SERVER_PORT}`);
});
