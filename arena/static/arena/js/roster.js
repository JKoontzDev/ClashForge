import {
  findRosterEntryById,
  getRosterSummary,
  loadRosterEntries,
  removeRosterEntry,
  upsertRosterEntry,
} from './local_roster.js';
import {
  clearChampionState,
  designateChampion,
  getChampionSummary,
  isChampionFighter,
  loadChampionState,
} from './champion_identity.js';

const arenaPath = document.body.dataset.arenaUrl || '/';
const forgePath = document.body.dataset.forgeUrl || '/forge/';

const els = {
  status: document.getElementById('roster-page-status'),
  championCard: document.getElementById('roster-champion-card'),
  championBody: document.getElementById('roster-champion-body'),
  total: document.getElementById('roster-total-count'),
  imported: document.getElementById('roster-import-count'),
  saved: document.getElementById('roster-saved-count'),
  variants: document.getElementById('roster-variant-count'),
  emptyCopy: document.getElementById('roster-empty-copy'),
  grid: document.getElementById('local-roster-grid'),
  featuredButtons: Array.from(document.querySelectorAll('.featured-roster-add')),
};

let championState = loadChampionState();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugLabel(value) {
  return String(value || '')
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function truncateText(value, maxLength = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : '#8b5cf6';
}

function appendChildren(parent, children) {
  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) {
      return;
    }
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return parent;
}

function node(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) {
      return;
    }
    if (key === 'className') {
      element.className = value;
    } else if (key === 'text') {
      element.textContent = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        element.dataset[dataKey] = dataValue;
      });
    } else {
      element.setAttribute(key, value);
    }
  });
  return appendChildren(element, Array.isArray(children) ? children : [children]);
}

