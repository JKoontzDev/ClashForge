const STORAGE_KEY = 'clashforge_champion_v1';
const STORAGE_VERSION = 1;

function safeStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function fighterSnapshot(fighter) {
  return {
    id: fighter.id ?? null,
    slug: fighter.slug || '',
    name: fighter.name || '',
    title: fighter.title || '',
    archetype: fighter.archetype || '',
    avatar_color: fighter.avatar_color || '#8b5cf6',
    visibility: fighter.visibility || 'public',
  };
}

function defaultStats() {
  return {
    total_sims: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    last_result: null,
    encounters: {},
  };
}

function normalizeChampionState(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== STORAGE_VERSION || !raw.fighter) {
    return null;
  }

  return {
    version: STORAGE_VERSION,
    fighter: fighterSnapshot(raw.fighter),
    designated_at: raw.designated_at || new Date().toISOString(),
    local_stats: {
      ...defaultStats(),
      ...(raw.local_stats || {}),
      encounters: typeof raw.local_stats?.encounters === 'object' && raw.local_stats?.encounters
        ? raw.local_stats.encounters
        : {},
    },
  };
}

export function loadChampionState() {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }

  try {
    return normalizeChampionState(JSON.parse(storage.getItem(STORAGE_KEY) || 'null'));
  } catch (error) {
    return null;
  }
}

export function saveChampionState(championState) {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }

  const normalized = normalizeChampionState(championState);
  if (!normalized) {
    return null;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearChampionState() {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(STORAGE_KEY);
}

export function isChampionFighter(fighter, championState = loadChampionState()) {
  if (!fighter || !championState?.fighter) {
    return false;
  }

  const champion = championState.fighter;
  if (fighter.id != null && champion.id != null) {
    return Number(fighter.id) === Number(champion.id);
  }
  if (fighter.slug && champion.slug) {
    return fighter.slug === champion.slug;
  }
  return fighter.name === champion.name;
}

export function designateChampion(fighter, previousState = loadChampionState()) {
  const next = {
    version: STORAGE_VERSION,
    fighter: fighterSnapshot(fighter),
    designated_at: new Date().toISOString(),
    local_stats: defaultStats(),
  };

  if (previousState && isChampionFighter(fighter, previousState)) {
    next.designated_at = previousState.designated_at;
    next.local_stats = {
      ...defaultStats(),
      ...(previousState.local_stats || {}),
      encounters: { ...(previousState.local_stats?.encounters || {}) },
    };
  }

  return saveChampionState(next);
}

function summarizeEncounter(entry) {
  return {
    name: entry.name,
    count: Number(entry.count || 0),
    wins: Number(entry.wins || 0),
    losses: Number(entry.losses || 0),
  };
}

export function getChampionSummary(championState = loadChampionState()) {
  if (!championState) {
    return null;
  }

  const stats = championState.local_stats || defaultStats();
  const encounters = Object.values(stats.encounters || {}).map(summarizeEncounter);
  encounters.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return right.wins - left.wins;
  });

  const rivalry = encounters[0] || null;
  const notableWin = [...encounters]
    .sort((left, right) => {
      if (right.wins !== left.wins) {
        return right.wins - left.wins;
      }
      return right.count - left.count;
    })[0] || null;

  return {
    champion: championState.fighter,
    designated_at: championState.designated_at,
    totalSims: Number(stats.total_sims || 0),
    wins: Number(stats.wins || 0),
    losses: Number(stats.losses || 0),
    draws: Number(stats.draws || 0),
    lastResult: stats.last_result || null,
    rivalry,
    notableWin,
  };
}

export function recordChampionBattle(
  result,
  fighterA,
  fighterB,
  championState = loadChampionState()
) {
  if (!championState || !fighterA || !fighterB) {
    return championState;
  }

  const championOnA = isChampionFighter(fighterA, championState);
  const championOnB = isChampionFighter(fighterB, championState);
  if (!championOnA && !championOnB) {
    return championState;
  }

  const next = {
    ...championState,
    local_stats: {
      ...defaultStats(),
      ...(championState.local_stats || {}),
      encounters: { ...(championState.local_stats?.encounters || {}) },
    },
  };
  const simCount = Number(result?.sim_count || 1);
  const opponent = championOnA ? fighterB : fighterA;
  const opponentKey = opponent.slug || opponent.name;
  const encounter = {
    name: opponent.name || 'Unknown',
    count: 0,
    wins: 0,
    losses: 0,
    ...(next.local_stats.encounters[opponentKey] || {}),
  };

  next.local_stats.total_sims += simCount;
  encounter.count += simCount;

  if (simCount === 1) {
    const winnerId = result?.winner?.id || null;
    if (
      (championOnA && winnerId === fighterA.id)
      || (championOnB && winnerId === fighterB.id)
    ) {
      next.local_stats.wins += 1;
      encounter.wins += 1;
    } else if (winnerId == null) {
      next.local_stats.draws += 1;
    } else {
      next.local_stats.losses += 1;
      encounter.losses += 1;
    }
  } else {
    const aggregate = result?.aggregate || {};
    const championWins = championOnA
      ? Number(aggregate.fighter_a_wins || 0)
      : Number(aggregate.fighter_b_wins || 0);
    const opponentWins = championOnA
      ? Number(aggregate.fighter_b_wins || 0)
      : Number(aggregate.fighter_a_wins || 0);
    const draws = Math.max(0, simCount - championWins - opponentWins);
    next.local_stats.wins += championWins;
    next.local_stats.losses += opponentWins;
    next.local_stats.draws += draws;
    encounter.wins += championWins;
    encounter.losses += opponentWins;
  }

  next.local_stats.last_result = {
    opponent_name: opponent.name || 'Unknown',
    sim_count: simCount,
    summary: result?.aggregate_insights?.matchup_story || result?.recap?.headline || result?.summary || '',
    at: new Date().toISOString(),
  };
  next.local_stats.encounters[opponentKey] = encounter;

  const trimmedEntries = Object.entries(next.local_stats.encounters)
    .sort((left, right) => Number(right[1].count || 0) - Number(left[1].count || 0))
    .slice(0, 12);
  next.local_stats.encounters = Object.fromEntries(trimmedEntries);

  return saveChampionState(next);
}
