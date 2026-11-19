(() => {
  "use strict";

  const PAGE_TYPE = location.pathname.includes("/HD2025031821201822/")
    ? "task"
    : location.pathname.includes("/HD2025031721339450/")
      ? "benefits"
      : "";

  const state = {
    running: false,
    taskRunning: false,
    hotReloading: false,
    attentionNeeded: false,
    lastStatus: "待命"
  };

  const HOT_REFRESH_LIMIT = 5;
  const MEMBER_CLAIM_RETRY_LIMIT = 5;
  const OVERLAY_LOG_LIMIT = 30;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function elementText(element) {
    return normalizeText(element?.innerText || element?.textContent || "");
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function visibleElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(isVisible);
  }

  async function waitFor(getter, timeoutMs = 8000, intervalMs = 120) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value) {
        return value;
      }
      await sleep(intervalMs);
    }
    return null;
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  function ensureOverlay() {
    if (document.getElementById("wps-assistant-panel")) {
      return;
    }

    const panel = document.createElement("section");
    panel.id = "wps-assistant-panel";
    panel.innerHTML = `
      <div class="wps-assistant-head">
        <div>
          <strong>WPS 福利助手</strong>
          <span id="wps-assistant-status">待命</span>
        </div>
        <button id="wps-assistant-hide" type="button" aria-label="隐藏">×</button>
      </div>
      <div id="wps-assistant-log">等待任务</div>
      <button id="wps-assistant-open" type="button">展开日志</button>
    `;
    document.documentElement.appendChild(panel);

    const log = panel.querySelector("#wps-assistant-log");
    panel.querySelector("#wps-assistant-hide").addEventListener("click", () => {
      panel.classList.add("is-collapsed");
      panel.querySelector("#wps-assistant-open").textContent = "WPS 助手";
    });
    panel.querySelector("#wps-assistant-open").addEventListener("click", () => {
      if (panel.classList.contains("is-collapsed")) {
        panel.classList.remove("is-collapsed");
        panel.querySelector("#wps-assistant-open").textContent = "展开日志";
        return;
      }
      panel.classList.toggle("show-log");
    });

    if (!log) {
      panel.remove();
    }
  }

  function setStatus(text, level = "info") {
    state.lastStatus = text;
    ensureOverlay();
    const panel = document.getElementById("wps-assistant-panel");
    const status = document.getElementById("wps-assistant-status");
    if (status) {
      status.textContent = text;
      status.dataset.level = level;
    }
    panel?.classList.toggle("is-attention", level === "attention");
  }

  async function log(message, level = "info") {
    const text = normalizeText(message);
    console.log("[WPS 福利助手]", text);
    setStatus(text, level);

    ensureOverlay();
    const logBox = document.getElementById("wps-assistant-log");
    if (logBox) {
      const line = document.createElement("div");
      line.textContent = `${new Date().toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      })}  ${text}`;
      line.dataset.level = level;
      logBox.prepend(line);
      while (logBox.children.length > OVERLAY_LOG_LIMIT) {
        logBox.lastElementChild?.remove();
      }
    }

    await sendMessage({
      type: "log",
      entry: { level, message: text },
      clearBadge: level === "success"
    });
  }

  async function hydrateOverlayLogs() {
    const state = await sendMessage({ type: "get-state" });
    const logs = Array.isArray(state?.logs) ? state.logs : [];
    if (!logs.length) {
      return;
    }

    ensureOverlay();
    const logBox = document.getElementById("wps-assistant-log");
    if (!logBox) {
      return;
    }

    logBox.replaceChildren();
    for (const entry of logs.slice(0, OVERLAY_LOG_LIMIT)) {
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
      logBox.appendChild(line);
    }
  }

  async function notify(title, message, requireAttention = false) {
    await sendMessage({
      type: "notify",
      title,
      message,
      requireAttention
    });
  }

  function detectCaptcha() {
    const popup = document.querySelector("#aliyunCaptcha-window-popup");
    const wrapper = document.querySelector("#aliyunCaptcha-sliding-wrapper");
    return Boolean(
      (popup && !popup.classList.contains("aliyunCaptcha-hidden") && isVisible(popup)) ||
        (wrapper && isVisible(wrapper))
    );
  }

  async function stopForCaptcha(context = "") {
    state.attentionNeeded = true;
    const message = `${context ? `${context}：` : ""}触发安全验证，请到已打开的页面手动滑动滑块，完成后重新点“立即执行”。`;
    await log(message, "attention");
    await notify("WPS 福利助手需要你操作", message, true);
    return "captcha";
  }

  function visibleModal() {
    const selectors = [".boost-dialog-box", ".rb-dialog__bg", ".dialog-bg"];
    const candidates = selectors
      .flatMap((selector) => visibleElements(selector))
      .filter((element) => !element.closest("#wps-assistant-panel"));

    if (!candidates.length) {
      return null;
    }

    return candidates.sort((left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return b.width * b.height - a.width * a.height;
    })[0];
  }

  function visibleToast() {
    const selectors = [
      ".rb-toast-content-wrap",
      ".rb-toast-content",
      ".rb-toast"
    ];
    return (
      selectors
        .flatMap((selector) => visibleElements(selector))
        .find((element) => elementText(element)) || null
    );
  }

  function modalCloseButton(modal) {
    const selectors = [
      ".boost-dialog-box .confirm-btn",
      ".rb-dialog__bg .close-btn",
      ".dialog-bg .close-icon",
      ".close-btn",
      ".close-icon"
    ];

    for (const selector of selectors) {
      const button = visibleElements(selector, modal)[0];
      if (button) {
        return button;
      }
    }
    return null;
  }

  function modalConfirmButton(modal) {
    const buttons = visibleElements(
      ".btn, .main-btn, .confirm-btn, button",
      modal
    );
    return (
      buttons.find((button) =>
        /^(确认领取|确认|确定|我知道了)$/.test(elementText(button))
      ) || null
    );
  }

  async function closeModal(modal = visibleModal()) {
    if (!modal) {
      return false;
    }

    const closeButton = modalCloseButton(modal);
    if (closeButton) {
      closeButton.click();
      await sleep(250);
      return true;
    }

    const quietButton = visibleElements(
      ".cancel-btn, .btn, .main-btn, .confirm-btn, button",
      modal
    ).find((button) =>
      /^(我再想想|取消|关闭|我知道了|好的|确定)$/.test(elementText(button))
    );

    if (quietButton) {
      quietButton.click();
      await sleep(250);
      return true;
    }

    return false;
  }

  async function settleResultModal(context) {
    const outcome = await waitFor(() => {
      const modal = visibleModal();
      if (modal) {
        return { type: "modal", element: modal, text: elementText(modal) };
      }
      const toast = visibleToast();
      if (toast) {
        return { type: "toast", element: toast, text: elementText(toast) };
      }
      return null;
    }, 1500, 100);

    if (!outcome) {
      return "";
    }

    await log(`${context}：${outcome.text.slice(0, 180)}`);
    if (outcome.type === "modal") {
      await closeModal(outcome.element);
    } else {
      await sleep(250);
    }
    return outcome.text;
  }

  async function runTaskSignIn() {
    if (state.taskRunning) {
      return;
    }
    state.taskRunning = true;

    try {
      await log("检查任务中心签到...");
      const panel = await waitFor(
        () => document.querySelector(".sign-in-panel"),
        15000
      );
      if (!panel) {
        await log("未找到任务中心签到区域。", "error");
        return;
      }

      await waitFor(() => document.readyState === "complete", 12000, 250);
      await sleep(1200);

      const taskSignButton = () =>
        Array.from(panel.querySelectorAll(".sign-opera-btn")).find(isVisible);

      let button = taskSignButton();
      if (!button) {
        await log("签到按钮暂未渲染。", "error");
        return;
      }

      const before = elementText(button);
      if (!before.includes("点击签到")) {
        await log(`任务中心无需签到（${before || "已签到"}）。`);
        return;
      }

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (detectCaptcha()) {
          await stopForCaptcha("任务中心签到");
          return;
        }

        button = taskSignButton();
        if (!button) {
          await log("签到按钮在重试时消失，请手动确认签到状态。", "warning");
          return;
        }

        const currentText = elementText(button);
        if (!currentText.includes("点击签到")) {
          await log(`任务中心签到成功，按钮状态：${currentText || "已签到"}。`, "success");
          return;
        }

        await log(
          attempt === 1
            ? "正在点击任务中心签到..."
            : `任务中心签到第 ${attempt}/3 次重试...`,
          attempt === 1 ? "info" : "warning"
        );
        await waitFor(() => !visibleToast(), 800, 100);
        button.click();

        const result = await settleResultModal("任务中心签到");
        await sleep(350);

        if (detectCaptcha()) {
          await stopForCaptcha("任务中心签到");
          return;
        }

        const refreshedButton = await waitFor(taskSignButton, 3000, 100);
        if (!refreshedButton) {
          await log("任务中心签到后按钮暂时消失，请稍后刷新确认状态。", "warning");
          return;
        }

        const after = elementText(refreshedButton);
        if (!after.includes("点击签到")) {
          if (!result) {
            await log(`任务中心签到成功，按钮状态：${after || "已签到"}。`, "success");
          }
          return;
        }

        if (/签到成功|已签到|成功|获得/.test(result)) {
          await log(`任务中心签到成功：${result.slice(0, 160)}`, "success");
          return;
        }

        if (result) {
          await log(`任务中心签到返回：${result.slice(0, 160)}`, "warning");
        }

        if (attempt < 3) {
          await waitFor(() => !visibleToast(), 1200, 100);
          await sleep(700 + attempt * 250);
        }
      }

      await log("任务中心签到连续尝试 3 次后仍显示“点击签到”，请手动确认。", "warning");
    } catch (error) {
      await log(`任务中心签到失败：${error.message || error}`, "error");
    } finally {
      state.taskRunning = false;
    }
  }

  function isRetryableMemberClaim(text) {
    return (
      !text ||
      /活动太火爆|太火爆|稍后再试|稍候|请求频繁|系统繁忙|网络异常|请求失败/.test(
        text
      )
    );
  }

  async function claimImmediateMemberReward(card, index, attemptLimit = 1) {
    let lastResult = "";

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      const button = card.querySelector(".trial-btn");
      if (!button || !isVisible(button)) {
        return lastResult || "hidden";
      }

      const currentText = elementText(button);
      if (!currentText.includes("立刻领取")) {
        if (attempt > 1) {
          await log(`第 ${index + 1} 张会员卡已变为“${currentText}”。`, "success");
        }
        return lastResult || currentText;
      }

      await log(
        attempt === 1
          ? `第 ${index + 1} 张会员卡有已中奖奖励，正在领取...`
          : `第 ${index + 1} 张会员卡正在第 ${attempt}/${attemptLimit} 次重试领取...`,
        attempt === 1 ? "info" : "warning"
      );
      await waitFor(() => !visibleToast(), 800, 100);
      button.click();
      lastResult = await settleResultModal(`第 ${index + 1} 张会员卡`);

      const afterText = elementText(card.querySelector(".trial-btn"));
      if (!afterText.includes("立刻领取")) {
        await log(`第 ${index + 1} 张会员卡领取状态：${afterText || "已提交"}`, "success");
        return lastResult || afterText || "submitted";
      }

      if (!isRetryableMemberClaim(lastResult)) {
        return lastResult;
      }

      if (attempt < attemptLimit) {
        await waitFor(() => !visibleToast(), 1200, 100);
        await sleep(450 + attempt * 120);
      }
    }

    await log(
      `第 ${index + 1} 张会员卡尝试 ${attemptLimit} 次后仍显示“立刻领取”，暂未领取成功。`,
      "warning"
    );
    return lastResult || "busy";
  }

  async function waitForSevenDayClaimWindow(card) {
    const now = new Date();
    if (now.getHours() !== 10 || now.getMinutes() > 2) {
      return;
    }

    const initialText = elementText(card.querySelector(".trial-btn"));
    if (initialText !== "待开奖") {
      return;
    }

    await log("7 天会员卡正在开奖，等待页面更新为“立刻领取”...");
    const readyButton = await waitFor(() => {
      const button = card.querySelector(".trial-btn");
      return elementText(button).includes("立刻领取") ? button : null;
    }, 10000, 250);

    if (!readyButton) {
      await log("7 天会员卡暂未更新为可领取状态。", "warning");
    }
  }

  async function runMemberTrial() {
    const root = document.querySelector(".divide-prize-box");
    if (!root) {
      await log("未找到会员免费试用模块。", "warning");
      return;
    }

    const cards = Array.from(root.querySelectorAll(".member-item")).slice(0, 3);
    if (!cards.length) {
      await log("会员免费试用卡片暂未加载。", "warning");
      return;
    }

    await log("检查 7 天、1 个月、3 个月会员奖励...");
    // The separate 1-day invite card is not .member-item, so the first one is 7-day.
    const sevenDayCard = cards[0];
    if (sevenDayCard) {
      await waitForSevenDayClaimWindow(sevenDayCard);
    }

    for (const [index, card] of cards.entries()) {
      if (detectCaptcha()) {
        await stopForCaptcha("会员领取");
        return;
      }

      const button = card.querySelector(".trial-btn");
      const text = elementText(button);
      if (!button || !isVisible(button) || text === "待开奖") {
        continue;
      }

      if (text.includes("立刻领取")) {
        const attemptLimit = card === sevenDayCard ? MEMBER_CLAIM_RETRY_LIMIT : 1;
        await claimImmediateMemberReward(card, index, attemptLimit);
        await sleep(1200);
        continue;
      }

      if (text.includes("申请试用")) {
        await log(`正在申请第 ${index + 1} 张会员试用...`);
        button.click();
        const confirmModal = await waitFor(visibleModal, 3500);
        if (!confirmModal) {
          if (detectCaptcha()) {
            await stopForCaptcha("会员试用申请");
          } else {
            await log(`第 ${index + 1} 张会员卡未弹出确认框。`, "warning");
          }
          return;
        }

        const confirmText = elementText(confirmModal);
        if (!/想好了吗|确认选它|确认申请|每天仅可参与/.test(confirmText)) {
          await log(`第 ${index + 1} 张会员卡：${confirmText.slice(0, 160)}`);
          await closeModal(confirmModal);
          if (/3次|次数|明日|明天/.test(confirmText)) {
            return;
          }
          continue;
        }

        if (/每天仅可参与3次会员申请.*明天再来/.test(confirmText)) {
          await log(confirmText.slice(0, 180), "warning");
          await closeModal(confirmModal);
          return;
        }

        const confirmButton = modalConfirmButton(confirmModal);
        if (!confirmButton) {
          await log("未找到会员试用确认按钮。", "error");
          await closeModal(confirmModal);
          return;
        }

        confirmButton.click();
        await sleep(900);
        const result = await settleResultModal(`第 ${index + 1} 张会员卡`);
        if (/3次|次数|明天再来/.test(result)) {
          return;
        }
        await sleep(1100);
      }
    }
  }

  async function attemptSevenDayBeforeHot() {
    const root = document.querySelector(".divide-prize-box");
    if (!root) {
      await log("7 天会员卡抢先尝试：未找到会员免费试用模块。", "warning");
      return "missing";
    }

    const cards = Array.from(root.querySelectorAll(".member-item")).slice(0, 3);
    const index = 0;
    if (!cards[index]) {
      await log("7 天会员卡抢先尝试：未找到 7 天会员卡。", "warning");
      return "missing";
    }

    const card = cards[index];
    const button = card.querySelector(".trial-btn");
    if (!button || !isVisible(button)) {
      await log("7 天会员卡抢先尝试：领取按钮暂未显示。", "warning");
      return "not-ready";
    }

    const buttonText = elementText(button);
    if (!buttonText.includes("立刻领取")) {
      await log(`7 天会员卡抢先尝试：当前状态为“${buttonText}”，先转去抢限量爆款。`);
      return "not-ready";
    }

    await log("10:00 限量爆款开始前，先尝试领取 7 天会员卡 1 次...");
    return claimImmediateMemberReward(card, index, 1);
  }

  async function runFragmentCheckIn() {
    const collect = document.querySelector(".fragment-collect");
    if (!collect) {
      await log("未找到打卡免费领会员模块。", "warning");
      return;
    }

    const mask = visibleElements(".mask", collect)[0];
    if (mask) {
      await log("打卡连续记录已中断，需要手动处理“重新开始”。", "warning");
      await notify(
        "WPS 打卡需要手动处理",
        "连续打卡已中断，脚本没有自动重置，请到福利中心手动确认。",
        true
      );
      return;
    }

    const button = visibleElements(".sigh-item img.btn", collect)[0];
    if (!button) {
      await log("打卡免费领会员：今天已领取或暂无可领取按钮。");
      return;
    }

    if (detectCaptcha()) {
      await stopForCaptcha("打卡免费领会员");
      return;
    }

    await log("正在执行福利中心连续打卡...");
    button.click();
    await sleep(700);

    if (detectCaptcha()) {
      await stopForCaptcha("打卡免费领会员");
      return;
    }

    const modal = await waitFor(visibleModal, 4500);
    if (modal) {
      const text = elementText(modal);
      await log(`今日打卡：${text.slice(0, 180)}`, "success");
      await closeModal(modal);
    } else {
      await log("已点击今日打卡，页面正在刷新奖励状态。");
    }
  }

  async function runFragmentFinalPrize() {
    const finalSign = document.querySelector(".fragment-collect .final-sign");
    if (!finalSign) {
      await log("未找到“集碎片领 1 天超级会员”区域。", "warning");
      return "missing";
    }

    if (isVisible(finalSign.querySelector(".final-image"))) {
      await log("集碎片 1 天超级会员今天已经领取。");
      return "received";
    }

    const claimButton = finalSign.querySelector(".hot-btn.pointer");
    if (!claimButton || !isVisible(claimButton)) {
      await log("集碎片 1 天超级会员尚未满 7 天，暂不可领取。");
      return "not-ready";
    }

    if (detectCaptcha()) {
      await stopForCaptcha("集碎片领超级会员");
      return "captcha";
    }

    await log("连续打卡已满 7 天，正在领取“集碎片 1 天超级会员”...");
    claimButton.click();
    await sleep(550);

    if (detectCaptcha()) {
      await stopForCaptcha("集碎片领超级会员");
      return "captcha";
    }

    const modal = await waitFor(visibleModal, 5000);
    if (!modal) {
      await log("集碎片奖励未弹出领取确认框。", "warning");
      return "failed";
    }

    const modalText = elementText(modal);
    if (/绑定手机|账号安全/.test(modalText)) {
      await log("领取集碎片奖励前需要绑定手机号，已暂停自动操作。", "attention");
      await notify(
        "WPS 集碎片奖励需要绑定手机号",
        "请到福利中心手动完成绑定后再领取，脚本没有继续提交。",
        true
      );
      await closeModal(modal);
      return "needs-phone";
    }

    const receiveButton = visibleElements(
      ".btn, .main-btn, .confirm-btn, button",
      modal
    ).find((button) => /立即领取|确认领取|确认/.test(elementText(button)));

    if (!receiveButton) {
      await log(`集碎片领取弹窗未找到“立即领取”按钮：${modalText.slice(0, 140)}`, "warning");
      await closeModal(modal);
      return "failed";
    }

    receiveButton.click();
    await sleep(900);

    if (detectCaptcha()) {
      await stopForCaptcha("集碎片领超级会员");
      return "captcha";
    }

    const resultModal = await waitFor(visibleModal, 2500);
    if (resultModal) {
      await log(`集碎片领取结果：${elementText(resultModal).slice(0, 160)}`, "success");
      await closeModal(resultModal);
    }

    const receivedImage = await waitFor(() => {
      const refreshedFinal = document.querySelector(
        ".fragment-collect .final-sign"
      );
      const image = refreshedFinal?.querySelector(".final-image");
      return isVisible(image) ? image : null;
    }, 5000, 200);
    if (receivedImage) {
      await log("集碎片 1 天超级会员领取成功。", "success");
      return "success";
    }

    await log("已提交集碎片奖励领取，页面稍后刷新到账状态。");
    return "submitted";
  }

  function lotteryRemaining() {
    const root = document.querySelector(".slide-lottery-v2");
    if (!root) {
      return null;
    }
    const match = elementText(root).match(/剩余\s*(\d+)\s*次/);
    return match ? Number(match[1]) : null;
  }

  async function runLottery() {
    const root = document.querySelector(".slide-lottery-v2");
    if (!root) {
      await log("未找到天天抽奖模块。", "warning");
      return;
    }

    let remaining = lotteryRemaining();
    if (remaining == null) {
      await log("无法读取天天抽奖剩余次数。", "warning");
      return;
    }

    while (remaining > 0) {
      if (detectCaptcha()) {
        await stopForCaptcha("天天抽奖");
        return false;
      }

      const button = visibleElements(".lottery-btn.total-lottery-btn", root)[0];
      if (!button) {
        await log("抽奖按钮暂不可用。", "warning");
        return;
      }

      await log(`天天抽奖：剩余 ${remaining} 次，开始抽奖...`);
      button.click();
      await sleep(850);

      if (detectCaptcha()) {
        await stopForCaptcha("天天抽奖");
        return false;
      }

      const modal = await waitFor(visibleModal, 4500);
      if (modal) {
        const result = elementText(modal);
        await log(`抽奖结果：${result.slice(0, 180)}`, "success");
        await closeModal(modal);
      }

      await sleep(1100);
      const nextRemaining = lotteryRemaining();
      if (nextRemaining == null) {
        await log("抽奖后无法读取剩余次数，已停止。", "warning");
        return false;
      }
      if (nextRemaining >= remaining) {
        await log(
          "抽奖次数未变化，可能触发了风控或安全验证，已停止继续尝试。",
          "attention"
        );
        await notify(
          "WPS 抽奖可能需要安全验证",
          "剩余次数没有变化。请查看页面是否出现滑块验证，完成后手动点“立即执行”。",
          true
        );
        return false;
      }

      remaining = nextRemaining;
    }

    await log("天天抽奖次数已用完。", "success");
    return true;
  }

  async function attemptHotCard(index, label) {
    const root = document.querySelector(".privilege-select-box");
    if (!root) {
      return "missing";
    }

    const card = root.querySelectorAll(".select-box")[index];
    if (!card) {
      return "missing";
    }

    const button = card.querySelector(".btn");
    if (!button || !isVisible(button)) {
      return "missing";
    }

    const actionText = elementText(button);
    if (/已抢光/.test(actionText)) {
      await log(`${label}：已抢光。`);
      return "soldout";
    }
    if (/去查看|已领取/.test(actionText)) {
      await log(`${label}：今天已经领取过。`);
      return "already";
    }
    if (!/立即领取|选它/.test(actionText)) {
      await log(`${label}：按钮状态为“${actionText}”，暂不领取。`);
      return "not-ready";
    }

    await log(`正在抢 ${label}...`);
    button.click();
    await sleep(350);

    if (detectCaptcha()) {
      return await stopForCaptcha(label);
    }

    let modal = await waitFor(visibleModal, 2200);
    if (!modal) {
      await log(`${label}：未弹出确认框，可能已被抢光。`, "warning");
      return "no-dialog";
    }

    const confirmText = elementText(modal);
    if (!/确认选它|确认领取|每天仅可领取一个/.test(confirmText)) {
      const resultText = confirmText;
      await closeModal(modal);
      if (/领取成功/.test(resultText)) {
        return "success";
      }
      if (/已经领过/.test(resultText)) {
        return "already";
      }
      if (/抢光/.test(resultText)) {
        return "soldout";
      }
      return "failed";
    }

    const confirmButton = modalConfirmButton(modal);
    if (!confirmButton) {
      await log(`${label}：未找到确认领取按钮。`, "error");
      await closeModal(modal);
      return "failed";
    }

    confirmButton.click();
    await sleep(1000);

    if (detectCaptcha()) {
      return await stopForCaptcha(label);
    }

    modal = await waitFor(visibleModal, 3500);
    if (modal) {
      const resultText = elementText(modal);
      await log(`${label}结果：${resultText.slice(0, 180)}`, "success");
      await closeModal(modal);
      if (/领取成功|获得/.test(resultText)) {
        return "success";
      }
      if (/已经领过|已领/.test(resultText)) {
        return "already";
      }
      if (/抢光/.test(resultText)) {
        return "soldout";
      }
      return "failed";
    }

    await sleep(800);
    const currentButton = document
      .querySelectorAll(".privilege-select-box .select-box")[index]
      ?.querySelector(".btn");
    const currentText = elementText(currentButton);
    if (/已抢光/.test(currentText)) {
      await log(`${label}：页面已显示抢光。`, "warning");
      return "soldout";
    }
    if (/去查看|已领取/.test(currentText)) {
      await log(`${label}：页面已显示领取成功。`, "success");
      return "success";
    }

    await log(`${label}：未读取到明确结果。`, "warning");
    return "unknown";
  }

  function hotCardButtonText(index) {
    return elementText(
      document
        .querySelectorAll(".privilege-select-box .select-box")
        [index]?.querySelector(".btn")
    );
  }

  async function reloadForHotRetry(message) {
    await log(message, "warning");
    await sleep(180);
    location.reload();
    return "reloading";
  }

  async function runHotRetryFlow(pending = {}) {
    let stage = pending.stage === "points" ? "points" : "member";
    let memberRefreshes = Math.max(0, Number(pending.memberRefreshes) || 0);
    let pointsRefreshes = Math.max(0, Number(pending.pointsRefreshes) || 0);
    let sevenDayPreAttempted = Boolean(pending.sevenDayPreAttempted);

    await waitFor(() => document.readyState === "complete", 15000, 200);
    await waitFor(
      () => document.querySelectorAll(".privilege-select-box .select-box").length >= 2,
      15000
    );
    await sleep(700);

    const now = new Date();
    const ten = new Date(now);
    ten.setHours(10, 0, 0, 300);
    if (now < ten) {
      await sleep(ten.getTime() - now.getTime());
    }

    if (detectCaptcha()) {
      return await stopForCaptcha("10:00 限量福利");
    }

    if (!sevenDayPreAttempted) {
      await attemptSevenDayBeforeHot();
      if (detectCaptcha()) {
        return await stopForCaptcha("7 天会员卡抢先领取");
      }

      sevenDayPreAttempted = true;
      await sendMessage({
        type: "hot-pending-update",
        patch: {
          stage,
          memberRefreshes,
          pointsRefreshes,
          sevenDayPreAttempted
        }
      });
      await log("7 天会员卡抢先尝试结束，开始领取 10:00 限量爆款。");
    }

    if (stage === "member") {
      await log(
        `10:00 限量福利：WPS 大会员第 ${memberRefreshes + 1} 次尝试，已刷新 ${memberRefreshes}/${HOT_REFRESH_LIMIT} 次。`
      );
      const memberResult = await attemptHotCard(0, "WPS 大会员 1 天");

      if (memberResult === "success" || memberResult === "already") {
        await sendMessage({ type: "hot-pending-clear" });
        await log("WPS 大会员限量福利已领取，不再领取积分。", "success");
        return memberResult;
      }
      if (memberResult === "captcha") {
        return memberResult;
      }

      if (memberRefreshes < HOT_REFRESH_LIMIT) {
        memberRefreshes += 1;
        await sendMessage({
          type: "hot-pending-update",
          patch: {
            stage: "member",
            memberRefreshes,
            pointsRefreshes: 0
          }
        });
        return reloadForHotRetry(
          `WPS 大会员未抢到，正在第 ${memberRefreshes}/${HOT_REFRESH_LIMIT} 次刷新重试。`
        );
      }

      await sendMessage({
        type: "hot-pending-update",
        patch: {
          stage: "points",
          memberRefreshes,
          pointsRefreshes: 0
        }
      });
      return reloadForHotRetry(
        `WPS 大会员已刷新 ${HOT_REFRESH_LIMIT} 次仍未抢到，切换到 WPS 积分。`
      );
    }

    if (/去查看|已领取/.test(hotCardButtonText(0))) {
      await sendMessage({ type: "hot-pending-clear" });
      await log("检测到 WPS 大会员今天已经领取，停止领取积分。", "success");
      return "already";
    }

    await log(
      `10:00 限量福利：WPS 积分第 ${pointsRefreshes + 1} 次尝试，已刷新 ${pointsRefreshes}/${HOT_REFRESH_LIMIT} 次。`
    );
    const pointsResult = await attemptHotCard(1, "WPS 积分 2 分");

    if (pointsResult === "success" || pointsResult === "already") {
      await sendMessage({ type: "hot-pending-clear" });
      await log("WPS 积分限量福利已领取。", "success");
      return pointsResult;
    }
    if (pointsResult === "captcha") {
      return pointsResult;
    }

    if (pointsRefreshes < HOT_REFRESH_LIMIT) {
      pointsRefreshes += 1;
      await sendMessage({
        type: "hot-pending-update",
        patch: {
          stage: "points",
          memberRefreshes,
          pointsRefreshes
        }
      });
      return reloadForHotRetry(
        `WPS 积分未抢到，正在第 ${pointsRefreshes}/${HOT_REFRESH_LIMIT} 次刷新重试。`
      );
    }

    await sendMessage({ type: "hot-pending-clear" });
    await log(
      "大会员和积分各刷新 5 次仍未领取成功；不会自动选择第三张优惠券。",
      "warning"
    );
    return "failed";
  }

  async function runBenefitsRoutine(options = {}) {
    if (state.running) {
      return;
    }

    const claim = await sendMessage({
      type: "routine-claim",
      force: Boolean(options.force)
    });
    if (claim?.claimed) {
      await log("今天已经完成过自动任务；需要重跑请点扩展里的“立即执行”。");
      return;
    }

    state.running = true;
    state.attentionNeeded = false;

    try {
      await closeModal();
      if (detectCaptcha()) {
        await stopForCaptcha("福利中心任务");
        return;
      }

      await runMemberTrial();
      await sleep(700);
      await runFragmentCheckIn();
      await sleep(500);
      await runFragmentFinalPrize();
      await sleep(700);
      const lotteryCompleted = await runLottery();
      if (lotteryCompleted && !state.attentionNeeded) {
        await log("福利中心今日自动任务已执行完毕。", "success");
        await notify(
          "WPS 福利助手执行完成",
          "今日签到、会员领取、打卡与抽奖已按页面状态处理。",
          false
        );
      } else {
        await sendMessage({ type: "routine-release" });
      }
    } catch (error) {
      await sendMessage({ type: "routine-release" });
      await log(`福利中心任务失败：${error.message || error}`, "error");
    } finally {
      state.running = false;
    }
  }

  async function scheduleHotReload() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(9, 59, 56, 200);

    let delay = target.getTime() - now.getTime();
    if (delay < 0 && now.getHours() === 10 && now.getMinutes() < 2) {
      delay = 0;
    }

    if (delay < 0 || delay > 45_000) {
      await log("已收到 10:00 预热指令，等待下一次定时窗口。");
      return;
    }

    await log(
      `已进入 10:00 预热，将在 ${Math.max(0, Math.round(delay / 1000))} 秒后刷新页面并抢福利。`
    );
    setTimeout(async () => {
      if (state.hotReloading) {
        return;
      }
      state.hotReloading = true;
      await sendMessage({
        type: "hot-pending-set",
        state: {
          stage: "member",
          memberRefreshes: 0,
          pointsRefreshes: 0,
          sevenDayPreAttempted: false
        }
      });
      location.reload();
    }, delay);
  }

  async function initializeBenefitsPage() {
    const pendingResponse = await sendMessage({ type: "hot-pending-get" });
    const hotPending = pendingResponse?.pending || null;

    if (hotPending) {
      setStatus("10 点限量领取", "attention");
      await sleep(250);
      const hotResult = await runHotRetryFlow(hotPending);
      if (hotResult === "reloading" || hotResult === "captcha") {
        return;
      }

      await log("限量爆款流程已结束，返回检查 7 天会员卡并重试 5 次。");
      const afterHot = new Date();
      const routineAt = new Date(afterHot);
      routineAt.setHours(10, 0, 5, 0);
      if (afterHot < routineAt) {
        await sleep(routineAt.getTime() - afterHot.getTime());
      }
      await runBenefitsRoutine();
      return;
    }

    const now = new Date();
    if (now.getHours() >= 10) {
      await sleep(1200);
      await runBenefitsRoutine();
    } else {
      await log("福利中心已就绪，等待 10:00 自动任务或手动“立即执行”。");
    }
  }

  async function initialize() {
    if (!PAGE_TYPE) {
      return;
    }

    ensureOverlay();
    await hydrateOverlayLogs();
    if (PAGE_TYPE === "task") {
      await sleep(1800);
      await runTaskSignIn();
      return;
    }

    await initializeBenefitsPage();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message?.type === "prepare-hot") {
        await scheduleHotReload();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "run-task-now") {
        await runTaskSignIn();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "run-all-now") {
        await closeModal();
        if (new Date().getHours() >= 10) {
          const pendingResponse = await sendMessage({ type: "hot-pending-get" });
          const hotState = pendingResponse?.pending || {
            stage: "member",
            memberRefreshes: 0,
            pointsRefreshes: 0,
            sevenDayPreAttempted: false
          };
          if (!pendingResponse?.pending) {
            await sendMessage({ type: "hot-pending-set", state: hotState });
          }
          const hotResult = await runHotRetryFlow(hotState);
          if (hotResult === "reloading" || hotResult === "captcha") {
            sendResponse({ ok: true, hotResult });
            return;
          }
        }
        await runBenefitsRoutine({ force: true });
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, reason: "unknown-message" });
    })().catch(async (error) => {
      await log(`扩展消息执行失败：${error.message || error}`, "error");
      sendResponse({ ok: false, error: String(error?.message || error) });
    });

    return true;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
