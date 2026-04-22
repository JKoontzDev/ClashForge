import {
  clearChampionState,
  designateChampion,
  getChampionSummary,
  isChampionFighter,
  loadChampionState,
  recordChampionBattle,
} from './champion_identity.js';
import {
  findRosterEntryByFighter,
  findRosterEntryById,
  loadRosterEntries,
  removeRosterEntry,
  upsertRosterEntry,
} from './local_roster.js';

const MIN_CORE_STAT = 10;
const MAX_CORE_STAT = 100;
const MAX_CORE_STAT_BUDGET = 320;
const MIN_MAX_HEALTH = 60;
const MAX_MAX_HEALTH = 220;
const MAX_FIGHTER_PAYLOAD_CHARS = 1800;
const MAX_ABILITY_COUNT = 4;
const MAX_CREATOR_NAME_LENGTH = 32;
const CREATOR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,31}$/;
const pageMode = document.body.dataset.page || 'arena';
const arenaPath = document.body.dataset.arenaUrl || '/';
const forgePath = document.body.dataset.forgeUrl || '/forge/';

const state = {
  pageMode,
  characters: [],
  localRoster: loadRosterEntries(),
  recentFights: [],
  selectedA: null,
  selectedB: null,
  forgedCharacter: null,
  forgeArchetype: 'duelist',
  forgeStatus: null,
  forgeServerErrors: [],
  savedForge: null,
  forgeImportContext: null,
  iterationBaseline: null,
  lastBattleSnapshot: null,
  matchupSnapshots: {},
  championState: loadChampionState(),
  shareIntent: null,
  pixi: null,
  sprites: {},
};

const els = {
  list: document.getElementById('character-list'),
  search: document.getElementById('character-search'),
  selectedA: document.getElementById('selected-a'),
  selectedB: document.getElementById('selected-b'),
  selectedAMeta: document.getElementById('selected-a-meta'),
  selectedBMeta: document.getElementById('selected-b-meta'),
  hudNameA: document.getElementById('hud-name-a'),
  hudNameB: document.getElementById('hud-name-b'),
  hudHpA: document.getElementById('hud-hp-a'),
  hudHpB: document.getElementById('hud-hp-b'),
  hudBarA: document.getElementById('hud-bar-a'),
  hudBarB: document.getElementById('hud-bar-b'),
  hudCdA: document.getElementById('hud-cd-a'),
  hudCdB: document.getElementById('hud-cd-b'),
  commentary: document.getElementById('commentary-pop'),
  fightLog: document.getElementById('fight-log'),
  resultBox: document.getElementById('result-box'),
  recentFights: document.getElementById('recent-fights'),
  batchCount: document.getElementById('batch-count'),
  simulateBtn: document.getElementById('simulate-btn'),
  refreshBtn: document.getElementById('refresh-data'),
  forgeBtn: document.getElementById('forge-btn'),
  saveDraftBtn: document.getElementById('save-draft-btn'),
  savePublicBtn: document.getElementById('save-public-btn'),
  saveVariantBtn: document.getElementById('save-variant-btn'),
  championBanner: document.getElementById('champion-banner'),
  challengeBanner: document.getElementById('challenge-banner'),
  creatorName: document.getElementById('forge-creator-name'),
  forgePrompt: document.getElementById('forge-prompt'),
  forgeBalance: document.getElementById('forge-balance'),
  forgeModel: document.getElementById('forge-model'),
  forgedPreview: document.getElementById('forged-preview'),
  forgeStatus: document.getElementById('forge-status'),
  forgeValidation: document.getElementById('forge-validation'),
  forgeSaveState: document.getElementById('forge-save-state'),
  llmStatus: document.getElementById('llm-status'),
  charCount: document.getElementById('stat-character-count'),
  fightCount: document.getElementById('stat-fight-count'),
  selectedArchetypeLabel: document.getElementById('selected-archetype-label'),
  archetypeSummaryTitle: document.getElementById('archetype-summary-title'),
  archetypeSummary: document.getElementById('archetype-summary'),
  archetypeStrengths: document.getElementById('archetype-strengths'),
  archetypeWeaknesses: document.getElementById('archetype-weaknesses'),
  archetypeWinPattern: document.getElementById('archetype-win-pattern'),
  archetypeMatchupRead: document.getElementById('archetype-matchup-read'),
  archetypeRoleTags: document.getElementById('archetype-role-tags'),
};

els.archetypeButtons = Array.from(document.querySelectorAll('[data-archetype]'));

const rand = (min, max) => Math.random() * (max - min) + min;
const sample = (arr) => arr[Math.floor(Math.random() * arr.length)];

function refreshLocalRoster() {
  state.localRoster = loadRosterEntries();
  return state.localRoster;
}

function getRosterEntryForFighter(fighter) {
  return findRosterEntryByFighter(fighter, state.localRoster);
}

function isRosteredLocalFighter(fighter) {
  return Boolean(getRosterEntryForFighter(fighter));
}

function upsertLocalRosterFighter(fighter, options = {}) {
  const entry = upsertRosterEntry(fighter, options);
  refreshLocalRoster();
  return entry;
}

function removeLocalRosterFighter(fighter) {
  const entry = getRosterEntryForFighter(fighter);
  if (!entry) {
    return { removed: false, clearedChampion: false };
  }
  const clearedChampion = isChampionFighter(fighter, state.championState);
  const removed = removeRosterEntry(entry.entry_id);
  refreshLocalRoster();
  if (clearedChampion) {
    clearChampionState();
    state.championState = null;
  }
  return { removed, clearedChampion };
}

const ARCHETYPES = {
  assassin: {
    label: 'Assassin',
    summary: 'Fast opener that lives on first-touch burst and tempo theft.',
    strengths: ['Explosive first touch', 'Punishes hesitation', 'Snowballs short cooldown loops'],
    weaknesses: ['Falls off in long trades', 'Gets punished hard by armor or stalled tempo'],
    roleTags: ['Burst', 'Evasive', 'Punish'],
    matchupRead: 'Best when you want to read how a build handles explosive openers and tempo swings.',
    baseStats: { strength: 74, speed: 91, durability: 50, intelligence: 64, max_health: 102 },
    colors: ['#ff4d6d', '#fb7185', '#8b5cf6'],
    firstNames: ['Nyx', 'Vex', 'Kairo', 'Sable', 'Rin', 'Mira'],
    lastNames: ['Rift', 'Ghost', 'Needle', 'Hex', 'Shade', 'Volt'],
    titles: ['Night Circuit Reaper', 'Ghostblade Courier', 'Voltage Cutthroat'],
    passiveNames: ['Kill Switch Rhythm', 'Slipstream Nerves', 'Fatal Tempo'],
    passiveText: 'A clean opening converts into a short burst of momentum.',
    openerNames: ['Arc Lunge', 'Needle Rush', 'Shadow Dash'],
    buffNames: ['Ghost Mantle', 'Overclock Veil', 'Blink Sync'],
    finisherNames: ['Rift Splitter', 'Pulse Execution', 'Backline Collapse'],
    winCondition: 'Win initiative, convert the first clean touch, and never allow a stable reset.',
    balanceNotes: 'Explosive start, weak if forced into long defensive cycles.',
  },
  tank: {
    label: 'Tank',
    summary: 'Frontline anchor that slows the fight down and wins on staying power.',
    strengths: ['Blunts burst damage', 'Wins long rounds', 'Punishes reckless offense'],
    weaknesses: ['Slow to seize initiative', 'Can be outmaneuvered by cleaner tempo'],
    roleTags: ['Frontline', 'Attrition', 'Punish'],
    matchupRead: 'Best when you want to see whether a build can crack a wall instead of only winning short trades.',
    baseStats: { strength: 72, speed: 40, durability: 93, intelligence: 60, max_health: 150 },
    colors: ['#38bdf8', '#60a5fa', '#0ea5e9'],
    firstNames: ['Titan', 'Bastion', 'Grav', 'Morrow', 'Atlas', 'Karn'],
    lastNames: ['Ward', 'Forge', 'Bulwark', 'Anchor', 'Stone', 'Core'],
    titles: ['Iron Bastion', 'Wallbreaker Saint', 'Gravplate Sentinel'],
    passiveNames: ['Bulwark Protocol', 'Armor Echo', 'Siege Nerves'],
    passiveText: 'The first heavy hit each round is blunted by layered plating.',
    openerNames: ['Crusher Fist', 'Anchor Slam', 'Plate Crash'],
    buffNames: ['Fortress Stance', 'Siege Lock', 'Guard Array'],
    finisherNames: ['Citadel Crush', 'Shock Counter', 'Last Gate'],
    winCondition: 'Absorb the early burst, drag the duel long, then crush weakened offense.',
    balanceNotes: 'Reliable durability anchor for anti-burst and attrition tuning.',
  },
  bruiser: {
    label: 'Bruiser',
    summary: 'Midrange brawler that wins ugly by keeping exchanges active and costly.',
    strengths: ['Pressures through chip', 'Thrives in medium trades', 'Keeps re-engaging'],
    weaknesses: ['Can be kited by hard control', 'Less extreme than burst or tank specialists'],
    roleTags: ['Frontline', 'Attrition', 'Pressure'],
    matchupRead: 'Best when you want to see whether a fighter stays coherent under sustained pressure.',
    baseStats: { strength: 84, speed: 62, durability: 76, intelligence: 54, max_health: 134 },
    colors: ['#f97316', '#fb923c', '#ef4444'],
    firstNames: ['Morrow', 'Knox', 'Raze', 'Brakka', 'Vale', 'Talon'],
    lastNames: ['Fang', 'Breaker', 'Hammer', 'Maw', 'Drake', 'Howl'],
    titles: ['Pitbreaker', 'Ruin Collar', 'Warpath Enforcer'],
    passiveNames: ['War Drum', 'Brawler Pulse', 'Grounded Fury'],
    passiveText: 'Extended trades slowly tilt in this fighter’s favor.',
    openerNames: ['Maul Step', 'Rush Hook', 'Breaker Swing'],
    buffNames: ['Bloodup Roar', 'Iron Pulse', 'Scrap Engine'],
    finisherNames: ['Pile Driver', 'Riot Hammer', 'Bone Debt'],
    winCondition: 'Force medium-length exchanges and turn durability into unstoppable pressure.',
    balanceNotes: 'Excels when the fight stays messy and close.',
  },
  duelist: {
    label: 'Duelist',
    summary: 'Flexible all-rounder built around clean timing, spacing, and efficient punishment.',
    strengths: ['No major stat hole', 'Rewards disciplined sequencing', 'Adapts across matchups'],
    weaknesses: ['No extreme ceiling', 'Needs cleaner reads to beat specialists'],
    roleTags: ['Tempo', 'Punish', 'Balanced'],
    matchupRead: 'Best when you want a fair read without forcing an extreme burst or stall scenario.',
    baseStats: { strength: 72, speed: 78, durability: 68, intelligence: 72, max_health: 122 },
    colors: ['#22c55e', '#34d399', '#8b5cf6'],
    firstNames: ['Nova', 'Vesper', 'Astra', 'Cael', 'Iris', 'Sol'],
    lastNames: ['Vale', 'Rift', 'Quill', 'Drift', 'Shard', 'Mirror'],
    titles: ['Starforged Duelist', 'Mirrorpoint Ronin', 'Tempo Blade Saint'],
    passiveNames: ['Measured Edge', 'Adaptive Nerves', 'Clean Tempo'],
    passiveText: 'Proper spacing keeps the next exchange efficient and sharp.',
    openerNames: ['Arc Lunge', 'Halfstep Cut', 'Tempo Jab'],
    buffNames: ['Core Sync', 'Counter Ledger', 'Mirror Focus'],
    finisherNames: ['Rift Breaker', 'Final Measure', 'Pulse Verdict'],
    winCondition: 'Stay even on trades until superior timing creates a decisive swing.',
    balanceNotes: 'Solid baseline for fair midline combat and matchup comparisons.',
  },
  control: {
    label: 'Control',
    summary: 'Pace manipulator that wins by denying rhythm and forcing bad choices.',
    strengths: ['Breaks sequencing', 'Rewards long fights', 'Turns intelligence into tempo control'],
    weaknesses: ['Can lose raw damage races', 'Looks weaker in straight brawls'],
    roleTags: ['Control', 'Tempo', 'Punish'],
    matchupRead: 'Best when you want to see whether a build still functions under pace control and sequencing denial.',
    baseStats: { strength: 58, speed: 70, durability: 66, intelligence: 88, max_health: 118 },
    colors: ['#14b8a6', '#2dd4bf', '#38bdf8'],
    firstNames: ['Hex', 'Cipher', 'Luma', 'Vanta', 'Echo', 'Sorin'],
    lastNames: ['Locke', 'Signal', 'Weave', 'Static', 'Veil', 'Proxy'],
    titles: ['Signal Tyrant', 'Hologrid Binder', 'Tempo Warden'],
    passiveNames: ['Signal Jam', 'Cold Read', 'Pattern Snare'],
    passiveText: 'As the duel stretches on, enemy rhythm becomes easier to punish.',
    openerNames: ['Static Lash', 'Grid Tap', 'Signal Spike'],
    buffNames: ['Slowfield', 'Phase Script', 'Control Halo'],
    finisherNames: ['Override Spike', 'Pattern Break', 'Proxy Collapse'],
    winCondition: 'Distort the pace of the fight until the opponent is trapped in bad choices.',
    balanceNotes: 'Strong into reckless aggression, weaker if forced into raw damage races.',
  },
  glass_cannon: {
    label: 'Glass Cannon',
    summary: 'High-risk burst specialist that wins fast or dies fast.',
    strengths: ['Huge damage ceiling', 'Threatens instant kills', 'Forces respect every turn'],
    weaknesses: ['Little room to recover', 'Any clean punish hurts badly'],
    roleTags: ['Burst', 'High Risk', 'Evasive'],
    matchupRead: 'Best when you want to read burst ceilings, punish discipline, and fragile damage pacing.',
    baseStats: { strength: 86, speed: 80, durability: 46, intelligence: 70, max_health: 98 },
    colors: ['#facc15', '#f59e0b', '#fb7185'],
    firstNames: ['Sol', 'Astra', 'Pyre', 'Lux', 'Nova', 'Ruin'],
    lastNames: ['Vanta', 'Flare', 'Cinder', 'Glass', 'Volt', 'Star'],
    titles: ['Starglass Reaper', 'Sunwire Executioner', 'Overheat Prophet'],
    passiveNames: ['Solar Surge', 'Kill Pressure', 'Overburn Engine'],
    passiveText: 'Once the engine is primed, explosive turns hit much harder.',
    openerNames: ['Helio Cut', 'Flash Rend', 'Prism Strike'],
    buffNames: ['Prism Burn', 'Overheat Hymn', 'Breaklight'],
    finisherNames: ['Sunpiercer', 'Final Flare', 'Meteor Edge'],
    winCondition: 'Find first blood, snowball the burst cycle, and avoid every bad trade.',
    balanceNotes: 'Scary damage profile with very little margin for error.',
  },
};

const BALANCE_PROFILES = {
  '50/50': { strength: 0, speed: 0, durability: 0, intelligence: 0, max_health: 0 },
  aggressive: { strength: 5, speed: 4, durability: -5, intelligence: -2, max_health: -8 },
  tank: { strength: -2, speed: -5, durability: 7, intelligence: 0, max_health: 14 },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function appendChildren(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  list.flat(Infinity).forEach((child) => {
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
      element.textContent = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        if (dataValue != null) {
          element.dataset[dataKey] = String(dataValue);
        }
      });
    } else {
      element.setAttribute(key, String(value));
    }
  });
  return appendChildren(element, children);
}

function setChildren(target, children = []) {
  if (!target) {
    return;
  }
  target.replaceChildren();
  appendChildren(target, children);
}

function statusNode(className, message) {
  return node('p', { className, text: message });
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? value.trim() : '#8b5cf6';
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeCreatorName(value) {
  return normalizeWhitespace(value).slice(0, MAX_CREATOR_NAME_LENGTH);
}

function slugLabel(value) {
  return String(value || '')
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function truncateText(value, maxLength = 96) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function getArchetypeGuide(archetype) {
  return ARCHETYPES[archetype] || ARCHETYPES.duelist;
}

function fightersMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left.id != null && right.id != null) {
    return Number(left.id) === Number(right.id);
  }
  if (left.slug && right.slug) {
    return left.slug === right.slug;
  }
  return normalizeWhitespace(left.name).toLowerCase() === normalizeWhitespace(right.name).toLowerCase();
}

function isBattleEligible(fighter) {
  return Boolean(
    fighter
    && fighter.id != null
    && fighter.visibility === 'public'
    && fighter.can_battle === true
    && fighter.is_benchmark !== true
  );
}

function resolvePublicBattleFighter(fighter) {
  if (!fighter) {
    return null;
  }
  return state.characters.find(
    (character) => fightersMatch(character, fighter) && isBattleEligible(character)
  ) || null;
}

function resolveChampionFighter() {
  if (!state.championState?.fighter) {
    return null;
  }
  if (state.savedForge?.fighter && fightersMatch(state.savedForge.fighter, state.championState.fighter)) {
    return state.savedForge.fighter;
  }
  const rosterMatch = state.localRoster.find((entry) => fightersMatch(entry.fighter, state.championState.fighter));
  if (rosterMatch?.fighter) {
    return rosterMatch.fighter;
  }
  return null;
}

function syncChampionStateFromRoster() {
  if (!state.championState?.fighter) {
    return;
  }
  const resolved = resolveChampionFighter();
  if (resolved) {
    state.championState = designateChampion(resolved, state.championState);
    return;
  }
  clearChampionState();
  state.championState = null;
}

function designateChampionWithRoster(fighter, options = {}) {
  if (!fighter) {
    return null;
  }

  upsertLocalRosterFighter(fighter, {
    origin_type: options.originType || 'public_library',
    source_page: options.sourcePage || state.pageMode,
  });
  state.championState = designateChampion(fighter, state.championState);
  return state.championState;
}

