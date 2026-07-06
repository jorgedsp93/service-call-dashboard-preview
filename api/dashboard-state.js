import { list, put } from "@vercel/blob";

const STATE_PATH = "dashboard-state/latest.json";
const TRADE_NAMES = new Set([
  "HVAC",
  "Plumbing",
  "Electrical",
  "Handyman",
  "Subtrade",
  "Door & Dock",
  "Multi-trade",
]);

function send(response, status, body) {
  response.status(status).setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function cleanNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(Math.round(number), 0) : 0;
}

function normalizeState(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Missing dashboard state.");
  }

  if (!Array.isArray(input.trades)) {
    throw new Error("Dashboard state must include trades.");
  }

  const trades = input.trades
    .filter((trade) => TRADE_NAMES.has(trade?.name))
    .map((trade) => ({
      name: trade.name,
      weeks: Array.from({ length: 4 }, (_, index) => cleanNumber(trade.weeks?.[index])),
    }));

  if (!trades.length) {
    throw new Error("Dashboard state has no valid trades.");
  }

  return {
    goal: cleanNumber(input.goal),
    savedAt: new Date().toISOString(),
    savedBy: typeof input.savedBy === "string" ? input.savedBy.slice(0, 80) : "",
    trades,
  };
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

async function getSharedState() {
  const result = await list({ prefix: STATE_PATH, limit: 1 });
  const blob = result.blobs.find((item) => item.pathname === STATE_PATH);

  if (!blob) {
    return null;
  }

  const response = await fetch(blob.url, {
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error("Unable to fetch private dashboard state.");
  }

  const text = await response.text();

  return {
    etag: blob.etag,
    state: JSON.parse(text),
    uploadedAt: blob.uploadedAt,
  };
}

async function saveSharedState(state) {
  const blob = await put(STATE_PATH, JSON.stringify(state), {
    access: "private",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });

  return blob;
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    try {
      const stored = await getSharedState();

      send(response, 200, {
        state: stored?.state || null,
        updatedAt: stored?.uploadedAt || null,
      });
    } catch (error) {
      send(response, 500, { error: "Unable to load dashboard state." });
    }

    return;
  }

  if (request.method === "POST") {
    try {
      const body = await readBody(request);
      const state = normalizeState(body?.state || body);
      const blob = await saveSharedState(state);

      send(response, 200, {
        state,
        updatedAt: blob.uploadedAt || state.savedAt,
      });
    } catch (error) {
      send(response, 400, { error: error.message || "Unable to save dashboard state." });
    }

    return;
  }

  response.setHeader("Allow", "GET, POST");
  send(response, 405, { error: "Method not allowed." });
}
