(() => {
  const apiBase = (() => {
    const url = new URL(window.location.href);
    const host = url.hostname || 'localhost';
    const protocol = url.protocol.startsWith('http') ? url.protocol : 'http:';
    return `${protocol}//${host}:4000`;
  })();

  const POLL_MS = 3000;

  const loginPanel = document.getElementById('login-panel');
  const appPanel = document.getElementById('app-panel');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const alcoholList = document.getElementById('alcohol-list');
  const shishaList = document.getElementById('shisha-list');
  const addAlcoholForm = document.getElementById('add-alcohol-form');
  const addShishaForm = document.getElementById('add-shisha-form');
  const toastEl = document.getElementById('toast');
  const lowAlert = document.getElementById('low-alert');

  let authPassword = sessionStorage.getItem('inv_password') || '';
  let state = { alcohols: [], shishas: [] };
  let toastTimeout = null;
  let pollHandle = null;
  const lowNotified = new Set();

  async function api(path, options = {}, skipAuth = false) {
    const opts = { ...options };
    opts.headers = opts.headers || {};
    if (!skipAuth) {
      opts.headers['X-Password'] = authPassword;
    }
    if (opts.body && !opts.headers['Content-Type']) {
      opts.headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${apiBase}${path}`, opts);
    if (res.status === 401) {
      requireLogin('Session expired. Please login again.');
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      let message = 'Request failed';
      try {
        const error = await res.json();
        message = error.message || message;
      } catch (_) {
        // ignore parse errors
      }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function requireLogin(message) {
    appPanel.classList.add('hidden');
    loginPanel.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    if (message) {
      loginError.textContent = message;
    }
    stopPolling();
  }

  function setLoggedIn() {
    loginPanel.classList.add('hidden');
    appPanel.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    loginError.textContent = '';
    if (!pollHandle) {
      pollHandle = setInterval(() => {
        fetchState(true);
      }, POLL_MS);
    }
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2500);
  }

  function formatMl(amount) {
    return `${Math.max(0, Math.round(amount))} ml`;
  }

  function formatGrams(amount) {
    return `${Math.max(0, Math.round(amount))} g`;
  }

  function servingsLeft(item) {
    if (!item || !item.gramsPerServe) return 0;
    return Math.max(0, Math.floor((item.gramsRemaining || 0) / item.gramsPerServe));
  }

  function updateLowBanner() {
    const lowAlcohols = state.alcohols.filter((a) => a.quantity <= 150);
    const lowShishas = state.shishas.filter(
      (s) => s.gramsRemaining <= (s.gramsPerServe || 15) * 2
    );

    if (!lowAlcohols.length && !lowShishas.length) {
      lowAlert.classList.add('hidden');
      lowAlert.textContent = '';
      return;
    }

    const parts = [];
    if (lowAlcohols.length) {
      parts.push(
        `Alcohol: ${lowAlcohols
          .map((a) => `${a.name} (${formatMl(a.quantity)})`)
          .join(', ')}`
      );
    }
    if (lowShishas.length) {
      parts.push(
        `Shisha: ${lowShishas
          .map(
            (s) =>
              `${s.name} (${formatGrams(s.gramsRemaining)} ≈ ${servingsLeft(s)} bowls)`
          )
          .join(', ')}`
      );
    }

    lowAlert.classList.remove('hidden');
    lowAlert.textContent = `Low stock • ${parts.join(' • ')}`;
  }

  function handleLowNotifications() {
    const currentlyLow = new Set();
    state.alcohols.forEach((item) => {
      const key = `a:${item.name.toLowerCase()}`;
      if (item.quantity <= 150) {
        currentlyLow.add(key);
        if (!lowNotified.has(key)) {
          showToast(`${item.name} is under 150ml`);
        }
      }
    });
    state.shishas.forEach((item) => {
      const key = `s:${item.name.toLowerCase()}`;
      if (item.gramsRemaining <= (item.gramsPerServe || 15) * 2) {
        currentlyLow.add(key);
        if (!lowNotified.has(key)) {
          showToast(`${item.name} shisha is running low`);
        }
      }
    });
    lowNotified.clear();
    currentlyLow.forEach((k) => lowNotified.add(k));
  }

  function renderAlcohols() {
    alcoholList.innerHTML = '';
    const sorted = [...state.alcohols].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (!sorted.length) {
      alcoholList.innerHTML = '<p class="muted">No alcohols yet.</p>';
      return;
    }
    sorted.forEach((item) => {
      const low = item.quantity <= 150;
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <div class="item-header">
          <div>
            <p class="item-name">${item.name}</p>
            <p class="item-qty">${formatMl(item.quantity)} left • Full: ${formatMl(
        item.originalQuantity || item.quantity
      )}</p>
          </div>
          <span class="pill ${low ? 'warn' : 'ok'}">${low ? 'Low' : 'Ready'}</span>
        </div>
        <div class="item-actions">
          <button class="primary-btn" data-action="pour" data-name="${item.name}">Pour 40ml</button>
          <button class="secondary-btn" data-action="refill" data-name="${item.name}">Refill</button>
          <button class="secondary-btn danger" data-action="remove" data-name="${item.name}">Remove</button>
        </div>
      `;
      alcoholList.appendChild(card);
    });
  }

  function renderShishas() {
    shishaList.innerHTML = '';
    const sorted = [...state.shishas].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (!sorted.length) {
      shishaList.innerHTML = '<p class="muted">No flavours yet.</p>';
      return;
    }
    sorted.forEach((item) => {
      const low = item.gramsRemaining <= (item.gramsPerServe || 15) * 2;
      const serves = servingsLeft(item);
      const packDisplay = item.packSize || item.gramsRemaining || 0;
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <div class="item-header">
          <div>
            <p class="item-name">${item.name}</p>
            <p class="item-qty">${formatGrams(item.gramsRemaining)} left • ~${serves} bowls • Pack: ${formatGrams(
        packDisplay
      )}</p>
          </div>
          <span class="pill ${low ? 'warn' : 'ok'}">${low ? 'Low' : 'Ready'}</span>
        </div>
        <div class="item-actions">
          <button class="primary-btn" data-action="serve-shisha" data-name="${item.name}">Serve 1 bowl</button>
          <button class="secondary-btn" data-action="restock-shisha" data-name="${item.name}">Restock pack</button>
          <button class="secondary-btn danger" data-action="remove-shisha" data-name="${item.name}">Remove</button>
        </div>
      `;
      shishaList.appendChild(card);
    });
  }

  function render() {
    renderAlcohols();
    renderShishas();
    updateLowBanner();
    handleLowNotifications();
  }

  async function fetchState(silent = false) {
    if (!authPassword) return;
    try {
      const data = await api('/api/state', { method: 'GET' });
      state = data;
      render();
      if (!silent) {
        showToast('Synced');
      }
    } catch (err) {
      if (!silent) {
        showToast(err.message);
      }
    }
  }

  async function consumeAlcohol(name, amount = 40) {
    await api('/api/alcohols/consume', {
      method: 'POST',
      body: JSON.stringify({ name, amount }),
    });
    await fetchState(true);
  }

  async function removeAlcohol(name) {
    await api(`/api/alcohols/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    await fetchState(true);
  }

  async function addAlcohol(name, quantity) {
    await api('/api/alcohols', {
      method: 'POST',
      body: JSON.stringify({ name, quantity }),
    });
    await fetchState(true);
  }

  async function refillAlcohol(name) {
    await api('/api/alcohols/refill', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await fetchState(true);
  }

  async function addShisha(payload) {
    await api('/api/shishas', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await fetchState(true);
  }

  async function serveShisha(name) {
    await api('/api/shishas/serve', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await fetchState(true);
  }

  async function restockShisha(name) {
    await api('/api/shishas/restock', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await fetchState(true);
  }

  async function removeShisha(name) {
    await api(`/api/shishas/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    await fetchState(true);
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value.trim();
    if (!password) return;
    try {
      await api(
        '/api/login',
        { method: 'POST', body: JSON.stringify({ password }) },
        true
      );
      authPassword = password;
      sessionStorage.setItem('inv_password', password);
      setLoggedIn();
      await fetchState();
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  logoutBtn.addEventListener('click', () => {
    authPassword = '';
    sessionStorage.removeItem('inv_password');
    state = { alcohols: [], shishas: [] };
    requireLogin();
  });

  addAlcoholForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = addAlcoholForm.name.value.trim();
    const quantity = Number(addAlcoholForm.quantity.value || 700);
    if (!name) return;
    try {
      await addAlcohol(name, quantity);
      addAlcoholForm.reset();
      showToast('Saved alcohol');
    } catch (err) {
      showToast(err.message);
    }
  });

  addShishaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = addShishaForm.name.value.trim();
    const packSize = Number(addShishaForm.packSize.value || 1000);
    const gramsPerServe = Number(addShishaForm.gramsPerServe.value || 15);
    const currentRaw = addShishaForm.currentGrams.value;
    const hasCurrent = currentRaw !== '';
    const currentGrams = hasCurrent ? Number(currentRaw) : undefined;
    if (!name) return;
    try {
      const payload = { name, packSize, gramsPerServe };
      if (hasCurrent) payload.currentGrams = currentGrams;
      await addShisha(payload);
      addShishaForm.reset();
      showToast('Saved flavour');
    } catch (err) {
      showToast(err.message);
    }
  });

  alcoholList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const name = btn.dataset.name;
    const action = btn.dataset.action;
    try {
      if (action === 'pour') {
        await consumeAlcohol(name);
        showToast(`Logged 40ml ${name}`);
      } else if (action === 'refill') {
        await refillAlcohol(name);
        showToast(`Refilled ${name}`);
      } else if (action === 'remove') {
        await removeAlcohol(name);
        showToast(`Removed ${name}`);
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  shishaList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const name = btn.dataset.name;
    const action = btn.dataset.action;
    try {
      if (action === 'serve-shisha') {
        await serveShisha(name);
        showToast(`Served 1 ${name}`);
      } else if (action === 'restock-shisha') {
        await restockShisha(name);
        showToast(`Restocked ${name}`);
      } else if (action === 'remove-shisha') {
        await removeShisha(name);
        showToast(`Removed ${name}`);
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  // Auto-login if password is already stored.
  if (authPassword) {
    setLoggedIn();
    fetchState();
  } else {
    requireLogin();
  }
})();