function renderChampionBanner() {
  if (!els.championBanner) {
    return;
  }

  const summary = getChampionSummary(state.championState);
  if (!summary) {
    const selectedLabel = state.selectedA?.name ? `Make ${state.selectedA.name} your champion` : 'Claim a champion from the roster';
    setChildren(els.championBanner, node('div', { className: 'champion-banner champion-banner--empty' }, [
      node('div', { className: 'champion-banner__layout champion-banner__layout--empty' }, [
        node('div', {}, [
          node('p', { className: 'champion-banner__eyebrow', text: 'Champion Slot' }),
          node('h2', { className: 'champion-banner__title', text: 'No current champion' }),
          node('p', {
            className: 'champion-banner__copy',
            text: 'Tag one fighter as your headliner. ClashForge keeps a local identity card, rivalry notes, and official battle recap history for that pick.',
          }),
        ]),
        node('div', { className: 'champion-banner__actions' }, [
          state.selectedA ? node('button', {
            type: 'button',
            className: 'champion-banner-action button button--warning',
            dataset: { action: 'claim-selected' },
            text: selectedLabel,
          }) : null,
        ]),
      ]),
    ]));
  } else {
    const champion = summary.champion;
    const resolved = resolveChampionFighter();
    const color = safeColor(champion.avatar_color);
    const guide = getArchetypeGuide(champion.archetype || 'duelist');
    const rivalryText = summary.rivalry
      ? `${summary.rivalry.name} · ${summary.rivalry.count} local sets`
      : 'No rivalry locked in yet';
    const notableText = summary.notableWin?.wins
      ? `${summary.notableWin.name} · ${summary.notableWin.wins} wins`
      : 'No statement win yet';
    const lastResultText = summary.lastResult
      ? truncateText(summary.lastResult.summary || `${summary.lastResult.sim_count} sim set logged against ${summary.lastResult.opponent_name}.`, 120)
      : 'No official champion battle logged yet.';

    const metric = (label, value, note = null, small = false) => node('div', { className: 'champion-banner__metric' }, [
      node('p', { className: 'champion-banner__metric-label', text: label }),
      node('p', {
        className: `champion-banner__metric-value${small ? ' champion-banner__metric-value--small' : ''}`,
        text: value,
      }),
      note ? node('p', { className: 'champion-banner__metric-note', text: note }) : null,
    ]);
    setChildren(els.championBanner, node('div', { className: 'champion-banner champion-banner--active' }, [
      node('div', { className: 'champion-banner__layout' }, [
        node('div', { className: 'champion-banner__identity' }, [
          node('div', {
            className: 'champion-banner__avatar',
            style: { background: color, boxShadow: `0 0 24px ${color}55` },
          }),
          node('div', {}, [
            node('div', { className: 'champion-banner__kicker-row' }, [
              node('p', { className: 'champion-banner__eyebrow', text: 'Current Champion' }),
              node('span', { className: 'meta-pill meta-pill--amber', text: 'Local Identity' }),
            ]),
            node('h2', { className: 'champion-banner__title', text: champion.name }),
            node('p', { className: 'champion-banner__subtitle', text: champion.title || 'Untitled headliner' }),
            node('p', { className: 'champion-banner__guide', text: `${guide.label} feel` }),
            node('p', { className: 'champion-banner__copy', text: guide.summary }),
          ]),
        ]),
        node('div', { className: 'champion-banner__metrics' }, [
          metric('Local Sims', summary.totalSims, `${summary.wins}W ${summary.losses}L ${summary.draws}D`),
          metric('Rivalry', rivalryText, null, true),
          metric('Notable Win', notableText, null, true),
          metric('Last Report', lastResultText, null, true),
        ]),
      ]),
      node('div', { className: 'champion-banner__actions' }, [
        resolved ? node('button', {
          type: 'button',
          className: 'champion-banner-action button button--primary',
          dataset: { action: 'use-a' },
          text: 'Use In Arena',
        }) : null,
        resolved ? node('button', {
          type: 'button',
          className: 'champion-banner-action button button--accent',
          dataset: { action: 'reforge' },
          text: 'Load To Forge',
        }) : null,
        champion.slug ? node('a', {
          href: `/fighters/${encodeURIComponent(champion.slug)}/`,
          className: 'button-link button--ghost',
          text: 'Open Profile',
        }) : null,
        node('button', {
          type: 'button',
          className: 'champion-banner-action button button--warning',
          dataset: { action: 'clear' },
          text: 'Clear Champion',
        }),
      ]),
    ]));
  }

  els.championBanner.querySelectorAll('.champion-banner-action').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'claim-selected' && state.selectedA) {
        designateChampionWithRoster(state.selectedA, {
          originType: 'public_library',
          sourcePage: 'arena',
        });
        renderChampionBanner();
        renderCharacterList();
        renderSelection();
        renderForgeSaveState();
        setForgeStatus('info', `${state.selectedA.name} is now your local champion.`);
        return;
      }
      if (action === 'use-a') {
        const champion = resolveChampionFighter();
        if (!champion) {
          return;
        }
        pickFighterForSlot('A', champion);
        setForgeStatus('info', `${champion.name} loaded into Arena slot A.`);
        return;
      }
      if (action === 'reforge') {
        const champion = resolveChampionFighter();
        if (!champion) {
          return;
        }
        if (state.pageMode !== 'forge') {
          window.location.href = getFighterForgeUrl(champion);
          return;
        }
        loadFighterIntoForge(champion, { message: `${state.championState?.fighter?.name || 'Champion'} loaded into the forge.` });
        return;
      }
      if (action === 'clear') {
        clearChampionState();
        state.championState = null;
        renderChampionBanner();
        renderCharacterList();
        renderSelection();
        renderForgeSaveState();
      }
    });
  });
}

function renderChampionBattleNote() {
  const summary = getChampionSummary(state.championState);
  if (!summary) {
    return null;
  }
  if (!isChampionFighter(state.selectedA, state.championState) && !isChampionFighter(state.selectedB, state.championState)) {
    return null;
  }

  const rivalryText = summary.rivalry
    ? `${summary.rivalry.name} keeps showing up (${summary.rivalry.count} logged sets).`
    : 'No rivalry has formed yet.';
  const notableText = summary.notableWin?.wins
    ? `Best farm so far: ${summary.notableWin.name} (${summary.notableWin.wins} wins).`
    : 'Still waiting on a signature matchup.';

  return node('div', { className: 'battle-note-card' }, [
    node('p', { className: 'battle-note-card__label', text: 'Champion Report' }),
    node(
      'p',
      {
        className: 'battle-note-card__body',
        text: `${summary.champion.name} now sits at ${summary.wins}W ${summary.losses}L ${summary.draws}D across ${summary.totalSims} local official sims. ${rivalryText} ${notableText}`,
      }
    ),
  ]);
}