function pageUrl(pathname, query = {}) {
  const url = new URL(window.location.origin);
  url.pathname = pathname;
  Object.entries(query).forEach(([key, value]) => {
    if (value != null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
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
    info: 'roster-status--info',
    success: 'roster-status--success',
    error: 'roster-status--error',
  }[type] || 'roster-status--info';

  els.status.replaceChildren(node('div', { className: `roster-status ${tone}`, text: message }));
}

function rosterEntries() {
  return loadRosterEntries();
}

function syncChampionState() {
  championState = loadChampionState();
  return championState;
}

function updateSummary(entries) {
  const summary = getRosterSummary(entries);
  els.total.textContent = summary.total;
  els.imported.textContent = summary.imported;
  els.saved.textContent = summary.forgeSaved;
  els.variants.textContent = summary.variants;
  els.emptyCopy.textContent = summary.total
    ? 'Your roster is stored only in this browser.'
    : 'Add fighters from Arena, Forge, or a share page to start building your local pool.';
}

function renderLocalRoster() {
  const entries = rosterEntries();
  syncChampionState();
  updateSummary(entries);

  if (!entries.length) {
    els.grid.replaceChildren(
      node(
        'div',
        { className: 'roster-empty-state' },
        'No local roster entries yet. Add a public fighter below, import one from a share page, or save a forge build to seed your browser-local collection.'
      )
    );
  } else {
    els.grid.replaceChildren(
      ...entries.map((entry) => {
      const fighter = entry.fighter;
      const metadata = entry.meta || {};
      const isChampion = isChampionFighter(fighter, championState);
      const arenaAUrl = metadata.can_use_in_arena ? pageUrl(arenaPath, { roster_a: entry.entry_id }) : '';
      const arenaBUrl = metadata.can_use_in_arena ? pageUrl(arenaPath, { roster_b: entry.entry_id }) : '';
      const forgeUrl = metadata.can_open_in_forge ? pageUrl(forgePath, { roster: entry.entry_id }) : '';
      const shareUrl = fighter.slug ? `/fighters/${encodeURIComponent(fighter.slug)}/` : '';
      const authorityNote = metadata.authority === 'local_snapshot'
        ? 'Local snapshot only. Roster membership does not grant edit ownership.'
        : '';

      const badges = [
        isChampion ? node('span', { className: 'roster-badge roster-badge--champion', text: 'Champion' }) : null,
        node('span', { className: 'roster-badge roster-badge--origin', text: metadata.origin_label || 'Local Snapshot' }),
        node('span', { className: 'roster-badge', text: slugLabel(fighter.archetype) }),
      ];
      const actions = [
        arenaAUrl ? node('a', { href: arenaAUrl, className: 'roster-card__action roster-card__action--arena', text: 'Arena A' }) : null,
        arenaBUrl ? node('a', { href: arenaBUrl, className: 'roster-card__action roster-card__action--arena', text: 'Arena B' }) : null,
        forgeUrl ? node('a', { href: forgeUrl, className: 'roster-card__action roster-card__action--forge', text: 'Open in Forge' }) : null,
        shareUrl ? node('a', { href: shareUrl, className: 'roster-card__action roster-card__action--secondary', text: 'View profile' }) : null,
        node('button', {
          type: 'button',
          className: `roster-card__action roster-champion-button roster-champion ${isChampion ? 'is-active' : ''}`,
          dataset: { entryId: entry.entry_id },
          text: isChampion ? 'Current champion' : 'Make champion',
        }),
        node('button', {
          type: 'button',
          className: 'roster-card__action roster-card__action--remove roster-remove',
          dataset: { entryId: entry.entry_id },
          text: 'Remove',
        }),
      ];

      return node('article', { className: 'roster-card' }, [
        node('div', { className: 'roster-card__top' }, [
          node('div', { className: 'roster-card__avatar', style: { background: safeColor(fighter.avatar_color) } }),
          node('div', { className: 'roster-card__content' }, [
            node('div', { className: 'roster-card__head' }, [
              node('div', {}, [
                node('p', { className: 'roster-card__name', text: fighter.name }),
                node('p', { className: 'roster-card__title', text: fighter.title || 'Untitled combatant' }),
                fighter.creator_name ? node('p', { className: 'roster-card__creator', text: `Forged by ${fighter.creator_name}` }) : null,
              ]),
              node('div', { className: 'roster-card__badges' }, badges),
            ]),
            node('p', {
              className: 'roster-card__description',
              text: truncateText(fighter.description || 'Local roster snapshot ready for Arena or Forge.', 140),
            }),
          ]),
        ]),
        node('div', { className: 'roster-card__stats' }, [
          ['STR', fighter.strength],
          ['SPD', fighter.speed],
          ['DUR', fighter.durability],
          ['HP', fighter.max_health],
        ].map(([label, value]) => node('div', { className: 'roster-card__stat' }, [
          node('span', { className: 'roster-card__stat-label', text: label }),
          node('span', { className: 'roster-card__stat-value', text: value }),
        ]))),
        authorityNote ? node('p', { className: 'roster-card__note', text: authorityNote }) : null,
        node('div', { className: 'roster-card__actions' }, actions),
      ]);
    })
    );
  }

  els.grid.querySelectorAll('.roster-remove').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = findRosterEntryById(button.dataset.entryId || '', entries);
      const wasChampion = entry ? isChampionFighter(entry.fighter, championState) : false;
      removeRosterEntry(button.dataset.entryId || '');
      if (wasChampion) {
        clearChampionState();
        syncChampionState();
      }
      renderLocalRoster();
      syncFeaturedButtons();
      renderChampionCard();
      renderStatus('info', wasChampion ? 'Champion removed from roster and cleared locally.' : 'Fighter removed from your local roster.');
    });
  });

  els.grid.querySelectorAll('.roster-champion').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = findRosterEntryById(button.dataset.entryId || '', entries);
      if (!entry) {
        return;
      }
      championState = designateChampion(entry.fighter, championState);
      renderLocalRoster();
      renderChampionCard();
      renderStatus('success', `${entry.fighter.name} is now your current champion in this browser.`);
    });
  });
}

