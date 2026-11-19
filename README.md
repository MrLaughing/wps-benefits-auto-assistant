# WPS Benefits Auto Assistant

A Chromium/Edge Manifest V3 extension that automates daily check-ins and benefit claims on the pages you are already signed into. It only clicks visible page controls: it does not read cookies, passwords, browsing history, or browser profile data, and it does not bypass CAPTCHA or anti-bot controls.

> This project is provided for personal automation on accounts and sites you are authorized to use. Activity pages and reward rules can change at any time; the author is not responsible for lost rewards, account restrictions, or site changes.

## Features

- Opens the WPS task center, WPS benefits center, and `iamtxt.com` daily at 09:49.
- Clicks the WPS task-center sign-in button and retries if the page has not finished binding its events.
- Handles WPS benefits check-in, fragment rewards, free member trials, and the remaining daily lottery draws.
- At 10:00, runs the limited-benefit flow:
  - tries the 7-day member reward once;
  - claims the WPS 1-day membership first, with five refresh retries;
  - then claims the 2-point WPS reward, with five refresh retries;
  - returns to the 7-day member reward for up to five more tries if it still shows “立刻领取”;
  - never chooses the paid coupon.
- Signs in on `iamtxt.com`, skips when logged out, and records the result in the extension log.
- Pauses on security verification and sends a notification; it never attempts to solve a CAPTCHA.
- Keeps seven days of local logs with full date and time.

## Install from source

1. Download the repository ZIP and extract it to a permanent folder.
2. Open `edge://extensions/` or `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension` folder.
5. Pin **WPS Benefits Auto Assistant** from the extension menu.
6. Open the extension, click **打开三个页面**, and make sure both WPS sites and `iamtxt.com` show your normal logged-in state.
7. Click **立即执行** once to verify the controls.

The release ZIP named `wps-benefits-auto-assistant-v1.0.8.zip` can also be used: extract it first, then load the extracted folder as an unpacked extension.

## Optional Windows startup task

The extension's alarm can run only while the browser is open. On Windows, the included PowerShell script can launch Edge before the daily tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\安装定时任务.ps1
```

It creates a daily 09:48 task that opens the three public URLs in the default Edge profile. It does not copy or export browser data. Remove it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\卸载定时任务.ps1
```

## Daily schedule

- `09:48` — optional Windows task launches Edge.
- `09:49` — extension opens all three pages and runs ordinary check-ins.
- `09:59:56` — extension prepares and reloads the WPS benefits page.
- `10:00` — limited rewards and the return visit to the 7-day member card.

Keep the computer awake and the browser open. The WPS activity must show that you are logged in. Rewards are first come, first served, so automation cannot guarantee a successful claim.

## Privacy and permissions

The extension requests `alarms`, `tabs`, `storage`, and `notifications`, plus host permissions for the WPS activity domain and `iamtxt.com`. These are used to open pages, exchange messages with its own content scripts, remember daily state and logs, and show notifications.

No analytics, remote configuration, external API calls, credential capture, or account identifiers are included in the source.

## Troubleshooting

- **Nothing happens at 10:00**: confirm the browser was open before 09:49, the extension switch is enabled, and the WPS pages remain logged in.
- **Security verification appears**: complete it manually, then click **立即执行**.
- **Button state says 待开奖**: the draw has not opened yet; wait for the scheduled 10:00 run.
- **A site says 活动太火爆了**: the automated retries were not enough; check the page manually.
- **Extension stops after an update**: in `edge://extensions/`, click **重新加载**, then refresh the activity pages.

## Repository layout

- `extension/` — unpacked Chromium/Edge extension source.
- `releases/` — release ZIP for version 1.0.8.
- `README.md` — this document.