function buildArenaUrl(query = {}) {
  const url = new URL(window.location.href);
  url.pathname = arenaPath;
  url.search = '';
  Object.entries(query).forEach(([key, value]) => {
    if (value != null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function buildForgeUrl(query = {}) {
  const url = new URL(window.location.href);
  url.pathname = forgePath;
  url.search = '';
  Object.entries(query).forEach(([key, value]) => {
    if (value != null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function buildRosterArenaUrl(entryId, slot = 'A') {
  const key = slot === 'B' ? 'roster_b' : 'roster_a';
  return buildArenaUrl({ [key]: entryId });
}

function buildRosterForgeUrl(entryId) {
  return buildForgeUrl({ roster: entryId });
}

function getFighterShareUrl(fighter) {
  if (!fighter?.slug) {
    return '';
  }
  return new URL(`/fighters/${encodeURIComponent(fighter.slug)}/`, window.location.origin).toString();
}

function getFighterChallengeUrl(fighter) {
  return fighter?.slug && isBattleEligible(fighter) ? buildArenaUrl({ challenge: fighter.slug }) : '';
}

function getFighterForgeUrl(fighter) {
  return fighter?.slug ? buildForgeUrl({ forge: fighter.slug }) : '';
}

function getVisibilitySummary(fighter) {
  if (!fighter) {
    return '';
  }
  return fighter.visibility === 'unlisted'
    ? 'Unlisted keeps the fighter off the public roster. Direct links can view or duplicate it, but official public battles require a published variant.'
    : 'Public puts the fighter in the roster and on the share page. Challenge links still only share the fighter, not edit authority.';
}

function updateArenaQuery(updates = {}) {
  const url = new URL(window.location.href);
  Object.entries(updates).forEach(([key, value]) => {
    if (value == null || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  });
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

async function copyTextToClipboard(text) {
  if (!text) {
    throw new Error('Nothing to copy.');
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const probe = document.createElement('textarea');
  probe.value = text;
  probe.setAttribute('readonly', 'readonly');
  probe.className = 'fixed -left-[9999px] top-0';
  document.body.appendChild(probe);
  probe.select();
  document.execCommand('copy');
  document.body.removeChild(probe);
}

function chooseChallengeChallenger(target) {
  const champion = resolveChampionFighter();
  if (champion && isBattleEligible(champion) && !fightersMatch(champion, target)) {
    return champion;
  }
  if (state.savedForge?.fighter && isBattleEligible(state.savedForge.fighter) && !fightersMatch(state.savedForge.fighter, target)) {
    return state.savedForge.fighter;
  }
  if (state.selectedA && isBattleEligible(state.selectedA) && !fightersMatch(state.selectedA, target)) {
    return state.selectedA;
  }
  return state.characters.find((fighter) => isBattleEligible(fighter) && !fightersMatch(fighter, target)) || null;
}

async function fetchShareableFighterBySlug(slug) {
  return apiJson(`/api/fighters/by-slug/${encodeURIComponent(slug)}/`);
}

async function hydrateRosterIntentFromUrl() {
  refreshLocalRoster();
  const params = new URLSearchParams(window.location.search);
  const rosterAId = normalizeWhitespace(params.get('roster_a') || '');
  const rosterBId = normalizeWhitespace(params.get('roster_b') || '');
  const rosterForgeId = normalizeWhitespace(params.get('roster') || '');

  if (state.pageMode === 'forge' && rosterForgeId) {
    const entry = findRosterEntryById(rosterForgeId, state.localRoster);
    if (!entry) {
      setForgeStatus('error', 'That local roster fighter is not available in this browser anymore.');
      return;
    }

    loadFighterIntoForge(entry.fighter, {
      message: `${entry.fighter.name} loaded from your local roster as a local snapshot.`,
      scroll: false,
    });
    return;
  }

  if (state.pageMode !== 'arena' || (!rosterAId && !rosterBId)) {
    return;
  }

  const rosterA = rosterAId ? findRosterEntryById(rosterAId, state.localRoster) : null;
  const rosterB = rosterBId ? findRosterEntryById(rosterBId, state.localRoster) : null;

  const rosterAFighter = resolvePublicBattleFighter(rosterA?.fighter);
  const rosterBFighter = resolvePublicBattleFighter(rosterB?.fighter);

  if (rosterAFighter) {
    state.selectedA = rosterAFighter;
  }
  if (rosterBFighter) {
    state.selectedB = rosterBFighter;
  }

  if (state.selectedA?.id === state.selectedB?.id) {
    const alternate = state.characters.find(
      (character) => isBattleEligible(character) && character.id !== state.selectedA?.id
    );
    if (alternate) {
      state.selectedB = alternate;
    }
  }

  renderSelection();
  renderCharacterList();
  resetArenaFighters();

  const loadedNames = [rosterA?.fighter?.name, rosterB?.fighter?.name].filter(Boolean);
  if (loadedNames.length) {
    const eligibleNames = [state.selectedA?.name, state.selectedB?.name].filter(Boolean);
    setForgeStatus(
      'info',
      eligibleNames.length
        ? `Local roster loaded into Arena: ${eligibleNames.join(' vs ')}.`
        : 'Those local roster fighters are not eligible for official public battles.'
    );
  }
}

function renderShareIntentBanner() {
  if (!els.challengeBanner) {
    return;
  }

  const intent = state.shareIntent;
  if (!intent?.fighter) {
    els.challengeBanner.replaceChildren();
    return;
  }

  const fighter = intent.fighter;
  const guide = getArchetypeGuide(fighter.archetype || 'duelist');
  const visibilityLabel = fighter.visibility === 'unlisted' ? 'Unlisted Link' : 'Public Share';
  const challengeLink = getFighterChallengeUrl(fighter);
  const forgeLink = getFighterForgeUrl(fighter);
  const duplicateLink = `${forgeLink}${forgeLink.includes('?') ? '&' : '?'}duplicate=1`;
  const rosterEntry = getRosterEntryForFighter(fighter);
  const actionLabel = intent.type === 'variant'
    ? 'Variant Branch Loaded'
    : intent.type === 'forge'
      ? 'Shared Build Loaded'
      : 'Challenge Target Loaded';
  const bodyText = intent.type === 'variant'
    ? `${fighter.name} was copied into Forge as a local branch point. Save from there to create your own variant without editing the original fighter.`
    : intent.type === 'forge'
      ? `${fighter.name} was pulled in from a share page and loaded into the forge as a reference.`
    : isBattleEligible(fighter)
      ? `${fighter.name} is sitting in slot B as a challenge target. Bring your champion, current build, or a fresh counter-pick.`
      : `${fighter.name} is available as a share reference. Duplicate it into Forge and publish your own variant before running official public battles.`;

  const primaryActions = intent.type === 'challenge' && isBattleEligible(fighter)
    ? [
        node('button', {
          type: 'button',
          className: 'share-intent-action button button--primary',
          dataset: { action: 'run' },
          text: 'Run Matchup',
        }),
        node('button', {
          type: 'button',
          className: 'share-intent-action button button--ghost',
          dataset: { action: 'swap' },
          text: 'Swap Sides',
        }),
      ]
    : [
        node('button', {
          type: 'button',
          className: 'share-intent-action button button--primary',
          dataset: { action: 'challenge' },
          text: intent.type === 'variant' || !isBattleEligible(fighter) ? 'Publish A Variant First' : 'Challenge This Fighter',
        }),
      ];

  setChildren(els.challengeBanner, node('div', { className: 'share-banner' }, [
    node('div', { className: 'share-banner__layout' }, [
      node('div', {}, [
        node('div', { className: 'share-banner__kicker-row' }, [
          node('p', { className: 'share-banner__eyebrow', text: actionLabel }),
          node('span', { className: 'tag', text: visibilityLabel }),
          node('span', { className: 'tag', text: slugLabel(fighter.archetype || 'duelist') }),
        ]),
        node('h2', { className: 'share-banner__title', text: fighter.name }),
        node('p', { className: 'share-banner__subtitle', text: fighter.title || 'Untitled share target' }),
        fighter.creator_name ? node('p', { className: 'share-banner__creator', text: `Forged by ${fighter.creator_name}` }) : null,
        node('p', { className: 'share-banner__copy', text: bodyText }),
        node('p', { className: 'share-banner__note', text: guide.summary }),
      ]),
      node('div', { className: 'share-banner__metrics' }, [
        node('div', { className: 'share-banner__metric' }, [
          node('p', { className: 'share-banner__metric-label', text: 'Fight Read' }),
          node('p', { className: 'share-banner__metric-value', text: getWinPatternText(fighter) }),
        ]),
        node('div', { className: 'share-banner__metric' }, [
          node('p', { className: 'share-banner__metric-label', text: 'Share Read' }),
          node('p', { className: 'share-banner__metric-value', text: getVisibilitySummary(fighter) }),
        ]),
      ]),
    ]),
    node('div', { className: 'share-banner__actions' }, [
      primaryActions,
      node('button', {
        type: 'button',
        className: 'share-intent-action button button--accent',
        dataset: { action: 'duplicate' },
        text: 'Duplicate As Variant',
      }),
      node('a', { href: forgeLink, className: 'button-link button--ghost', text: 'Inspect In Forge' }),
      node('button', {
        type: 'button',
        className: 'share-intent-action button button--secondary',
        dataset: { action: 'roster' },
        text: rosterEntry ? 'Remove From Roster' : 'Add To Roster',
      }),
      challengeLink ? node('button', {
        type: 'button',
        className: 'share-intent-action button button--secondary',
        dataset: { action: 'copy-challenge' },
        text: 'Copy Challenge Link',
      }) : null,
      fighter.slug ? node('a', {
        href: getFighterShareUrl(fighter),
        className: 'button-link button--ghost',
        text: 'Open Profile',
      }) : null,
      node('button', {
        type: 'button',
        className: 'share-intent-action button button--warning',
        dataset: { action: 'clear' },
        text: 'Clear',
      }),
    ]),
  ]));

  els.challengeBanner.querySelectorAll('.share-intent-action').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      if (action === 'run') {
        await handleSimulate();
        return;
      }
      if (action === 'swap') {
        const left = state.selectedA;
        state.selectedA = state.selectedB;
        state.selectedB = left;
        renderSelection();
        renderCharacterList();
        resetArenaFighters();
        setForgeStatus('info', 'Challenge sides swapped.');
        return;
      }
      if (action === 'challenge') {
        if (!isBattleEligible(fighter)) {
          setForgeStatus('info', 'Unlisted shared fighters cannot run official public battles. Duplicate and publish a variant first.');
          return;
        }
        if (state.pageMode !== 'arena') {
          window.location.href = challengeLink;
          return;
        }
        const challenger = chooseChallengeChallenger(fighter);
        if (challenger) {
          state.selectedA = challenger;
        }
        state.selectedB = fighter;
        state.shareIntent = { type: 'challenge', fighter };
        updateArenaQuery({ challenge: fighter.slug });
        renderSelection();
        renderCharacterList();
        resetArenaFighters();
        renderShareIntentBanner();
        setForgeStatus('info', `${fighter.name} moved into Arena slot B as a challenge target.`);
        return;
      }
      if (action === 'duplicate') {
        if (state.pageMode !== 'forge') {
          window.location.href = duplicateLink;
          return;
        }
        loadFighterIntoForge(fighter, {
          message: `${fighter.name} copied into Forge as a new local variant starting point. Saving from here creates your own branch, not an edit of the original.`,
          forceLocalCopy: true,
          importContext: {
            mode: 'duplicate',
            sourceName: fighter.name,
            sourceSlug: fighter.slug || '',
          },
        });
        updateArenaQuery({ forge: fighter.slug, duplicate: '1' });
        return;
      }
      if (action === 'copy-challenge') {
        try {
          await copyTextToClipboard(challengeLink);
          setForgeStatus('success', 'Challenge link copied.');
        } catch (error) {
          setForgeStatus('error', error.message);
        }
        return;
      }
      if (action === 'roster') {
        if (rosterEntry) {
          const removal = removeLocalRosterFighter(fighter);
          renderShareIntentBanner();
          renderChampionBanner();
          renderCharacterList();
          renderSelection();
          renderForgeSaveState();
          setForgeStatus('info', removal.clearedChampion ? `${fighter.name} removed from your local roster and cleared as champion.` : `${fighter.name} removed from your local roster.`);
          return;
        }

        upsertLocalRosterFighter(fighter, {
          origin_type: 'shared_profile',
          source_page: state.pageMode,
        });
        renderShareIntentBanner();
        renderCharacterList();
        renderForgeSaveState();
        setForgeStatus('success', `${fighter.name} added to your local roster.`);
        return;
      }
      if (action === 'clear') {
        state.shareIntent = null;
        updateArenaQuery({ challenge: null, forge: null, duplicate: null });
        renderShareIntentBanner();
      }
    });
  });
}

async function hydrateShareIntentFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const challengeSlug = normalizeWhitespace(params.get('challenge') || '');
  const forgeSlug = normalizeWhitespace(params.get('forge') || '');
  const duplicateMode = params.get('duplicate') === '1';
  state.shareIntent = null;

  if (!challengeSlug && !forgeSlug) {
    renderShareIntentBanner();
    return;
  }

  // Share links can target unlisted fighters, so the arena hydrates them through a
  // dedicated read-only slug lookup instead of assuming they are already in bootstrap.
  const resolveBySlug = async (slug) => {
    if (!slug) {
      return null;
    }
    const rosterMatch = state.characters.find((fighter) => fighter.slug === slug);
    if (rosterMatch) {
      return rosterMatch;
    }
    try {
      return await fetchShareableFighterBySlug(slug);
    } catch (error) {
      setForgeStatus('error', `Shared fighter link could not be loaded: ${error.message}`);
      return null;
    }
  };

  if (challengeSlug) {
    const challengeTarget = await resolveBySlug(challengeSlug);
    if (challengeTarget && isBattleEligible(challengeTarget)) {
      const challenger = chooseChallengeChallenger(challengeTarget);
      if (challenger) {
        state.selectedA = challenger;
      }
      state.selectedB = challengeTarget;
      state.shareIntent = {
        type: 'challenge',
        fighter: challengeTarget,
      };
      renderSelection();
      renderCharacterList();
      resetArenaFighters();
      setForgeStatus('info', `Challenge target loaded: ${challengeTarget.name}.`);
    } else {
      if (challengeTarget) {
        setForgeStatus('info', 'This shared fighter is not available for official public battles. Duplicate it into Forge first.');
      }
      updateArenaQuery({ challenge: null });
    }
  }

  if (forgeSlug) {
    const forgeTarget = await resolveBySlug(forgeSlug);
    if (forgeTarget) {
      loadFighterIntoForge(forgeTarget, {
        message: duplicateMode
          ? `${forgeTarget.name} copied into Forge as a new local variant starting point. Saving from here creates your own branch, not an edit of the original.`
          : `${forgeTarget.name} loaded from a shared link into the forge as a read-only reference starting point.`,
        scroll: false,
        forceLocalCopy: duplicateMode,
        importContext: {
          mode: duplicateMode ? 'duplicate' : 'reference',
          sourceName: forgeTarget.name,
          sourceSlug: forgeTarget.slug || '',
        },
      });
      state.shareIntent = {
        type: duplicateMode ? 'variant' : (challengeSlug ? 'challenge' : 'forge'),
        fighter: challengeSlug && state.shareIntent?.fighter ? state.shareIntent.fighter : forgeTarget,
      };
    } else {
      updateArenaQuery({ forge: null });
    }
  }

  renderShareIntentBanner();
}

function normalizeRoleTag(tag) {
  return {
    anchor: 'Frontline',
    burst: 'Burst',
    control: 'Control',
    fundamentals: 'Balanced',
    'high-risk': 'High Risk',
    footsies: 'Punish',
    pressure: 'Pressure',
    risk: 'High Risk',
    scrap: 'Attrition',
    tempo: 'Tempo',
    'tempo-denial': 'Control',
  }[String(tag || '').toLowerCase()] || '';
}

function deriveRoleTags(fighter, limit = 3) {
  const guide = getArchetypeGuide(fighter.archetype || inferArchetypeFromStats(fighter));
  const tags = [...(guide.roleTags || [])];
  const stateTags = Array.isArray(fighter.fighter_state?.tags) ? fighter.fighter_state.tags : [];
  stateTags.forEach((tag) => {
    const normalized = normalizeRoleTag(tag);
    if (normalized && !tags.includes(normalized)) {
      tags.push(normalized);
    }
  });

  const hasDamageAmp = (fighter.abilities || []).some(
    (ability) => ability.type === 'buff' && Number(ability.effect?.damage_mult || 1) > 1.12
  );
  const hasSpeedControl = (fighter.abilities || []).some(
    (ability) =>
      ability.type === 'buff'
      && (
        Number(ability.effect?.speed_mult || 1) < 1
        || Number(ability.effect?.stun_chance || 0) > 0
      )
  );

  if ((fighter.strength ?? 0) >= 82 || hasDamageAmp) {
    tags.push('Burst');
  }
  if ((fighter.speed ?? 0) >= 84) {
    tags.push('Evasive');
  }
  if ((fighter.durability ?? 0) >= 80 || (fighter.max_health ?? 0) >= 145) {
    tags.push('Frontline');
  }
  if ((fighter.durability ?? 0) >= 72 && (fighter.max_health ?? 0) >= 130) {
    tags.push('Attrition');
  }
  if ((fighter.intelligence ?? 0) >= 82 || hasSpeedControl) {
    tags.push('Control');
  }
  if ((fighter.speed ?? 0) >= 76 && (fighter.intelligence ?? 0) >= 70) {
    tags.push('Punish');
  }

  return Array.from(new Set(tags)).slice(0, limit);
}

function renderRoleTagPills(tags) {
  return tags.map((tag) => node('span', { className: 'character-card__tag', text: tag }));
}

function getStatIdentity(fighter) {
  const ranked = [
    ['STR', fighter.strength],
    ['SPD', fighter.speed],
    ['DUR', fighter.durability],
    ['INT', fighter.intelligence],
  ].sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  return `${ranked[0][0]}/${ranked[1][0]} lean`;
}

function getWinPatternText(fighter) {
  return normalizeWhitespace(fighter.win_condition || '') || getArchetypeGuide(fighter.archetype).winCondition;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function extractApiError(payload) {
  if (!payload) {
    return 'Request failed.';
  }
  if (typeof payload.detail === 'string') {
    return payload.detail;
  }
  if (Array.isArray(payload.non_field_errors) && payload.non_field_errors[0]) {
    return payload.non_field_errors[0];
  }
  return flattenApiErrors(payload)[0] || 'Request failed.';
}

function flattenApiErrors(payload, prefix = '') {
  if (payload == null) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((entry, index) => {
      if (typeof entry === 'string') {
        return [`${prefix}${entry}`];
      }
      const nextPrefix = prefix || `Item ${index + 1}: `;
      return flattenApiErrors(entry, nextPrefix);
    });
  }

  if (typeof payload === 'object') {
    return Object.entries(payload).flatMap(([key, value]) => {
      const label = key === 'non_field_errors'
        ? prefix
        : `${prefix}${slugLabel(key)}: `;
      return flattenApiErrors(value, label);
    });
  }

  return [`${prefix}${payload}`];
}

async function apiJson(url, options = {}) {
  const requestOptions = { ...options };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const headers = new Headers(requestOptions.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    headers.set('X-ClashForge-Client', 'web');
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
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
    const apiError = new Error(extractApiError(payload));
    apiError.payload = payload;
    apiError.status = response.status;
    throw apiError;
  }

  return payload;
}

async function requestCreativeAssist(fighter, prompt, model) {
  return apiJson('/api/forge/creative/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCreativeAssistPayload(fighter, prompt, model)),
  });
}

function sortCharacters(characters) {
  return characters.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function getArenaQueue() {
  if (state.localRoster.length) {
    const rosterFighters = state.localRoster
      .map((entry) => entry.fighter)
      .map(resolvePublicBattleFighter)
      .filter(Boolean);
    const uniqueRosterFighters = [...new Map(rosterFighters.map((fighter) => [fighter.id, fighter])).values()];
    if (uniqueRosterFighters.length) {
      return uniqueRosterFighters;
    }
  }
  return state.characters.filter(isBattleEligible).slice(0, 4);
}

function getLibraryPool() {
  if (state.pageMode === 'arena') {
    return getArenaQueue();
  }
  return state.characters;
}

function chooseDefaultArenaFighters() {
  const arenaQueue = getArenaQueue();
  const preferredA = arenaQueue.find((fighter) => fighter.name === 'Raze') || arenaQueue[0] || null;
  const preferredB =
    arenaQueue.find((fighter) => fighter.name === 'Titan' && fighter.id !== preferredA?.id) ||
    arenaQueue.find((fighter) => fighter.id !== preferredA?.id) ||
    arenaQueue[0] ||
    null;

  state.selectedA = preferredA;
  state.selectedB = preferredB;
}

async function bootstrap() {
  const data = await apiJson('/api/bootstrap/');
  state.characters = sortCharacters(data.fighters || data.characters || []);
  refreshLocalRoster();
  state.recentFights = data.recent_battles || data.recent_fights || [];
  syncChampionStateFromRoster();
  chooseDefaultArenaFighters();
  renderChampionBanner();
  renderCharacterList();
  renderSelection();
  renderRecentFights();
  renderForgeStatus();
  renderForgeValidation();
  renderForgeSaveState();
  updateForgeActionState();
  updateStats();
  await hydrateRosterIntentFromUrl();
  await hydrateShareIntentFromUrl();
  if (!state.pixi) {
    await setupArena();
  } else {
    resetArenaFighters();
  }
}

function updateStats() {
  if (!els.charCount || !els.fightCount) {
    return;
  }
  els.charCount.textContent = String(getLibraryPool().length);
  els.fightCount.textContent = state.recentFights.length;
}

function pickFighterForSlot(slot, picked) {
  if (!picked) {
    return;
  }

  if (slot === 'A') {
    state.selectedA = picked;
  } else {
    state.selectedB = picked;
  }

  if (state.selectedA?.id === state.selectedB?.id) {
    const alternate = getLibraryPool().find((character) => character.id !== picked.id);
    if (slot === 'A') {
      state.selectedB = alternate || picked;
    } else {
      state.selectedA = alternate || picked;
    }
  }

  renderCharacterList();
  renderSelection();
  resetArenaFighters();
}

function renderCharacterList() {
  if (!els.list || !els.search) {
    return;
  }

  const query = els.search.value.trim().toLowerCase();
  const isForgePage = state.pageMode === 'forge';
  const pool = getLibraryPool();
  const filtered = pool.filter(
    (character) =>
      character.name.toLowerCase().includes(query) ||
      (character.title || '').toLowerCase().includes(query) ||
      (character.archetype || '').toLowerCase().includes(query) ||
      getArchetypeGuide(character.archetype || 'duelist').summary.toLowerCase().includes(query) ||
      (character.description || '').toLowerCase().includes(query)
  );

  if (!filtered.length) {
    setChildren(els.list, node('p', { className: 'character-list-empty', text: 'No fighters match that search.' }));
  } else {
    setChildren(
      els.list,
      filtered.map((character) => {
        const isSelected =
          state.selectedA?.id === character.id || state.selectedB?.id === character.id;
        const isChampion = isChampionFighter(character, state.championState);
        const rosterEntry = getRosterEntryForFighter(character);
        const color = safeColor(character.avatar_color);
        const summaryText = truncateText(
          character.description || getArchetypeGuide(character.archetype || 'duelist').summary,
          120
        );
        const footerText = `Win pattern: ${truncateText(getWinPatternText(character), 92)}`;
        const challengeUrl = getFighterChallengeUrl(character);
        const actions = isForgePage
          ? [
              challengeUrl ? node('a', {
                href: challengeUrl,
                className: 'character-slot-pick character-slot-pick--challenge button-link button--primary',
                text: 'Arena Challenge',
              }) : null,
            ]
          : [
              node('button', {
                className: 'character-slot-pick button button--primary',
                dataset: { id: character.id, slot: 'A' },
                type: 'button',
                text: 'Pick A',
              }),
              node('button', {
                className: 'character-slot-pick character-slot-pick--secondary button button--secondary',
                dataset: { id: character.id, slot: 'B' },
                type: 'button',
                text: 'Pick B',
              }),
            ];

        return node('div', {
          className: `character-card ${isSelected ? 'active' : ''} ${isChampion ? 'character-card--champion' : ''}`,
        }, [
          node('button', {
            className: 'character-select character-card__select',
            dataset: { id: character.id },
            type: 'button',
          }, [
            node('div', { className: 'character-card__layout' }, [
              node('div', {
                className: 'character-card__avatar',
                style: { background: color, boxShadow: `0 0 18px ${color}55` },
              }),
              node('div', { className: 'character-card__body' }, [
                node('div', { className: 'character-card__header' }, [
                  node('div', { className: 'character-card__identity' }, [
                    node('p', { className: 'character-card__name', text: character.name }),
                    node('p', { className: 'character-card__title', text: character.title || 'Unnamed menace' }),
                    character.creator_name ? node('p', { className: 'character-card__creator', text: `Forged by ${character.creator_name}` }) : null,
                  ]),
                  node('div', { className: 'character-card__badges' }, [
                    isChampion ? node('span', { className: 'character-card__badge character-card__badge--champion', text: 'Your Champion' }) : null,
                    rosterEntry ? node('span', { className: 'character-card__badge character-card__badge--roster', text: 'In Roster' }) : null,
                    node('span', {
                      className: 'character-card__badge character-card__badge--archetype',
                      text: slugLabel(character.archetype || 'duelist'),
                    }),
                  ]),
                ]),
                node('p', { className: 'character-card__summary', text: summaryText }),
                node('div', { className: 'character-card__stats' }, [
                  node('span', { text: `STR ${character.strength}` }),
                  node('span', { text: `SPD ${character.speed}` }),
                  node('span', { text: `DUR ${character.durability}` }),
                  node('span', { text: `HP ${character.max_health}` }),
                ]),
                node('div', { className: 'character-card__tags' }, renderRoleTagPills(deriveRoleTags(character))),
                node('p', { className: 'character-card__note', text: footerText }),
              ]),
            ]),
          ]),
          node('div', { className: 'character-card__footer' }, [
            node('div', { className: 'character-card__actions' }, [
              actions,
              node('button', {
                className: 'character-reforge button button--accent',
                dataset: { id: character.id },
                type: 'button',
                text: 'Load To Forge',
              }),
              node('button', {
                className: 'character-roster button button--secondary',
                dataset: { id: character.id, action: rosterEntry ? 'remove' : 'add' },
                type: 'button',
                text: rosterEntry ? 'Remove Roster' : 'Add To Roster',
              }),
              node('button', {
                className: `character-champion button button--warning ${isChampion ? 'is-active' : ''}`,
                dataset: { id: character.id },
                type: 'button',
                text: isChampion ? 'Champion' : 'Set Champion',
              }),
            ]),
            character.slug ? node('a', {
              href: `/fighters/${encodeURIComponent(character.slug)}/`,
              className: 'character-card__profile-link button-link button--ghost',
              text: 'View Profile',
            }) : null,
          ]),
        ]);
      })
    );
  }

  els.list.querySelectorAll('.character-select').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const picked = pool.find((character) => character.id === id);
      if (!picked) {
        return;
      }

      if (state.pageMode === 'forge') {
        loadFighterIntoForge(picked);
        return;
      }

      if (!state.selectedA || (state.selectedA && state.selectedB)) {
        state.selectedA = picked;
      } else {
        state.selectedB = picked;
      }

      if (state.selectedA?.id === state.selectedB?.id) {
        const alternate = pool.find((character) => character.id !== picked.id);
        state.selectedB = alternate || picked;
      }

      renderCharacterList();
      renderSelection();
      resetArenaFighters();
    });
  });
  els.list.querySelectorAll('.character-slot-pick').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const slot = button.dataset.slot === 'B' ? 'B' : 'A';
      const picked = pool.find((character) => character.id === id);
      pickFighterForSlot(slot, picked);
    });
  });
  els.list.querySelectorAll('.character-reforge').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const picked = pool.find((character) => character.id === id);
      if (!picked) {
        return;
      }
      if (state.pageMode !== 'forge') {
        window.location.href = getFighterForgeUrl(picked);
        return;
      }
      loadFighterIntoForge(picked);
    });
  });
  els.list.querySelectorAll('.character-champion').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const picked = pool.find((character) => character.id === id);
      if (!picked) {
        return;
      }
      designateChampionWithRoster(picked, {
        originType: picked.id != null ? 'public_library' : 'variant_copy',
        sourcePage: state.pageMode,
      });
      renderChampionBanner();
      renderCharacterList();
      renderSelection();
      renderForgeSaveState();
      setForgeStatus('info', `${picked.name} is now your local champion.`);
    });
  });
  els.list.querySelectorAll('.character-roster').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const picked = pool.find((character) => character.id === id);
      if (!picked) {
        return;
      }

      if (button.dataset.action === 'remove') {
        const removal = removeLocalRosterFighter(picked);
        renderChampionBanner();
        renderCharacterList();
        renderSelection();
        renderForgeSaveState();
        setForgeStatus('info', removal.clearedChampion ? `${picked.name} removed from your local roster and cleared as champion.` : `${picked.name} removed from your local roster.`);
        return;
      }

      upsertLocalRosterFighter(picked, {
        origin_type: 'public_library',
        source_page: state.pageMode,
      });
      renderCharacterList();
      renderForgeSaveState();
      setForgeStatus('success', `${picked.name} added to your local roster.`);
    });
  });
}

function formatFighterMeta(character) {
  if (!character) {
    return '';
  }

  const sourceLabel = character.visibility === 'unlisted' ? 'Draft' : 'Public';
  const championLabel = isChampionFighter(character, state.championState) ? ' · Your Champion' : '';
  return `${sourceLabel} ${slugLabel(character.archetype || 'duelist').toLowerCase()} · ${deriveRoleTags(character, 2).join(' / ')}${championLabel}`;
}

function renderSelection() {
  if (
    !state.selectedA
    || !state.selectedB
    || !els.selectedA
    || !els.selectedB
    || !els.selectedAMeta
    || !els.selectedBMeta
    || !els.hudNameA
    || !els.hudNameB
  ) {
    return;
  }

  els.selectedA.textContent = state.selectedA.name;
  els.selectedB.textContent = state.selectedB.name;
  els.selectedAMeta.textContent = formatFighterMeta(state.selectedA);
  els.selectedBMeta.textContent = formatFighterMeta(state.selectedB);
  els.hudNameA.textContent = isChampionFighter(state.selectedA, state.championState)
    ? `${state.selectedA.name} [Champ]`
    : state.selectedA.name;
  els.hudNameB.textContent = isChampionFighter(state.selectedB, state.championState)
    ? `${state.selectedB.name} [Champ]`
    : state.selectedB.name;
  setHealthHud('A', 1);
  setHealthHud('B', 1);
  setCooldownHud('A', {});
  setCooldownHud('B', {});
}

function setHealthHud(side, ratio) {
  const pct = `${Math.max(0, Math.round(ratio * 100))}%`;
  if (side === 'A') {
    if (els.hudHpA) {
      els.hudHpA.textContent = pct;
    }
    if (els.hudBarA) {
      els.hudBarA.style.width = pct;
    }
  } else {
    if (els.hudHpB) {
      els.hudHpB.textContent = pct;
    }
    if (els.hudBarB) {
      els.hudBarB.style.width = pct;
    }
  }
}

function setCooldownHud(side, cooldowns) {
  const body = Object.entries(cooldowns)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => `${name}:${value}`)
    .join(' | ');
  const text = body ? `Cooldowns: ${body}` : 'Cooldowns: Ready';
  if (side === 'A') {
    if (els.hudCdA) {
      els.hudCdA.textContent = text;
    }
  } else {
    if (els.hudCdB) {
      els.hudCdB.textContent = text;
    }
  }
}

