import {
  loadRosterEntries,
  upsertRosterEntry,
} from './local_roster.js';

const els = {
  status: document.getElementById('fighters-page-status'),
  buttons: Array.from(document.querySelectorAll('.fighters-roster-add')),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderStatus(type, message) {
  if (!els.status) {
    return;
  }
  if (!message) {
    els.status.replaceChildren();
    return;
  }

  const tone = {
    info: 'status-message--info',
    success: 'status-message--success',
    error: 'status-message--error',
  }[type] || 'status-message--info';

  const node = document.createElement('div');
  node.className = `status-message ${tone}`;
  node.textContent = message;
  els.status.replaceChildren(node);
}

function syncButtons() {
  const entries = loadRosterEntries();
  els.buttons.forEach((button) => {
    const fighterId = Number(button.dataset.fighterId || 0);
    const existing = entries.find((entry) => Number(entry.fighter.id || 0) === fighterId);
    button.textContent = existing ? 'Update roster snapshot' : 'Add to roster';
  });
}

async function apiJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.detail || 'Request failed.');
  }
  return payload;
}

async function handleRosterAdd(button) {
  const fighterId = Number(button.dataset.fighterId || 0);
  if (!fighterId) {
    return;
  }

  button.disabled = true;
  try {
    const fighter = await apiJson(`/api/fighters/${fighterId}/`);
    const entries = loadRosterEntries();
    const existing = entries.find((entry) => Number(entry.fighter.id || 0) === fighterId);
    upsertRosterEntry(fighter, {
      origin_type: 'public_library',
      source_page: 'fighters',
    });
    syncButtons();
    renderStatus('success', existing ? `${fighter.name} roster snapshot updated.` : `${fighter.name} added to your local roster.`);
  } catch (error) {
    renderStatus('error', error.message);
  } finally {
    button.disabled = false;
  }
}

els.buttons.forEach((button) => {
  button.addEventListener('click', () => {
    handleRosterAdd(button);
  });
});

syncButtons();
