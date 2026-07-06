const LEGACY_PERIOD_KEY = "2026-07";
const currentPeriod = getDashboardPeriod(new Date());

const trades = [
  { name: "HVAC", icon: "hvac", color: "#167a74", weeks: getInitialWeeks([17, 0, 0, 0]) },
  { name: "Plumbing", icon: "plumbing", color: "#7c5fb5", weeks: getInitialWeeks([32, 0, 0, 0]) },
  { name: "Electrical", icon: "electrical", color: "#df6b57", weeks: getInitialWeeks([2, 0, 0, 0]) },
  { name: "Handyman", icon: "handyman", color: "#3978c6", weeks: getInitialWeeks([4, 0, 0, 0]) },
  { name: "Subtrade", icon: "subtrade", color: "#d99a2b", weeks: getInitialWeeks([1, 0, 0, 0]) },
  { name: "Door & Dock", icon: "dock", color: "#2e9d63", weeks: getInitialWeeks([1, 0, 0, 0]) },
  { name: "Multi-trade", icon: "multi", color: "#667085", weeks: getInitialWeeks([0, 0, 0, 0]) },
];

const historicalServiceCalls = [
  {
    fiscalYear: "FY 2025/26",
    fiscalTotal: 2339,
    july: {
      total: 213,
      trades: {
        HVAC: 62,
        Plumbing: 85,
        Electrical: 36,
        Handyman: 23,
        Subtrade: 6,
        "Multi-trade": 1,
      },
    },
  },
  {
    fiscalYear: "FY 2024/25",
    fiscalTotal: 2144,
    july: {
      total: 236,
      trades: {
        HVAC: 74,
        Plumbing: 94,
        Electrical: 34,
        Handyman: 34,
        "Multi-trade": 0,
      },
    },
  },
  {
    fiscalYear: "FY 2023/24",
    fiscalTotal: 2445,
    july: {
      total: 207,
      trades: {
        HVAC: 78,
        Plumbing: 89,
        Electrical: 20,
        Handyman: 20,
        "Multi-trade": 0,
      },
    },
  },
  {
    fiscalYear: "FY 2022/23",
    fiscalTotal: 2429,
    july: {
      total: 190,
      trades: {
        HVAC: 67,
        Plumbing: 76,
        Electrical: 27,
        Handyman: 20,
      },
    },
  },
  {
    fiscalYear: "FY 2021/22",
    fiscalTotal: 2166,
    july: {
      total: 190,
      trades: {
        HVAC: 96,
        Plumbing: 53,
        Electrical: 25,
        Handyman: 16,
      },
    },
  },
];

const tradeYoyTotals = [
  { name: "Plumbing", color: "#7c5fb5", current: 143, previous: 136 },
  { name: "HVAC", color: "#167a74", current: 91, previous: 112 },
  { name: "Electrical", color: "#df6b57", current: 56, previous: 49 },
  { name: "Handyman", color: "#3978c6", current: 40, previous: 63 },
  { name: "Subtrade", color: "#d99a2b", current: 15, previous: 0 },
  { name: "Multi-trade", color: "#667085", current: 5, previous: 0 },
];

const LEGACY_STORAGE_KEY = "meadowbrookServiceCallDashboard:v1";
const STORAGE_KEY = `${LEGACY_STORAGE_KEY}:${currentPeriod.key}`;
const CLIENT_ID_KEY = "meadowbrookServiceCallDashboardClient:v1";
const SAVE_DELAY_MS = 450;
const LIVE_POLL_INTERVAL_MS = 300000;
const SHARED_STATE_ENDPOINT = "/api/dashboard-state";

const tradeRows = document.getElementById("tradeRows");
const goalInput = document.getElementById("goalInput");
const mixBars = document.getElementById("mixBars");
const comparisonChart = document.getElementById("comparisonChart");
const dashboardTitle = document.getElementById("dashboardTitle");
const lastUpdatedValue = document.getElementById("lastUpdatedValue");
const mixSubtitle = document.getElementById("mixSubtitle");
const saveStatus = document.getElementById("saveStatus");