function renderRecentFights() {
  if (!els.recentFights) {
    return;
  }
  if (!state.recentFights.length) {
    setChildren(els.recentFights, node('p', { className: 'text-slate-500', text: 'No fight history yet.' }));
    return;
  }

  setChildren(
    els.recentFights,
    state.recentFights.slice(0, 3).map((fight) => node('div', { className: 'fight-history-card' }, [
      node('div', { className: 'fight-history-card__top' }, [
        node('div', {}, [
          node('p', { className: 'font-semibold', text: `${fight.fighter_a_name || 'Unknown'} vs ${fight.fighter_b_name || 'Unknown'}` }),
          node('p', { className: 'fight-history-card__meta', text: getRecentFightMetaLine(fight) }),
        ]),
        node('span', { className: 'fight-history-card__mode', text: getRecentFightModeLabel(fight) }),
      ]),
      renderRecentFightOutcome(fight),
      node('p', { className: 'fight-history-card__lead', text: getRecentFightLead(fight) }),
      node('p', { className: 'fight-history-card__sub', text: getRecentFightSubline(fight) }),
    ]))
  );
}

function getRecentFightModeLabel(fight) {
  const simCount = Number(fight.sim_count || 1);
  return simCount > 1 ? `${simCount} Sims` : 'Official';
}

function formatFightTimestamp(value) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getRecentFightMetaLine(fight) {
  const stamp = formatFightTimestamp(fight.created_at);
  const rounds = fight.rounds ? `${fight.rounds} rounds` : 'Round data unavailable';
  return stamp ? `${stamp} | ${rounds}` : rounds;
}

function getRecentFightLead(fight) {
  const meta = fight.meta || {};
  if (Number(fight.sim_count || 1) > 1) {
    return meta.aggregate_insights?.matchup_story || fight.summary || 'Batch complete.';
  }
  return meta.recap?.win_reason || fight.summary || 'Fight complete.';
}

function getRecentFightSubline(fight) {
  const meta = fight.meta || {};
  if (Number(fight.sim_count || 1) > 1) {
    const likelyPattern = normalizeWhitespace(meta.aggregate_insights?.likely_pattern || '');
    return likelyPattern ? `Likely pattern: ${truncateText(likelyPattern, 110)}` : 'Sample fight recap unavailable.';
  }

  const turningPoint = normalizeWhitespace(meta.recap?.turning_point || '');
  if (turningPoint) {
    return truncateText(turningPoint, 118);
  }
  const finisher = normalizeWhitespace(meta.recap?.finisher || '');
  return finisher || 'No additional recap recorded.';
}

function renderRecentFightOutcome(fight) {
  const simCount = Number(fight.sim_count || 1);
  if (simCount > 1) {
    const meta = fight.meta || {};
    const insights = meta.aggregate_insights || {};
    const fighterAWins = Number(fight.fighter_a_wins || 0);
    const fighterBWins = Number(fight.fighter_b_wins || 0);
    const fighterAPct = Number.isFinite(Number(insights.fighter_a_pct))
      ? Number(insights.fighter_a_pct)
      : (fighterAWins / simCount) * 100;
    const fighterBPct = Number.isFinite(Number(insights.fighter_b_pct))
      ? Number(insights.fighter_b_pct)
      : (fighterBWins / simCount) * 100;
    return node('div', { className: 'fight-history-split' }, [
      node('div', { className: 'fight-history-split__row' }, [
        node('span', { className: 'fight-history-split__name is-a', text: fight.fighter_a_name || 'Fighter A' }),
        node('span', { text: `${fighterAWins} wins (${fighterAPct.toFixed(1)}%)` }),
      ]),
      node('div', { className: 'fight-history-split__row' }, [
        node('span', { className: 'fight-history-split__name is-b', text: fight.fighter_b_name || 'Fighter B' }),
        node('span', { text: `${fighterBWins} wins (${fighterBPct.toFixed(1)}%)` }),
      ]),
    ]);
  }

  return node('p', { className: 'fight-history-card__winner' }, [
    'Winner: ',
    node('span', { text: fight.winner_name || 'Draw' }),
  ]);
}

const EASING = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inQuad: (t) => t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBasePosition(slot) {
  return {
    x: state.pixi.renderer.width * (slot === 'A' ? 0.28 : 0.72),
    y: state.pixi.renderer.height * 0.68,
  };
}

function getSpritePose(sprite) {
  return {
    x: sprite.container.x,
    y: sprite.container.y,
    scaleX: Math.abs(sprite.container.scale.x),
    scaleY: sprite.container.scale.y,
    rotation: sprite.container.rotation,
    alpha: sprite.container.alpha,
    glowAlpha: sprite.glow.alpha,
    auraAlpha: sprite.aura.alpha,
    shadowScaleX: sprite.shadow.scale.x,
    shadowScaleY: sprite.shadow.scale.y,
  };
}

function applySpritePose(sprite, pose) {
  sprite.container.position.set(pose.x, pose.y);
  sprite.container.scale.set(sprite.facingSign * pose.scaleX, pose.scaleY);
  sprite.container.rotation = pose.rotation;
  sprite.container.alpha = pose.alpha;
  sprite.glow.alpha = pose.glowAlpha;
  sprite.aura.alpha = pose.auraAlpha;
  sprite.shadow.scale.set(pose.shadowScaleX, pose.shadowScaleY);
}

