const CHAMPION_STORAGE_KEY = "clashforge.profile.champion";
const ROSTER_STORAGE_KEY = "clashforge.profile.local_roster";
const COPY_RESET_DELAY_MS = 1600;

function init() {
  const root = document.getElementById("fighter-detail-page");
  if (!(root instanceof HTMLElement)) {
    return;
  }

  const payloadId = root.dataset.payloadId;
  if (!payloadId) {
    return;
  }

  const payload = readPayload(payloadId);
  if (!payload) {
    return;
  }

  const elements = getElements(root);
  applyAvatarColor(elements.avatar, payload.fighter.avatarColor);
  bindCopyButtons(root, payload.urls, elements.status);
  bindChampionButton(elements, payload);
  bindRosterButton(elements, payload);
  renderChampionState(elements, payload);
  renderRosterState(elements, payload);
}

function getElements(root) {
  return {
    root,
    avatar: requireElement(root, "#profile-avatar"),
    championBadge: requireElement(root, "#profile-champion-badge"),
    championButton: requireElement(root, "#profile-set-champion-btn"),
    championBody: requireElement(root, "#profile-champion-body"),
    rosterButton: requireElement(root, "#profile-roster-btn"),
    rosterNote: requireElement(root, "#profile-roster-note"),
    status: requireElement(root, "#fighter-detail-status"),
  };
}

function requireElement(root, selector) {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function readPayload(scriptId) {
  const script = document.getElementById(scriptId);
  if (!(script instanceof HTMLScriptElement)) {
    console.error(`Missing payload script: ${scriptId}`);
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(script.textContent || "{}");
  } catch (error) {
    console.error("Failed to parse fighter detail payload.", error);
    return null;
  }

  return validatePayload(raw);
}

function validatePayload(raw) {
  if (!isPlainObject(raw)) {
    console.error("Payload must be an object.");
    return null;
  }

  const fighterRaw = isPlainObject(raw.fighter) ? raw.fighter : {};
  const urlsRaw = isPlainObject(raw.urls) ? raw.urls : {};

  const fighterId = toSafeString(fighterRaw.id);
  const fighterSlug = toSafeSlug(fighterRaw.slug);
  const fighterName = toSafeString(fighterRaw.name);
  const shareUrl = toSafeUrl(urlsRaw.shareUrl);
  const challengeUrl = toSafeUrl(urlsRaw.challengeUrl);
  const duplicateUrl = toSafeUrl(urlsRaw.duplicateUrl);
  const forgeUrl = toSafeUrl(urlsRaw.forgeUrl);

  if (!fighterId || !fighterSlug || !fighterName) {
    console.error("Payload missing required fighter identity fields.");
    return null;
  }

  if (!shareUrl || !duplicateUrl || !forgeUrl) {
    console.error("Payload missing required URL fields.");
    return null;
  }

  const snapshot = {
    id: fighterId,
    slug: fighterSlug,
    name: fighterName,
    title: toSafeString(fighterRaw.title),
    creatorName: toSafeString(fighterRaw.creatorName),
    archetype: toSafeString(fighterRaw.archetype),
    summary: toSafeString(fighterRaw.summary),
    avatarColor: toSafeColor(fighterRaw.avatarColor),
    visibility: toSafeString(fighterRaw.visibility),
    source: toSafeString(fighterRaw.source),
    shareUrl,
    challengeUrl,
    duplicateUrl,
    forgeUrl,
    stats: {
      strength: toSafeInteger(fighterRaw.stats?.strength),
      speed: toSafeInteger(fighterRaw.stats?.speed),
      durability: toSafeInteger(fighterRaw.stats?.durability),
      intelligence: toSafeInteger(fighterRaw.stats?.intelligence),
      maxHealth: toSafeInteger(fighterRaw.stats?.maxHealth),
    },
  };

  return {
    fighter: snapshot,
    urls: {
      shareUrl,
      challengeUrl,
      duplicateUrl,
      forgeUrl,
    },
  };
}

function bindCopyButtons(root, urls, statusElement) {
  const buttons = root.querySelectorAll("[data-copy-source]");
  buttons.forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) {
      return;
    }

    const sourceKey = node.dataset.copySource;
    const defaultLabel = node.dataset.defaultLabel || node.textContent || "Copy";
    const copiedLabel = node.dataset.copiedLabel || "Copied";
    const textToCopy = sourceKey ? urls[sourceKey] : "";

    if (!textToCopy) {
      node.disabled = true;
      return;
    }

    node.addEventListener("click", async () => {
      const didCopy = await copyText(textToCopy);
      if (didCopy) {
        node.textContent = copiedLabel;
        announce(statusElement, copiedLabel);
        window.setTimeout(() => {
          node.textContent = defaultLabel;
        }, COPY_RESET_DELAY_MS);
      } else {
        announce(statusElement, "Copy failed");
      }
    });
  });
}

function bindChampionButton(elements, payload) {
  elements.championButton.addEventListener("click", () => {
    const stored = readJsonStorage(CHAMPION_STORAGE_KEY);
    const currentId = toSafeString(stored?.id);

    if (currentId === payload.fighter.id) {
      renderChampionState(elements, payload);
      announce(elements.status, "This fighter is already your champion.");
      return;
    }

    writeJsonStorage(CHAMPION_STORAGE_KEY, {
      ...payload.fighter,
      savedAt: new Date().toISOString(),
    });

    renderChampionState(elements, payload);
    announce(elements.status, `${payload.fighter.name} set as champion.`);
  });
}