let saveTimer = null;
let latestSharedRevision = 0;
let latestSharedSavedAt = 0;
let livePollTimer = null;
const pendingPatchMap = new Map();
const dashboardClientId = getDashboardClientId();

const icons = {
  hvac: `<svg viewBox="0 0 24 24" role="img"><path d="M12 2v20M4.2 6l15.6 12M4.2 18 19.8 6M7.2 3.8 12 7l4.8-3.2M7.2 20.2 12 17l4.8 3.2M2.7 9.3 7.8 9l2.5-4.5M21.3 14.7l-5.1.3-2.5 4.5M2.7 14.7l5.1.3 2.5 4.5M21.3 9.3l-5.1-.3-2.5-4.5"/></svg>`,
  plumbing: `<svg viewBox="0 0 24 24" role="img"><path d="M4 11h11a3 3 0 0 1 3 3v1M7 11V7h8V4h4M5 18v-7M3 18h4M15 4V2M21 4h-2M18 15c-2 2-3 3.5-3 5a3 3 0 0 0 6 0c0-1.5-1-3-3-5Z"/></svg>`,
  electrical: `<svg viewBox="0 0 24 24" role="img"><path d="M13 2 5 13h6l-1 9 9-13h-6l1-7Z"/></svg>`,
  handyman: `<svg viewBox="0 0 24 24" role="img"><path d="m14.5 6.5 3-3 3 3-3 3M13 8l3 3M5 20l6.5-6.5M8 17l-1.5-1.5M4 4l4 4M7 3l2 2-4 4-2-2 4-4ZM14 14l6 6M20 14l-6 6"/></svg>`,
  subtrade: `<svg viewBox="0 0 24 24" role="img"><path d="M3 18h18M5 18v-5a7 7 0 0 1 14 0v5M9 6v5M15 6v5M12 4v7"/></svg>`,
  dock: `<svg viewBox="0 0 24 24" role="img"><path d="M4 20V5h16v15M7 20V8h10v12M7 12h10M7 16h10M4 5h16"/></svg>`,
  multi: `<svg viewBox="0 0 24 24" role="img"><path d="m14.5 6.5 3-3 3 3-3 3M13 8l3 3M5 20l6.5-6.5M8 17l-1.5-1.5M4 4l4 4M7 3l2 2-4 4-2-2 4-4ZM14 14l6 6M20 14l-6 6"/></svg>`,
};

function getDashboardPeriod(date) {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const monthNumber = String(monthIndex + 1).padStart(2, "0");
  const monthName = date.toLocaleString("en-US", { month: "long" });

  return {
    dataKey: monthName.toLowerCase(),
    key: `${year}-${monthNumber}`,
    monthName,
    monthShort: date.toLocaleString("en-US", { month: "short" }),
    year,
  };
}

function getInitialWeeks(defaultWeeks) {
  return currentPeriod.key === LEGACY_PERIOD_KEY ? [...defaultWeeks] : [0, 0, 0, 0];
}

function getSharedStateUrl() {
  return `${SHARED_STATE_ENDPOINT}?period=${encodeURIComponent(currentPeriod.key)}`;
}

function updatePeriodLabels() {
  const title = `${currentPeriod.monthName} Service Call Dashboard`;
  document.title = title;
  dashboardTitle.textContent = title;
  document.querySelector(".dashboard-card").setAttribute("aria-label", `${currentPeriod.monthName} service call dashboard`);
  mixSubtitle.textContent = `Current share plus ${currentPeriod.monthName} YoY`;
  comparisonChart.setAttribute("aria-label", `${currentPeriod.monthName} service calls comparison chart`);
}

function setLastUpdated(value) {
  lastUpdatedValue.textContent = value ? formatSavedAt(value) : "Not saved yet";
}