function animateSpritePose(
  sprite,
  {
    x,
    y,
    scaleX,
    scaleY,
    rotation,
    alpha,
    glowAlpha,
    auraAlpha,
    shadowScaleX,
    shadowScaleY,
    arcHeight = 0,
    duration = 180,
    easing = 'outCubic',
  }
) {
  const start = getSpritePose(sprite);
  const target = {
    x: x ?? start.x,
    y: y ?? start.y,
    scaleX: scaleX ?? start.scaleX,
    scaleY: scaleY ?? start.scaleY,
    rotation: rotation ?? start.rotation,
    alpha: alpha ?? start.alpha,
    glowAlpha: glowAlpha ?? start.glowAlpha,
    auraAlpha: auraAlpha ?? start.auraAlpha,
    shadowScaleX: shadowScaleX ?? start.shadowScaleX,
    shadowScaleY: shadowScaleY ?? start.shadowScaleY,
  };
  const ease = EASING[easing] || EASING.outCubic;

  return new Promise((resolve) => {
    const startedAt = performance.now();

    function frame(now) {
      const rawT = Math.min(1, (now - startedAt) / duration);
      const t = ease(rawT);
      applySpritePose(sprite, {
        x: start.x + (target.x - start.x) * t,
        y: start.y + (target.y - start.y) * t - Math.sin(Math.PI * rawT) * arcHeight,
        scaleX: start.scaleX + (target.scaleX - start.scaleX) * t,
        scaleY: start.scaleY + (target.scaleY - start.scaleY) * t,
        rotation: start.rotation + (target.rotation - start.rotation) * t,
        alpha: start.alpha + (target.alpha - start.alpha) * t,
        glowAlpha: start.glowAlpha + (target.glowAlpha - start.glowAlpha) * t,
        auraAlpha: start.auraAlpha + (target.auraAlpha - start.auraAlpha) * t,
        shadowScaleX: start.shadowScaleX + (target.shadowScaleX - start.shadowScaleX) * t,
        shadowScaleY: start.shadowScaleY + (target.shadowScaleY - start.shadowScaleY) * t,
      });

      if (rawT < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

function buildBasePose(sprite) {
  const base = getBasePosition(sprite.slot);
  return {
    x: base.x,
    y: base.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    glowAlpha: 0.18,
    auraAlpha: 0,
    shadowScaleX: 1,
    shadowScaleY: 1,
  };
}

async function setupArena() {
  const host = document.getElementById('arena-shell');
  const canvas = document.getElementById('arena-canvas');
  if (!host || !canvas || typeof PIXI === 'undefined') {
    return;
  }
  const app = new PIXI.Application();
  await app.init({ canvas, resizeTo: host, antialias: true, backgroundAlpha: 0 });
  state.pixi = app;

  const stage = app.stage;
  const ground = new PIXI.Graphics();
  ground.ellipse(host.clientWidth / 2, host.clientHeight - 60, host.clientWidth * 0.32, 44).fill({ color: 0x172033, alpha: 0.95 });
  ground.ellipse(host.clientWidth / 2, host.clientHeight - 60, host.clientWidth * 0.26, 22).fill({ color: 0x0f172a, alpha: 1 });
  stage.addChild(ground);

  const makeFighter = (slot, x, y, color, facing = 1) => {
    const container = new PIXI.Container();
    const shadow = new PIXI.Graphics().ellipse(0, 56, 26, 10).fill({ color: 0x020617, alpha: 0.68 });
    const aura = new PIXI.Graphics().circle(0, -40, 42).fill({ color, alpha: 0 });
    const glow = new PIXI.Graphics().circle(0, -50, 28).fill({ color, alpha: 0.18 });
    const body = new PIXI.Graphics().roundRect(-18, -40, 36, 74, 16).fill({ color, alpha: 0.92 });
    const head = new PIXI.Graphics().circle(0, -62, 16).fill({ color: 0xffffff, alpha: 0.88 });
    const visor = new PIXI.Graphics().roundRect(-10, -66, 20, 7, 3).fill({ color, alpha: 0.52 });
    const armLeft = new PIXI.Graphics().rect(-36, -30, 16, 8).fill({ color, alpha: 0.85 });
    const armRight = new PIXI.Graphics().rect(20, -30, 16, 8).fill({ color, alpha: 0.85 });
    const legLeft = new PIXI.Graphics().rect(-14, 30, 10, 32).fill({ color, alpha: 0.85 });
    const legRight = new PIXI.Graphics().rect(4, 30, 10, 32).fill({ color, alpha: 0.85 });
    [shadow, aura, glow, body, head, visor, armLeft, armRight, legLeft, legRight].forEach((part) => container.addChild(part));
    container.x = x;
    container.y = y;
    container.scale.x = facing;
    stage.addChild(container);
    return {
      slot,
      facingSign: facing,
      color,
      container,
      shadow,
      aura,
      glow,
      body,
      head,
      visor,
      armLeft,
      armRight,
      legLeft,
      legRight,
    };
  };

  state.sprites.left = makeFighter('A', host.clientWidth * 0.28, host.clientHeight * 0.68, 0xff4d6d, 1);
  state.sprites.right = makeFighter('B', host.clientWidth * 0.72, host.clientHeight * 0.68, 0x38bdf8, -1);
}

function resetArenaFighters() {
  if (!state.pixi || !state.sprites.left || !state.sprites.right) {
    return;
  }

  applySpritePose(state.sprites.left, buildBasePose(state.sprites.left));
  applySpritePose(state.sprites.right, buildBasePose(state.sprites.right));
}

function flashCommentary(text, priority = 'minor') {
  els.commentary.textContent = text;
  els.commentary.classList.remove('commentary-pop--minor', 'commentary-pop--major', 'commentary-pop--critical');
  els.commentary.classList.add(`commentary-pop--${priority}`);
  els.commentary.classList.remove('opacity-0');
  clearTimeout(flashCommentary._timer);
  const duration = priority === 'critical' ? 1900 : priority === 'major' ? 1550 : 1200;
  flashCommentary._timer = setTimeout(() => els.commentary.classList.add('opacity-0'), duration);
}

function getEventMomentLabel(event) {
  const labelMap = {
    buff: 'Buff',
    hit: 'Hit',
    swing: 'Swing',
    big_hit: 'Big Hit',
    finisher: 'Finisher',
    stun: 'Stun',
    effect_tick: 'Bleed',
    effect_finisher: 'Fatal Tick',
  };
  return labelMap[event?.moment] || slugLabel(event?.type || 'event');
}

function pushLog(event) {
  const div = document.createElement('div');
  const priority = event?.priority || 'minor';
  const slotClass = event?.actor_slot === 'A' ? 'is-a' : event?.actor_slot === 'B' ? 'is-b' : '';

  div.className = `log-pill log-pill--${priority}`;
  appendChildren(div, [
    node('div', { className: 'log-pill__topline' }, [
      node('span', { className: 'log-pill__round', text: `R${event?.round || '?'}` }),
      node('span', { className: 'log-pill__moment', text: getEventMomentLabel(event) }),
      event?.ability_name ? node('span', { className: 'log-pill__detail', text: event.ability_name }) : null,
      event?.damage ? node('span', { className: 'log-pill__value', text: `-${event.damage}` }) : null,
    ]),
    node('p', { className: `log-pill__text ${slotClass}`, text: event?.text || '' }),
    event?.target_slot && Number.isFinite(Number(event.target_hp))
      ? node('div', { className: 'log-pill__meta' }, [
          node('span', {
            className: 'log-pill__detail',
            text: `${event.target_name || 'Target'} ${event.target_hp}/${event.target_max_hp || ''} HP`,
          }),
        ])
      : null,
  ]);
  els.fightLog.prepend(div);
}

async function animateFight(result) {
  const left = state.sprites.left;
  const right = state.sprites.right;
  if (!left || !right || !state.selectedA || !state.selectedB) {
    return;
  }

  const baseLX = state.pixi.renderer.width * 0.28;
  const baseRX = state.pixi.renderer.width * 0.72;
  resetArenaFighters();
  els.fightLog.replaceChildren();

  const animateActionEvent = async (event, attacker, defender) => {
    const fromA = event.actor_slot === 'A';
    const direction = fromA ? 1 : -1;
    const priority = event.priority || 'minor';
    const intensity = priority === 'critical' ? 1.25 : priority === 'major' ? 1.08 : 1;
    const isCriticalMoment = priority === 'critical';
    const attackerBaseX = fromA ? baseLX : baseRX;
    const defenderBaseX = fromA ? baseRX : baseLX;
    const attackerBaseY = state.pixi.renderer.height * 0.68;
    const defenderBaseY = attackerBaseY;
    const damage = Number(event.damage || 0);
    const landedHit = Boolean(event.target_slot && damage > 0);
    const isBuff = event.type === 'buff';
    const isStun = event.type === 'stun_attack';
    const isBasic = event.type === 'basic_attack';
    const attackDepth = (isBuff ? 42 : isBasic ? 78 : 104) + (isCriticalMoment && !isBuff ? 10 : 0);
    const anticipation = isBuff ? 130 : isBasic ? 115 : isStun ? 185 : 155;
    const travel = (isBuff ? 150 : isBasic ? 180 : isStun ? 240 : 215) + (isCriticalMoment ? 20 : 0);
    const recovery = isBuff ? 160 : isBasic ? 190 : 220;
    const arcHeight = (isBuff ? 12 : isBasic ? 18 : 34) * intensity;
    const hitStop = landedHit ? ((isStun ? 135 : isBasic ? 70 : 105) + (isCriticalMoment ? 40 : 0)) : 0;
    const attackTargetX = isBuff
      ? attackerBaseX + direction * 12
      : attackerBaseX + direction * attackDepth;

    await Promise.all([
      animateSpritePose(
        attacker,
        {
          x: attackerBaseX - direction * 18,
          y: attackerBaseY + 8,
          scaleX: 0.94,
          scaleY: 1.08,
          rotation: -direction * 0.05,
          glowAlpha: 0.28,
          auraAlpha: isBuff ? 0.14 : 0.04,
          shadowScaleX: 1.08,
          shadowScaleY: 0.92,
          duration: anticipation,
          easing: 'inQuad',
        }
      ),
      animateSpritePose(
        defender,
        {
          glowAlpha: 0.1,
          scaleX: 1.02,
          scaleY: 0.98,
          duration: anticipation,
          easing: 'outQuad',
        }
      ),
    ]);

    spawnMotionTrail(attackerBaseX, attackerBaseY - 48, attackTargetX, attackerBaseY - 68, attacker.color, {
      intensity: isBuff ? 0.55 : intensity,
    });

    await animateSpritePose(
      attacker,
      {
        x: attackTargetX,
        y: attackerBaseY,
        scaleX: isBuff ? 1.04 : 1.08,
        scaleY: isBuff ? 0.95 : 0.92,
        rotation: direction * (isBuff ? 0.04 : 0.08),
        glowAlpha: isBuff ? 0.42 : 0.46,
        auraAlpha: isBuff ? 0.26 : 0.1,
        shadowScaleX: 0.92,
        shadowScaleY: 1.06,
        arcHeight,
        duration: travel,
        easing: 'outCubic',
      }
    );

    if (isBuff) {
      spawnBuffPulse(attacker);
    }

    if (landedHit) {
      const impactX = defender.container.x - direction * 8;
      const impactY = defender.container.y - 52;
      spawnImpact(impactX, impactY, attacker.color, {
        burstCount: isStun ? 20 : isCriticalMoment ? 24 : 16,
        shockwave: true,
        intensity: isStun ? 1.3 : intensity,
      });

      await Promise.all([
        animateSpritePose(
          defender,
          {
            x: defenderBaseX + direction * (isStun ? 28 : 20),
            y: defenderBaseY + (isStun ? -10 : -4),
            scaleX: isCriticalMoment ? 0.82 : 0.88,
            scaleY: isCriticalMoment ? 1.18 : 1.14,
            rotation: direction * (isStun ? 0.14 : isCriticalMoment ? 0.11 : 0.08),
            glowAlpha: 0.3,
            auraAlpha: 0.08,
            shadowScaleX: 1.12,
            shadowScaleY: 0.88,
            duration: 110,
            easing: 'outQuad',
          }
        ),
        animateSpritePose(
          attacker,
          {
            x: attackTargetX - direction * 10,
            scaleX: 1.02,
            scaleY: 0.98,
            rotation: direction * 0.03,
            duration: 80,
            easing: 'outQuad',
          }
        ),
      ]);
      await sleep(hitStop);
    }

    await Promise.all([
      animateSpritePose(attacker, {
        x: attackerBaseX,
        y: attackerBaseY,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        glowAlpha: 0.18,
        auraAlpha: 0,
        shadowScaleX: 1,
        shadowScaleY: 1,
        duration: recovery,
        easing: 'outBack',
      }),
      animateSpritePose(defender, {
        x: defenderBaseX,
        y: defenderBaseY,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        glowAlpha: 0.18,
        auraAlpha: 0,
        shadowScaleX: 1,
        shadowScaleY: 1,
        duration: recovery,
        easing: 'outCubic',
      }),
    ]);
  };

  const animateEffectTick = async (fighter) => {
    spawnImpact(fighter.container.x, fighter.container.y - 60, 0xff6b6b, {
      burstCount: 8,
      shockwave: false,
      intensity: 0.55,
    });
    await animateSpritePose(fighter, {
      x: fighter.container.x + rand(-8, 8),
      y: fighter.container.y - 6,
      scaleX: 0.96,
      scaleY: 1.05,
      glowAlpha: 0.34,
      auraAlpha: 0.12,
      duration: 90,
      easing: 'outQuad',
    });
    await animateSpritePose(fighter, {
      ...buildBasePose(fighter),
      duration: 140,
      easing: 'outCubic',
    });
  };

  const playVictoryMoment = async () => {
    if (!result.winner?.slot) {
      await Promise.all([
        animateSpritePose(left, { glowAlpha: 0.24, auraAlpha: 0.08, duration: 180, easing: 'outQuad' }),
        animateSpritePose(right, { glowAlpha: 0.24, auraAlpha: 0.08, duration: 180, easing: 'outQuad' }),
      ]);
      return;
    }

    const winner = result.winner.slot === 'A' ? left : right;
    const loser = result.winner.slot === 'A' ? right : left;
    const winnerBase = buildBasePose(winner);
    const loserBase = buildBasePose(loser);

    spawnBuffPulse(winner, { intensity: 1.25, rings: 3 });

    await Promise.all([
      animateSpritePose(winner, {
        x: winnerBase.x,
        y: winnerBase.y - 26,
        scaleX: 1.08,
        scaleY: 1.08,
        rotation: -winner.facingSign * 0.04,
        glowAlpha: 0.46,
        auraAlpha: 0.18,
        shadowScaleX: 0.96,
        shadowScaleY: 1.08,
        duration: 260,
        easing: 'outBack',
      }),
      animateSpritePose(loser, {
        x: loserBase.x + winner.facingSign * 24,
        y: loserBase.y + 24,
        scaleX: 0.9,
        scaleY: 0.82,
        rotation: winner.facingSign * 0.28,
        alpha: 0.34,
        glowAlpha: 0.04,
        auraAlpha: 0,
        shadowScaleX: 1.14,
        shadowScaleY: 0.82,
        duration: 300,
        easing: 'outCubic',
      }),
    ]);
  };

  let hpA = state.selectedA.max_health;
  let hpB = state.selectedB.max_health;
  const timeline = result.timeline || [];
  for (const event of timeline) {
    const fromA = event.actor_slot === 'A';
    const attacker = fromA ? left : right;
    const defender = fromA ? right : left;
    const damage = Number(event.damage || 0);
    const line = event.text || '';

    flashCommentary(line, event.priority || 'minor');
    pushLog(event);

    if (event.type === 'effect_tick') {
      await animateEffectTick(attacker);
    } else {
      await animateActionEvent(event, attacker, defender);
    }

    if (damage && event.target_slot) {
      if (event.target_slot === 'B') {
        hpB = Math.max(0, event.target_hp ?? hpB - damage);
      } else {
        hpA = Math.max(0, event.target_hp ?? hpA - damage);
      }
      spawnImpact(
        (attacker.container.x + defender.container.x) / 2,
        attacker.container.y - 60,
        fromA ? 0xff4d6d : 0x38bdf8
      );
      setHealthHud('A', hpA / state.selectedA.max_health);
      setHealthHud('B', hpB / state.selectedB.max_health);
    } else if (damage && event.actor_slot) {
      if (event.actor_slot === 'A') {
        hpA = Math.max(0, event.actor_hp ?? hpA - damage);
      } else {
        hpB = Math.max(0, event.actor_hp ?? hpB - damage);
      }
      setHealthHud('A', hpA / state.selectedA.max_health);
      setHealthHud('B', hpB / state.selectedB.max_health);
    }

    setCooldownHud('A', result.final?.fighter_a_cooldowns || {});
    setCooldownHud('B', result.final?.fighter_b_cooldowns || {});
    const pause = event.priority === 'critical'
      ? 320
      : event.priority === 'major'
        ? 270
        : event.type === 'effect_tick'
          ? 155
          : event.type === 'buff'
            ? 220
            : 210;
    await sleep(pause);
  }

  flashCommentary(result.winner?.name ? `${result.winner.name} wins the duel.` : 'The duel ends in a draw.', 'critical');
  await playVictoryMoment();
}

function spawnImpact(x, y, color, options = {}) {
  const {
    burstCount = 12,
    shockwave = true,
    intensity = 1,
  } = options;
  const burst = new PIXI.Container();
  for (let index = 0; index < burstCount; index += 1) {
    const particle = new PIXI.Graphics().circle(0, 0, rand(2, 5) * intensity).fill({ color, alpha: 0.9 });
    particle.x = x;
    particle.y = y;
    particle.vx = rand(-4.5, 4.5) * intensity;
    particle.vy = rand(-4.5, 3.5) * intensity;
    burst.addChild(particle);
  }

  state.pixi.stage.addChild(burst);
  if (shockwave) {
    const ring = new PIXI.Graphics().circle(0, 0, 18).stroke({ color, alpha: 0.55, width: 2 });
    ring.x = x;
    ring.y = y;
    ring.scale.set(0.2, 0.2);
    state.pixi.stage.addChild(ring);
    const ringTicker = (delta) => {
      ring.scale.x += 0.12 * delta * intensity;
      ring.scale.y += 0.12 * delta * intensity;
      ring.alpha -= 0.045 * delta;
      if (ring.alpha <= 0) {
        state.pixi.ticker.remove(ringTicker);
        state.pixi.stage.removeChild(ring);
        ring.destroy();
      }
    };
    state.pixi.ticker.add(ringTicker);
  }

  const ticker = (delta) => {
    burst.children.forEach((child) => {
      child.x += child.vx * delta;
      child.y += child.vy * delta;
      child.alpha -= 0.03 * delta;
    });
    if (burst.children.every((child) => child.alpha <= 0)) {
      state.pixi.ticker.remove(ticker);
      state.pixi.stage.removeChild(burst);
      burst.destroy({ children: true });
    }
  };
  state.pixi.ticker.add(ticker);
}

function spawnMotionTrail(startX, startY, endX, endY, color, options = {}) {
  const intensity = options.intensity ?? 1;
  const trail = new PIXI.Container();
  const particleCount = Math.max(4, Math.round(8 * intensity));

  for (let index = 0; index < particleCount; index += 1) {
    const progress = index / particleCount;
    const particle = new PIXI.Graphics().circle(0, 0, rand(1.5, 4) * intensity).fill({ color, alpha: 0.6 });
    particle.x = startX + (endX - startX) * progress;
    particle.y = startY + (endY - startY) * progress + rand(-4, 4);
    particle.vx = rand(-1.5, 1.5);
    particle.vy = rand(-1.5, 1.5);
    trail.addChild(particle);
  }

  state.pixi.stage.addChild(trail);
  const ticker = (delta) => {
    trail.children.forEach((child) => {
      child.x += child.vx * delta;
      child.y += child.vy * delta;
      child.alpha -= 0.05 * delta;
    });
    if (trail.children.every((child) => child.alpha <= 0)) {
      state.pixi.ticker.remove(ticker);
      state.pixi.stage.removeChild(trail);
      trail.destroy({ children: true });
    }
  };
  state.pixi.ticker.add(ticker);
}

function spawnBuffPulse(sprite, options = {}) {
  const intensity = options.intensity ?? 1;
  const rings = options.rings ?? 2;

  for (let index = 0; index < rings; index += 1) {
    const ring = new PIXI.Graphics().circle(0, 0, 26 + index * 8).stroke({
      color: sprite.color,
      alpha: 0.45 - index * 0.1,
      width: 2,
    });
    ring.x = sprite.container.x;
    ring.y = sprite.container.y - 46;
    ring.scale.set(0.4, 0.4);
    state.pixi.stage.addChild(ring);

    let delay = index * 50;
    const ticker = (delta) => {
      if (delay > 0) {
        delay -= 16 * delta;
        return;
      }
      ring.scale.x += 0.065 * delta * intensity;
      ring.scale.y += 0.065 * delta * intensity;
      ring.alpha -= 0.026 * delta;
      if (ring.alpha <= 0) {
        state.pixi.ticker.remove(ticker);
        state.pixi.stage.removeChild(ring);
        ring.destroy();
      }
    };
    state.pixi.ticker.add(ticker);
  }
}

async function runBattle() {
  const payload = {
    fighter_a_id: state.selectedA.id,
    fighter_b_id: state.selectedB.id,
    sim_count: Number(els.batchCount.value),
  };
  return apiJson('/api/battles/run/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function getMatchupSnapshotKey(fighterA, fighterB, simCount) {
  const pair = [fighterA.id, fighterB.id].sort((left, right) => left - right).join(':');
  return `${pair}:${simCount}`;
}

function buildBattleSnapshot(result) {
  const simCount = Number(result.sim_count || 1);
  const snapshot = {
    key: getMatchupSnapshotKey(state.selectedA, state.selectedB, simCount),
    simCount,
    byFighterId: {},
  };

  if (simCount === 1) {
    const winnerId = result.winner?.id || null;
    snapshot.byFighterId[state.selectedA.id] = {
      id: state.selectedA.id,
      name: state.selectedA.name,
      won: winnerId === state.selectedA.id,
    };
    snapshot.byFighterId[state.selectedB.id] = {
      id: state.selectedB.id,
      name: state.selectedB.name,
      won: winnerId === state.selectedB.id,
    };
    return snapshot;
  }

  const insights = result.aggregate_insights || {};
  snapshot.byFighterId[state.selectedA.id] = {
    id: state.selectedA.id,
    name: state.selectedA.name,
    pct: Number.isFinite(Number(insights.fighter_a_pct))
      ? Number(insights.fighter_a_pct)
      : ((Number(result.aggregate?.fighter_a_wins || 0) / simCount) * 100),
  };
  snapshot.byFighterId[state.selectedB.id] = {
    id: state.selectedB.id,
    name: state.selectedB.name,
    pct: Number.isFinite(Number(insights.fighter_b_pct))
      ? Number(insights.fighter_b_pct)
      : ((Number(result.aggregate?.fighter_b_wins || 0) / simCount) * 100),
  };
  return snapshot;
}

function renderBattleCompareToPrevious(previousSnapshot, currentSnapshot) {
  if (!previousSnapshot || !currentSnapshot || previousSnapshot.simCount !== currentSnapshot.simCount) {
    return null;
  }

  if (currentSnapshot.simCount === 1) {
    const previousWinner = Object.values(previousSnapshot.byFighterId).find((entry) => entry.won)?.name || 'Draw';
    const currentWinner = Object.values(currentSnapshot.byFighterId).find((entry) => entry.won)?.name || 'Draw';
    return node('div', { className: 'battle-note-card' }, [
      node('p', { className: 'battle-note-card__label', text: 'Compare To Last Run' }),
      node('p', { className: 'battle-note-card__body', text: `Last time: ${previousWinner}. This time: ${currentWinner}.` }),
    ]);
  }

  const left = currentSnapshot.byFighterId[state.selectedA.id];
  const right = currentSnapshot.byFighterId[state.selectedB.id];
  const prevLeft = previousSnapshot.byFighterId[state.selectedA.id];
  const prevRight = previousSnapshot.byFighterId[state.selectedB.id];
  if (!left || !right || !prevLeft || !prevRight) {
    return null;
  }

  return node('div', { className: 'battle-note-card' }, [
    node('p', { className: 'battle-note-card__label', text: 'Compare To Last Run' }),
    node(
      'p',
      {
        className: 'battle-note-card__body',
        text: `${left.name} ${left.pct.toFixed(1)}% (${formatDelta(Number((left.pct - prevLeft.pct).toFixed(1)), 1)}) · ${right.name} ${right.pct.toFixed(1)}% (${formatDelta(Number((right.pct - prevRight.pct).toFixed(1)), 1)})`,
      }
    ),
  ]);
}

function renderBattleNextSteps() {
  const stepButton = (action, label, className) => node('button', {
    type: 'button',
    className: `battle-next-step ${className}`,
    dataset: { action },
    text: label,
  });
  return node('div', { className: 'mt-4 rounded-2xl border border-line bg-slate-950/55 p-3' }, [
    node('div', { className: 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between' }, [
      node('div', {}, [
        node('p', { className: 'text-xs uppercase tracking-[0.22em] text-slate-400', text: 'Next Step' }),
        node('p', {
          className: 'mt-1 text-xs text-slate-500',
          text: 'Run it back, swap sides, or send one side into Forge for a fast variant pass.',
        }),
      ]),
      node('div', { className: 'flex flex-wrap gap-2' }, [
        stepButton('rematch', 'Rematch', 'rounded-xl border border-neonblue/30 bg-neonblue/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neonblue hover:bg-neonblue/20'),
        stepButton('swap', 'Swap + Rematch', 'rounded-xl border border-neonpurple/30 bg-neonpurple/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neonpurple hover:bg-neonpurple/20'),
        stepButton('tweak-a', `Tweak ${state.selectedA?.name || 'A'}`, 'rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100 hover:bg-amber-300/20'),
        stepButton('tweak-b', `Tweak ${state.selectedB?.name || 'B'}`, 'rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100 hover:bg-amber-300/20'),
      ]),
    ]),
  ]);
}

function attachBattleResultActions() {
  if (!els.resultBox) {
    return;
  }
  els.resultBox.querySelectorAll('.battle-next-step').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      if (action === 'rematch') {
        await handleSimulate();
        return;
      }
      if (action === 'swap') {
        const left = state.selectedA;
        state.selectedA = state.selectedB;
        state.selectedB = left;
        renderSelection();
        renderCharacterList();
        resetArenaFighters();
        setForgeStatus('info', 'Sides swapped. Running the rematch now.');
        await handleSimulate();
        return;
      }
      if (action === 'tweak-a') {
        if (state.pageMode !== 'forge') {
          window.location.href = getFighterForgeUrl(state.selectedA);
          return;
        }
        loadFighterIntoForge(state.selectedA, { message: `Loaded ${state.selectedA.name} into the forge for a variant pass.` });
        return;
      }
      if (action === 'tweak-b') {
        if (state.pageMode !== 'forge') {
          window.location.href = getFighterForgeUrl(state.selectedB);
          return;
        }
        loadFighterIntoForge(state.selectedB, { message: `Loaded ${state.selectedB.name} into the forge for a variant pass.` });
        return;
      }
    });
  });
}

function renderBattleResult(result, previousSnapshot = null, currentSnapshot = null) {
  const compareNode = renderBattleCompareToPrevious(previousSnapshot, currentSnapshot);
  const nextStepsNode = renderBattleNextSteps();
  const championNode = renderChampionBattleNote();
  const noteCard = (label, body) => node('div', { className: 'battle-note-card' }, [
    node('p', { className: 'battle-note-card__label', text: label }),
    node('p', { className: 'battle-note-card__body', text: body }),
  ]);
  const statCard = (className, fighter, hp, stats = {}) => node('div', { className }, [
    node('p', { className: 'battle-compare-card__name', text: fighter.name }),
    node('p', { className: 'battle-compare-card__meta', text: `Final HP ${hp}/${fighter.max_health}` }),
    node('div', { className: 'battle-compare-card__stats' }, [
      node('span', { text: `Damage ${stats.damage ?? 0}` }),
      node('span', { text: `Buffs ${stats.buffs ?? 0}` }),
      node('span', { text: `Stuns ${stats.stuns ?? 0}` }),
      node('span', { text: `Big hits ${stats.big_hits ?? 0}` }),
    ]),
  ]);

  if (result.sim_count === 1) {
    const winnerLabel = result.winner?.name || 'Draw';
    const recap = result.recap || {};
    const fighterAStats = recap.fighter_a || {};
    const fighterBStats = recap.fighter_b || {};
    setChildren(els.resultBox, node('div', { className: 'battle-summary-stack' }, [
      node('div', {}, [
        node('p', { className: 'battle-summary__eyebrow', text: 'Official Recap' }),
        node('p', { className: 'battle-summary__headline', text: recap.headline || `${winnerLabel} wins.` }),
        node('p', { className: 'battle-summary__subtle' }, [
          'Winner: ',
          node('span', { className: 'text-white', text: winnerLabel }),
          ` | ${result.rounds} rounds`,
        ]),
      ]),
      node('div', { className: 'battle-note-grid' }, [
        noteCard('How It Was Won', recap.win_reason || result.summary || 'Fight complete.'),
        noteCard('Turning Point', recap.turning_point || 'No decisive turning point recorded.'),
        noteCard('Finish', recap.finisher || 'No finisher data recorded.'),
      ]),
      node('div', { className: 'battle-compare-grid' }, [
        statCard('battle-compare-card battle-compare-card--a', state.selectedA, result.final?.fighter_a_hp ?? 0, fighterAStats),
        statCard('battle-compare-card battle-compare-card--b', state.selectedB, result.final?.fighter_b_hp ?? 0, fighterBStats),
      ]),
      recap.biggest_hit ? noteCard(
        'Biggest Hit',
        `${recap.biggest_hit.actor_name} hit for ${recap.biggest_hit.damage} with ${recap.biggest_hit.ability_name || 'a strike'} in round ${recap.biggest_hit.round}.`
      ) : null,
      Array.isArray(recap.key_moments) && recap.key_moments.length
        ? node('div', { className: 'battle-key-moments' }, recap.key_moments.map((moment) => (
            node('span', { className: 'battle-key-moments__item', text: moment })
          )))
        : null,
      championNode,
      compareNode,
      nextStepsNode,
    ]));
    attachBattleResultActions();
    return;
  }

  const aWins = result.aggregate?.fighter_a_wins ?? 0;
  const bWins = result.aggregate?.fighter_b_wins ?? 0;
  const insights = result.aggregate_insights || {};
  const recap = result.recap || {};
  const aPct = Number.isFinite(Number(insights.fighter_a_pct))
    ? Number(insights.fighter_a_pct).toFixed(1)
    : ((aWins / result.sim_count) * 100).toFixed(1);
  const bPct = Number.isFinite(Number(insights.fighter_b_pct))
    ? Number(insights.fighter_b_pct).toFixed(1)
    : ((bWins / result.sim_count) * 100).toFixed(1);
  const leaderText = insights.leader_name
    ? `${insights.leader_name} leads the set.`
    : 'The set stayed effectively even.';
  const splitRow = (slot, fighter, wins, pct) => node('div', { className: 'battle-split-row' }, [
    node('div', { className: 'battle-split-row__top' }, [
      node('span', { className: `battle-split-row__name is-${slot}`, text: fighter.name }),
      node('span', { text: `${wins} wins (${pct}%)` }),
    ]),
    node('div', { className: 'battle-split-row__bar' }, [
      node('div', { className: `battle-split-row__fill is-${slot}`, style: { width: `${pct}%` } }),
    ]),
  ]);
  setChildren(els.resultBox, node('div', { className: 'battle-summary-stack' }, [
    node('div', {}, [
      node('p', { className: 'battle-summary__eyebrow', text: 'Batch Report' }),
      node('p', { className: 'battle-summary__headline', text: `${result.sim_count.toLocaleString()} simulations complete` }),
      node('p', { className: 'battle-summary__subtle', text: leaderText }),
    ]),
    node('div', { className: 'battle-split-card' }, [
      splitRow('a', state.selectedA, aWins, aPct),
      splitRow('b', state.selectedB, bWins, bPct),
    ]),
    node('div', { className: 'battle-note-grid' }, [
      noteCard('Consistency', `${slugLabel(insights.consistency || 'volatile')} matchup. ${insights.matchup_story || result.summary || 'Batch complete.'}`),
      noteCard('Likely Pattern', insights.likely_pattern || 'No stable pattern emerged.'),
      noteCard('Sample Fight', `${recap.headline || 'Sample duel recorded.'} ${recap.turning_point || ''}`),
      championNode,
      compareNode,
    ]),
    nextStepsNode,
  ]));
  attachBattleResultActions();
}

async function handleSimulate() {
  if (!state.selectedA || !state.selectedB) {
    return;
  }
  if (!isBattleEligible(state.selectedA) || !isBattleEligible(state.selectedB)) {
    setChildren(els.resultBox, statusNode('text-rose-300', 'Official public battles require two published fighters.'));
    return;
  }
  if (state.selectedA.id === state.selectedB.id) {
    setChildren(els.resultBox, statusNode('text-rose-300', 'Choose two different fighters before running an official battle.'));
    return;
  }

  setChildren(els.resultBox, statusNode('text-slate-400', 'Simulating arena chaos...'));
  try {
    const snapshotKey = getMatchupSnapshotKey(state.selectedA, state.selectedB, Number(els.batchCount.value));
    const previousSnapshot = state.matchupSnapshots[snapshotKey] || null;
    const payload = await runBattle();
    const result = payload.result;
    const battle = payload.battle;
    await animateFight(result);
    const currentSnapshot = buildBattleSnapshot(result);
    state.matchupSnapshots[currentSnapshot.key] = currentSnapshot;
    state.lastBattleSnapshot = currentSnapshot;
    state.championState = recordChampionBattle(
      result,
      state.selectedA,
      state.selectedB,
      state.championState
    ) || state.championState;
    syncChampionStateFromRoster();
    renderChampionBanner();
    renderBattleResult(result, previousSnapshot, currentSnapshot);
    state.recentFights.unshift(battle);
    renderRecentFights();
    updateStats();
  } catch (error) {
    setChildren(els.resultBox, statusNode('text-rose-300', error.message));
  }
}

function inferArchetypeFromStats(fighter) {
  if ((fighter.durability ?? 0) >= 82 && (fighter.max_health ?? 0) >= 145) {
    return 'tank';
  }
  if ((fighter.strength ?? 0) >= 82 && (fighter.speed ?? 0) >= 78 && (fighter.durability ?? 0) <= 58 && (fighter.max_health ?? 0) <= 112) {
    return 'glass_cannon';
  }
  if ((fighter.speed ?? 0) >= 86 && (fighter.durability ?? 0) <= 58 && (fighter.strength ?? 0) < 82) {
    return 'assassin';
  }
  if ((fighter.intelligence ?? 0) >= 84 && (fighter.speed ?? 0) >= 66 && (fighter.strength ?? 0) <= 74) {
    return 'control';
  }
  if ((fighter.strength ?? 0) >= 78 && (fighter.durability ?? 0) >= 74 && (fighter.max_health ?? 0) >= 126) {
    return 'bruiser';
  }
  return 'duelist';
}

function finalizeStats(baseStats, archetype) {
  const stats = {
    strength: clamp(Math.round(baseStats.strength), MIN_CORE_STAT, MAX_CORE_STAT),
    speed: clamp(Math.round(baseStats.speed), MIN_CORE_STAT, MAX_CORE_STAT),
    durability: clamp(Math.round(baseStats.durability), MIN_CORE_STAT, MAX_CORE_STAT),
    intelligence: clamp(Math.round(baseStats.intelligence), MIN_CORE_STAT, MAX_CORE_STAT),
  };
  let maxHealth = clamp(Math.round(baseStats.max_health), MIN_MAX_HEALTH, MAX_MAX_HEALTH);

  const reductionOrder = {
    assassin: ['intelligence', 'strength', 'durability', 'speed'],
    tank: ['speed', 'intelligence', 'strength', 'durability'],
    bruiser: ['intelligence', 'speed', 'durability', 'strength'],
    duelist: ['strength', 'intelligence', 'durability', 'speed'],
    control: ['strength', 'durability', 'speed', 'intelligence'],
    glass_cannon: ['durability', 'intelligence', 'speed', 'strength'],
  }[archetype] || ['intelligence', 'durability', 'strength', 'speed'];

  const totalStats = () => stats.strength + stats.speed + stats.durability + stats.intelligence;
  while (totalStats() > MAX_CORE_STAT_BUDGET) {
    for (const field of reductionOrder) {
      if (totalStats() <= MAX_CORE_STAT_BUDGET) {
        break;
      }
      if (stats[field] > MIN_CORE_STAT) {
        stats[field] -= 1;
      }
    }
  }

  while (maxHealth > 180 && totalStats() > 300) {
    maxHealth -= 1;
  }

  return { ...stats, max_health: maxHealth };
}

function buildDescription(prompt, fallbackText) {
  const cleaned = normalizeWhitespace(prompt);
  if (!cleaned) {
    return fallbackText;
  }
  return cleaned.length > 600 ? `${cleaned.slice(0, 597)}...` : cleaned;
}

function proceduralForge(archetype, prompt, balanceTarget) {
  const kit = ARCHETYPES[archetype] || ARCHETYPES.duelist;
  const balance = BALANCE_PROFILES[balanceTarget] || BALANCE_PROFILES['50/50'];
  const rawStats = {
    strength: kit.baseStats.strength + balance.strength + rand(-4, 4),
    speed: kit.baseStats.speed + balance.speed + rand(-4, 4),
    durability: kit.baseStats.durability + balance.durability + rand(-4, 4),
    intelligence: kit.baseStats.intelligence + balance.intelligence + rand(-4, 4),
    max_health: kit.baseStats.max_health + balance.max_health + rand(-8, 8),
  };
  const stats = finalizeStats(rawStats, archetype);

  return {
    name: `${sample(kit.firstNames)} ${sample(kit.lastNames)}`,
    archetype,
    creator_name: normalizeCreatorName(els.creatorName?.value || ''),
    title: sample(kit.titles),
    description: buildDescription(prompt, `A ${kit.label.toLowerCase()} tuned for stylish arena pressure.`),
    avatar_color: sample(kit.colors),
    strength: stats.strength,
    speed: stats.speed,
    durability: stats.durability,
    intelligence: stats.intelligence,
    max_health: stats.max_health,
    passive_name: sample(kit.passiveNames),
    passive_description: kit.passiveText,
    abilities: [
      {
        name: sample(kit.openerNames),
        type: 'attack',
        power: clamp(Math.round(rand(16, 21)), 1, 40),
        cooldown: 2,
        scaling: archetype === 'control' ? 'intelligence' : archetype === 'tank' ? 'durability' : 'speed',
        description: `A low-commitment opener shaped for ${kit.label.toLowerCase()} tempo.`,
      },
      {
        name: sample(kit.buffNames),
        type: 'buff',
        power: 0,
        cooldown: 5,
        duration: 2,
        effect:
          archetype === 'tank'
            ? { damage_taken_mult: 0.72 }
            : archetype === 'control'
              ? { damage_mult: 1.12, damage_taken_mult: 0.88 }
              : archetype === 'glass_cannon'
                ? { damage_mult: 1.24, damage_taken_mult: 1.08 }
                : archetype === 'assassin'
                  ? { speed_mult: 1.25, damage_mult: 1.16 }
                  : { damage_taken_mult: 0.84, damage_mult: 1.12 },
        description: `A short self-buff window that reinforces the ${kit.label.toLowerCase()} game plan.`,
      },
      {
        name: sample(kit.finisherNames),
        type: 'attack',
        power: clamp(Math.round(rand(22, 28)), 1, 40),
        cooldown: 4,
        scaling: archetype === 'glass_cannon' ? 'strength' : archetype === 'control' ? 'intelligence' : 'strength',
        description: 'A higher-commitment finisher meant to cash in the setup.',
      },
    ],
    win_condition: kit.winCondition,
    balance_notes: kit.balanceNotes,
  };
}

function buildFighterPayload(fighter, visibility) {
  return {
    name: normalizeWhitespace(fighter.name),
    archetype: fighter.archetype,
    creator_name: normalizeCreatorName(fighter.creator_name),
    visibility,
    title: normalizeWhitespace(fighter.title),
    description: normalizeWhitespace(fighter.description),
    avatar_color: safeColor(fighter.avatar_color),
    strength: fighter.strength,
    speed: fighter.speed,
    durability: fighter.durability,
    intelligence: fighter.intelligence,
    max_health: fighter.max_health,
    passive_name: normalizeWhitespace(fighter.passive_name),
    passive_description: normalizeWhitespace(fighter.passive_description),
    abilities: (fighter.abilities || []).map((ability) => {
      const payload = {
        name: normalizeWhitespace(ability.name),
        type: ability.type,
        power: ability.power,
        cooldown: ability.cooldown,
        description: normalizeWhitespace(ability.description),
      };

      if (ability.scaling) {
        payload.scaling = ability.scaling;
      }
      if (ability.duration != null) {
        payload.duration = ability.duration;
      }
      if (ability.effect && Object.keys(ability.effect).length) {
        payload.effect = ability.effect;
      }
      return payload;
    }),
    win_condition: normalizeWhitespace(fighter.win_condition),
    balance_notes: normalizeWhitespace(fighter.balance_notes),
  };
}

function buildCreativeAssistPayload(fighter, prompt, model) {
  return {
    archetype: fighter.archetype,
    prompt: normalizeWhitespace(prompt),
    model: model === 'ollama' ? '' : normalizeWhitespace(model),
    base_fighter: buildFighterPayload(fighter, 'unlisted'),
  };
}

function mergeCreativeSuggestions(baseFighter, suggestions) {
  const next = {
    ...baseFighter,
    abilities: (baseFighter.abilities || []).map((ability) => ({
      ...ability,
      effect: ability.effect ? { ...ability.effect } : undefined,
    })),
  };

  if (!suggestions || typeof suggestions !== 'object') {
    return next;
  }

  ['name', 'title', 'description', 'passive_name', 'passive_description'].forEach((field) => {
    if (typeof suggestions[field] === 'string' && normalizeWhitespace(suggestions[field])) {
      next[field] = normalizeWhitespace(suggestions[field]);
    }
  });

  if (Array.isArray(suggestions.abilities)) {
    suggestions.abilities.forEach((ability) => {
      const index = Number(ability.index);
      if (!Number.isInteger(index) || !next.abilities[index]) {
        return;
      }

      if (typeof ability.name === 'string' && normalizeWhitespace(ability.name)) {
        next.abilities[index].name = normalizeWhitespace(ability.name);
      }
      if (typeof ability.description === 'string' && normalizeWhitespace(ability.description)) {
        next.abilities[index].description = normalizeWhitespace(ability.description);
      }
    });
  }

  return next;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneFighterForForge(fighter) {
  return {
    name: normalizeWhitespace(fighter.name),
    archetype: fighter.archetype || inferArchetypeFromStats(fighter),
    creator_name: normalizeCreatorName(fighter.creator_name || ''),
    title: normalizeWhitespace(fighter.title || ''),
    description: normalizeWhitespace(fighter.description || ''),
    avatar_color: safeColor(fighter.avatar_color),
    strength: Number(fighter.strength || 0),
    speed: Number(fighter.speed || 0),
    durability: Number(fighter.durability || 0),
    intelligence: Number(fighter.intelligence || 0),
    max_health: Number(fighter.max_health || 0),
    passive_name: normalizeWhitespace(fighter.passive_name || ''),
    passive_description: normalizeWhitespace(fighter.passive_description || ''),
    abilities: deepClone(fighter.abilities || []),
    win_condition: normalizeWhitespace(fighter.win_condition || ''),
    balance_notes: normalizeWhitespace(fighter.balance_notes || ''),
  };
}

function buildVariantName(baseName) {
  const cleanBase = normalizeWhitespace(baseName || 'Forge Variant').replace(/\s+variant\s+\d+$/i, '');
  const takenNames = new Set([
    ...state.characters.map((fighter) => normalizeWhitespace(fighter.name).toLowerCase()),
    normalizeWhitespace(state.savedForge?.fighter?.name || '').toLowerCase(),
  ]);
  const trimmedBase = cleanBase.slice(0, 44) || 'Forge Variant';

  for (let index = 1; index <= 50; index += 1) {
    const suffix = index === 1 ? 'Variant' : `Variant ${index}`;
    const candidate = normalizeWhitespace(`${trimmedBase} ${suffix}`).slice(0, 60);
    if (!takenNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return normalizeWhitespace(`${trimmedBase} Variant ${Date.now() % 1000}`).slice(0, 60);
}

function formatDelta(delta, digits = 0) {
  if (digits > 0) {
    return `${delta > 0 ? '+' : ''}${delta.toFixed(digits)}`;
  }
  return `${delta > 0 ? '+' : ''}${delta}`;
}

function getEffectStep(key) {
  if (key === 'damage_mult' || key === 'damage_taken_mult') {
    return 0.02;
  }
  if (key === 'speed_mult') {
    return 0.05;
  }
  if (key === 'stun_chance') {
    return 0.02;
  }
  if (key === 'bleed' || key === 'ticks') {
    return 1;
  }
  return 1;
}

function clampEffectValue(key, value) {
  if (key === 'bleed') {
    return clamp(Math.round(value), 0, 10);
  }
  if (key === 'damage_mult') {
    return clamp(Number(value.toFixed(2)), 0.5, 2);
  }
  if (key === 'damage_taken_mult') {
    return clamp(Number(value.toFixed(2)), 0.4, 1.5);
  }
  if (key === 'speed_mult') {
    return clamp(Number(value.toFixed(2)), 0.5, 2);
  }
  if (key === 'stun_chance') {
    return clamp(Number(value.toFixed(2)), 0, 0.5);
  }
  if (key === 'ticks') {
    return clamp(Math.round(value), 1, 4);
  }
  return value;
}

function adjustForgedStat(field, delta) {
  if (!state.forgedCharacter) {
    return;
  }

  if (field === 'max_health') {
    state.forgedCharacter.max_health = clamp(
      Number(state.forgedCharacter.max_health || 0) + delta,
      MIN_MAX_HEALTH,
      MAX_MAX_HEALTH
    );
  } else {
    state.forgedCharacter[field] = clamp(
      Number(state.forgedCharacter[field] || 0) + delta,
      MIN_CORE_STAT,
      MAX_CORE_STAT
    );
  }

  renderForgedPreview();
}

function adjustForgedAbility(index, field, delta, effectKey = '') {
  const ability = state.forgedCharacter?.abilities?.[index];
  if (!ability) {
    return;
  }

  if (field === 'power') {
    ability.power = clamp(Number(ability.power || 0) + delta, 0, 40);
  } else if (field === 'cooldown') {
    ability.cooldown = clamp(Number(ability.cooldown || 0) + delta, 1, 8);
  } else if (field === 'duration') {
    ability.duration = clamp(Number(ability.duration || 1) + delta, 1, 4);
  } else if (field === 'effect' && effectKey) {
    const step = getEffectStep(effectKey);
    ability.effect = ability.effect || {};
    const nextValue = Number(ability.effect[effectKey] || 0) + delta * step;
    ability.effect[effectKey] = clampEffectValue(effectKey, nextValue);
  }

  renderForgedPreview();
}

function loadFighterIntoForge(fighter, options = {}) {
  if (!fighter) {
    return;
  }

  state.forgedCharacter = cloneFighterForForge(fighter);
  state.iterationBaseline = cloneFighterForForge(fighter);
  state.forgeArchetype = fighter.archetype || inferArchetypeFromStats(fighter);
  state.forgeServerErrors = [];
  state.forgeImportContext = options.importContext || null;
  if (options.forceLocalCopy) {
    state.savedForge = null;
  } else if (state.savedForge?.fighter?.id !== fighter.id) {
    state.savedForge = null;
  }
  if (els.creatorName) {
    els.creatorName.value = normalizeCreatorName(fighter.creator_name || '');
  }
  els.forgePrompt.value = normalizeWhitespace(fighter.description || '');
  renderArchetypePicker();
  renderForgeSaveState();
  renderForgedPreview();
  setForgeStatus('info', options.message || `Loaded ${fighter.name} into the forge. Tune it, then update the authorized draft or save a variant.`);
  if (options.scroll !== false) {
    document.getElementById('forge-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function buildWhatChanged(current, baseline) {
  if (!current || !baseline) {
    return [];
  }

  const items = [];
  const statFields = [
    ['strength', 'STR'],
    ['speed', 'SPD'],
    ['durability', 'DUR'],
    ['intelligence', 'INT'],
    ['max_health', 'HP'],
  ];
  statFields.forEach(([field, label]) => {
    const delta = Number(current[field] || 0) - Number(baseline[field] || 0);
    if (delta !== 0) {
      items.push(`${label} ${formatDelta(delta)}`);
    }
  });

  const currentRead = inferArchetypeFromStats(current);
  const baselineRead = inferArchetypeFromStats(baseline);
  if (currentRead !== baselineRead) {
    items.push(`Role shift: ${slugLabel(baselineRead)} -> ${slugLabel(currentRead)}`);
  }

  const currentTags = deriveRoleTags(current, 4);
  const baselineTags = deriveRoleTags(baseline, 4);
  const gainedTags = currentTags.filter((tag) => !baselineTags.includes(tag));
  const lostTags = baselineTags.filter((tag) => !currentTags.includes(tag));
  if (gainedTags.length) {
    items.push(`Gained tags: ${gainedTags.join(', ')}`);
  }
  if (lostTags.length) {
    items.push(`Dropped tags: ${lostTags.join(', ')}`);
  }

  const maxAbilities = Math.max(current.abilities?.length || 0, baseline.abilities?.length || 0);
  for (let index = 0; index < maxAbilities; index += 1) {
    const currentAbility = current.abilities?.[index];
    const baselineAbility = baseline.abilities?.[index];
    if (!currentAbility || !baselineAbility) {
      continue;
    }
    const abilityLabel = currentAbility.name || baselineAbility.name || `Ability ${index + 1}`;
    ['power', 'cooldown', 'duration'].forEach((field) => {
      const currentValue = Number(currentAbility[field] || 0);
      const baselineValue = Number(baselineAbility[field] || 0);
      const delta = currentValue - baselineValue;
      if (delta !== 0) {
        items.push(`${abilityLabel}: ${slugLabel(field)} ${formatDelta(delta)}`);
      }
    });

    const effectKeys = new Set([
      ...Object.keys(currentAbility.effect || {}),
      ...Object.keys(baselineAbility.effect || {}),
    ]);
    effectKeys.forEach((key) => {
      const currentValue = Number(currentAbility.effect?.[key] || 0);
      const baselineValue = Number(baselineAbility.effect?.[key] || 0);
      const delta = Number((currentValue - baselineValue).toFixed(2));
      if (delta !== 0) {
        const digits = Number.isInteger(currentValue) && Number.isInteger(baselineValue) ? 0 : 2;
        items.push(`${abilityLabel}: ${slugLabel(key)} ${formatDelta(delta, digits)}`);
      }
    });
  }

  return items.slice(0, 10);
}

function renderVariantDelta(current, baseline) {
  if (!baseline) {
    return null;
  }

  const changes = buildWhatChanged(current, baseline);
  if (!changes.length) {
    return node('div', { className: 'rounded-2xl border border-line bg-slate-950/55 p-3' }, [
      node('p', { className: 'text-xs uppercase tracking-[0.22em] text-slate-400', text: 'What Changed' }),
      node('p', {
        className: 'mt-2 text-xs text-slate-500',
        text: 'No delta yet. Use the tuning buttons or reforge a matchup target to create a variant worth saving.',
      }),
    ]);
  }

  return node('div', { className: 'rounded-2xl border border-neonpurple/20 bg-neonpurple/10 p-3' }, [
    node('p', { className: 'text-xs uppercase tracking-[0.22em] text-neonpurple', text: 'What Changed' }),
    node('p', {
      className: 'mt-2 text-xs text-slate-300',
      text: `Comparing the current preview against ${baseline.name}.`,
    }),
    node('div', { className: 'mt-3 flex flex-wrap gap-2' }, changes.map((change) => node('span', {
      className: 'rounded-full border border-neonpurple/20 bg-slate-950/60 px-3 py-1 text-[11px] text-slate-200',
      text: change,
    }))),
  ]);
}

function validateEffect(effect, index, errors) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
    errors.push(`Ability ${index + 1}: effect must be a flat object.`);
    return;
  }

  const allowed = ['bleed', 'damage_mult', 'damage_taken_mult', 'speed_mult', 'stun_chance', 'ticks'];
  for (const [key, value] of Object.entries(effect)) {
    if (!allowed.includes(key)) {
      errors.push(`Ability ${index + 1}: unsupported effect key "${key}".`);
      continue;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(`Ability ${index + 1}: effect "${key}" must be numeric.`);
    }
  }
}

function reviewForgedCharacter(fighter) {
  const errors = [];
  const warnings = [];

  if (!fighter) {
    return { errors, warnings, totalStats: 0, payloadSize: 0, inferredArchetype: state.forgeArchetype };
  }

  const payload = buildFighterPayload(fighter, 'public');
  const totalStats = fighter.strength + fighter.speed + fighter.durability + fighter.intelligence;
  const payloadSize = JSON.stringify(payload).length;
  const inferredArchetype = inferArchetypeFromStats(fighter);

  if (!fighter.archetype || !ARCHETYPES[fighter.archetype]) {
    errors.push('Choose a supported archetype before saving.');
  }
  if (fighter.name.length < 3 || fighter.name.length > 60) {
    errors.push('Name must be between 3 and 60 characters.');
  }
  if (fighter.title.length > 80) {
    errors.push('Title must be 80 characters or fewer.');
  }
  if (
    fighter.creator_name &&
    (fighter.creator_name.length > MAX_CREATOR_NAME_LENGTH || !CREATOR_NAME_RE.test(fighter.creator_name))
  ) {
    errors.push('Creator name must be 32 characters or fewer and use only safe display characters.');
  }
  if (fighter.description.length > 600) {
    errors.push('Description must be 600 characters or fewer.');
  }
  if (fighter.passive_name.length > 60) {
    errors.push('Passive name must be 60 characters or fewer.');
  }
  if (fighter.passive_description.length > 320) {
    errors.push('Passive description must be 320 characters or fewer.');
  }
  if (fighter.win_condition.length > 240) {
    errors.push('Win condition must be 240 characters or fewer.');
  }
  if (fighter.balance_notes.length > 240) {
    errors.push('Balance notes must be 240 characters or fewer.');
  }
  if (!/^#[0-9a-f]{6}$/i.test(fighter.avatar_color || '')) {
    errors.push('Avatar color must be a hex color like #38bdf8.');
  }

  ['strength', 'speed', 'durability', 'intelligence'].forEach((field) => {
    if (fighter[field] < MIN_CORE_STAT || fighter[field] > MAX_CORE_STAT) {
      errors.push(`${slugLabel(field)} must be between ${MIN_CORE_STAT} and ${MAX_CORE_STAT}.`);
    }
  });
  if (fighter.max_health < MIN_MAX_HEALTH || fighter.max_health > MAX_MAX_HEALTH) {
    errors.push(`Max health must be between ${MIN_MAX_HEALTH} and ${MAX_MAX_HEALTH}.`);
  }
  if (totalStats > MAX_CORE_STAT_BUDGET) {
    errors.push(`Combined core stats must stay at or below ${MAX_CORE_STAT_BUDGET}.`);
  }
  if (fighter.max_health > 180 && totalStats > 300) {
    errors.push('High-health fighters must trade off some core stats.');
  }

  if (!Array.isArray(fighter.abilities) || fighter.abilities.length < 1 || fighter.abilities.length > MAX_ABILITY_COUNT) {
    errors.push(`A fighter must have between 1 and ${MAX_ABILITY_COUNT} abilities.`);
  } else {
    const names = fighter.abilities.map((ability) => normalizeWhitespace(ability.name).toLowerCase());
    if (new Set(names).size !== names.length) {
      errors.push('Ability names must be unique per fighter.');
    }

    fighter.abilities.forEach((ability, index) => {
      if (ability.name.length < 2 || ability.name.length > 60) {
        errors.push(`Ability ${index + 1}: name must be between 2 and 60 characters.`);
      }
      if (!['attack', 'buff'].includes(ability.type)) {
        errors.push(`Ability ${index + 1}: type must be attack or buff.`);
      }
      if (ability.cooldown < 1 || ability.cooldown > 8) {
        errors.push(`Ability ${index + 1}: cooldown must be between 1 and 8.`);
      }
      if ((ability.description || '').length > 240 || !normalizeWhitespace(ability.description)) {
        errors.push(`Ability ${index + 1}: description must be present and 240 characters or fewer.`);
      }
      if (ability.type === 'attack') {
        if (!(ability.power > 0 && ability.power <= 40)) {
          errors.push(`Ability ${index + 1}: attack power must be between 1 and 40.`);
        }
        if (!['strength', 'speed', 'durability', 'intelligence'].includes(ability.scaling)) {
          errors.push(`Ability ${index + 1}: attack abilities must declare a valid scaling stat.`);
        }
      }
      if (ability.type === 'buff') {
        if (!(ability.duration >= 1 && ability.duration <= 4)) {
          errors.push(`Ability ${index + 1}: buff duration must be between 1 and 4.`);
        }
        if (!ability.effect || !Object.keys(ability.effect).length) {
          errors.push(`Ability ${index + 1}: buff abilities must include at least one supported effect.`);
        } else {
          validateEffect(ability.effect, index, errors);
        }
      }
      if (ability.effect && ability.type !== 'buff') {
        validateEffect(ability.effect, index, errors);
      }
    });
  }

  if (payloadSize > MAX_FIGHTER_PAYLOAD_CHARS) {
    errors.push(`Payload is too large. Keep it under ${MAX_FIGHTER_PAYLOAD_CHARS} characters.`);
  } else if (payloadSize > MAX_FIGHTER_PAYLOAD_CHARS - 150) {
    warnings.push('Payload is getting large. Tighten the lore if backend validation complains.');
  }

  if (fighter.archetype !== inferredArchetype) {
    warnings.push(`Stats read more like ${slugLabel(inferredArchetype)} than ${slugLabel(fighter.archetype)}.`);
  }
  if (fighter.archetype === 'tank' && fighter.durability < 82) {
    warnings.push('Tank drafts land better when durability is a clear headline stat.');
  }
  if (fighter.archetype === 'assassin' && fighter.speed < 84) {
    warnings.push('Assassin drafts usually want a sharper speed edge.');
  }
  if (fighter.archetype === 'bruiser' && (fighter.durability < 74 || fighter.max_health < 126)) {
    warnings.push('Bruiser drafts should clearly read as durable pressure, not just generic damage.');
  }
  if (fighter.archetype === 'control' && fighter.intelligence < 84) {
    warnings.push('Control drafts usually need intelligence to be a visible headline stat.');
  }
  if (fighter.archetype === 'glass_cannon' && fighter.durability > 58) {
    warnings.push('Glass cannon drafts should usually sacrifice more durability for the fantasy to read clearly.');
  }
  if (fighter.archetype === 'duelist' && Math.max(fighter.strength, fighter.speed, fighter.durability, fighter.intelligence) > 82) {
    warnings.push('Duelist drafts read best when no single stat overwhelms the rest of the kit.');
  }

  return {
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
    totalStats,
    payloadSize,
    inferredArchetype,
  };
}

function setForgeStatus(type, message) {
  state.forgeStatus = message ? { type, message } : null;
  renderForgeStatus();
}

function renderForgeStatus() {
  if (!els.forgeStatus) {
    return;
  }
  if (!state.forgeStatus) {
    els.forgeStatus.replaceChildren();
    return;
  }

  const tone = {
    info: 'border-neonblue/25 bg-neonblue/10 text-neonblue',
    success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    error: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
  }[state.forgeStatus.type] || 'border-line bg-panel text-slate-200';

  setChildren(els.forgeStatus, node('div', { className: `forge-message ${tone}`, text: state.forgeStatus.message }));
}

function renderForgeValidation() {
  if (!els.forgeValidation) {
    return;
  }
  if (!state.forgedCharacter) {
    setChildren(
      els.forgeValidation,
      node('p', {
        className: 'text-xs text-slate-500',
        text: 'Local warnings and backend validation notes will appear here.',
      })
    );
    return;
  }

  const review = reviewForgedCharacter(state.forgedCharacter);
  const blocks = [];
  const validationBlock = (className, titleClassName, title, listClassName, messages) => node('div', { className }, [
    node('p', { className: titleClassName, text: title }),
    node('ul', { className: listClassName }, messages.map((message) => node('li', { text: message }))),
  ]);

  if (review.errors.length) {
    blocks.push(validationBlock(
      'rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3',
      'text-xs uppercase tracking-[0.22em] text-rose-200',
      'Local blockers',
      'mt-2 space-y-1 text-xs text-rose-100',
      review.errors
    ));
  }

  if (review.warnings.length) {
    blocks.push(validationBlock(
      'rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3',
      'text-xs uppercase tracking-[0.22em] text-amber-100',
      'Forge warnings',
      'mt-2 space-y-1 text-xs text-amber-50',
      review.warnings
    ));
  }

  if (state.forgeServerErrors.length) {
    blocks.push(validationBlock(
      'rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3',
      'text-xs uppercase tracking-[0.22em] text-rose-200',
      'Backend validation',
      'mt-2 space-y-1 text-xs text-rose-100',
      state.forgeServerErrors
    ));
  }

  if (!blocks.length) {
    blocks.push(node('div', {
      className: 'rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-200',
      text: 'Local checks look clean. Save to let the backend make it official.',
    }));
  }

  setChildren(els.forgeValidation, blocks);
}

function renderEffectSummary(effect) {
  if (!effect || !Object.keys(effect).length) {
    return 'No special effect';
  }
  return Object.entries(effect)
    .map(([key, value]) => `${slugLabel(key)} ${value}`)
    .join(' · ');
}

function renderForgedPreview() {
  if (!els.forgedPreview) {
    return;
  }
  const fighter = state.forgedCharacter;
  if (!fighter) {
    setChildren(els.forgedPreview, node('p', {
      className: 'text-slate-400',
      text: 'No fighter forged yet. Choose an archetype and start a draft.',
    }));
    renderForgeValidation();
    updateForgeActionState();
    return;
  }

  const review = reviewForgedCharacter(fighter);
  const guide = getArchetypeGuide(fighter.archetype);
  const color = safeColor(fighter.avatar_color);
  const saveBadge = state.savedForge
    ? node('span', {
        className: 'rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200',
        text: `Saved ${state.savedForge.fighter.visibility}`,
      })
    : node('span', {
        className: 'rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-100',
        text: 'Preview only',
      });
  const adjustButton = (className, dataset, label) => node('button', {
    type: 'button',
    className,
    dataset,
    text: label,
  });
  const statControl = ([field, label, value, step]) => {
    if (field === 'Read') {
      return node('div', { className: 'rounded-xl border border-line bg-slate-950/70 p-3' }, [
        node('div', { className: 'flex items-center justify-between gap-2' }, [
          node('span', { className: 'text-slate-400', text: field }),
          node('span', { className: 'font-semibold text-white', text: label }),
        ]),
      ]);
    }
    return node('div', { className: 'rounded-xl border border-line bg-slate-950/70 p-3' }, [
      node('div', { className: 'flex items-center justify-between gap-2' }, [
        node('span', { className: 'text-slate-400', text: label }),
        node('div', { className: 'flex items-center gap-2' }, [
          adjustButton(
            'forge-adjust rounded-lg border border-line px-2 py-1 text-slate-300 hover:border-neonpurple/30',
            { field, delta: -step },
            '-'
          ),
          node('span', { className: 'min-w-10 text-center font-semibold text-white', text: value }),
          adjustButton(
            'forge-adjust rounded-lg border border-line px-2 py-1 text-slate-300 hover:border-neonpurple/30',
            { field, delta: step },
            '+'
          ),
        ]),
      ]),
    ]);
  };
  const abilityAdjust = (index, field, delta, label, effectKey = '') => adjustButton(
    'forge-ability-adjust rounded-md border border-line px-2 py-1 hover:border-neonpurple/30',
    { index, field, delta, effectKey },
    label
  );
  const abilityControl = (label, buttons) => node('div', {
    className: 'flex items-center gap-2 rounded-full border border-line px-2 py-1 text-slate-300',
  }, [
    node('span', { text: label }),
    buttons,
  ]);

  setChildren(els.forgedPreview, node('div', { className: 'rounded-2xl border border-line bg-panel p-4 space-y-4' }, [
    node('div', { className: 'flex items-start justify-between gap-3' }, [
      node('div', { className: 'flex items-center gap-3' }, [
        node('div', { className: 'h-14 w-14 rounded-2xl', style: { background: color, boxShadow: `0 0 18px ${color}55` } }),
        node('div', {}, [
          node('div', { className: 'flex flex-wrap items-center gap-2' }, [
            node('p', { className: 'font-bold text-lg', text: fighter.name }),
            saveBadge,
          ]),
          node('p', { className: 'text-xs text-slate-400', text: fighter.title }),
          fighter.creator_name ? node('p', { className: 'mt-1 text-[11px] text-neonblue', text: `Forged by ${fighter.creator_name}` }) : null,
          node('p', { className: 'mt-1 text-[11px] uppercase tracking-[0.24em] text-neonpurple', text: slugLabel(fighter.archetype) }),
          node('p', { className: 'mt-2 text-sm text-slate-200', text: guide.summary }),
          node('div', { className: 'mt-3 flex flex-wrap gap-2' }, renderRoleTagPills(deriveRoleTags(fighter, 4))),
        ]),
      ]),
      node('div', { className: 'rounded-2xl border border-line bg-slate-950/70 px-3 py-2 text-right text-[11px] text-slate-400' }, [
        node('p', { text: 'Total stats' }),
        node('p', { className: 'text-base font-bold text-white', text: review.totalStats }),
      ]),
    ]),
    node('p', { className: 'text-sm text-slate-300', text: fighter.description }),
    node('div', { className: 'rounded-2xl border border-line bg-slate-950/55 p-3' }, [
      node('p', { className: 'text-xs uppercase tracking-[0.22em] text-slate-400', text: 'Archetype Read' }),
      node('p', { className: 'mt-2 text-sm text-slate-200', text: getWinPatternText(fighter) }),
      node('p', { className: 'mt-2 text-xs text-slate-500', text: `Strengths: ${guide.strengths.join(' · ')}` }),
      node('p', { className: 'mt-1 text-xs text-slate-500', text: `Weaknesses: ${guide.weaknesses.join(' · ')}` }),
    ]),
    node('div', { className: 'grid grid-cols-2 gap-2 text-xs' }, [
      ['strength', 'STR', fighter.strength, 1],
      ['speed', 'SPD', fighter.speed, 1],
      ['durability', 'DUR', fighter.durability, 1],
      ['intelligence', 'INT', fighter.intelligence, 1],
      ['max_health', 'HP', fighter.max_health, 2],
      ['Read', getStatIdentity(fighter)],
    ].map(statControl)),
    node('div', { className: 'rounded-2xl border border-line bg-slate-950/55 p-3' }, [
      node('p', { className: 'font-semibold text-white', text: `Passive: ${fighter.passive_name}` }),
      node('p', { className: 'mt-1 text-xs text-slate-400', text: fighter.passive_description }),
    ]),
    node('div', {}, [
      node('div', { className: 'flex items-center justify-between gap-2' }, [
        node('p', { className: 'font-semibold text-white', text: 'Ability kit' }),
        node('p', { className: 'text-[11px] text-slate-500', text: `${fighter.abilities.length} abilities` }),
      ]),
      node('div', { className: 'mt-2 space-y-2' }, fighter.abilities.map((ability, index) => node('div', {
        className: 'rounded-xl border border-line bg-slate-950/70 p-3',
      }, [
        node('div', { className: 'flex items-start justify-between gap-3' }, [
          node('div', {}, [
            node('p', { className: 'font-semibold text-white', text: ability.name }),
            node('p', { className: 'mt-1 text-xs text-slate-400', text: ability.description }),
          ]),
          node('div', { className: 'text-right text-[11px] text-slate-400' }, [
            node('p', { text: slugLabel(ability.type) }),
            node('p', { text: `CD ${ability.cooldown}` }),
          ]),
        ]),
        node('div', { className: 'mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300' }, [
          node('span', {
            className: 'rounded-full border border-line px-2 py-1',
            text: ability.type === 'attack' ? `Scaling ${slugLabel(ability.scaling)}` : renderEffectSummary(ability.effect),
          }),
        ]),
        node('div', { className: 'mt-3 flex flex-wrap gap-2 text-[11px]' }, [
          ability.type === 'attack'
            ? abilityControl(`Power ${ability.power}`, [
                abilityAdjust(index, 'power', -1, '-'),
                abilityAdjust(index, 'power', 1, '+'),
              ])
            : abilityControl(`Duration ${ability.duration}`, [
                abilityAdjust(index, 'duration', -1, '-'),
                abilityAdjust(index, 'duration', 1, '+'),
              ]),
          abilityControl(`CD ${ability.cooldown}`, [
            abilityAdjust(index, 'cooldown', -1, '-'),
            abilityAdjust(index, 'cooldown', 1, '+'),
          ]),
          Object.entries(ability.effect || {}).map(([key, value]) => abilityControl(`${slugLabel(key)} ${value}`, [
            abilityAdjust(index, 'effect', -1, '-', key),
            abilityAdjust(index, 'effect', 1, '+', key),
          ])),
        ]),
      ]))),
    ]),
    renderVariantDelta(fighter, state.iterationBaseline),
    node('div', { className: 'grid gap-2 text-xs text-slate-400' }, [
      node('p', {}, [
        node('strong', { className: 'text-white', text: 'Win condition:' }),
        ` ${fighter.win_condition}`,
      ]),
      node('p', {}, [
        node('strong', { className: 'text-white', text: 'Balance notes:' }),
        ` ${fighter.balance_notes}`,
      ]),
    ]),
  ]));

  els.forgedPreview.querySelectorAll('.forge-adjust').forEach((button) => {
    button.addEventListener('click', () => {
      adjustForgedStat(button.dataset.field, Number(button.dataset.delta || 0));
    });
  });
  els.forgedPreview.querySelectorAll('.forge-ability-adjust').forEach((button) => {
    button.addEventListener('click', () => {
      adjustForgedAbility(
        Number(button.dataset.index),
        button.dataset.field,
        Number(button.dataset.delta || 0),
        button.dataset.effectKey || ''
      );
    });
  });

  renderForgeValidation();
  updateForgeActionState();
}

function renderForgeSaveState() {
  if (!els.forgeSaveState) {
    return;
  }
  if (!state.savedForge) {
    if (state.forgeImportContext) {
      const sourceName = state.forgeImportContext.sourceName || 'Imported fighter';
      const sourceSlug = state.forgeImportContext.sourceSlug || '';
      const sourceLink = sourceSlug ? getFighterShareUrl({ slug: sourceSlug }) : '';
      setChildren(els.forgeSaveState, node('div', {
        className: 'rounded-2xl border border-neonblue/20 bg-neonblue/10 px-3 py-3 text-xs text-slate-200',
      }, [
        node('p', {
          className: 'font-semibold text-white',
          text: `${sourceName} is loaded as a copied ${state.forgeImportContext.mode === 'duplicate' ? 'variant branch' : 'reference'}.`,
        }),
        node('p', {
          className: 'mt-1 text-slate-300',
          text: 'This is a local Forge workflow only. Saving from here creates your own fighter entry and does not edit the original shared fighter.',
        }),
        state.forgedCharacter?.creator_name
          ? node('p', { className: 'mt-1 text-neonblue', text: `Attribution carried forward: Forged by ${state.forgedCharacter.creator_name}.` })
          : node('p', { className: 'mt-1 text-slate-400', text: 'No creator attribution is set on this local copy yet.' }),
        sourceLink ? node('a', {
          href: sourceLink,
          className: 'mt-2 inline-flex text-neonblue hover:text-white',
          text: 'Open original share page',
        }) : null,
      ]));
      return;
    }
    if (state.iterationBaseline) {
      setChildren(els.forgeSaveState, node('div', {
        className: 'rounded-2xl border border-line bg-panel px-3 py-3 text-xs text-slate-300',
      }, [
        node('p', {
          className: 'font-semibold text-white',
          text: `${state.iterationBaseline.name} is loaded as the iteration baseline.`,
        }),
        node('p', {
          className: 'mt-1 text-slate-400',
          text: 'Tune the preview, then use Save Variant for a safe branch.',
        }),
        state.iterationBaseline.creator_name ? node('p', {
          className: 'mt-1 text-neonblue',
          text: `Forged by ${state.iterationBaseline.creator_name}`,
        }) : null,
        isChampionFighter(state.iterationBaseline, state.championState) ? node('p', {
          className: 'mt-2 text-amber-100',
          text: 'This baseline is also your current champion.',
        }) : null,
      ]));
      return;
    }
    setChildren(els.forgeSaveState, node('span', { className: 'text-slate-400', text: 'Nothing saved yet.' }));
    return;
  }

  const fighter = state.savedForge.fighter;
  const isChampion = isChampionFighter(fighter, state.championState);
  const rosterEntry = getRosterEntryForFighter(fighter);
  const visibilityLabel = fighter.visibility === 'unlisted' ? 'draft (unlisted)' : 'public';
  const shareUrl = getFighterShareUrl(fighter);
  const challengeUrl = getFighterChallengeUrl(fighter);
  const changes = buildWhatChanged(state.forgedCharacter, state.iterationBaseline);
  const urlCard = (label, url) => node('div', {
    className: 'rounded-2xl border border-line bg-slate-950/60 px-3 py-3',
  }, [
    node('p', { className: 'text-[11px] uppercase tracking-[0.2em] text-slate-500', text: label }),
    node('p', { className: 'mt-2 break-all text-slate-200', text: url }),
  ]);
  setChildren(els.forgeSaveState, node('div', {
    className: 'rounded-2xl border border-line bg-panel px-3 py-3 text-xs text-slate-300',
  }, [
    node('p', { className: 'font-semibold text-white', text: `${fighter.name} is saved as ${visibilityLabel}.` }),
    node('p', { className: 'mt-1 text-slate-400', text: `Slug: ${fighter.slug} · Archetype: ${slugLabel(fighter.archetype)}` }),
    node('p', {
      className: `mt-1 ${fighter.creator_name ? 'text-neonblue' : 'text-slate-500'}`,
      text: fighter.creator_name ? `Forged by ${fighter.creator_name}` : 'No display attribution set.',
    }),
    node('p', {
      className: 'mt-1 text-slate-500',
      text: state.savedForge.editToken ? 'This save can be updated in place.' : 'Use Save Variant to create a safe branch.',
    }),
    node('p', {
      className: `mt-1 ${isChampion ? 'text-amber-100' : 'text-slate-500'}`,
      text: isChampion ? 'This fighter is your current champion.' : 'Make this save your champion if it is now the build you want to lead with.',
    }),
    node('p', {
      className: `mt-1 ${rosterEntry ? 'text-neonblue' : 'text-slate-500'}`,
      text: rosterEntry ? 'Stored in your browser-local roster as a local snapshot.' : 'Not in your local roster yet.',
    }),
    node('p', { className: 'mt-1 text-slate-400', text: getVisibilitySummary(fighter) }),
    changes.length ? node('p', {
      className: 'mt-2 text-slate-400',
      text: `Current draft delta: ${changes.slice(0, 2).join(' · ')}`,
    }) : null,
    node('div', { className: 'forge-save-links mt-3 grid gap-2 md:grid-cols-2' }, [
      urlCard('Share URL', shareUrl),
      challengeUrl ? urlCard('Challenge URL', challengeUrl) : null,
    ]),
    node('div', { className: 'forge-save-actions mt-3 flex flex-wrap items-center gap-3' }, [
      node('a', { href: shareUrl, className: 'inline-flex text-neonblue hover:text-white', text: 'Open share page' }),
      challengeUrl ? node('a', {
        href: challengeUrl,
        className: 'inline-flex text-neonpink hover:text-white',
        text: 'Open challenge',
      }) : null,
      node('button', {
        type: 'button',
        className: 'forge-copy-link text-neonpurple hover:text-white',
        dataset: { url: shareUrl, label: 'Share link' },
        text: 'Copy share link',
      }),
      challengeUrl ? node('button', {
        type: 'button',
        className: 'forge-copy-link text-neonblue hover:text-white',
        dataset: { url: challengeUrl, label: 'Challenge link' },
        text: 'Copy challenge link',
      }) : null,
      node('button', {
        type: 'button',
        className: `forge-set-champion rounded-xl border ${isChampion ? 'border-amber-300/30 bg-amber-300/10 text-amber-100' : 'border-amber-300/20 bg-transparent text-amber-100'} px-3 py-2 font-semibold uppercase tracking-[0.16em] hover:bg-amber-300/10`,
        text: isChampion ? 'Current Champion' : 'Make Champion',
      }),
      node('button', {
        type: 'button',
        className: `forge-roster-toggle rounded-xl border border-neonblue/30 ${rosterEntry ? 'bg-neonblue/15 text-neonblue' : 'bg-transparent text-neonblue'} px-3 py-2 font-semibold uppercase tracking-[0.16em] hover:bg-neonblue/10`,
        text: rosterEntry ? 'Remove Roster' : 'Add To Roster',
      }),
    ]),
    node('p', {
      className: 'mt-2 text-slate-500',
      text: challengeUrl
        ? 'Only the fighter page and challenge link are shared. The edit token stays local to this browser session and is never embedded in those URLs.'
        : 'Only the fighter page is shared. The edit token stays local to this browser session and is never embedded in share URLs.',
    }),
  ]));
  els.forgeSaveState.querySelectorAll('.forge-copy-link').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await copyTextToClipboard(button.dataset.url || '');
        setForgeStatus('success', `${button.dataset.label || 'Link'} copied.`);
      } catch (error) {
        setForgeStatus('error', error.message);
      }
    });
  });
  els.forgeSaveState.querySelector('.forge-set-champion')?.addEventListener('click', () => {
    designateChampionWithRoster(fighter, {
      originType: state.savedForge?.fighter?.id ? 'forge_saved' : 'variant_copy',
      sourcePage: 'forge',
    });
    renderChampionBanner();
    renderCharacterList();
    renderSelection();
    renderForgeSaveState();
    setForgeStatus('info', `${fighter.name} is now your local champion.`);
  });
  els.forgeSaveState.querySelector('.forge-roster-toggle')?.addEventListener('click', () => {
    if (getRosterEntryForFighter(fighter)) {
      const removal = removeLocalRosterFighter(fighter);
      renderChampionBanner();
      renderCharacterList();
      renderSelection();
      renderForgeSaveState();
      setForgeStatus('info', removal.clearedChampion ? `${fighter.name} removed from your local roster and cleared as champion.` : `${fighter.name} removed from your local roster.`);
      return;
    }

    upsertLocalRosterFighter(fighter, {
      origin_type: 'forge_saved',
      source_page: 'forge',
    });
    renderCharacterList();
    renderForgeSaveState();
    setForgeStatus('success', `${fighter.name} added to your local roster.`);
  });
}

