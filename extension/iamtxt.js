(() => {
  "use strict";

  const state = {
    running: false
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  async function log(message, level = "info") {
    const text = normalizeText(message);
    console.log("[iamtxt assistant]", text);
    await sendMessage({
      type: "log",
      entry: { level, message: text },
      clearBadge: level === "success"
    });
  }

  async function notify(title, message, requireAttention = false) {
    await sendMessage({
      type: "notify",
      title,
      message,
      requireAttention
    });
  }

  async function waitFor(getter, timeoutMs = 10000, intervalMs = 200) {
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

  function loginRequired() {
    const userLink = document.querySelector(".system a.user");
    if (!userLink) {
      return false;
    }
    const text = normalizeText(userLink.textContent);
    return /^(登录|登陆)$/.test(text) || userLink.href.includes("/e/member/login/log.html");
  }

  function layerMessage() {
    const nodes = document.querySelectorAll(
      ".layui-layer-content, .layui-layer-msg, .layui-layer"
    );
    const messages = [];
    for (const node of nodes) {
      const text = normalizeText(node.innerText || node.textContent);
      if (text && !messages.includes(text)) {
        messages.push(text);
      }
    }
    return messages.join("\n");
  }

  async function markClaimed() {
    await chrome.storage.local.set({ iamtxtDate: localDateKey() });
  }

  async function runCheckIn(options = {}) {
    if (state.running) {
      return { ok: false, result: "running" };
    }

    state.running = true;
    try {
      if (!location.hostname.endsWith("iamtxt.com")) {
        return { ok: false, result: "wrong-page" };
      }

      if (loginRequired() || location.pathname.includes("/e/member/login/")) {
        const message = "iamtxt 尚未登录，已跳过签到；请在 Edge 中手动登录后再点“立即执行”。";
        await log(message, "warning");
        await notify("iamtxt 签到需要登录", message, true);
        return { ok: false, result: "login-required" };
      }

      const signButton = await waitFor(() => document.querySelector("#signin"));
      if (!signButton) {
        await log("iamtxt 页面没有找到“签到”按钮，已跳过。", "warning");
        return { ok: false, result: "missing-button" };
      }

      const data = await chrome.storage.local.get({ iamtxtDate: "" });
      if (!options.force && data.iamtxtDate === localDateKey()) {
        await log("iamtxt 今天已经签到，跳过重复点击。");
        return { ok: true, result: "already-done" };
      }

      signButton.click();
      await sleep(500);

      const result = await waitFor(() => {
        if (loginRequired() || location.pathname.includes("/e/member/login/")) {
          return { login: true, text: "" };
        }
        const text = layerMessage();
        return text ? { login: false, text } : null;
      }, 9000);

      if (!result) {
        const message = "iamtxt 签到后未检测到结果，请打开 iamtxt 页面确认。";
        await log(message, "warning");
        await notify("iamtxt 签到结果未知", message, true);
        return { ok: false, result: "unknown" };
      }

      if (result.login || /nologin/i.test(result.text)) {
        const message = "iamtxt 登录状态已失效，签到未完成；请手动登录后再点“立即执行”。";
        await log(message, "warning");
        await notify("iamtxt 签到需要登录", message, true);
        return { ok: false, result: "login-required" };
      }

      if (/已经签|签过|已签到/.test(result.text)) {
        await markClaimed();
        await log("iamtxt 今天已经签到过了。", "success");
        return { ok: true, result: "already" };
      }

      if (/失败|错误|异常|error/i.test(result.text)) {
        await log(`iamtxt 签到失败：${result.text}`, "error");
        await notify("iamtxt 签到失败", result.text, true);
        return { ok: false, result: "failed" };
      }

      await markClaimed();
      await log(`iamtxt 签到完成：${result.text}`, "success");
      return { ok: true, result: "success" };
    } catch (error) {
      const message = `iamtxt 签到执行失败：${error.message || error}`;
      await log(message, "error");
      await notify("iamtxt 签到执行失败", message, true);
      return { ok: false, result: "error" };
    } finally {
      state.running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "run-iamtxt-now") {
      return false;
    }

    runCheckIn({ force: Boolean(message.force) })
      .then((result) => sendResponse({ ok: result.ok, result: result.result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