function checkForPeriodChange() {
  if (getDashboardPeriod(new Date()).key !== currentPeriod.key) {
    window.location.reload();
  }
}

function cleanNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatDelta(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function formatNumber(value) {
  return value.toLocaleString("en-US");
}

function formatSavedAt(value) {
  const savedAt = new Date(value);

  if (Number.isNaN(savedAt.getTime())) return "";

  return savedAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function createFallbackId() {
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDashboardClientId() {
  try {
    const savedClientId = localStorage.getItem(CLIENT_ID_KEY);

    if (savedClientId) return savedClientId;

    const clientId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : createFallbackId();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    return clientId;
  } catch (error) {
    return createFallbackId();
  }
}

function setSaveStatus(message, state = "saved") {
  saveStatus.textContent = message;
  saveStatus.dataset.state = state;
}

function getStateTime(state) {
  const time = Date.parse(state?.savedAt || "");
  return Number.isFinite(time) ? time : 0;
}

function getStateRevision(state) {
  return Number.isFinite(Number(state?.revision)) ? Number(state.revision) : 0;
}

function isSharedStateNewer(state) {
  const revision = getStateRevision(state);
  const savedAt = getStateTime(state);

  if (savedAt > latestSharedSavedAt) return true;
  if (savedAt === latestSharedSavedAt && revision > latestSharedRevision) return true;
  if (savedAt === latestSharedSavedAt && revision !== latestSharedRevision) return true;
  if (!savedAt && revision > latestSharedRevision) return true;

  return false;
}

function rememberSharedState(state) {
  latestSharedRevision = getStateRevision(state);
  latestSharedSavedAt = Math.max(latestSharedSavedAt, getStateTime(state));
}

function getDashboardState() {
  return {
    goal: cleanNumber(goalInput.value),
    periodKey: currentPeriod.key,
    revision: latestSharedRevision,
    savedAt: new Date().toISOString(),
    trades: trades.map((trade) => ({
      name: trade.name,
      weeks: trade.weeks.map(cleanNumber),
    })),
  };
}

function writeLocalDashboardState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    return false;
  }
}

function readLocalDashboardState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const legacySaved = currentPeriod.key === LEGACY_PERIOD_KEY ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    return JSON.parse(saved || legacySaved || "null");
  } catch (error) {
    return null;
  }
}

function applyDashboardState(state) {
  if (!state || typeof state !== "object") return;

  if (Number.isFinite(Number(state.goal))) {
    goalInput.value = cleanNumber(state.goal);
  }

  if (Array.isArray(state.trades)) {
    trades.forEach((trade, tradeIndex) => {
      const savedTrade = state.trades.find((item) => item.name === trade.name);

      if (!Array.isArray(savedTrade?.weeks)) return;

      trade.weeks = trade.weeks.map((_, weekIndex) => cleanNumber(savedTrade.weeks[weekIndex]));
    });
  }

  document.querySelectorAll(".number-input").forEach((input) => {
    const tradeIndex = Number(input.dataset.trade);
    const weekIndex = Number(input.dataset.week);

    input.value = trades[tradeIndex].weeks[weekIndex] || "";
  });

  setLastUpdated(state.savedAt);
  updateTotals();
}

function loadSavedDashboardState() {
  const saved = readLocalDashboardState();

  if (!saved) {
    setSaveStatus("Loading shared save...", "saving");
    return null;
  }

  applyDashboardState(saved);
  setSaveStatus(saved.savedAt ? `Saved on this device ${formatSavedAt(saved.savedAt)}` : "Saved on this device");
  return saved;
}

