const DATABASE_NAME = "nhip-do";
const DATABASE_VERSION = 1;

const CATEGORIES = {
  sport: { label: "Thể thao", icon: "◌" },
  learning: { label: "Sách & học tập", icon: "⌁" },
  mindset: { label: "Mindset", icon: "◒" },
  work: { label: "Công việc", icon: "□" },
  money: { label: "Tiết kiệm", icon: "¤" },
  health: { label: "Sức khỏe", icon: "✦" },
  other: { label: "Khác", icon: "·" }
};

let state = emptyState();
let reports = [];
let databasePromise;
let editingGoalId = null;
let editingDailyId = null;
let viewingReportId = null;
let toastTimer;
let dashboardMode = "week";
let dashboardAnchor = localISODate();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function emptyState() {
  return { goals: [], dailyPlans: [], weeklyReviews: [] };
}

function localISODate(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function dayOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localISODate(date);
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Trình duyệt không hỗ trợ IndexedDB."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("state")) database.createObjectStore("state", { keyPath: "id" });
      if (!database.objectStoreNames.contains("reports")) database.createObjectStore("reports", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function databaseGet(storeName, key) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

async function databaseGetAll(storeName) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

async function databasePut(storeName, value) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, "readwrite").objectStore(storeName).put(value));
}

async function databaseDelete(storeName, key) {
  const database = await openDatabase();
  return requestResult(database.transaction(storeName, "readwrite").objectStore(storeName).delete(key));
}

function normalizeGoal(goal) {
  const current = Number(goal.current || 0);
  return {
    ...goal,
    category: CATEGORIES[goal.category] ? goal.category : "other",
    current,
    target: Number(goal.target || 0),
    startValue: Number(goal.startValue ?? current),
    createdAt: goal.createdAt || localISODate(),
    updates: Array.isArray(goal.updates) ? goal.updates : [],
    monthlyTarget: Number(goal.monthlyTarget || 0),
    monthlyEntries: Array.isArray(goal.monthlyEntries) ? goal.monthlyEntries : []
  };
}