function setButtonEnabled(button, enabled) {
  if (!button) {
    return;
  }
  button.disabled = !enabled;
  button.classList.toggle('opacity-50', !enabled);
  button.classList.toggle('cursor-not-allowed', !enabled);
}

function updateForgeActionState() {
  const hasPreview = Boolean(state.forgedCharacter);
  const review = hasPreview ? reviewForgedCharacter(state.forgedCharacter) : { errors: [] };
  const canSave = hasPreview && review.errors.length === 0;
  setButtonEnabled(els.saveDraftBtn, canSave);
  setButtonEnabled(els.savePublicBtn, canSave);
  setButtonEnabled(els.saveVariantBtn, canSave);
}

function renderArchetypePicker() {
  if (
    !els.selectedArchetypeLabel
    || !els.archetypeSummaryTitle
    || !els.archetypeSummary
    || !els.archetypeStrengths
    || !els.archetypeWeaknesses
    || !els.archetypeWinPattern
    || !els.archetypeMatchupRead
    || !els.archetypeRoleTags
  ) {
    return;
  }
  const guide = getArchetypeGuide(state.forgeArchetype);
  els.selectedArchetypeLabel.textContent = slugLabel(state.forgeArchetype);
  els.archetypeButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.archetype === state.forgeArchetype);
  });
  els.archetypeSummaryTitle.textContent = guide.label;
  els.archetypeSummary.textContent = guide.summary;
  setChildren(els.archetypeStrengths, guide.strengths.map((strength) => node('li', { text: strength })));
  setChildren(els.archetypeWeaknesses, guide.weaknesses.map((weakness) => node('li', { text: weakness })));
  els.archetypeWinPattern.textContent = guide.winCondition;
  els.archetypeMatchupRead.textContent = `Matchup read: ${guide.matchupRead}`;
  setChildren(els.archetypeRoleTags, renderRoleTagPills(guide.roleTags || []));
}