function bindRosterButton(elements, payload) {
  elements.rosterButton.addEventListener("click", () => {
    const roster = readRoster();
    const existingIndex = roster.findIndex((entry) => entry.id === payload.fighter.id);

    const nextEntry = {
      ...payload.fighter,
      savedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      roster[existingIndex] = nextEntry;
      writeJsonStorage(ROSTER_STORAGE_KEY, roster);
      renderRosterState(elements, payload);
      announce(elements.status, `${payload.fighter.name} refreshed in local roster.`);
      return;
    }

    roster.unshift(nextEntry);
    writeJsonStorage(ROSTER_STORAGE_KEY, roster);
    renderRosterState(elements, payload);
    announce(elements.status, `${payload.fighter.name} added to local roster.`);
  });
}

function renderChampionState(elements, payload) {
  const champion = readJsonStorage(CHAMPION_STORAGE_KEY);
  const isChampion = toSafeString(champion?.id) === payload.fighter.id;

  elements.championBadge.hidden = !isChampion;
  elements.championBadge.classList.toggle("hidden", !isChampion);

  elements.championButton.textContent = isChampion ? "Champion Set" : "Set as Champion";
  elements.championButton.setAttribute("aria-pressed", isChampion ? "true" : "false");

  const fragment = document.createDocumentFragment();
  const paragraphOne = document.createElement("p");
  const paragraphTwo = document.createElement("p");

  if (isChampion) {
    paragraphOne.textContent = `${payload.fighter.name} is your current local champion.`;
    paragraphTwo.textContent = "Stored in this browser only. You can use this fighter as your featured local headliner.";
  } else if (isPlainObject(champion) && toSafeString(champion.name)) {
    paragraphOne.textContent = `${toSafeString(champion.name)} is your current local champion.`;
    paragraphTwo.textContent = `Set ${payload.fighter.name} as champion to replace them in this browser.`;
  } else {
    paragraphOne.textContent = "Stored locally in this browser.";
    paragraphTwo.textContent = "Set this fighter as your champion to track simple rivalry and recap notes.";
  }

  fragment.append(paragraphOne, paragraphTwo);
  elements.championBody.replaceChildren(fragment);
}

function renderRosterState(elements, payload) {
  const roster = readRoster();
  const alreadyStored = roster.some((entry) => entry.id === payload.fighter.id);

  elements.rosterButton.textContent = alreadyStored ? "Refresh Local Roster Entry" : "Add to Local Roster";

  if (alreadyStored) {
    elements.rosterNote.textContent = `${payload.fighter.name} is already stored in your local roster. Clicking again refreshes the saved browser snapshot.`;
  } else {
    elements.rosterNote.textContent = "Add this fighter to your local roster to keep a browser-only snapshot for later Arena or Forge use.";
  }
}

function applyAvatarColor(avatarElement, rawColor) {
  const safeColor = toSafeColor(rawColor);
  if (!safeColor) {
    return;
  }
  avatarElement.style.backgroundColor = safeColor;
}

async function copyText(value) {
  if (!value) {
    return false;
  }

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      // fall through
    }
  }

  return legacyCopyText(value);
}

function legacyCopyText(value) {
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "readonly");
  textArea.setAttribute("aria-hidden", "true");
  textArea.tabIndex = -1;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }

  textArea.remove();
  return copied;
}

function announce(statusElement, message) {
  statusElement.textContent = "";
  window.setTimeout(() => {
    statusElement.textContent = message;
  }, 20);
}

function readRoster() {
  const raw = readJsonStorage(ROSTER_STORAGE_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(isPlainObject)
    .map((entry) => ({
      id: toSafeString(entry.id),
      slug: toSafeSlug(entry.slug),
      name: toSafeString(entry.name),
      title: toSafeString(entry.title),
      creatorName: toSafeString(entry.creatorName),
      archetype: toSafeString(entry.archetype),
      summary: toSafeString(entry.summary),
      avatarColor: toSafeColor(entry.avatarColor),
      visibility: toSafeString(entry.visibility),
      source: toSafeString(entry.source),
      shareUrl: toSafeUrl(entry.shareUrl),
      challengeUrl: toSafeUrl(entry.challengeUrl),
      duplicateUrl: toSafeUrl(entry.duplicateUrl),
      forgeUrl: toSafeUrl(entry.forgeUrl),
      stats: {
        strength: toSafeInteger(entry.stats?.strength),
        speed: toSafeInteger(entry.stats?.speed),
        durability: toSafeInteger(entry.stats?.durability),
        intelligence: toSafeInteger(entry.stats?.intelligence),
        maxHealth: toSafeInteger(entry.stats?.maxHealth),
      },
      savedAt: toSafeString(entry.savedAt),
    }))
    .filter((entry) => entry.id && entry.slug && entry.name);
}

function readJsonStorage(key) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value);
  } catch (error) {
    console.warn(`Failed to read storage key: ${key}`, error);
    return null;
  }
}

function writeJsonStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to write storage key: ${key}`, error);
    return false;
  }
}

function toSafeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toSafeSlug(value) {
  const slug = toSafeString(value);
  if (!slug) {
    return "";
  }
  return /^[a-z0-9][a-z0-9-]*$/i.test(slug) ? slug : "";
}

function toSafeInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toSafeUrl(value) {
  const raw = toSafeString(value);
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return "";
    }
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function toSafeColor(value) {
  const raw = toSafeString(value);
  if (!raw) {
    return "";
  }

  const hexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const rgbColor = /^rgba?\(\s*(\d{1,3}\s*,\s*){2,3}(0|1|0?\.\d+)?\s*\)$/;
  const hslColor = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+))?\s*\)$/;

  if (hexColor.test(raw) || rgbColor.test(raw) || hslColor.test(raw)) {
    return raw;
  }

  return "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