function normalizeState(savedState) {
  const goals = Array.isArray(savedState?.goals) ? savedState.goals.map(normalizeGoal).filter((goal) => goal.target > 0) : [];
  const goalIds = new Set(goals.map((goal) => goal.id));
  const sourcePlans = Array.isArray(savedState?.dailyPlans) ? savedState.dailyPlans : Array.isArray(savedState?.habits) ? savedState.habits : [];
  const dailyPlans = sourcePlans.map((plan) => {
    const goal = goals.find((item) => item.id === plan.goalId);
    const createdAt = plan.createdAt || localISODate();
    return {
      id: plan.id || `daily-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: plan.title || "Daily plan",
      category: CATEGORIES[plan.category] ? plan.category : goal?.category || "other",
      cadence: ["daily", "weekdays", "weekly"].includes(plan.cadence) ? plan.cadence : "daily",
      weeklyDay: Number.isInteger(plan.weeklyDay) ? plan.weeklyDay : new Date(`${createdAt}T12:00:00`).getDay(),
      goalId: goalIds.has(plan.goalId) ? plan.goalId : null,
      prompt: plan.prompt || "",
      createdAt,
      startsOn: /^\d{4}-\d{2}-\d{2}$/.test(plan.startsOn || "") ? plan.startsOn : createdAt,
      logs: Array.isArray(plan.logs) ? plan.logs : [],
      difficulty: ["base", "stretch", "challenge"].includes(plan.difficulty) ? plan.difficulty : "base",
      missRule: ["none", "catchup", "review"].includes(plan.missRule) ? plan.missRule : "none",
      makeupDue: Math.max(0, Number(plan.makeupDue || 0))
    };
  });
  const weeklyReviews = Array.isArray(savedState?.weeklyReviews) ? savedState.weeklyReviews.filter((review) => /^\d{4}-\d{2}-\d{2}$/.test(review.weekStart || "")).map((review) => ({
    id: review.id || `review-${review.weekStart}`,
    weekStart: review.weekStart,
    reviewedAt: review.reviewedAt || review.weekStart,
    planned: Math.max(0, Number(review.planned || 0)),
    completed: Math.max(0, Number(review.completed || 0)),
    rate: Math.max(0, Math.min(100, Number(review.rate || 0))),
    goalEntries: Array.isArray(review.goalEntries) ? review.goalEntries : [],
    action: review.action || "keep",
    actionPlanId: review.actionPlanId || null,
    generatedCatchups: Array.isArray(review.generatedCatchups) ? review.generatedCatchups : [],
    note: review.note || ""
  })) : [];
  return { goals, dailyPlans, weeklyReviews };
}

async function loadState() {
  try {
    const record = await databaseGet("state", "current");
    return normalizeState(record?.value);
  } catch (error) {
    console.warn("Could not load saved data", error);
    return emptyState();
  }
}

async function loadReports() {
  try {
    const savedReports = await databaseGetAll("reports");
    return savedReports.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  } catch (error) {
    console.warn("Could not load reports", error);
    return [];
  }
}

function saveState() {
  databasePut("state", { id: "current", value: state }).catch((error) => console.warn("Could not save data", error));
}

function saveReport(report) {
  databasePut("reports", report).catch((error) => console.warn("Could not save report", error));
}

function getGoal(goalId) {
  return state.goals.find((goal) => goal.id === goalId);
}

function number(value) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function dateText(dateString, options = { day: "numeric", month: "long", year: "numeric" }) {
  if (!dateString) return "-";
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", options).format(new Date(year, month - 1, day, 12));
}

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = value || "";
  return element.innerHTML;
}

function progressOf(goal) {
  return Math.max(0, Math.min(100, (Number(goal.current) / Number(goal.target)) * 100 || 0));
}

function daysToDeadline(deadline) {
  return Math.ceil((new Date(`${deadline}T00:00:00`) - new Date(`${localISODate()}T00:00:00`)) / 86400000);
}

function deadlineText(goal) {
  const days = daysToDeadline(goal.deadline);
  if (days < 0) return { main: "Quá hạn", sub: `${Math.abs(days)} ngày` };
  if (days === 0) return { main: "Hôm nay", sub: "ngày chốt" };
  if (days === 1) return { main: "Ngày mai", sub: dateText(goal.deadline, { day: "numeric", month: "short" }) };
  return { main: `${days} ngày`, sub: dateText(goal.deadline, { day: "numeric", month: "short" }) };
}

function cadenceText(plan) {
  if (plan.cadence === "weekdays") return "Thứ 2 - Thứ 6";
  if (plan.cadence === "weekly") return "Mỗi tuần";
  return "Mỗi ngày";
}

function isDueOn(plan, date = new Date()) {
  const day = date.getDay();
  if (plan.cadence === "weekdays") return day >= 1 && day <= 5;
  if (plan.cadence === "weekly") return day === plan.weeklyDay;
  return true;
}

function doneToday(plan) {
  return doneOn(plan, localISODate());
}

function doneOn(plan, date) {
  return plan.logs?.some((log) => log.date === date && (log.type || "regular") === "regular");
}

function dateAtNoon(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function addDays(dateString, offset) {
  const date = dateAtNoon(dateString);
  date.setDate(date.getDate() + offset);
  return localISODate(date);
}

function startOfWeek(dateString) {
  const date = dateAtNoon(dateString);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return localISODate(date);
}

function endOfMonth(dateString) {
  const date = dateAtNoon(dateString);
  return localISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
}

function dateRange(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function difficultyText(difficulty) {
  return { base: "Nền tảng", stretch: "Nâng cao", challenge: "Thử thách" }[difficulty] || "Nền tảng";
}

function nextDifficulty(difficulty, direction) {
  const levels = ["base", "stretch", "challenge"];
  const current = Math.max(0, levels.indexOf(difficulty));
  return levels[Math.max(0, Math.min(levels.length - 1, current + direction))];
}

function dashboardPeriod(mode = dashboardMode, anchor = dashboardAnchor) {
  const start = mode === "week" ? startOfWeek(anchor) : `${anchor.slice(0, 7)}-01`;
  const end = mode === "week" ? addDays(start, 6) : endOfMonth(start);
  return { mode, start, end };
}

function periodLabel(period) {
  if (period.mode === "month") return new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(dateAtNoon(period.start));
  const start = dateAtNoon(period.start);
  const end = dateAtNoon(period.end);
  const year = start.getFullYear() === end.getFullYear() ? undefined : "numeric";
  const startText = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short", ...(year ? { year } : {}) }).format(start);
  const endText = new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short", year: "numeric" }).format(end);
  return `${startText} – ${endText}`;
}

function periodStats(mode = dashboardMode, anchor = dashboardAnchor) {
  const period = dashboardPeriod(mode, anchor);
  const today = localISODate();
  const cutoff = period.start > today ? null : (period.end > today ? today : period.end);
  const days = cutoff ? dateRange(period.start, cutoff).map((date) => {
    const duePlans = state.dailyPlans.filter((plan) => plan.startsOn <= date && isDueOn(plan, dateAtNoon(date)));
    return { date, due: duePlans.length, done: duePlans.filter((plan) => doneOn(plan, date)).length };
  }) : [];
  const planStats = state.dailyPlans.map((plan) => {
    const dueDates = days.filter((day) => plan.startsOn <= day.date && isDueOn(plan, dateAtNoon(day.date)));
    const completed = dueDates.filter((day) => doneOn(plan, day.date)).length;
    return { plan, planned: dueDates.length, completed, missed: Math.max(0, dueDates.length - completed) };
  }).filter((item) => item.planned > 0);
  const planned = days.reduce((sum, day) => sum + day.due, 0);
  const completed = days.reduce((sum, day) => sum + day.done, 0);
  return {
    ...period,
    days,
    planStats,
    planned,
    completed,
    missed: Math.max(0, planned - completed),
    rate: planned ? Math.round((completed / planned) * 100) : 0,
    closed: period.end < today
  };
}

function weeklyReview(weekStart) {
  return state.weeklyReviews.find((review) => review.weekStart === weekStart);
}

function linkedPlanCount(goalId) {
  return state.dailyPlans.filter((plan) => plan.goalId === goalId).length;
}

function currentMonth() {
  return localISODate().slice(0, 7);
}

function monthlyEntry(goal, period = currentMonth()) {
  return goal.monthlyEntries?.find((entry) => entry.period === period);
}

function moneyStatus(goal) {
  if (!goal.monthlyTarget) return "Ghi sổ cuối tháng để cập nhật tích lũy";
  const entry = monthlyEntry(goal);
  return entry
    ? `Tháng này: ${number(entry.amount)} / ${number(goal.monthlyTarget)} ${escapeHTML(goal.unit)}`
    : `Mục tiêu tháng: ${number(goal.monthlyTarget)} ${escapeHTML(goal.unit)}`;
}

function setActiveTab(tabName) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}Tab`));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  renderDate();
  renderGoals();
  renderDaily();
  renderDashboard();
  renderReports();
}

function renderDate() {
  $("#dateLine").textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

function dashboardSeries(stats) {
  if (stats.mode === "week") return stats.days.map((day) => ({
    label: new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(dateAtNoon(day.date)).replace("Thứ ", "T"),
    planned: day.due,
    completed: day.done
  }));
  const buckets = new Map();
  stats.days.forEach((day) => {
    const index = Math.floor((Number(day.date.slice(8, 10)) - 1) / 7) + 1;
    const bucket = buckets.get(index) || { label: `Tuần ${index}`, planned: 0, completed: 0 };
    bucket.planned += day.due;
    bucket.completed += day.done;
    buckets.set(index, bucket);
  });
  return [...buckets.values()];
}

function dashboardMessage(stats) {
  if (!state.dailyPlans.length) return { tone: "quiet", title: "Chưa có template để quan sát", copy: "Tạo daily plan trước, rồi dashboard sẽ tự đọc nhịp thực hiện của bạn." };
  if (!stats.planned) return { tone: "quiet", title: "Kỳ này chưa có lượt cần làm", copy: "Các plan xuất hiện từ ngày tạo và theo lịch lặp bạn đã chọn." };
  if (stats.closed && stats.rate >= 90) return { tone: "good", title: "Nhịp này đủ vững để tăng thử thách", copy: "Chốt review và chọn một plan để nâng cường độ, nếu mức hiện tại vẫn còn nhẹ." };
  if (stats.closed && stats.rate < 60) return { tone: "alert", title: "Cảnh báo: nhịp chưa đủ để giữ tải hiện tại", copy: "Đừng tự động tăng độ khó. Khi chốt review, hãy chọn giảm tải hoặc tạo một lượt bù nhỏ." };
  if (stats.missed) return { tone: "watch", title: `Còn ${stats.missed} lượt chưa được ghi nhận`, copy: stats.closed ? "Chốt review để quyết định bù, giữ nhịp hoặc điều chỉnh cường độ." : "Kỳ này vẫn đang diễn ra. Hãy nhìn số còn lại thay vì tự phạt quá sớm." };
  return { tone: "good", title: "Bạn đang bám đúng nhịp", copy: "Giữ tốc độ này đến cuối kỳ rồi mới quyết định có nên nâng độ khó." };
}

function setDashboardMode(mode) {
  dashboardMode = mode === "month" ? "month" : "week";
  renderDashboard();
}

function shiftDashboardPeriod(direction) {
  if (dashboardMode === "week") dashboardAnchor = addDays(dashboardAnchor, direction * 7);
  else {
    const date = dateAtNoon(dashboardAnchor);
    date.setMonth(date.getMonth() + direction);
    dashboardAnchor = localISODate(date);
  }
  renderDashboard();
}

function renderDashboard() {
  const stats = periodStats();
  const series = dashboardSeries(stats);
  const reviewed = stats.mode === "week" ? weeklyReview(stats.start) : null;
  const message = dashboardMessage(stats);
  const completionLabel = stats.planned ? `${stats.rate}%` : "–";
  $("#dashboardPeriodLabel").textContent = periodLabel(stats);
  $("#nextPeriod").disabled = stats.end >= localISODate();
  $$("[data-dashboard-mode]").forEach((button) => button.classList.toggle("active", button.dataset.dashboardMode === dashboardMode));
  $("#reviewOverview").innerHTML = `<article class="review-metric primary"><span>Hoàn thành</span><strong>${completionLabel}</strong><small>${stats.completed} / ${stats.planned} lượt</small></article><article class="review-metric"><span>Chưa xong</span><strong>${stats.missed}</strong><small>lượt trong kỳ</small></article><article class="review-metric"><span>Template có nhịp</span><strong>${stats.planStats.length}</strong><small>trên ${state.dailyPlans.length} template</small></article>`;
  $("#reviewSignal").innerHTML = `<span class="signal-mark" aria-hidden="true">${message.tone === "alert" ? "!" : message.tone === "good" ? "↑" : "·"}</span><div><p class="section-label">${message.tone === "alert" ? "Cần điều chỉnh" : message.tone === "good" ? "Tín hiệu tốt" : "Theo dõi nhịp"}</p><h3>${message.title}</h3><p>${message.copy}</p></div>`;
  $("#reviewSignal").dataset.tone = message.tone;
  $("#reviewChartCaption").textContent = stats.mode === "week" ? "Số lượt hoàn thành trên số lượt cần làm, theo ngày." : "Số lượt hoàn thành trên số lượt cần làm, gom theo từng tuần trong tháng.";
  $("#reviewChartTotal").textContent = `${stats.completed} / ${stats.planned}`;
  $("#reviewBars").innerHTML = series.length ? series.map((item) => {
    const height = item.planned ? Math.max(7, Math.round((item.completed / item.planned) * 100)) : 5;
    return `<div class="review-bar-column"><div class="review-bar-rail"><span class="review-bar" style="height:${height}%"></span></div><strong>${item.completed}/${item.planned}</strong><small>${item.label}</small></div>`;
  }).join("") : '<p class="review-chart-empty">Chưa có dữ liệu trong kỳ này.</p>';
  $("#reviewPlans").innerHTML = stats.planStats.map(({ plan, planned, completed, missed }) => `<article class="review-plan" data-category="${plan.category}"><div class="review-plan-title"><span class="plan-chip">${difficultyText(plan.difficulty)}</span><h3>${escapeHTML(plan.title)}</h3><p>${completed}/${planned} lượt · ${missed ? `còn ${missed} lượt` : "đủ nhịp"}</p></div><div class="review-plan-side"><strong>${planned ? Math.round((completed / planned) * 100) : 0}%</strong>${plan.makeupDue ? `<small>${plan.makeupDue} lượt bù</small>` : `<small>${plan.missRule === "catchup" ? "có quy tắc bù" : plan.missRule === "review" ? "cần review khi lỡ" : "theo dõi"}</small>`}</div></article>`).join("");
  $("#emptyReviewPlans").hidden = stats.planStats.length !== 0;
  const canReview = stats.mode === "week" && stats.end <= localISODate() && stats.planned > 0;
  $("#openWeeklyReview").hidden = stats.mode !== "week";
  $("#openWeeklyReview").disabled = !canReview || Boolean(reviewed);
  $("#weeklyReviewStatus").innerHTML = stats.mode !== "week" ? "" : reviewed
    ? `<p class="reviewed-status"><strong>Đã chốt tuần này</strong>${reviewed.note ? ` · ${escapeHTML(reviewed.note)}` : ""}</p>`
    : canReview ? '<p class="review-pending">Đủ dữ liệu để chốt review tuần và cập nhật goal thực tế.</p>' : '<p class="review-pending">Review mở khi tuần kết thúc. Bạn vẫn có thể theo dõi nhịp mỗi ngày tại đây.</p>';
}

function renderGoals() {
  const table = $("#goalTable");
  const empty = $("#emptyGoals");
  table.hidden = state.goals.length === 0;
  empty.hidden = state.goals.length !== 0;
  $("#goalsList").innerHTML = state.goals.map((goal) => {
    const category = CATEGORIES[goal.category];
    const deadline = deadlineText(goal);
    const urgent = daysToDeadline(goal.deadline) <= 7;
    const progress = progressOf(goal);
    const detail = goal.category === "money"
      ? `${category.label} · ${moneyStatus(goal)}`
      : `${category.label} · ${escapeHTML(goal.description)} · ${linkedPlanCount(goal.id)} daily plan`;
    return `<article class="goal-row" data-category="${goal.category}" role="listitem">
      <div class="goal-main"><span class="category-icon" aria-hidden="true">${category.icon}</span><div><h3>${escapeHTML(goal.title)}</h3><p>${detail}</p></div></div>
      <div class="deadline ${urgent ? "urgent" : ""}"><strong>${deadline.main}</strong>${deadline.sub}</div>
      <div class="progress-area"><div class="progress-top"><span>${number(goal.current)} / ${number(goal.target)} ${escapeHTML(goal.unit)}</span><strong>${Math.round(progress)}%</strong></div><div class="progress-track"><span style="--progress:${progress}%"></span></div></div>
      <div class="goal-actions">${goal.category === "money" ? `<button class="monthly-button" type="button" data-open-monthly="${goal.id}">Ghi tháng</button>` : ""}<button class="more-button" type="button" data-edit-goal="${goal.id}" aria-label="Cập nhật ${escapeHTML(goal.title)}">•••</button></div>
    </article>`;
  }).join("");
  $$('[data-edit-goal]').forEach((button) => button.addEventListener("click", () => openGoalDialog(button.dataset.editGoal)));
  $$('[data-open-monthly]').forEach((button) => button.addEventListener("click", () => openMonthlyDialog(button.dataset.openMonthly)));
}

function renderDaily() {
  const today = localISODate();
  const duePlans = state.dailyPlans.filter((plan) => plan.startsOn <= today && isDueOn(plan));
  const makeupOnlyPlans = state.dailyPlans.filter((plan) => plan.startsOn <= today && plan.makeupDue && !isDueOn(plan));
  const plansToday = [...duePlans, ...makeupOnlyPlans];
  const done = duePlans.filter(doneToday).length;
  $("#todayPlanCount").textContent = `${done}/${duePlans.length} việc${makeupOnlyPlans.length ? ` · ${makeupOnlyPlans.length} lượt bù` : ""}`;
  $("#todaySummary").innerHTML = `<span class="today-orb" aria-hidden="true"></span><p>${duePlans.length ? `Hôm nay có ${duePlans.length} plan, bạn đã xong ${done}.${makeupOnlyPlans.length ? ` Có thêm ${makeupOnlyPlans.length} lượt bù.` : ""}` : makeupOnlyPlans.length ? `Hôm nay không có plan theo lịch, nhưng có ${makeupOnlyPlans.length} lượt bù.` : "Chưa có plan nào cho hôm nay."}</p><small>${plansToday.length ? "Daily không tự thay đổi tiến độ mục tiêu." : "Tạo một template, rồi dùng lại mỗi ngày."}</small>`;
  $("#todayPlans").innerHTML = plansToday.map((plan) => {
    const goal = getGoal(plan.goalId);
    const dueToday = plan.startsOn <= today && isDueOn(plan);
    const done = dueToday && doneToday(plan);
    return `<article class="today-card ${done ? "done" : ""}" data-category="${plan.category}">
      ${dueToday ? `<button class="daily-check" type="button" data-complete-daily="${plan.id}" ${done ? "disabled" : ""} aria-label="${done ? "Đã hoàn thành" : `Hoàn thành ${escapeHTML(plan.title)}`}"></button>` : '<span class="daily-makeup-mark" aria-hidden="true">↻</span>'}
      <div class="daily-copy"><h3>${escapeHTML(plan.title)}</h3><p>${escapeHTML(plan.prompt || (goal ? `Liên kết: ${goal.title}` : "Không gắn với mục tiêu nào"))}</p></div>
      <div class="daily-actions"><div class="daily-status">${dueToday ? (done ? "Đã xong" : difficultyText(plan.difficulty)) : "Lượt bù"}<small>${goal ? `mục tiêu: ${goal.title}` : "nhịp độc lập"}</small></div>${plan.makeupDue ? `<button class="makeup-button" type="button" data-complete-makeup="${plan.id}">Bù 1 · còn ${plan.makeupDue}</button>` : ""}</div>
    </article>`;
  }).join("");
  $("#emptyTodayPlans").hidden = plansToday.length !== 0;
  $$('[data-complete-daily]').forEach((button) => button.addEventListener("click", () => completeDaily(button.dataset.completeDaily)));
  $$('[data-complete-makeup]').forEach((button) => button.addEventListener("click", () => completeMakeup(button.dataset.completeMakeup)));

  $("#planLibrary").innerHTML = state.dailyPlans.map((plan) => {
    const goal = getGoal(plan.goalId);
    return `<article class="plan-card" data-category="${plan.category}"><span class="plan-chip">${cadenceText(plan)} · ${difficultyText(plan.difficulty)}</span><h3>${escapeHTML(plan.title)}</h3><p>${escapeHTML(plan.prompt || (goal ? `Liên kết với ${goal.title}` : "Kế hoạch độc lập"))}</p><div class="plan-actions"><button type="button" data-clone-daily="${plan.id}">Nhân bản</button><button type="button" data-edit-daily="${plan.id}">Chỉnh sửa</button></div></article>`;
  }).join("");
  $("#emptyPlans").hidden = state.dailyPlans.length !== 0;
  $$('[data-clone-daily]').forEach((button) => button.addEventListener("click", () => cloneDaily(button.dataset.cloneDaily)));
  $$('[data-edit-daily]').forEach((button) => button.addEventListener("click", () => openDailyDialog(button.dataset.editDaily)));
}

function renderReports() {
  $("#reportsList").innerHTML = reports.map((report) => `<button class="report-card" type="button" data-report-id="${report.id}" aria-label="Xem báo cáo ${escapeHTML(report.title)}"><div><p class="section-label">Hoàn tất ${dateText(report.completedAt, { day: "numeric", month: "short", year: "numeric" })}</p><h3>${escapeHTML(report.title)}</h3><p>${escapeHTML(report.description || "Đã đạt mục tiêu")}</p></div><span class="report-arrow" aria-hidden="true">↗</span><strong>${number(report.finalValue)} / ${number(report.target)} ${escapeHTML(report.unit)}</strong></button>`).join("");
  $("#emptyReports").hidden = reports.length !== 0;
  $$('[data-report-id]').forEach((button) => button.addEventListener("click", () => openReportDialog(button.dataset.reportId)));
}

function populateDailyGoalSelect(selectedGoalId) {
  const select = $("#dailyGoal");
  select.innerHTML = '<option value="">Không liên kết mục tiêu</option>' + state.goals.map((goal) => `<option value="${goal.id}">${escapeHTML(goal.title)}</option>`).join("");
  select.value = getGoal(selectedGoalId) ? selectedGoalId : "";
}

function updateMoneyFields() {
  const isMoneyGoal = $("#goalCategory").value === "money";
  $("#monthlyTargetField").hidden = !isMoneyGoal;
  $("#goalMonthlyTarget").required = isMoneyGoal;
  if (!isMoneyGoal) $("#goalMonthlyTarget").value = "";
}

function openGoalDialog(goalId) {
  const goal = getGoal(goalId);
  editingGoalId = goal?.id || null;
  $("#goalForm").reset();
  $("#goalDialogLabel").textContent = goal ? "Cập nhật mục tiêu" : "Mục tiêu mới";
  $("#goalDialogTitle").textContent = goal ? "Cập nhật số thực tế" : "Đặt một đích có thể đo";
  $("#deleteGoalButton").hidden = !goal;
  if (goal) {
    $("#goalTitle").value = goal.title;
    $("#goalCategory").value = goal.category;
    $("#goalDeadline").value = goal.deadline;
    $("#goalCurrent").value = goal.current;
    $("#goalTarget").value = goal.target;
    $("#goalUnit").value = goal.unit;
    $("#goalMonthlyTarget").value = goal.monthlyTarget || "";
    $("#goalDescription").value = goal.description;
  } else {
    $("#goalDeadline").value = dayOffset(60);
    $("#goalCurrent").value = "0";
  }
  updateMoneyFields();
  $("#goalDialog").showModal();
  $("#goalTitle").focus();
}

function openDailyDialog(planId) {
  const plan = state.dailyPlans.find((item) => item.id === planId);
  editingDailyId = plan?.id || null;
  $("#dailyForm").reset();
  $("#dailyDialogLabel").textContent = plan ? "Chỉnh sửa daily plan" : "Daily plan mới";
  $("#dailyDialogTitle").textContent = plan ? "Điều chỉnh template lặp lại" : "Việc nhỏ, dùng lại nhiều lần";
  $("#deleteDailyButton").hidden = !plan;
  populateDailyGoalSelect(plan?.goalId);
  if (plan) {
    $("#dailyTitle").value = plan.title;
    $("#dailyCategory").value = plan.category;
    $("#dailyCadence").value = plan.cadence;
    $("#dailyDifficulty").value = plan.difficulty || "base";
    $("#dailyMissRule").value = plan.missRule || "none";
    $("#dailyPrompt").value = plan.prompt || "";
  }
  $("#dailyDialog").showModal();
  $("#dailyTitle").focus();
}

function submitGoal(event) {
  event.preventDefault();
  const target = Number($("#goalTarget").value);
  const current = Number($("#goalCurrent").value);
  if (current > target) {
    showToast("Tiến độ hiện tại không thể lớn hơn con số đích.");
    return;
  }
  const previous = getGoal(editingGoalId);
  const updates = [...(previous?.updates || [])];
  if (!previous || Number(previous.current) !== current) updates.push({ date: localISODate(), value: current });
  const goal = {
    id: previous?.id || `goal-${Date.now()}`,
    title: $("#goalTitle").value.trim(),
    category: $("#goalCategory").value,
    deadline: $("#goalDeadline").value,
    current,
    target,
    unit: $("#goalUnit").value.trim(),
    description: $("#goalDescription").value.trim(),
    createdAt: previous?.createdAt || localISODate(),
    startValue: previous?.startValue ?? current,
    updates,
    monthlyTarget: $("#goalCategory").value === "money" ? Number($("#goalMonthlyTarget").value || 0) : 0,
    monthlyEntries: previous?.monthlyEntries || []
  };
  if (previous) state.goals = state.goals.map((item) => item.id === goal.id ? goal : item);
  else state.goals.unshift(goal);
  if (current >= target) {
    archiveGoal(goal);
    $("#goalDialog").close();
    render();
    setActiveTab("reports");
    showToast(`Đã hoàn tất “${goal.title}”. Báo cáo đã được lưu.`);
    return;
  }
  saveState();
  $("#goalDialog").close();
  render();
  showToast(previous ? "Đã cập nhật tiến độ mục tiêu." : "Đã tạo mục tiêu mới.");
}

function submitDaily(event) {
  event.preventDefault();
  const previous = state.dailyPlans.find((plan) => plan.id === editingDailyId);
  const createdAt = previous?.createdAt || localISODate();
  const plan = {
    id: previous?.id || `daily-${Date.now()}`,
    title: $("#dailyTitle").value.trim(),
    category: $("#dailyCategory").value,
    cadence: $("#dailyCadence").value,
    weeklyDay: previous?.weeklyDay ?? new Date(`${createdAt}T12:00:00`).getDay(),
    goalId: getGoal($("#dailyGoal").value)?.id || null,
    prompt: $("#dailyPrompt").value.trim(),
    createdAt,
    startsOn: previous?.startsOn || createdAt,
    logs: previous?.logs || [],
    difficulty: $("#dailyDifficulty").value,
    missRule: $("#dailyMissRule").value,
    makeupDue: previous?.makeupDue || 0
  };
  if (previous) state.dailyPlans = state.dailyPlans.map((item) => item.id === plan.id ? plan : item);
  else state.dailyPlans.unshift(plan);
  saveState();
  $("#dailyDialog").close();
  render();
  showToast(previous ? "Đã cập nhật daily plan." : "Daily plan đã sẵn sàng để lặp lại.");
}

function populateMonthlyGoalSelect(selectedGoalId) {
  const moneyGoals = state.goals.filter((goal) => goal.category === "money");
  $("#monthlyGoal").innerHTML = moneyGoals.map((goal) => `<option value="${goal.id}">${escapeHTML(goal.title)} · ${goal.unit}</option>`).join("");
  if (selectedGoalId && getGoal(selectedGoalId)?.category === "money") $("#monthlyGoal").value = selectedGoalId;
}

function updateMonthlyForm() {
  const goal = getGoal($("#monthlyGoal").value);
  const period = $("#monthlyPeriod").value;
  if (!goal) {
    $("#monthlyUnit").textContent = "Chọn mục tiêu trước";
    return;
  }
  $("#monthlyUnit").textContent = goal.unit;
  const entry = monthlyEntry(goal, period);
  $("#monthlyAmount").value = entry ? entry.amount : goal.monthlyTarget || "";
  $("#monthlyNote").value = entry?.note || "";
  $("#monthlyNoteText").textContent = entry
    ? `Bạn đang cập nhật bản ghi ${period}. Số cũ sẽ được thay bằng số mới, không cộng hai lần.`
    : `Khoản này sẽ cộng trực tiếp vào “${goal.title}”. Mức dự kiến tháng: ${number(goal.monthlyTarget)} ${goal.unit}.`;
}

function openMonthlyDialog(goalId) {
  const moneyGoals = state.goals.filter((goal) => goal.category === "money");
  if (!moneyGoals.length) {
    showToast("Tạo một mục tiêu thuộc Tiết kiệm trước khi ghi sổ tháng.");
    return;
  }
  $("#monthlyForm").reset();
  $("#monthlyPeriod").value = currentMonth();
  populateMonthlyGoalSelect(goalId);
  updateMonthlyForm();
  $("#monthlyDialog").showModal();
  $("#monthlyAmount").focus();
}

function submitMonthly(event) {
  event.preventDefault();
  const goal = getGoal($("#monthlyGoal").value);
  const period = $("#monthlyPeriod").value;
  const amount = Number($("#monthlyAmount").value);
  if (!goal || goal.category !== "money" || !period || !Number.isFinite(amount) || amount < 0) {
    showToast("Chọn mục tiêu tiết kiệm, tháng và số tiền hợp lệ.");
    return;
  }
  const previous = monthlyEntry(goal, period);
  const previousAmount = Number(previous?.amount || 0);
  goal.monthlyEntries = (goal.monthlyEntries || []).filter((entry) => entry.period !== period);
  goal.monthlyEntries.push({ period, amount, note: $("#monthlyNote").value.trim() });
  goal.current = Math.max(0, Number(goal.current) - previousAmount + amount);
  goal.updates = [...(goal.updates || []), { date: `${period}-28`, value: goal.current, note: `Ghi sổ ${period}` }];
  if (goal.current >= goal.target) {
    archiveGoal(goal);
    $("#monthlyDialog").close();
    render();
    setActiveTab("reports");
    showToast(`Đã hoàn tất “${goal.title}”. Báo cáo đã được lưu.`);
    return;
  }
  saveState();
  $("#monthlyDialog").close();
  render();
  showToast(previous ? `Đã cập nhật sổ tháng ${period}.` : `Đã ghi ${number(amount)} ${goal.unit} cho tháng ${period}.`);
}

function completeDaily(planId) {
  const plan = state.dailyPlans.find((item) => item.id === planId);
  if (!plan || doneToday(plan)) return;
  plan.logs.push({ date: localISODate(), type: "regular" });
  saveState();
  render();
  showToast(`Đã ghi nhận “${plan.title}” hôm nay.`);
}

function completeMakeup(planId) {
  const plan = state.dailyPlans.find((item) => item.id === planId);
  if (!plan || !plan.makeupDue) return;
  plan.logs.push({ date: localISODate(), type: "makeup" });
  plan.makeupDue -= 1;
  saveState();
  render();
  showToast(`Đã bù một lượt cho “${plan.title}”.`);
}

function startTomorrow() {
  if (!state.dailyPlans.length) {
    showToast("Chưa có daily plan nào để khởi động.");
    return;
  }
  const tomorrow = addDays(localISODate(), 1);
  const confirmed = window.confirm(`Bắt đầu tất cả daily plan từ ${dateText(tomorrow, { day: "numeric", month: "long" })}? Nhật ký daily, lượt bù và review tuần hiện có sẽ được xóa. Goal và sổ tiết kiệm được giữ nguyên.`);
  if (!confirmed) return;
  state.dailyPlans = state.dailyPlans.map((plan) => ({ ...plan, startsOn: tomorrow, logs: [], makeupDue: 0 }));
  state.weeklyReviews = [];
  saveState();
  render();
  showToast(`Đã xóa nhịp cũ. Tất cả plan bắt đầu từ ${dateText(tomorrow, { day: "numeric", month: "short" })}.`);
}

function openWeeklyReview() {
  const stats = periodStats("week", dashboardAnchor);
  if (stats.end > localISODate()) {
    showToast("Review chỉ mở sau khi tuần kết thúc.");
    return;
  }
  if (!stats.planned) {
    showToast("Tuần này chưa có lượt daily nào để chốt.");
    return;
  }
  if (weeklyReview(stats.start)) {
    showToast("Tuần này đã được chốt review.");
    return;
  }
  const linkedGoals = [...new Set(stats.planStats.map(({ plan }) => plan.goalId))]
    .map((goalId) => getGoal(goalId))
    .filter((goal) => goal && goal.category !== "money");
  const catchupPlans = stats.planStats.filter(({ plan, missed }) => missed && plan.missRule === "catchup");
  const reviewPlans = stats.planStats.filter(({ plan, missed }) => missed && plan.missRule === "review");
  $("#weeklyReviewTitle").textContent = `Chốt tuần ${periodLabel(stats)}`;
  $("#weeklyReviewSummary").innerHTML = `<div><span>Hoàn thành</span><strong>${stats.rate}%</strong></div><div><span>Đã làm</span><strong>${stats.completed}/${stats.planned}</strong></div><div><span>Còn lại</span><strong>${stats.missed}</strong></div>`;
  $("#weeklyReviewPolicy").textContent = catchupPlans.length
    ? `${catchupPlans.length} plan có quy tắc bù sẽ nhận thêm 1 lượt bù sau khi bạn chốt tuần.`
    : reviewPlans.length
      ? `${reviewPlans.length} plan yêu cầu bạn xem lại vì đã có lượt bị bỏ lỡ.`
      : "Bạn có thể giữ nhịp, nâng cường độ hoặc chủ động điều chỉnh một plan cho tuần tới.";
  $("#weeklyReviewGoals").innerHTML = linkedGoals.length ? linkedGoals.map((goal) => `<label class="review-goal-field"><span><strong>${escapeHTML(goal.title)}</strong><small>Hiện tại ${number(goal.current)} / ${number(goal.target)} ${escapeHTML(goal.unit)}</small></span><span class="review-goal-input"><input type="number" min="0" step="0.1" value="0" data-review-goal="${goal.id}" aria-label="Tiến độ tăng thêm cho ${escapeHTML(goal.title)}" /><small>${escapeHTML(goal.unit)} tăng thêm</small></span></label>`).join("") : '<p class="empty-inline review-empty">Không có goal thường nào được liên kết trong tuần này. Goal tiết kiệm được ghi riêng ở sổ tháng.</p>';
  $("#reviewActionPlan").innerHTML = stats.planStats.length
    ? stats.planStats.map(({ plan }) => `<option value="${plan.id}">${escapeHTML(plan.title)} · ${difficultyText(plan.difficulty)}</option>`).join("")
    : '<option value="">Không có plan</option>';
  $("#reviewActionPlan").disabled = stats.planStats.length === 0;
  $("#reviewAction").value = stats.rate >= 90 ? "raise" : stats.rate < 60 ? "lower" : "keep";
  $("#weeklyReviewNote").value = "";
  $("#weeklyReviewDialog").showModal();
}

function submitWeeklyReview(event) {
  event.preventDefault();
  const stats = periodStats("week", dashboardAnchor);
  if (stats.end > localISODate() || weeklyReview(stats.start)) {
    showToast("Review tuần này không còn khả dụng.");
    return;
  }
  const goalEntries = [];
  for (const input of $$('[data-review-goal]')) {
    const amount = Number(input.value || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast("Số cập nhật goal phải là số dương hoặc bằng 0.");
      return;
    }
    if (amount > 0) goalEntries.push({ goalId: input.dataset.reviewGoal, amount });
  }
  const action = $("#reviewAction").value;
  const actionPlan = state.dailyPlans.find((plan) => plan.id === $("#reviewActionPlan").value);
  if (action !== "keep" && !actionPlan) {
    showToast("Chọn một plan để áp dụng quyết định tuần tới.");
    return;
  }
  const generatedCatchups = [];
  stats.planStats.forEach(({ plan, missed }) => {
    if (missed && plan.missRule === "catchup") {
      plan.makeupDue += 1;
      generatedCatchups.push(plan.id);
    }
  });
  if (action === "raise") actionPlan.difficulty = nextDifficulty(actionPlan.difficulty, 1);
  if (action === "lower") actionPlan.difficulty = nextDifficulty(actionPlan.difficulty, -1);
  if (action === "catchup" && !generatedCatchups.includes(actionPlan.id)) {
    actionPlan.makeupDue += 1;
    generatedCatchups.push(actionPlan.id);
  }
  const updateDate = stats.end > localISODate() ? localISODate() : stats.end;
  const completedGoalIds = [];
  goalEntries.forEach(({ goalId, amount }) => {
    const goal = getGoal(goalId);
    if (!goal) return;
    goal.current = Number(goal.current) + amount;
    goal.updates = [...(goal.updates || []), { date: updateDate, value: goal.current, note: `Review tuần ${stats.start}` }];
    if (goal.current >= goal.target) completedGoalIds.push(goal.id);
  });
  state.weeklyReviews.unshift({
    id: `review-${stats.start}`,
    weekStart: stats.start,
    reviewedAt: localISODate(),
    planned: stats.planned,
    completed: stats.completed,
    rate: stats.rate,
    goalEntries,
    action,
    actionPlanId: actionPlan?.id || null,
    generatedCatchups,
    note: $("#weeklyReviewNote").value.trim()
  });
  completedGoalIds.forEach((goalId) => {
    const goal = getGoal(goalId);
    if (goal) archiveGoal(goal);
  });
  saveState();
  $("#weeklyReviewDialog").close();
  render();
  const goalMessage = goalEntries.length ? ` và đã cập nhật ${goalEntries.length} goal` : "";
  showToast(`Đã chốt review tuần${goalMessage}.`);
}

function cloneDaily(planId) {
  const plan = state.dailyPlans.find((item) => item.id === planId);
  if (!plan) return;
  state.dailyPlans.unshift({
    ...plan,
    id: `daily-${Date.now()}`,
    title: `${plan.title} (bản sao)`,
    logs: [],
    makeupDue: 0,
    createdAt: localISODate(),
    startsOn: localISODate(),
    weeklyDay: new Date().getDay()
  });
  saveState();
  render();
  showToast("Đã nhân bản plan. Bạn có thể chỉnh sửa biến thể mới.");
}

function archiveGoal(goal) {
  const report = {
    id: `report-${goal.id}`,
    goalId: goal.id,
    title: goal.title,
    description: goal.description,
    category: goal.category,
    unit: goal.unit,
    target: Number(goal.target),
    finalValue: Number(goal.current),
    startValue: Number(goal.startValue || 0),
    startedAt: goal.createdAt || localISODate(),
    completedAt: localISODate(),
    updates: goal.updates || [],
    monthlyEntries: goal.monthlyEntries || []
  };
  reports = [report, ...reports.filter((item) => item.goalId !== goal.id)];
  state.goals = state.goals.filter((item) => item.id !== goal.id);
  state.dailyPlans = state.dailyPlans.map((plan) => plan.goalId === goal.id ? { ...plan, goalId: null } : plan);
  saveState();
  saveReport(report);
}

function deleteGoal() {
  const goal = getGoal(editingGoalId);
  if (!goal || !window.confirm(`Xóa mục tiêu “${goal.title}”? Daily plan liên kết sẽ được giữ lại nhưng bỏ liên kết.`)) return;
  state.goals = state.goals.filter((item) => item.id !== goal.id);
  state.dailyPlans = state.dailyPlans.map((plan) => plan.goalId === goal.id ? { ...plan, goalId: null } : plan);
  saveState();
  $("#goalDialog").close();
  render();
  showToast("Đã xóa mục tiêu. Daily plan vẫn được giữ lại.");
}

function deleteDaily() {
  const plan = state.dailyPlans.find((item) => item.id === editingDailyId);
  if (!plan || !window.confirm(`Xóa daily plan “${plan.title}”?`)) return;
  state.dailyPlans = state.dailyPlans.filter((item) => item.id !== plan.id);
  saveState();
  $("#dailyDialog").close();
  render();
  showToast("Đã xóa daily plan.");
}

function reportUpdates(report) {
  if (Array.isArray(report.updates) && report.updates.length) return report.updates;
  if (Array.isArray(report.entries)) {
    let value = Number(report.startValue || 0);
    return report.entries.map((entry) => { value += Number(entry.amount || 0); return { date: entry.date, value }; });
  }
  return Array.isArray(report.logs) ? report.logs.map((log) => ({ date: log.date, value: log.amount })) : [];
}

function reportSeries(report) {
  const updates = [...reportUpdates(report)].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const series = [{ date: report.startedAt, value: Number(report.startValue || 0) }];
  updates.forEach((update) => series.push({ date: update.date, value: Math.min(Number(report.target), Number(update.value || 0)) }));
  const last = series.at(-1);
  if (last.date === report.completedAt) last.value = Math.max(last.value, Number(report.finalValue));
  else series.push({ date: report.completedAt, value: Number(report.finalValue) });
  return series;
}

function reportChartSVG(report) {
  const series = reportSeries(report);
  const width = 560;
  const height = 210;
  const padding = { top: 24, right: 21, bottom: 19, left: 28 };
  const target = Number(report.target);
  const maxValue = Math.max(target, ...series.map((point) => point.value), 1);
  const x = (index) => padding.left + (index / Math.max(1, series.length - 1)) * (width - padding.left - padding.right);
  const y = (value) => padding.top + (1 - value / maxValue) * (height - padding.top - padding.bottom);
  const points = series.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const targetY = y(target).toFixed(1);
  const last = series.at(-1);
  return `<title id="reportChartTitle">Tiến độ ${escapeHTML(report.title)}</title><line x1="${padding.left}" y1="${targetY}" x2="${width - padding.right}" y2="${targetY}" stroke="#d87358" stroke-width="1.5" stroke-dasharray="5 5" /><line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#bfd4c8" stroke-width="1" /><polyline points="${points}" fill="none" stroke="#2a6753" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />${series.map((point, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="${index === series.length - 1 ? 5.5 : 3.4}" fill="${index === series.length - 1 ? "#dfb24e" : "#2a6753"}" />`).join("")}<text x="${width - padding.right}" y="${Number(targetY) - 8}" text-anchor="end" fill="#a44f3c" font-size="11" font-family="DM Sans, sans-serif">Đích</text><text x="${x(series.length - 1).toFixed(1)}" y="${Math.max(15, y(last.value) - 12).toFixed(1)}" text-anchor="middle" fill="#2a6753" font-size="11" font-weight="700" font-family="DM Sans, sans-serif">${number(last.value)} ${escapeHTML(report.unit)}</text>`;
}

function openReportDialog(reportId) {
  const report = reports.find((item) => item.id === reportId);
  if (!report) return;
  viewingReportId = report.id;
  const updates = reportUpdates(report);
  $("#reportTitle").textContent = report.title;
  $("#reportResult").textContent = `${number(report.finalValue)} ${report.unit}`;
  $("#reportUpdates").textContent = number(updates.length);
  $("#reportDate").textContent = dateText(report.completedAt, { day: "numeric", month: "short" });
  $("#chartDescription").textContent = "Theo các lần bạn cập nhật tiến độ thực tế";
  $("#chartStart").textContent = dateText(report.startedAt, { day: "numeric", month: "short" });
  $("#chartEnd").textContent = dateText(report.completedAt, { day: "numeric", month: "short" });
  $("#reportChart").innerHTML = reportChartSVG(report);
  $("#reportDialog").showModal();
}

function deleteReport() {
  const report = reports.find((item) => item.id === viewingReportId);
  if (!report || !window.confirm(`Xóa báo cáo “${report.title}”?`)) return;
  reports = reports.filter((item) => item.id !== report.id);
  databaseDelete("reports", report.id).catch((error) => console.warn("Could not delete report", error));
  $("#reportDialog").close();
  render();
  showToast("Đã xóa báo cáo.");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2700);
}

async function init() {
  state = await loadState();
  reports = await loadReports();
  render();
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));
  $("#openGoalDialog").addEventListener("click", () => openGoalDialog());
  $("#emptyGoalButton").addEventListener("click", () => openGoalDialog());
  $("#openDailyDialog").addEventListener("click", () => openDailyDialog());
  $("#openDailyDialogInline").addEventListener("click", () => openDailyDialog());
  $("#startTomorrowButton").addEventListener("click", startTomorrow);
  $("#goalForm").addEventListener("submit", submitGoal);
  $("#dailyForm").addEventListener("submit", submitDaily);
  $("#monthlyForm").addEventListener("submit", submitMonthly);
  $("#weeklyReviewForm").addEventListener("submit", submitWeeklyReview);
  $("#goalCategory").addEventListener("change", updateMoneyFields);
  $("#monthlyGoal").addEventListener("change", updateMonthlyForm);
  $("#monthlyPeriod").addEventListener("change", updateMonthlyForm);
  $$("[data-dashboard-mode]").forEach((button) => button.addEventListener("click", () => setDashboardMode(button.dataset.dashboardMode)));
  $("#previousPeriod").addEventListener("click", () => shiftDashboardPeriod(-1));
  $("#nextPeriod").addEventListener("click", () => shiftDashboardPeriod(1));
  $("#openWeeklyReview").addEventListener("click", openWeeklyReview);
  $("#deleteGoalButton").addEventListener("click", deleteGoal);
  $("#deleteDailyButton").addEventListener("click", deleteDaily);
  $("#deleteReportButton").addEventListener("click", deleteReport);
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
}

init();