async function forgeCharacter() {
  if (!els.forgePrompt || !els.forgeBalance || !els.forgeModel) {
    return;
  }
  const prompt = els.forgePrompt.value.trim();
  const balance = els.forgeBalance.value;
  const model = els.forgeModel.value;
  const baselineSource = state.forgedCharacter || state.savedForge?.fighter || null;

  state.forgeServerErrors = [];
  if (els.llmStatus) {
    els.llmStatus.textContent = model === 'ollama' ? 'Warming' : 'Procedural';
  }
  setForgeStatus(
    'info',
    model === 'ollama'
      ? 'Forging a local draft, then requesting optional Ollama flavor assist.'
      : 'Forging a procedural draft. Review it before saving.'
  );

  try {
    const baseDraft = proceduralForge(state.forgeArchetype, prompt, balance);
    let forged = baseDraft;

    if (model === 'ollama') {
      try {
        const assist = await requestCreativeAssist(baseDraft, prompt, model);
        if (assist.suggestions) {
          forged = mergeCreativeSuggestions(baseDraft, assist.suggestions);
          if (els.llmStatus) {
            els.llmStatus.textContent = 'Ollama';
          }
          const modelDetail = assist.used_model ? ` (${assist.used_model})` : '';
          setForgeStatus('info', `${assist.message}${modelDetail}`);
        } else {
          if (els.llmStatus) {
            els.llmStatus.textContent = assist.available ? 'Ollama' : 'Offline';
          }
          setForgeStatus('info', assist.message || 'Ollama is unavailable. Using procedural flavor only.');
        }
      } catch (error) {
        console.error(error);
        if (els.llmStatus) {
          els.llmStatus.textContent = error.status === 429 ? 'Busy' : 'Offline';
        }
        setForgeStatus('info', `Ollama assist unavailable: ${error.message}. Using procedural flavor only.`);
      }
    } else {
      if (els.llmStatus) {
        els.llmStatus.textContent = 'Procedural';
      }
      setForgeStatus('info', 'Procedural draft forged. Save it to let the backend validate it.');
    }

    state.forgedCharacter = forged;
    state.iterationBaseline = baselineSource ? cloneFighterForForge(baselineSource) : null;
    renderForgeSaveState();
    renderForgedPreview();
  } catch (error) {
    console.error(error);
    els.llmStatus.textContent = 'Error';
    state.forgedCharacter = null;
    state.forgeServerErrors = [];
    setForgeStatus('error', `Forge failed: ${error.message}`);
    renderForgedPreview();
  }
}