async function loadSharedDashboardState(localState) {
  try {
    const response = await fetch(getSharedStateUrl(), { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Shared save unavailable.");
    }

    const payload = await response.json();
    const sharedState = payload.state;

    if (sharedState) {
      applyDashboardState(sharedState);
      writeLocalDashboardState(sharedState);
      rememberSharedState(sharedState);
      setSaveStatus(sharedState.savedAt ? `Shared save ${formatSavedAt(sharedState.savedAt)}` : "Live updates on");
      return;
    }

    setSaveStatus("Not saved yet", "idle");
  } catch (error) {
    if (localState?.savedAt) {
      setSaveStatus(`Saved here only ${formatSavedAt(localState.savedAt)}`, "warning");
    } else {
      setSaveStatus("Shared save offline", "warning");
    }
  }
}

function getPatchKey(patch) {
  if (patch.type === "goal") return "goal";
  return `${patch.tradeName}:${patch.weekIndex}`;
}

function queuePatch(patch) {
  pendingPatchMap.set(getPatchKey(patch), patch);
}

async function saveDashboardState({ forceFullSave = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;

  const state = getDashboardState();
  const patches = forceFullSave ? [] : [...pendingPatchMap.values()];

  writeLocalDashboardState(state);

  if (!patches.length && !forceFullSave) {
    setSaveStatus("Live updates on", "saved");
    return;
  }

  setSaveStatus("Saving shared...", "saving");

  try {
    const body = patches.length
      ? { clientId: dashboardClientId, patches, periodKey: currentPeriod.key, state }
      : { clientId: dashboardClientId, force: true, periodKey: currentPeriod.key, state };

    const response = await fetch(getSharedStateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);

      if (response.status === 409 && errorPayload?.state) {
        const savedState = errorPayload.state;
        pendingPatchMap.clear();
        applyDashboardState(savedState);
        writeLocalDashboardState(savedState);
        rememberSharedState(savedState);
        setSaveStatus("Recent edit locked this field", "warning");
        return;
      }

      throw new Error("Shared save failed.");
    }

    const payload = await response.json();
    const savedState = payload.state || state;
    pendingPatchMap.clear();
    applyDashboardState(savedState);
    writeLocalDashboardState(savedState);
    rememberSharedState(savedState);
    setSaveStatus(`Saved for everyone ${formatSavedAt(savedState.savedAt)}`);
  } catch (error) {
    setSaveStatus(`Saved here only ${formatSavedAt(state.savedAt)}`, "warning");
  }
}

function queueDashboardSave(patch) {
  if (patch) queuePatch(patch);
  setSaveStatus("Saving...", "saving");
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDashboardState, SAVE_DELAY_MS);
}

async function refreshSharedDashboardState({ showSyncedStatus = false } = {}) {
  if (document.hidden) return;
  if (pendingPatchMap.size || saveTimer) return;

  try {
    const response = await fetch(getSharedStateUrl(), { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Shared save unavailable.");
    }

    const payload = await response.json();
    const sharedState = payload.state;

    if (!sharedState) {
      if (showSyncedStatus) setSaveStatus("Live updates on", "saved");
      return;
    }

    if (isSharedStateNewer(sharedState)) {
      applyDashboardState(sharedState, { skipFocused: true });
      writeLocalDashboardState(sharedState);
      rememberSharedState(sharedState);
      setSaveStatus(sharedState.savedAt ? `Live update ${formatSavedAt(sharedState.savedAt)}` : "Live updates on");
      return;
    }

    if (showSyncedStatus) {
      setSaveStatus("Live updates on", "saved");
    }
  } catch (error) {
    setSaveStatus("Live updates offline", "warning");
  }
}

function startLiveUpdates() {
  clearInterval(livePollTimer);
  livePollTimer = window.setInterval(refreshSharedDashboardState, LIVE_POLL_INTERVAL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshSharedDashboardState({ showSyncedStatus: true });
  }
});

window.addEventListener("focus", () => {
  refreshSharedDashboardState({ showSyncedStatus: true });
});

