const PAGES = {
  task: "https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=dzx&tcmp=dzx&position=pc_ysmb1003_pc_dzx_rwzx&hide-banner-userinfo=1",
  benefits:
    "https://personal-act.wps.cn/rubik2/portal/HD2025031721339450/YM2025031721331326?position=android_aty_fl_grzx2002",
  iamtxt: "https://www.iamtxt.com/"
};

const PAGE_MATCHERS = {
  task: "/HD2025031821201822/",
  benefits: "/HD2025031721339450/",
  iamtxt: "iamtxt.com"
};

const ALARMS = {
  open: "wps-daily-open",
  hot: "wps-hot-prepare"
};

const LOG_RETENTION_DAYS = 7;
const MAX_LOGS = 2000;

function nextLocalTime(hour, minute, second = 0) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, second, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function isEnabled() {
  const data = await chrome.storage.local.get({ enabled: true });
  return data.enabled !== false;
}

async function scheduleAlarms() {
  await chrome.alarms.clear(ALARMS.open);
  await chrome.alarms.clear(ALARMS.hot);

  if (!(await isEnabled())) {
    return;
  }

  await chrome.alarms.create(ALARMS.open, {
    when: nextLocalTime(9, 49).getTime()
  });
  await chrome.alarms.create(ALARMS.hot, {
    when: nextLocalTime(9, 59, 40).getTime()
  });
}

async function findPageTab(kind) {
  const marker = PAGE_MATCHERS[kind];
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url && tab.url.includes(marker)) || null;
}

async function ensurePageTab(kind, options = {}) {
  const { active = false, reloadExisting = false } = options;
  let tab = await findPageTab(kind);

  if (!tab) {
    tab = await chrome.tabs.create({
      url: PAGES[kind],
      active
    });
  } else {
    if (reloadExisting) {
      await chrome.tabs.reload(tab.id);
    }
    if (active) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    }
  }

  return tab;
}

