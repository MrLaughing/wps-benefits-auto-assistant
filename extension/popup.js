const enabledInput = document.getElementById("enabled");
const runButton = document.getElementById("run-now");
const openButton = document.getElementById("open-pages");
const refreshButton = document.getElementById("refresh");
const logsBox = document.getElementById("logs");
const schedule = document.getElementById("schedule");

function formatDate(value) {
  if (!value) {
    return "未安排";
  }
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function renderLogs(logs = []) {
  logsBox.replaceChildren();
  if (!logs.length) {
    logsBox.textContent = "还没有执行记录";
    return;
  }

  for (const entry of logs.slice(0, 30)) {
    const line = document.createElement("div");
    line.dataset.level = entry.level || "info";
    const time = new Date(entry.time).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    line.textContent = `${time}  ${entry.message}`;
    logsBox.appendChild(line);
  }
}

async function loadState() {
  const state = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!state) {
    return;
  }
  enabledInput.checked = Boolean(state.enabled);
  renderLogs(state.logs);
  schedule.textContent = `下次打开：${formatDate(state.openAlarmAt)} · 下次预热：${formatDate(
    state.hotAlarmAt
  )}`;
}

async function withBusy(button, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "执行中...";
  try {
    await action();
    await loadState();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

enabledInput.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({
    type: "set-enabled",
    enabled: enabledInput.checked
  });
  await loadState();
});

runButton.addEventListener("click", () => {
  withBusy(runButton, async () => {
    await chrome.runtime.sendMessage({ type: "run-now" });
  });
});

openButton.addEventListener("click", () => {
  withBusy(openButton, async () => {
    await chrome.runtime.sendMessage({ type: "open-pages" });
  });
});

refreshButton.addEventListener("click", loadState);

loadState();
