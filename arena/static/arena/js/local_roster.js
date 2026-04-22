const STORAGE_KEY = 'clashforge_local_roster_v1';
const STORAGE_VERSION = 1;

function safeStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeAbilities(abilities) {
  if (!Array.isArray(abilities)) {
    return [];
  }

  return abilities.map((ability) => ({
    name: normalizeText(ability?.name),
    type: normalizeText(ability?.type, 'attack'),
    power: Number(ability?.power || 0),
    cooldown: Number(ability?.cooldown || 0),
    description: normalizeText(ability?.description),
    scaling: normalizeText(ability?.scaling),
    duration: ability?.duration != null ? Number(ability.duration) : null,
    effect: ability?.effect && typeof ability.effect === 'object' && !Array.isArray(ability.effect)
      ? deepClone(ability.effect)
      : {},
  }));
}

export function fighterRosterSnapshot(fighter) {
  return {
    id: fighter?.id != null ? Number(fighter.id) : null,
    slug: normalizeText(fighter?.slug),
    name: normalizeText(fighter?.name),
    creator_name: normalizeText(fighter?.creator_name),
    title: normalizeText(fighter?.title),
    archetype: normalizeText(fighter?.archetype, 'duelist'),
    avatar_color: normalizeText(fighter?.avatar_color, '#8b5cf6') || '#8b5cf6',
    visibility: normalizeText(fighter?.visibility, 'public') || 'public',
    is_benchmark: fighter?.is_benchmark === true,
    can_battle: fighter?.can_battle === true
      && fighter?.is_benchmark !== true
      && normalizeText(fighter?.visibility, 'public') === 'public',
    description: normalizeText(fighter?.description),
    strength: Number(fighter?.strength || 0),
    speed: Number(fighter?.speed || 0),
    durability: Number(fighter?.durability || 0),
    intelligence: Number(fighter?.intelligence || 0),
    max_health: Number(fighter?.max_health || 0),
    passive_name: normalizeText(fighter?.passive_name),
    passive_description: normalizeText(fighter?.passive_description),
    abilities: normalizeAbilities(fighter?.abilities),
    win_condition: normalizeText(fighter?.win_condition),
    balance_notes: normalizeText(fighter?.balance_notes),
  };
}

function buildMatchKey(snapshot) {
  if (snapshot.id != null) {
    return `fighter:${snapshot.id}`;
  }
  if (snapshot.slug) {
    return `slug:${snapshot.slug}`;
  }
  return `name:${snapshot.name.toLowerCase()}:${snapshot.archetype.toLowerCase()}`;
}

function defaultOriginLabel(originType) {
  return {
    forge_saved: 'Forge Save',
    variant_copy: 'Variant',
    public_library: 'Public Import',
    shared_profile: 'Share Import',
  }[originType] || 'Local Snapshot';
}

function normalizeMeta(raw, snapshot, options = {}) {
  const now = new Date().toISOString();
  const originType = normalizeText(raw?.origin_type || options.origin_type, 'local_snapshot') || 'local_snapshot';

  return {
    origin_type: originType,
    origin_label: normalizeText(raw?.origin_label || options.origin_label, defaultOriginLabel(originType)),
    source_page: normalizeText(raw?.source_page || options.source_page),
    source_fighter_id: snapshot.id,
    source_slug: snapshot.slug,
    visibility_at_capture: snapshot.visibility,
    authority: 'local_snapshot',
    created_at: normalizeText(raw?.created_at, now),
    updated_at: now,
    can_use_in_arena: snapshot.can_battle === true,
    can_open_in_forge: true,
  };
}

function normalizeRosterEntry(raw) {
  if (!raw || typeof raw !== 'object' || !raw.fighter) {
    return null;
  }
  if (raw.fighter?.is_benchmark) {
    return null;
  }

  const snapshot = fighterRosterSnapshot(raw.fighter);
  if (!snapshot.name) {
    return null;
  }

  return {
    entry_id: normalizeText(raw.entry_id) || `roster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    match_key: normalizeText(raw.match_key) || buildMatchKey(snapshot),
    fighter: snapshot,
    meta: normalizeMeta(raw.meta, snapshot),
  };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftUpdated = Date.parse(left.meta?.updated_at || '') || 0;
    const rightUpdated = Date.parse(right.meta?.updated_at || '') || 0;
    if (rightUpdated !== leftUpdated) {
      return rightUpdated - leftUpdated;
    }
    return (left.fighter?.name || '').localeCompare(right.fighter?.name || '');
  });
}

function saveState(entries) {
  const storage = safeStorage();
  if (!storage) {
    return [];
  }

  const normalized = sortEntries(entries.map((entry) => normalizeRosterEntry(entry)).filter(Boolean));
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: STORAGE_VERSION,
      entries: normalized,
    })
  );
  return normalized;
}

export function loadRosterEntries() {
  const storage = safeStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!raw || raw.version !== STORAGE_VERSION || !Array.isArray(raw.entries)) {
      return [];
    }
    const normalized = sortEntries(raw.entries.map(normalizeRosterEntry).filter(Boolean));
    if (normalized.length !== raw.entries.length) {
      saveState(normalized);
    }
    return normalized;
  } catch (error) {
    return [];
  }
}

export function findRosterEntryById(entryId, entries = loadRosterEntries()) {
  const target = normalizeText(entryId);
  if (!target) {
    return null;
  }
  return entries.find((entry) => entry.entry_id === target) || null;
}

export function findRosterEntryByFighter(fighter, entries = loadRosterEntries()) {
  if (!fighter) {
    return null;
  }
  const snapshot = fighterRosterSnapshot(fighter);
  const matchKey = buildMatchKey(snapshot);
  return entries.find((entry) => entry.match_key === matchKey) || null;
}

export function isRosteredFighter(fighter, entries = loadRosterEntries()) {
  return Boolean(findRosterEntryByFighter(fighter, entries));
}

export function upsertRosterEntry(fighter, options = {}) {
  const snapshot = fighterRosterSnapshot(fighter);
  if (!snapshot.name) {
    return null;
  }

  const entries = loadRosterEntries();
  const matchKey = buildMatchKey(snapshot);
  const existingIndex = entries.findIndex((entry) => entry.match_key === matchKey);
  const existing = existingIndex >= 0 ? entries[existingIndex] : null;
  const next = {
    entry_id: existing?.entry_id || `roster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    match_key: matchKey,
    fighter: snapshot,
    meta: normalizeMeta(existing?.meta, snapshot, options),
  };

  if (existingIndex >= 0) {
    entries.splice(existingIndex, 1, next);
  } else {
    entries.push(next);
  }

  saveState(entries);
  return next;
}

export function removeRosterEntry(entryId) {
  const entries = loadRosterEntries();
  const next = entries.filter((entry) => entry.entry_id !== normalizeText(entryId));
  saveState(next);
  return next.length !== entries.length;
}

export function getRosterSummary(entries = loadRosterEntries()) {
  const summary = {
    total: entries.length,
    imported: 0,
    forgeSaved: 0,
    variants: 0,
  };

  entries.forEach((entry) => {
    if (entry.meta.origin_type === 'variant_copy') {
      summary.variants += 1;
    } else if (entry.meta.origin_type === 'forge_saved') {
      summary.forgeSaved += 1;
    } else {
      summary.imported += 1;
    }
  });

  return summary;
}
