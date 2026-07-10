import { Firestore } from "@google-cloud/firestore";

const LEGACY_PERIOD_KEY = "2026-07";
const FIELD_LOCK_MS = 10000;
const DEFAULT_PROJECT_ID = "polarpath-fsm";
const DEFAULT_DATABASE_ID = "service-call-dashboard";
const PERIOD_COLLECTION = "dashboard_periods";
const DEFAULT_WEEK_COUNT = 4;
const WEEK_COUNTS_BY_PERIOD = {
  "2026-07": 5,
};

const DEFAULT_TRADES = [
  { id: "hvac", name: "HVAC", weeks: [17, 0, 0, 0, 0] },
  { id: "plumbing", name: "Plumbing", weeks: [32, 0, 0, 0, 0] },
  { id: "electrical", name: "Electrical", weeks: [2, 0, 0, 0, 0] },
  { id: "handyman", name: "Handyman", weeks: [4, 0, 0, 0, 0] },
  { id: "subtrade", name: "Subtrade", weeks: [1, 0, 0, 0, 0] },
  { id: "door-dock", name: "Door & Dock", weeks: [1, 0, 0, 0, 0] },
  { id: "multi-trade", name: "Multi-trade", weeks: [0, 0, 0, 0, 0] },
];

const TRADE_NAMES = new Set(DEFAULT_TRADES.map((trade) => trade.name));

let firestoreClient = null;

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

function getCurrentPeriodKey() {
  return new Date().toISOString().slice(0, 7);
}

function normalizePeriodKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "") ? value : getCurrentPeriodKey();
}

function getWeekCount(periodKey) {
  return WEEK_COUNTS_BY_PERIOD[periodKey] || DEFAULT_WEEK_COUNT;
}

function normalizeWeeks(weeks, periodKey) {
  return Array.from(
    { length: getWeekCount(periodKey) },
    (_, index) => cleanNumber(weeks?.[index]),
  );
}

function getDefaultWeeks(defaultWeeks, periodKey) {
  return periodKey === LEGACY_PERIOD_KEY
    ? normalizeWeeks(defaultWeeks, periodKey)
    : normalizeWeeks([], periodKey);
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
    savedAt: typeof input.savedAt === "string" ? input.savedAt : "",
    savedBy: typeof input.savedBy === "string" ? input.savedBy.slice(0, 80) : "",
    trades: DEFAULT_TRADES.map((defaultTrade) => {
      const trade = inputTrades.find((item) => item?.name === defaultTrade.name);

      return {
        name: defaultTrade.name,
        weeks: normalizeWeeks(trade?.weeks || defaultTrade.weeks, periodKey),
      };
    }),
  };
}

function getTradeId(tradeName) {
  return DEFAULT_TRADES.find((trade) => trade.name === tradeName)?.id || "";
}

function assertValidWeekIndex(weekIndex, periodKey) {
  if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex >= getWeekCount(periodKey)) {
    throw new Error("Invalid dashboard cell patch.");
  }
}

function getFieldKey(patch, periodKey) {
  if (patch.type === "goal") {
    return "goal";
  }

  if (patch.type === "cell") {
    const tradeId = getTradeId(patch.tradeName);
    const weekIndex = Number(patch.weekIndex);

    if (!tradeId) {
      throw new Error("Invalid dashboard cell patch.");
    }

    assertValidWeekIndex(weekIndex, periodKey);
    return `${tradeId}_week_${weekIndex}`;
  }

  throw new Error("Unsupported dashboard patch.");
}

function normalizePatch(patch, periodKey) {
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

    if (!TRADE_NAMES.has(patch.tradeName)) {
      throw new Error("Invalid dashboard cell patch.");
    }

    assertValidWeekIndex(weekIndex, periodKey);
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

function parseServiceAccountJson() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    return null;
  }

  const credentials = JSON.parse(raw);

  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  return credentials;
}

function getProjectId(credentials) {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.GCP_PROJECT ||
    credentials?.project_id ||
    DEFAULT_PROJECT_ID
  );
}

function getFirestore() {
  if (firestoreClient) {
    return firestoreClient;
  }

  const credentials = parseServiceAccountJson();
  const projectId = getProjectId(credentials);
  const databaseId = process.env.GOOGLE_FIRESTORE_DATABASE_ID || process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID;

  firestoreClient = new Firestore({
    projectId,
    databaseId,
    ...(credentials ? { credentials } : {}),
  });

  return firestoreClient;
}

function getPeriodRef(periodKey) {
  return getFirestore().collection(PERIOD_COLLECTION).doc(periodKey);
}

function normalizeFields(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function stateFromDocument(snapshot, periodKey) {
  if (!snapshot.exists) {
    return createDefaultState(periodKey);
  }

  return normalizeState(snapshot.data(), periodKey);
}

function isRecentExternalChange(record, clientId) {
  const savedAt = Date.parse(record?.savedAt || "");

  if (!clientId || !record?.clientId || record.clientId === clientId || !Number.isFinite(savedAt)) {
    return false;
  }

  return Date.now() - savedAt < FIELD_LOCK_MS;
}

function createFieldRecord(patch, clientId, revision, savedAt, savedBy) {
  return {
    ...patch,
    clientId,
    revision,
    savedAt,
    savedBy,
  };
}

async function readDashboardState(periodKey) {
  const snapshot = await getPeriodRef(periodKey).get();
  return stateFromDocument(snapshot, periodKey);
}

async function saveDashboardUpdate(body, requestPeriodKey) {
  const periodKey = normalizePeriodKey(body?.periodKey || body?.period || body?.state?.periodKey || requestPeriodKey);
  const savedBy = typeof body?.savedBy === "string" ? body.savedBy.slice(0, 80) : "";
  const clientId = normalizeClientId(body?.clientId);
  const force = body?.force === true;
  const patches = Array.isArray(body?.patches)
    ? body.patches.map((patch) => normalizePatch(patch, periodKey))
    : body?.patch
      ? [normalizePatch(body.patch, periodKey)]
      : patchesFromState(body?.state || body, periodKey).map((patch) => normalizePatch(patch, periodKey));

  if (!patches.length) {
    throw new Error("Dashboard update has no patches.");
  }

  const ref = getPeriodRef(periodKey);

  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const state = stateFromDocument(snapshot, periodKey);
    const fields = normalizeFields(snapshot.exists ? snapshot.data()?.fields : null);

    if (!force) {
      for (const patch of patches) {
        const fieldRecord = fields[getFieldKey(patch, periodKey)];

        if (isRecentExternalChange(fieldRecord, clientId)) {
          throw new FieldLockError(patch, fieldRecord, state);
        }
      }
    }

    const revision = Date.now();
    const savedAt = new Date(revision).toISOString();
    const fieldClientId = force ? "" : clientId;
    const nextFields = { ...fields };

    for (const patch of patches) {
      applyPatch(state, patch);
      nextFields[getFieldKey(patch, periodKey)] = createFieldRecord(
        patch,
        fieldClientId,
        revision,
        savedAt,
        savedBy,
      );
    }

    state.revision = Math.max(cleanNumber(state.revision), revision);
    state.savedAt = savedAt;
    state.savedBy = savedBy;

    transaction.set(ref, {
      ...state,
      fields: nextFields,
      updatedAt: savedAt,
    });

    return state;
  });
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
      console.error("Unable to load dashboard state.", error);
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
      console.error("Unable to save dashboard state.", error);
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
