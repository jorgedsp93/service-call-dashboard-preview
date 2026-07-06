import { del, list, put } from "@vercel/blob";

const LEGACY_PERIOD_KEY = "2026-07";
const LEGACY_FIELD_PREFIX = "dashboard-state/live-fields";
const LEGACY_LOCK_PREFIX = "dashboard-state/live-locks";
const MONTHLY_PREFIX = "dashboard-state/monthly";
const FIELD_LOCK_MS = 10000;

const DEFAULT_TRADES = [
  { id: "hvac", name: "HVAC", weeks: [17, 0, 0, 0] },
  { id: "plumbing", name: "Plumbing", weeks: [32, 0, 0, 0] },
  { id: "electrical", name: "Electrical", weeks: [2, 0, 0, 0] },
  { id: "handyman", name: "Handyman", weeks: [4, 0, 0, 0] },
  { id: "subtrade", name: "Subtrade", weeks: [1, 0, 0, 0] },
  { id: "door-dock", name: "Door & Dock", weeks: [1, 0, 0, 0] },
  { id: "multi-trade", name: "Multi-trade", weeks: [0, 0, 0, 0] },
];

const TRADE_NAMES = new Set(DEFAULT_TRADES.map((trade) => trade.name));

class FieldLockError extends Error {
  constructor(patch, lock, state) {
    super("This field was just changed in another session.");
    this.name = "FieldLockError";
    this.statusCode = 409;
    this.patch = patch;
    this.lock = lock;
    this.state = state;
  }
}

function send(response, status, body) {
  response.status(status).setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function cleanNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(Math.round(number), 0) : 0;
}

function normalizeClientId(value) {
  return typeof value === "string" ? value.slice(0, 120) : "";
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getCurrentPeriodKey() {
  return new Date().toISOString().slice(0, 7);
}

function normalizePeriodKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "") ? value : getCurrentPeriodKey();
}

function getFieldPrefix(periodKey) {
  return periodKey === LEGACY_PERIOD_KEY ? LEGACY_FIELD_PREFIX : `${MONTHLY_PREFIX}/${periodKey}/live-fields`;
}

function getLockPrefix(periodKey) {
  return periodKey === LEGACY_PERIOD_KEY ? LEGACY_LOCK_PREFIX : `${MONTHLY_PREFIX}/${periodKey}/live-locks`;
}

function getDefaultWeeks(defaultWeeks, periodKey) {
  return periodKey === LEGACY_PERIOD_KEY ? defaultWeeks : [0, 0, 0, 0];
}

function createDefaultState(periodKey = getCurrentPeriodKey()) {
  return {
    goal: 396,
    periodKey,
    revision: 0,
    savedAt: "",
    savedBy: "",
    trades: DEFAULT_TRADES.map((trade) => ({
      name: trade.name,
      weeks: getDefaultWeeks(trade.weeks, periodKey),
    })),
  };
}

function normalizeState(input, periodKey = getCurrentPeriodKey()) {
  const base = createDefaultState(periodKey);

  if (!input || typeof input !== "object") {
    return base;
  }

  const inputTrades = Array.isArray(input.trades) ? input.trades : [];

  return {
    goal: Number.isFinite(Number(input.goal)) ? cleanNumber(input.goal) : base.goal,
    periodKey,
    revision: cleanNumber(input.revision),
    savedAt: input.savedAt || "",
    savedBy: typeof input.savedBy === "string" ? input.savedBy.slice(0, 80) : "",
    trades: DEFAULT_TRADES.map((defaultTrade) => {
      const trade = inputTrades.find((item) => item?.name === defaultTrade.name);

      return {
        name: defaultTrade.name,
        weeks: Array.from(
          { length: 4 },
          (_, index) => cleanNumber(trade?.weeks?.[index] ?? defaultTrade.weeks[index]),
        ),
      };
    }),
  };
}

function getTradeId(tradeName) {
  return DEFAULT_TRADES.find((trade) => trade.name === tradeName)?.id || "";
}