function buildDonutGradient(tradeTotals, total) {
  if (total <= 0) return "conic-gradient(#e8ecee 0deg 360deg)";

  let start = 0;
  const segments = tradeTotals
    .filter((item) => item.total > 0)
    .map((item, index, activeItems) => {
      const isLast = index === activeItems.length - 1;
      const sweep = isLast ? 360 - start : (item.total / total) * 360;
      const end = start + sweep;
      const segment = `${item.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
      start = end;
      return segment;
    });

  return `conic-gradient(${segments.join(", ")})`;
}

function renderRows() {
  tradeRows.innerHTML = trades
    .map((trade, tradeIndex) => {
      const cells = trade.weeks
        .map(
          (value, weekIndex) => `
            <td>
              <input
                class="number-input"
                type="number"
                min="0"
                step="1"
                value="${value || ""}"
                placeholder="-"
                aria-label="${trade.name} week ${weekIndex + 1}"
                data-trade="${tradeIndex}"
                data-week="${weekIndex}"
              />
            </td>
          `,
        )
        .join("");

      return `
        <tr>
          <th scope="row">
            <span class="trade-name">
              <span class="trade-icon" style="color:${trade.color}" aria-hidden="true">${icons[trade.icon]}</span>
              ${trade.name}
            </span>
          </th>
          ${cells}
          <td id="tradeTotal${tradeIndex}">0</td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".number-input").forEach((input) => {
    input.addEventListener("input", () => {
      const tradeIndex = Number(input.dataset.trade);
      const weekIndex = Number(input.dataset.week);
      trades[tradeIndex].weeks[weekIndex] = cleanNumber(input.value);
      updateTotals();
      queueDashboardSave({
        tradeName: trades[tradeIndex].name,
        type: "cell",
        value: trades[tradeIndex].weeks[weekIndex],
        weekIndex,
      });
    });
  });
}

function updateTotals() {
  const weekTotals = [0, 0, 0, 0];
  let total = 0;
  const goal = cleanNumber(goalInput.value);

  trades.forEach((trade, tradeIndex) => {
    const tradeTotal = trade.weeks.reduce((sum, value, weekIndex) => {
      const number = cleanNumber(value);
      weekTotals[weekIndex] += number;
      return sum + number;
    }, 0);

    total += tradeTotal;
    document.getElementById(`tradeTotal${tradeIndex}`).textContent = tradeTotal;
  });

  weekTotals.forEach((value, index) => {
    document.getElementById(`weekTotal${index}`).textContent = value;
  });

  const percent = goal > 0 ? Math.round((total / goal) * 100) : 0;
  document.getElementById("monthTotal").textContent = total;
  document.getElementById("progressTotal").textContent = total;
  document.getElementById("progressGoal").textContent = goal;
  document.getElementById("progressPercent").textContent = `${percent}%`;
  document.getElementById("progressFill").style.width = `${Math.min(percent, 100)}%`;
  updateTradeMix(total);
  updateHistoricalComparison(total, weekTotals);
}

function updateTradeMix(total) {
  const tradeTotals = trades.map((trade) => ({
    ...trade,
    total: trade.weeks.reduce((sum, value) => sum + cleanNumber(value), 0),
  }));
  const sortedTrades = [...tradeTotals].sort((a, b) => b.total - a.total);
  const leader = sortedTrades[0];
  const runnerUp = sortedTrades[1];
  const leaderShare = total > 0 ? (leader.total / total) * 100 : 0;
  const leaderGap = Math.max((leader?.total || 0) - (runnerUp?.total || 0), 0);
  const maxTradeTotal = Math.max(leader?.total || 0, 1);

  document.getElementById("mixDonut").style.background = buildDonutGradient(tradeTotals, total);
  document.getElementById("topTradeName").textContent = total > 0 ? leader.name : "No calls";
  document.getElementById("topTradeShare").textContent = formatPercent(leaderShare);
  document.getElementById("leaderBadge").textContent =
    total > 0 ? `${leader.name} leads by ${leaderGap} calls` : "No calls entered";

  mixBars.innerHTML = sortedTrades
    .map((trade) => {
      const share = total > 0 ? (trade.total / total) * 100 : 0;
      const width = trade.total > 0 ? (trade.total / maxTradeTotal) * 100 : 0;
      const yoy = currentPeriod.dataKey === "july" ? tradeYoyTotals.find((item) => item.name === trade.name) : null;
      const lastMonthTotal = yoy?.current || 0;

      return `
        <div class="mix-row">
          <div class="mix-label">
            <span class="mix-dot" style="background:${trade.color}"></span>
            <span>${trade.name}</span>
          </div>
          <div class="mix-measures">
            <div class="mix-track">
              <div class="mix-fill" style="background:${trade.color}; width:${width}%"></div>
            </div>
            <div class="mix-yoy">
              ${
                yoy
                  ? `<span class="yoy-year is-prior-year">Last ${currentPeriod.monthName}: <b>${lastMonthTotal} calls</b></span>`
                  : `<span class="yoy-year is-prior-year">No LY target</span>`
              }
            </div>
          </div>
          <div class="mix-value">
            <strong>${trade.total}</strong>
            <span>${formatPercent(share)}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function updateHistoricalComparison(total, weekTotals) {
  const goal = cleanNumber(goalInput.value);
  const goalWeekly = Math.round(goal / 4);
  const historicalMonthRecords = historicalServiceCalls.map((item) => item[currentPeriod.dataKey]).filter(Boolean);
  const hasHistory = historicalMonthRecords.length > 0;
  const lastYearTotal = hasHistory ? historicalMonthRecords[0].total : 0;
  const lastYearWeekly = hasHistory ? Math.round(lastYearTotal / 4) : 0;
  const fiveYearWeekly = hasHistory
    ? Math.round(historicalMonthRecords.reduce((sum, item) => sum + item.total, 0) / historicalMonthRecords.length / 4)
    : 0;
  const latestWeekIndex = Math.max(weekTotals.findLastIndex((value) => value > 0), 0);
  const latestWeekTotal = weekTotals[latestWeekIndex] || 0;

  renderWeeklyComparisonChart(weekTotals, {
    fiveYearWeekly,
    goal,
    goalWeekly,
    hasHistory,
    lastYearTotal,
    lastYearWeekly,
    monthName: currentPeriod.monthName,
    total,
  });
}

function renderWeeklyComparisonChart(weekTotals, references) {
  const width = 420;
  const height = 290;
  const margin = { top: 22, right: 24, bottom: 62, left: 44 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const referenceValues = references.hasHistory
    ? [references.goalWeekly, references.lastYearWeekly, references.fiveYearWeekly]
    : [references.goalWeekly];
  const maxValue = Math.ceil(Math.max(10, ...referenceValues, ...weekTotals) * 1.12 / 10) * 10;
  const ticks = [0, Math.round(maxValue / 2), maxValue];
  const barWidth = 48;
  const gap = (chartWidth - barWidth * weekTotals.length) / (weekTotals.length - 1);
  const yFor = (value) => margin.top + chartHeight - (value / maxValue) * chartHeight;
  const baseline = margin.top + chartHeight;
  const lastYearY = yFor(references.lastYearWeekly);
  const goalY = yFor(references.goalWeekly);
  const latestWeekIndex = Math.max(weekTotals.findLastIndex((value) => value > 0), 0);
  const latestWeekTotal = weekTotals[latestWeekIndex] || 0;
  const latestDelta = latestWeekTotal - references.lastYearWeekly;

  const gridLines = ticks
    .map((tick) => {
      const y = yFor(tick);

      return `
        <g class="chart-gridline">
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>
          <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end">${tick}</text>
        </g>
      `;
    })
    .join("");

  const bars = weekTotals
    .map((value, index) => {
      const x = margin.left + index * (barWidth + gap);
      const y = yFor(value);
      const hasValue = value > 0;
      const barHeight = hasValue ? baseline - y : 5;
      const barY = hasValue ? y : baseline - barHeight;
      const label = hasValue ? formatNumber(value) : "-";

      return `
        <g class="chart-bar ${hasValue ? "is-entered" : "is-empty"}">
          <rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="7"></rect>
          <text class="chart-value current-value" x="${x + barWidth / 2}" y="${Math.max(barY - 10, 18)}" text-anchor="middle">
            ${label}
          </text>
        </g>
        <g class="chart-week-label">
          <text class="chart-label" x="${x + barWidth / 2}" y="${baseline + 26}" text-anchor="middle">
            Week ${index + 1}
          </text>
          <text class="chart-sublabel" x="${x + barWidth / 2}" y="${baseline + 44}" text-anchor="middle">
            ${hasValue ? "Actual" : "Open"}
          </text>
        </g>
      `;
    })
    .join("");

  comparisonChart.setAttribute(
    "aria-label",
    references.hasHistory
      ? `Weekly ${references.monthName} service calls chart. Current entered weeks total ${references.total}. Last ${references.monthName} averaged ${references.lastYearWeekly} calls per week, five year average is ${references.fiveYearWeekly} per week, and the goal pace is ${references.goalWeekly} per week.`
      : `Weekly ${references.monthName} service calls chart. Current entered weeks total ${references.total}. No prior ${references.monthName} history is loaded, and the goal pace is ${references.goalWeekly} per week.`,
  );

  const lastYearMarkup = references.hasHistory
    ? `
      <line class="last-year-line" x1="${margin.left}" y1="${lastYearY}" x2="${width - margin.right}" y2="${lastYearY}"></line>
      <text class="last-year-label" x="${width - margin.right}" y="${lastYearY - 8}" text-anchor="end">
        last year avg ${references.lastYearWeekly}/wk
      </text>
    `
    : "";

  comparisonChart.innerHTML = `
    <div class="comparison-summary" aria-hidden="true">
      <div class="comparison-stat is-current">
        <span>Week ${latestWeekIndex + 1}</span>
        <strong>${formatNumber(latestWeekTotal)}</strong>
        <em>${references.hasHistory ? `${formatDelta(latestDelta)} vs LY avg` : "Current week"}</em>
      </div>
      <div class="comparison-stat">
        <span>Last Year Avg</span>
        <strong>${references.hasHistory ? `${references.lastYearWeekly}/wk` : "N/A"}</strong>
        <em>${references.hasHistory ? `${formatNumber(references.lastYearTotal)} last ${references.monthName}` : `No prior ${references.monthName} data`}</em>
      </div>
      <div class="comparison-stat">
        <span>Goal Pace</span>
        <strong>${references.goalWeekly}/wk</strong>
        <em>${formatNumber(goalInput.valueAsNumber || 0)} monthly goal</em>
      </div>
    </div>
    <svg class="comparison-svg" viewBox="0 0 ${width} ${height}" role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id="currentBar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#1fb55b"></stop>
          <stop offset="100%" stop-color="#078a42"></stop>
        </linearGradient>
        <linearGradient id="historyBar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#3d7ed0"></stop>
          <stop offset="100%" stop-color="#226f96"></stop>
        </linearGradient>
      </defs>
      <rect class="chart-plot" x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" rx="12"></rect>
      ${gridLines}
      <line class="goal-line" x1="${margin.left}" y1="${goalY}" x2="${width - margin.right}" y2="${goalY}"></line>
      <text class="goal-label" x="${width - margin.right}" y="${goalY - 8}" text-anchor="end">
        goal pace ${references.goalWeekly}/wk
      </text>
      ${lastYearMarkup}
      ${bars}
    </svg>
  `;
}

goalInput.addEventListener("input", () => {
  updateTotals();
  queueDashboardSave({
    type: "goal",
    value: cleanNumber(goalInput.value),
  });
});

updatePeriodLabels();
renderRows();
const localState = loadSavedDashboardState();
updateTotals();
loadSharedDashboardState(localState);
startLiveUpdates();
window.setInterval(checkForPeriodChange, 60000);