async function sendToTab(tabId, message, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch (error) {
      if (attempt === attempts - 1) {
        console.warn("WPS assistant: content script unavailable", error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  return false;
}

function pruneLogs(logs) {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return logs.filter((item) => {
    const time = new Date(item?.time).getTime();
    return Number.isFinite(time) && time >= cutoff;
  });
}

async function recordLog(entry) {
  const data = await chrome.storage.local.get({ logs: [] });
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const retained = pruneLogs(logs);
  retained.unshift({
    time: new Date().toISOString(),
    level: entry.level || "info",
    message: entry.message || String(entry)
  });
  await chrome.storage.local.set({ logs: retained.slice(0, MAX_LOGS) });
}

async function notify(title, message, requireAttention = false) {
  if (requireAttention) {
    await chrome.action.setBadgeBackgroundColor({ color: "#D9435C" });
    await chrome.action.setBadgeText({ text: "!" });
  }

  try {
    await chrome.notifications.create(`wps-assistant-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: requireAttention ? 2 : 0
    });
  } catch (error) {
    console.warn("WPS assistant: notification failed", error);
  }
}

async function setHotPending(state = {}) {
  await chrome.storage.local.set({
    hotPending: {
      date: localDateKey(),
      at: Date.now(),
      stage: "member",
      memberRefreshes: 0,
      pointsRefreshes: 0,
      sevenDayPreAttempted: false,
      ...state
    }
  });
}

async function getHotPending() {
  const data = await chrome.storage.local.get({ hotPending: null });
  const pending = data.hotPending;
  if (!pending || pending.date !== localDateKey()) {
    return null;
  }

  return Date.now() - Number(pending.at) < 10 * 60 * 1000
    ? pending
    : null;
}

async function updateHotPending(patch = {}) {
  const pending = await getHotPending();
  if (!pending) {
    return null;
  }
  const updated = { ...pending, ...patch };
  await chrome.storage.local.set({ hotPending: updated });
  return updated;
}

async function clearHotPending() {
  await chrome.storage.local.remove("hotPending");
}

async function openDailyPages() {
  if (!(await isEnabled())) {
    return;
  }

  await ensurePageTab("benefits", { reloadExisting: true });
  const taskTab = await ensurePageTab("task", { reloadExisting: true });
  const iamtxtTab = await ensurePageTab("iamtxt", { reloadExisting: true });
  await recordLog({
    message: "已打开任务中心、福利中心与 iamtxt 签到页，等待 10:00 限量领取。"
  });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await Promise.all([
    sendToTab(taskTab.id, { type: "run-task-now" }, 10),
    sendToTab(iamtxtTab.id, { type: "run-iamtxt-now" }, 10)
  ]);
}

async function prepareHotDrawing() {
  if (!(await isEnabled())) {
    return;
  }

  const tab = await ensurePageTab("benefits", {
    active: true,
    reloadExisting: false
  });
  const sent = await sendToTab(tab.id, { type: "prepare-hot" }, 12);
  if (!sent) {
    await chrome.tabs.reload(tab.id);
    await sendToTab(tab.id, { type: "prepare-hot" }, 12);
  }
}

async function runNow() {
  const benefitsTab = await ensurePageTab("benefits", { active: true });
  const taskTab = await ensurePageTab("task", { active: false });
  const iamtxtTab = await ensurePageTab("iamtxt", { active: false });

  await Promise.all([
    sendToTab(taskTab.id, { type: "run-task-now" }, 12),
    sendToTab(iamtxtTab.id, { type: "run-iamtxt-now", force: true }, 12)
  ]);
  await sendToTab(benefitsTab.id, { type: "run-all-now" }, 12);
  await recordLog({ message: "已发送立即执行指令。" });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarms();
  recordLog({ message: "WPS 福利自动助手已安装。" });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === ALARMS.open) {
      await openDailyPages();
      await scheduleAlarms();
      return;
    }

    if (alarm.name === ALARMS.hot) {
      await prepareHotDrawing();
      await scheduleAlarms();
    }
  } catch (error) {
    console.error("WPS assistant alarm error", error);
    await recordLog({
      level: "error",
      message: `定时任务失败：${error.message || error}`
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "get-state": {
        const data = await chrome.storage.local.get({
          enabled: true,
          logs: []
        });
        const logs = pruneLogs(Array.isArray(data.logs) ? data.logs : []);
        await chrome.storage.local.set({ logs: logs.slice(0, MAX_LOGS) });
        const openAlarm = await chrome.alarms.get(ALARMS.open);
        const hotAlarm = await chrome.alarms.get(ALARMS.hot);
        sendResponse({
          enabled: data.enabled !== false,
          logs,
          openAlarmAt: openAlarm?.scheduledTime || null,
          hotAlarmAt: hotAlarm?.scheduledTime || null
        });
        return;
      }

      case "set-enabled": {
        await chrome.storage.local.set({ enabled: Boolean(message.enabled) });
        await scheduleAlarms();
        await recordLog({
          message: message.enabled ? "自动任务已启用。" : "自动任务已暂停。"
        });
        sendResponse({ ok: true });
        return;
      }

      case "open-pages": {
        await openDailyPages();
        sendResponse({ ok: true });
        return;
      }

      case "run-now": {
        await runNow();
        sendResponse({ ok: true });
        return;
      }

      case "log": {
        await recordLog(message.entry || { message: message.message });
        if (message.clearBadge) {
          await chrome.action.setBadgeText({ text: "" });
        }
        sendResponse({ ok: true });
        return;
      }

      case "notify": {
        await notify(
          message.title || "WPS 福利自动助手",
          message.message || "",
          Boolean(message.requireAttention)
        );
        sendResponse({ ok: true });
        return;
      }

      case "hot-pending-set": {
        await setHotPending(message.state || {});
        sendResponse({ ok: true });
        return;
      }

      case "hot-pending-get": {
        sendResponse({ pending: await getHotPending() });
        return;
      }

      case "hot-pending-update": {
        sendResponse({ pending: await updateHotPending(message.patch || {}) });
        return;
      }

      case "hot-pending-clear": {
        await clearHotPending();
        sendResponse({ ok: true });
        return;
      }

      case "routine-claim": {
        const data = await chrome.storage.local.get({ routineDate: "" });
        const today = localDateKey();
        if (!message.force && data.routineDate === today) {
          sendResponse({ claimed: true });
          return;
        }
        await chrome.storage.local.set({ routineDate: today });
        sendResponse({ claimed: false });
        return;
      }

      case "routine-release": {
        const data = await chrome.storage.local.get({ routineDate: "" });
        if (data.routineDate === localDateKey()) {
          await chrome.storage.local.remove("routineDate");
        }
        sendResponse({ ok: true });
        return;
      }

      default:
        sendResponse({ ok: false, reason: "unknown-message" });
    }
  })().catch(async (error) => {
    console.error("WPS assistant message error", error);
    try {
      await recordLog({
        level: "error",
        message: `扩展错误：${error.message || error}`
      });
    } catch {
      // Ignore secondary storage failures.
    }
    sendResponse({ ok: false, error: String(error?.message || error) });
  });

  return true;
});