function renderChampionCard() {
  if (!els.championBody) {
    return;
  }

  syncChampionState();
  const summary = getChampionSummary(championState);

  if (!summary) {
    els.championBody.replaceChildren(
      node('div', { className: 'roster-champion-empty' }, [
        node('p', { className: 'roster-champion-empty__title', text: 'No current champion set' }),
        node(
          'p',
          {
            className: 'roster-champion-empty__copy',
            text: 'Pick one roster fighter as your local headliner. This affects presentation and local identity only, not battle power or account ownership.',
          }
        ),
      ])
    );
    return;
  }

  const rivalry = summary.rivalry ? `${summary.rivalry.name} (${summary.rivalry.count} local sets)` : 'No rivalry yet';
  const lastResult = truncateText(summary.lastResult?.summary || 'No official recap tracked yet.', 160);

  const clearButton = node('button', {
    type: 'button',
    id: 'roster-clear-champion-btn',
    className: 'roster-clear-button',
    text: 'Clear champion',
  });
  els.championBody.replaceChildren(
    node('div', { className: 'roster-champion-block' }, [
      node('div', { className: 'roster-champion-block__hero' }, [
        node('p', { className: 'roster-champion-block__label', text: 'Current champion' }),
        node('p', { className: 'roster-champion-block__name', text: summary.champion.name }),
        node('p', { className: 'roster-champion-block__title', text: summary.champion.title || 'Untitled headliner' }),
      ]),
      node('div', { className: 'roster-champion-metrics' }, [
        node('div', { className: 'roster-champion-metric' }, [
          node('p', { className: 'roster-champion-metric__label', text: 'Local record' }),
          node('p', { className: 'roster-champion-metric__value', text: `${summary.wins}W ${summary.losses}L ${summary.draws}D` }),
        ]),
        node('div', { className: 'roster-champion-metric' }, [
          node('p', { className: 'roster-champion-metric__label', text: 'Official sims tracked' }),
          node('p', { className: 'roster-champion-metric__value', text: summary.totalSims }),
        ]),
        node('div', { className: 'roster-champion-metric' }, [
          node('p', { className: 'roster-champion-metric__label', text: 'Rivalry' }),
          node('p', { className: 'roster-champion-metric__value', text: rivalry }),
        ]),
        node('div', { className: 'roster-champion-metric' }, [
          node('p', { className: 'roster-champion-metric__label', text: 'Last report' }),
          node('p', { className: 'roster-champion-metric__value', text: lastResult }),
        ]),
      ]),
      clearButton,
    ])
  );

  clearButton.addEventListener('click', () => {
    clearChampionState();
    syncChampionState();
    renderLocalRoster();
    renderChampionCard();
    renderStatus('info', 'Champion cleared for this browser.');
  });
}

function syncFeaturedButtons() {
  const entries = rosterEntries();
  els.featuredButtons.forEach((button) => {
    const fighterId = Number(button.dataset.fighterId || 0);
    const entry = entries.find((item) => Number(item.fighter.id || 0) === fighterId);
    button.textContent = entry ? 'Update roster snapshot' : 'Add to roster';
  });
}

async function apiJson(url, options = {}) {
  const requestOptions = { ...options };
  const headers = new Headers(requestOptions.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  requestOptions.headers = headers;

  const response = await fetch(url, requestOptions);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message = typeof payload?.detail === 'string' ? payload.detail : 'Request failed.';
    throw new Error(message);
  }

  return payload;
}

async function handleFeaturedImport(button) {
  const fighterId = Number(button.dataset.fighterId || 0);
  if (!fighterId) {
    return;
  }

  button.disabled = true;
  try {
    const fighter = await apiJson(`/api/fighters/${fighterId}/`);
    const existing = rosterEntries().find((entry) => Number(entry.fighter.id || 0) === fighterId);
    upsertRosterEntry(fighter, {
      origin_type: 'public_library',
      source_page: 'roster',
    });
    renderLocalRoster();
    syncFeaturedButtons();
    renderStatus('success', existing ? `${fighter.name} roster snapshot updated.` : `${fighter.name} added to your local roster.`);
  } catch (error) {
    renderStatus('error', error.message);
  } finally {
    button.disabled = false;
  }
}

els.featuredButtons.forEach((button) => {
  button.addEventListener('click', () => {
    handleFeaturedImport(button);
  });
});

renderLocalRoster();
syncFeaturedButtons();
renderChampionCard();
