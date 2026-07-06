import { del, list, put } from "@vercel/blob";

const FIELD_PREFIX = "dashboard-state/live-fields";

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

function send(response, status, body) {
  response.status(status).setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function cleanNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(Math.round(number), 0) : 0;
}

function createDefaultState() {
  return {
    goal: 396,
    revision: 0,
    savedAt: "",
    savedBy: "",
    trades: DEFAULT_TRADES.map((trade) => ({
      name: trade.name,
      weeks: [...trade.weeks],
    })),
  };
}

function normalizeState(input) {
  const base = createDefaultState();

  if (!input || typeof input !== "object") {
    return base;
  }

  const inputTrades = Array.isArray(input.trades) ? input.trades : [];

  return {
    goal: Number.isFinite(Number(input.goal)) ? cleanNumber(input.goal) : base.goal,
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

function getFieldBase(patch) {
  if (patch.type === "goal") {
    return `${FIELD_PREFIX}/goal`;
  }

  if (patch.type === "cell") {
    const tradeId = getTradeId(patch.tradeName);
    const weekIndex = Number(patch.weekIndex);

    if (!tradeId || !Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex > 3) {
      throw new Error("Invalid dashboard cell patch.");
    }

    return `${FIELD_PREFIX}/${tradeId}/week-${weekIndex}`;
  }

  throw new Error("Unsupported dashboard patch.");
}

function getFieldPath(patch, revision) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${getFieldBase(patch)}/${revision}-${suffix}.json`;
}

function parseFieldPath(pathname) {
  const relativePath = pathname.replace(`${FIELD_PREFIX}/`, "");
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

function patchesFromState(state) {
  const normalized = normalizeState(state);
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

async function readDashboardState() {
  const state = createDefaultState();
  const latestFields = new Map();
  let cursor;

  do {
    const result = await list({
      cursor,
      limit: 1000,
      prefix: `${FIELD_PREFIX}/`,
    });

    result.blobs.forEach((blob) => {
      const parsedField = parseFieldPath(blob.pathname);

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
      const response = await fetch(blob.url, {
        headers: {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        },
      });

      if (!response.ok) return;

      rememberField(state, await response.json());
    }),
  );

  return state;
}

async function saveField(patch, savedBy) {
  const revision = Date.now();
  const record = {
    ...patch,
    revision,
    savedAt: new Date().toISOString(),
    savedBy,
  };

  await put(getFieldPath(patch, revision), JSON.stringify(record), {
    access: "private",
    allowOverwrite: false,
    cacheControlMaxAge: 0,
    contentType: "application/json",
  });

  await cleanupOldFieldRecords(patch, revision);

  return record;
}

async function cleanupOldFieldRecords(patch, revision) {
  try {
    const result = await list({
      limit: 1000,
      prefix: `${getFieldBase(patch)}/`,
    });

    const oldPaths = result.blobs
      .map((blob) => {
        const parsedField = parseFieldPath(blob.pathname);
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

async function saveDashboardUpdate(body) {
  const savedBy = typeof body?.savedBy === "string" ? body.savedBy.slice(0, 80) : "";
  const patches = Array.isArray(body?.patches)
    ? body.patches.map(normalizePatch)
    : body?.patch
      ? [normalizePatch(body.patch)]
      : patchesFromState(body?.state || body).map(normalizePatch);

  if (!patches.length) {
    throw new Error("Dashboard update has no patches.");
  }

  const state = await readDashboardState();
  const records = await Promise.all(patches.map((patch) => saveField(patch, savedBy)));

  records.forEach((record) => {
    applyPatch(state, record);
    rememberField(state, record);
  });

  return state;
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    try {
      const state = await readDashboardState();

      send(response, 200, {
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
      const state = await saveDashboardUpdate(body);

      send(response, 200, {
        state,
        updatedAt: state.savedAt || null,
      });
    } catch (error) {
      send(response, 400, { error: error.message || "Unable to save dashboard state." });
    }

    return;
  }

  response.setHeader("Allow", "GET, POST");
  send(response, 405, { error: "Method not allowed." });
}