function getFieldBase(patch, periodKey) {
  if (patch.type === "goal") {
    return `${getFieldPrefix(periodKey)}/goal`;
  }

  if (patch.type === "cell") {
    const tradeId = getTradeId(patch.tradeName);
    const weekIndex = Number(patch.weekIndex);

    if (!tradeId || !Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex > 3) {
      throw new Error("Invalid dashboard cell patch.");
    }

    return `${getFieldPrefix(periodKey)}/${tradeId}/week-${weekIndex}`;
  }

  throw new Error("Unsupported dashboard patch.");
}

function getFieldPath(patch, revision, periodKey) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${getFieldBase(patch, periodKey)}/${revision}-${suffix}.json`;
}

function getFieldLockPath(patch, periodKey) {
  return `${getFieldBase(patch, periodKey).replace(getFieldPrefix(periodKey), getLockPrefix(periodKey))}.json`;
}

function parseFieldPath(pathname, periodKey) {
  const fieldPrefix = getFieldPrefix(periodKey);

  if (!pathname.startsWith(`${fieldPrefix}/`)) return null;

  const relativePath = pathname.replace(`${fieldPrefix}/`, "");
  const goalMatch = relativePath.match(/^goal\/(\d+)-[a-z0-9]+\.json$/);

  if (goalMatch) {
    return {
      revision: Number(goalMatch[1]),
      type: "goal",
    };
  }

  const cellMatch = relativePath.match(/^([^/]+)\/week-([0-3])\/(\d+)-[a-z0-9]+\.json$/);

  if (!cellMatch) return null;

  const trade = DEFAULT_TRADES.find((item) => item.id === cellMatch[1]);

  if (!trade) return null;

  return {
    revision: Number(cellMatch[3]),
    tradeName: trade.name,
    type: "cell",
    weekIndex: Number(cellMatch[2]),
  };
}

function getParsedFieldKey(parsedField) {
  if (parsedField.type === "goal") return "goal";
  return `${parsedField.tradeName}:${parsedField.weekIndex}`;
}

function normalizePatch(patch) {
  if (!patch || typeof patch !== "object") {
    throw new Error("Missing dashboard patch.");
  }

  if (patch.type === "goal") {
    return {
      type: "goal",
      value: cleanNumber(patch.value),
    };
  }

  if (patch.type === "cell") {
    const weekIndex = Number(patch.weekIndex);

    if (!TRADE_NAMES.has(patch.tradeName) || !Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex > 3) {
      throw new Error("Invalid dashboard cell patch.");
    }

    return {
      tradeName: patch.tradeName,
      type: "cell",
      value: cleanNumber(patch.value),
      weekIndex,
    };
  }

  throw new Error("Unsupported dashboard patch.");
}

function applyPatch(state, patch) {
  if (patch.type === "goal") {
    state.goal = patch.value;
    return;
  }

  const trade = state.trades.find((item) => item.name === patch.tradeName);

  if (!trade) {
    throw new Error("Invalid dashboard cell patch.");
  }

  trade.weeks[patch.weekIndex] = patch.value;
}

function patchesFromState(state, periodKey) {
  const normalized = normalizeState(state, periodKey);
  const patches = [{ type: "goal", value: normalized.goal }];

  normalized.trades.forEach((trade) => {
    trade.weeks.forEach((value, weekIndex) => {
      patches.push({
        tradeName: trade.name,
        type: "cell",
        value,
        weekIndex,
      });
    });
  });

  return patches;
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : null;
}

function getRequestPeriodKey(request) {
  try {
    const url = new URL(request.url, "https://dashboard.local");
    return normalizePeriodKey(url.searchParams.get("period"));
  } catch (error) {
    return getCurrentPeriodKey();
  }
}

async function readPrivateJsonBlob(blob) {
  const response = await fetch(blob.url, {
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
    },
  });

  return response.ok ? response.json() : null;
}

function rememberField(state, record) {
  if (!record) return;

  if (record.type === "goal") {
    state.goal = cleanNumber(record.value);
  }

  if (record.type === "cell") {
    const trade = state.trades.find((item) => item.name === record.tradeName);
    const weekIndex = Number(record.weekIndex);

    if (trade && Number.isInteger(weekIndex) && weekIndex >= 0 && weekIndex <= 3) {
      trade.weeks[weekIndex] = cleanNumber(record.value);
    }
  }

  state.revision += cleanNumber(record.revision);

  if (Date.parse(record.savedAt || "") > (Date.parse(state.savedAt || "") || 0)) {
    state.savedAt = record.savedAt;
    state.savedBy = typeof record.savedBy === "string" ? record.savedBy : "";
  }
}

async function readDashboardState(periodKey) {
  const state = createDefaultState(periodKey);
  const latestFields = new Map();
  let cursor;

  do {
    const result = await list({
      cursor,
      limit: 1000,
      prefix: `${getFieldPrefix(periodKey)}/`,
    });

    result.blobs.forEach((blob) => {
      const parsedField = parseFieldPath(blob.pathname, periodKey);

      if (!parsedField) return;

      const key = getParsedFieldKey(parsedField);
      const current = latestFields.get(key);

      if (!current || parsedField.revision > current.parsedField.revision) {
        latestFields.set(key, { blob, parsedField });
      }
    });

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  await Promise.all(
    [...latestFields.values()].map(async ({ blob }) => {
      rememberField(state, await readPrivateJsonBlob(blob));
    }),
  );

  return state;
}

async function readLatestFieldRecord(patch, periodKey) {
  let latestBlob = null;
  let latestParsedField = null;
  let cursor;

  do {
    const result = await list({
      cursor,
      limit: 1000,
      prefix: `${getFieldBase(patch, periodKey)}/`,
    });

    result.blobs.forEach((blob) => {
      const parsedField = parseFieldPath(blob.pathname, periodKey);

      if (!parsedField) return;

      if (!latestParsedField || parsedField.revision > latestParsedField.revision) {
        latestBlob = blob;
        latestParsedField = parsedField;
      }
    });

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  return latestBlob ? readPrivateJsonBlob(latestBlob) : null;
}

async function readFieldLock(lockPath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await list({
      limit: 10,
      prefix: lockPath,
    });
    const lockBlob = result.blobs.find((blob) => blob.pathname === lockPath);

    if (lockBlob) {
      return readPrivateJsonBlob(lockBlob);
    }

    if (attempt < 2) {
      await wait(120);
    }
  }

  return null;
}

function isRecentExternalChange(record, clientId) {
  const savedAt = Date.parse(record?.savedAt || "");

  if (!clientId || !record?.clientId || record.clientId === clientId || !Number.isFinite(savedAt)) {
    return false;
  }

  return Date.now() - savedAt < FIELD_LOCK_MS;
}

function createFieldLock(patch, clientId) {
  const savedAt = new Date();

  return {
    ...patch,
    clientId,
    expiresAt: new Date(savedAt.getTime() + FIELD_LOCK_MS).toISOString(),
    savedAt: savedAt.toISOString(),
  };
}

function isBlobAlreadyExistsError(error) {
  return /already exists|allowOverwrite/i.test(error?.message || "");
}

async function assertFieldCanBeEdited(patch, clientId, periodKey) {
  const latestRecord = await readLatestFieldRecord(patch, periodKey);

  if (isRecentExternalChange(latestRecord, clientId)) {
    throw new FieldLockError(patch, latestRecord, await readDashboardState(periodKey));
  }
}

async function acquireFieldLock(patch, clientId, periodKey) {
  if (!clientId) return;

  const lockPath = getFieldLockPath(patch, periodKey);
  const lockRecord = createFieldLock(patch, clientId);

  try {
    await put(lockPath, JSON.stringify(lockRecord), {
      access: "private",
      allowOverwrite: false,
      cacheControlMaxAge: 0,
      contentType: "application/json",
    });
    return;
  } catch (error) {
    const existingLock = await readFieldLock(lockPath);

    if (!existingLock) {
      if (isBlobAlreadyExistsError(error)) {
        await wait(250);
        throw new FieldLockError(patch, lockRecord, await readDashboardState(periodKey));
      }

      throw error;
    }

    if (isRecentExternalChange(existingLock, clientId)) {
      throw new FieldLockError(patch, existingLock, await readDashboardState(periodKey));
    }

    await put(lockPath, JSON.stringify(lockRecord), {
      access: "private",
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      contentType: "application/json",
    });
  }
}

async function clearFieldLocks(periodKey) {
  try {
    const lockPaths = [];
    let cursor;

    do {
      const result = await list({
        cursor,
        limit: 1000,
        prefix: `${getLockPrefix(periodKey)}/`,
      });

      lockPaths.push(...result.blobs.map((blob) => blob.pathname));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    if (lockPaths.length) {
      await del(lockPaths);
    }
  } catch (error) {
    // Stale locks expire quickly, so cleanup failure should not block a forced save.
  }
}

async function saveField(patch, savedBy, clientId, periodKey) {
  const revision = Date.now();
  const record = {
    ...patch,
    clientId,
    revision,
    savedAt: new Date().toISOString(),
    savedBy,
  };

  await put(getFieldPath(patch, revision, periodKey), JSON.stringify(record), {
    access: "private",
    allowOverwrite: false,
    cacheControlMaxAge: 0,
    contentType: "application/json",
  });

  await cleanupOldFieldRecords(patch, revision, periodKey);

  return record;
}

async function cleanupOldFieldRecords(patch, revision, periodKey) {
  try {
    const result = await list({
      limit: 1000,
      prefix: `${getFieldBase(patch, periodKey)}/`,
    });

    const oldPaths = result.blobs
      .map((blob) => {
        const parsedField = parseFieldPath(blob.pathname, periodKey);
        return parsedField && parsedField.revision < revision ? blob.pathname : null;
      })
      .filter(Boolean);

    if (oldPaths.length) {
      await del(oldPaths);
    }
  } catch (error) {
    // Cleanup is best effort; failed cleanup should not block user saves.
  }
}

async function saveDashboardUpdate(body, requestPeriodKey) {
  const periodKey = normalizePeriodKey(body?.periodKey || body?.period || body?.state?.periodKey || requestPeriodKey);
  const savedBy = typeof body?.savedBy === "string" ? body.savedBy.slice(0, 80) : "";
  const clientId = normalizeClientId(body?.clientId);
  const force = body?.force === true;
  const patches = Array.isArray(body?.patches)
    ? body.patches.map(normalizePatch)
    : body?.patch
      ? [normalizePatch(body.patch)]
      : patchesFromState(body?.state || body, periodKey).map(normalizePatch);

  if (!patches.length) {
    throw new Error("Dashboard update has no patches.");
  }

  const state = await readDashboardState(periodKey);

  if (force) {
    await clearFieldLocks(periodKey);
  } else {
    for (const patch of patches) {
      await assertFieldCanBeEdited(patch, clientId, periodKey);
      await acquireFieldLock(patch, clientId, periodKey);
    }
  }

  const fieldClientId = force ? "" : clientId;
  const records = await Promise.all(patches.map((patch) => saveField(patch, savedBy, fieldClientId, periodKey)));

  records.forEach((record) => {
    applyPatch(state, record);
    rememberField(state, record);
  });

  return state;
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    try {
      const periodKey = getRequestPeriodKey(request);
      const state = await readDashboardState(periodKey);

      send(response, 200, {
        periodKey,
        state,
        updatedAt: state.savedAt || null,
      });
    } catch (error) {
      send(response, 500, { error: "Unable to load dashboard state." });
    }

    return;
  }

  if (request.method === "POST") {
    try {
      const body = await readBody(request);
      const periodKey = normalizePeriodKey(body?.periodKey || body?.period || body?.state?.periodKey || getRequestPeriodKey(request));
      const state = await saveDashboardUpdate(body, periodKey);

      send(response, 200, {
        periodKey,
        state,
        updatedAt: state.savedAt || null,
      });
    } catch (error) {
      send(response, error.statusCode || 400, {
        error: error.message || "Unable to save dashboard state.",
        lockExpiresAt: error.lock?.expiresAt || null,
        state: error.state || null,
      });
    }

    return;
  }

  response.setHeader("Allow", "GET, POST");
  send(response, 405, { error: "Method not allowed." });
}