function syncSavedForge(saved, editToken = null, options = {}) {
  const nextEditToken = editToken || state.savedForge?.editToken || null;
  state.savedForge = {
    fighter: saved,
    editToken: nextEditToken,
  };
  state.forgeImportContext = null;
  if (options.setBaseline !== false) {
    state.iterationBaseline = cloneFighterForForge(saved);
  }

  const existingIndex = state.characters.findIndex((character) => character.id === saved.id);
  if (saved.visibility === 'public') {
    if (existingIndex >= 0) {
      state.characters.splice(existingIndex, 1, saved);
    } else {
      state.characters.push(saved);
    }
    sortCharacters(state.characters);
  } else if (existingIndex >= 0) {
    state.characters.splice(existingIndex, 1);
  }

  if (state.selectedA?.id === saved.id) {
    state.selectedA = saved;
  }
  if (state.selectedB?.id === saved.id) {
    state.selectedB = saved;
  }
  if (isChampionFighter(saved, state.championState)) {
    state.championState = designateChampion(saved, state.championState);
  }

  renderChampionBanner();
  renderCharacterList();
  renderSelection();
  renderForgeSaveState();
  updateStats();
  updateForgeActionState();
}

async function saveForgedCharacter(visibility, options = {}) {
  if (!state.forgedCharacter) {
    setForgeStatus('error', 'Generate a forge preview before trying to save it.');
    return;
  }

  const review = reviewForgedCharacter(state.forgedCharacter);
  if (review.errors.length) {
    state.forgeServerErrors = [];
    setForgeStatus('error', 'This preview has local blockers. Reforge it before saving.');
    renderForgeValidation();
    updateForgeActionState();
    return;
  }

  const forceCreate = Boolean(options.forceCreate);
  const payload = buildFighterPayload(state.forgedCharacter, visibility);
  const createBranchName = forceCreate || (
    !Boolean(state.savedForge?.fighter?.id && state.savedForge?.editToken)
    && state.iterationBaseline
    && normalizeWhitespace(payload.name).toLowerCase() === normalizeWhitespace(state.iterationBaseline.name).toLowerCase()
  );
  if (createBranchName) {
    payload.name = buildVariantName(payload.name);
  }
  const isUpdate = Boolean(state.savedForge?.fighter?.id && state.savedForge?.editToken);
  const url = !forceCreate && isUpdate ? `/api/fighters/${state.savedForge.fighter.id}/` : '/api/fighters/';
  const method = !forceCreate && isUpdate ? 'PATCH' : 'POST';

  setForgeStatus(
    'info',
    createBranchName
      ? `Saving ${visibility === 'unlisted' ? 'draft' : 'public'} variant to the backend...`
      : visibility === 'unlisted'
        ? 'Saving draft to the backend...'
        : 'Publishing fighter to the backend...'
  );

  try {
    const saved = await apiJson(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(!forceCreate && isUpdate ? { 'X-Fighter-Edit-Token': state.savedForge.editToken } : {}),
      },
      body: JSON.stringify(payload),
    });

    state.forgeServerErrors = [];
    syncSavedForge(
      saved,
      !forceCreate && isUpdate ? state.savedForge.editToken : saved.edit_token
    );
    upsertLocalRosterFighter(saved, {
      origin_type: createBranchName ? 'variant_copy' : 'forge_saved',
      source_page: 'forge',
    });
    state.forgedCharacter = cloneFighterForForge(saved);
    renderForgedPreview();
    renderForgeSaveState();
    setForgeStatus(
      'success',
      createBranchName
        ? `Variant saved as ${saved.name}.`
        : visibility === 'unlisted'
          ? 'Draft saved. It is official for testing, but hidden from the public library.'
          : 'Fighter published. It now appears in the public library.'
    );
    pushLog(`${saved.name} saved to the forge as ${saved.visibility}.`, 'emerald');
  } catch (error) {
    state.forgeServerErrors = flattenApiErrors(error.payload);
    setForgeStatus('error', error.message);
    renderForgeValidation();
    updateForgeActionState();
  }
}

if (els.search) {
  els.search.addEventListener('input', renderCharacterList);
}
if (els.simulateBtn) {
  els.simulateBtn.addEventListener('click', handleSimulate);
}
if (els.refreshBtn) {
  els.refreshBtn.addEventListener('click', bootstrap);
}
if (els.forgeBtn) {
  els.forgeBtn.addEventListener('click', forgeCharacter);
}
if (els.saveDraftBtn) {
  els.saveDraftBtn.addEventListener('click', () => saveForgedCharacter('unlisted'));
}
if (els.savePublicBtn) {
  els.savePublicBtn.addEventListener('click', () => saveForgedCharacter('public'));
}
if (els.saveVariantBtn) {
  els.saveVariantBtn.addEventListener('click', () => {
    const visibility = state.savedForge?.fighter?.visibility || 'unlisted';
    saveForgedCharacter(visibility, { forceCreate: true });
  });
}
if (els.creatorName) {
  els.creatorName.addEventListener('input', () => {
    const value = normalizeCreatorName(els.creatorName.value);
    els.creatorName.value = value;
    if (state.forgedCharacter) {
      state.forgedCharacter.creator_name = value;
      renderForgedPreview();
      renderForgeSaveState();
    }
  });
}
els.archetypeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.forgeArchetype = button.dataset.archetype;
    renderArchetypePicker();
    state.forgeServerErrors = [];
    setForgeStatus('info', `Archetype locked: ${slugLabel(state.forgeArchetype)}.`);
  });
});

renderArchetypePicker();
updateForgeActionState();

bootstrap().catch((error) => {
  if (els.resultBox) {
    setChildren(els.resultBox, statusNode('text-rose-300', error.message));
  } else {
    setForgeStatus('error', error.message);
  }
});
