const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const togglePreviewBtn = document.getElementById("togglePreviewBtn");
const camera = document.getElementById("camera");
const detectionCanvas = document.getElementById("detectionCanvas");
const placeholder = document.getElementById("placeholder");
const cameraLoading = document.getElementById("cameraLoading");
const cameraLoadingText = document.getElementById("cameraLoadingText");
const cameraOverlay = document.getElementById("cameraOverlay");
const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const monitorStrip = document.getElementById("monitorStrip");
const previewState = document.getElementById("previewState");
const currentStatus = document.getElementById("currentStatus");
const currentStatusCard = currentStatus ? currentStatus.closest(".mini-card") : null;
const sessionTime = document.getElementById("sessionTime");
const totalScreenTime = document.getElementById("totalScreenTime");
const reminderText = document.getElementById("reminderText");
const cameraAccess = document.getElementById("cameraAccess");
const distanceState = document.getElementById("distanceState");
const toastContainer = document.getElementById("toastContainer");
const infoToggleBtn = document.getElementById("infoToggleBtn");
const infoCloseBtn = document.getElementById("infoCloseBtn");
const infoDrawer = document.getElementById("infoDrawer");
const infoBackdrop = document.getElementById("infoBackdrop");

// Backend endpoints used by AiCare.
const BACKEND_BASE_URL = "http://127.0.0.1:5000";
const NATIVE_NOTIFY_URL = `${BACKEND_BASE_URL}/notify`;
const AICARE_APP_URL = "http://127.0.0.1:5500/frontend/aicare_ui_split_3files.html";
const AICARE_NOTIFICATION_OPEN_URL = `${AICARE_APP_URL}?fromNotification=1`;


// Notification click helper for VS Code Live Server.
// Windows opens a URL from the notification. Because the current AiCare page is
// usually running at http://127.0.0.1:5500/frontend/..., the notification must
// launch that exact same origin so this tab can communicate with the new one.
const AICARE_TAB_ID = sessionStorage.getItem("aicare_tab_id") || `${Date.now()}-${Math.random()}`;
sessionStorage.setItem("aicare_tab_id", AICARE_TAB_ID);

function markAiCareTabAlive() {
  try {
    localStorage.setItem("aicare_last_seen", String(Date.now()));
    localStorage.setItem("aicare_last_tab_id", AICARE_TAB_ID);
  } catch (error) {}
}

function focusAiCareTabFromNotification() {
  try { window.focus(); } catch (error) {}
  const originalTitle = document.title;
  document.title = "AiCare is already open";
  setTimeout(() => {
    document.title = originalTitle || "AiCare UI Mockup";
  }, 1600);
}

function handleNotificationLaunchDuplicate() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("fromNotification")) return false;

  let appLooksOpen = false;
  try {
    const lastSeen = Number(localStorage.getItem("aicare_last_seen") || 0);
    const lastTabId = localStorage.getItem("aicare_last_tab_id") || "";
    appLooksOpen = Date.now() - lastSeen < 8000 && lastTabId && lastTabId !== AICARE_TAB_ID;

    localStorage.setItem("aicare_open_request", String(Date.now()));
  } catch (error) {}

  try {
    const channel = new BroadcastChannel("aicare_focus_channel");
    channel.postMessage({ type: "OPEN_EXISTING_AICARE", time: Date.now(), source: AICARE_TAB_ID });
    setTimeout(() => channel.close(), 500);
  } catch (error) {}

  if (appLooksOpen) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = `
        <div style="min-height:100vh;display:grid;place-items:center;font-family:Segoe UI,Arial,sans-serif;background:linear-gradient(135deg,#bfded9,#bdddf2);color:#102833;">
          <div style="width:min(420px,calc(100vw - 32px));padding:24px;border-radius:24px;background:rgba(237,249,250,.92);border:1px solid rgba(16,40,51,.14);box-shadow:0 20px 60px rgba(31,143,255,.18);text-align:center;">
            <h1 style="margin:0 0 8px;font-size:1.25rem;">AiCare is already open</h1>
            <p style="margin:0;color:#486777;line-height:1.5;">Please return to the existing AiCare tab. This temporary tab will close if your browser allows it.</p>
          </div>
        </div>`;
    });

    setTimeout(() => {
      try { window.close(); } catch (error) {}
    }, 650);

    return true;
  }

  // If no existing AiCare tab is detected, clean the URL and keep this tab as the app.
  try {
    history.replaceState(null, "", AICARE_APP_URL);
  } catch (error) {}
  return false;
}

const IS_NOTIFICATION_DUPLICATE_LAUNCH = handleNotificationLaunchDuplicate();


markAiCareTabAlive();
setInterval(markAiCareTabAlive, 2000);

try {
  const focusChannel = new BroadcastChannel("aicare_focus_channel");
  focusChannel.addEventListener("message", event => {
    if (event.data && event.data.type === "OPEN_EXISTING_AICARE" && event.data.source !== AICARE_TAB_ID) {
      focusAiCareTabFromNotification();
    }
  });
} catch (error) {}

window.addEventListener("storage", event => {
  if (event.key === "aicare_open_request") {
    focusAiCareTabFromNotification();
  }
});

// AiCare native notification fix v2.
// Feature update: safe-distance notification + 20-second break countdown/completion notification.
// Native-only setting: alerts are sent to Flask/winotify instead of showing browser popups.
const USE_NATIVE_WINDOWS_NOTIFICATION_ONLY = true;
// Supervisor feedback update: test buttons have local fallback, and loading reminds users to press ? for tips.

// Web Audio fallback for notification sound. This works after the user clicks Start.
let alertAudioContext = null;

const add1MinBtn = document.getElementById("add1MinBtn");
const add5MinBtn = document.getElementById("add5MinBtn");
const add10MinBtn = document.getElementById("add10MinBtn");
const testCloseBtn = document.getElementById("testCloseBtn");
const testFarBtn = document.getElementById("testFarBtn");
const testErgoBtn = document.getElementById("testErgoBtn");

let stream = null;
let sessionSeconds = 0;
let faceDetectedSeconds = 0;
let totalScreenSeconds = 0;
let noFaceSeconds = 0;

let timer = null;
let predictionInterval = null;
let previewVisible = true;
let isSendingFrame = false;

let lastStatus = "Waiting";
let unsafeStatus = null;
let unsafeStartedAt = null;
let safeStartedAt = null;

let activeDistanceToastId = null;
let breakToastId = null;
let breakMode = false;
let safeNotificationPending = false;
let lastUnsafeStatusForSafeNotice = null;
let lastBoxData = null;
let lastBoxTime = 0;

const BOX_HOLD_MS = 2700; // box stays 1.5 seconds
const PREDICTION_INTERVAL_MS = 3000;
const UNSAFE_CONFIRM_SECONDS = 3;
const SAFE_CLEAR_SECONDS = 2;
const TOAST_DURATION_MS = 6500;
const BREAK_LIMIT_SECONDS = 20 * 60;
const BREAK_REQUIRED_SECONDS = 20;

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function nowMs() {
  return Date.now();
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();

  if (value.includes("close")) return "Too Close";
  if (value.includes("far")) return "Too Far";
  if (value.includes("safe")) return "Safe";
  if (value.includes("no face")) return "No face detected";

  return status || "Unknown";
}

function isUnsafeStatus(status) {
  return status === "Too Close" || status === "Too Far";
}

function isFaceDetectedStatus(status) {
  return status === "Too Close" || status === "Too Far" || status === "Safe";
}

function isKnownDetectionStatus(status) {
  return (
    status === "Too Close" ||
    status === "Too Far" ||
    status === "Safe" ||
    status === "No face detected"
  );
}

function formatConfidencePercent(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence <= 0) {
    return "";
  }

  return `${Math.round(confidence * 100)}%`;
}

function buildStatusLabel(status, confidence) {
  const percent = formatConfidencePercent(confidence);
  return percent && isFaceDetectedStatus(status) ? `${status} ${percent}` : status;
}

function updateCurrentStatusStyle(status) {
  if (!currentStatusCard) return;

  currentStatusCard.classList.remove(
    "safe",
    "warning",
    "info",
    "status-safe",
    "status-close",
    "status-far",
    "status-neutral"
  );

  if (status === "Too Close") {
    currentStatusCard.classList.add("status-close");
  } else if (status === "Too Far") {
    currentStatusCard.classList.add("status-far");
  } else if (status === "Safe") {
    currentStatusCard.classList.add("status-safe");
  } else {
    currentStatusCard.classList.add("status-neutral");
  }
}

function setCameraAccessStatus(value) {
  if (!cameraAccess) return;

  cameraAccess.textContent = value;
  cameraAccess.classList.remove("access-granted", "access-not-granted");

  const normalized = String(value || "").toLowerCase();
  if (normalized === "granted") {
    cameraAccess.classList.add("access-granted");
  } else {
    cameraAccess.classList.add("access-not-granted");
  }
}

function updateTotalScreenTimeUI() {
  if (totalScreenTime) totalScreenTime.textContent = formatTime(totalScreenSeconds);
}

function startSessionClock() {
  stopSessionClock();

  timer = setInterval(() => {
    sessionSeconds += 1;

    if (isFaceDetectedStatus(lastStatus)) {
      faceDetectedSeconds += 1;
      totalScreenSeconds += 1;
      noFaceSeconds = 0;
    } else {
      noFaceSeconds += 1;
    }

    sessionTime.textContent = formatTime(faceDetectedSeconds);
    updateTotalScreenTimeUI();

    handleDistanceNotificationTiming();
    handleErgonomicTiming();
  }, 1000);
}

function stopSessionClock() {
  if (timer) clearInterval(timer);
  timer = null;
}


function showCameraLoading(message = "Starting camera preview...", mode = "solid") {
  if (cameraLoadingText) cameraLoadingText.textContent = message;

  if (cameraLoading) {
    cameraLoading.style.display = "flex";
    cameraLoading.classList.toggle("monitoring", mode === "monitoring");
  }

  if (placeholder) placeholder.style.display = "none";
  if (cameraOverlay) cameraOverlay.style.display = "none";

  // Solid loading is used before webcam permission/preview is ready.
  // Monitoring loading keeps the camera visible behind a lighter overlay
  // while AiCare is waiting for a valid model status or backend response.
  if (camera) {
    if (mode === "monitoring" && stream && previewVisible) {
      camera.style.display = "block";
    } else {
      camera.style.display = "none";
    }
  }

  clearDetectionBox();
}

function hideCameraLoading() {
  if (cameraLoading) {
    cameraLoading.style.display = "none";
    cameraLoading.classList.remove("monitoring");
  }
}

function resetCameraPlaceholder() {
  if (!placeholder) return;

  placeholder.innerHTML = `
    <div class="placeholder-icon">📷</div>
    <h2>Camera standby</h2>
    <p>Once started, the webcam preview will appear here!</p>
  `;
}

function waitForCameraReady(timeoutMs = 900) {
  return new Promise(resolve => {
    let done = false;
    let timeoutId = null;

    const finish = () => {
      if (done) return;
      done = true;
      camera.removeEventListener("loadedmetadata", finish);
      camera.removeEventListener("playing", finish);
      if (timeoutId) clearTimeout(timeoutId);
      resolve();
    };

    if (!camera || camera.readyState >= 2) {
      finish();
      return;
    }

    camera.addEventListener("loadedmetadata", finish, { once: true });
    camera.addEventListener("playing", finish, { once: true });
    timeoutId = setTimeout(finish, timeoutMs);

    if (camera.play) {
      camera.play().catch(() => {});
    }
  });
}

function requestBrowserNotificationPermission() {
  // Disabled on purpose. AiCare now uses Python/winotify for real Windows notifications.
  // This prevents browser permission popups and browser-based notifications.
  return false;
}

function browserNotify(title, body) {
  // Disabled on purpose. Real Windows notification is handled by Flask /notify.
  return false;
}

function unlockAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!alertAudioContext) {
      alertAudioContext = new AudioContext();
    }

    if (alertAudioContext.state === "suspended") {
      alertAudioContext.resume().catch(() => {});
    }
  } catch (error) {
    console.warn("Alert sound could not be unlocked:", error);
  }
}

function playAlertSound(type = "info") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!alertAudioContext) {
      alertAudioContext = new AudioContext();
    }

    if (alertAudioContext.state === "suspended") {
      alertAudioContext.resume().catch(() => {});
    }

    const frequencyMap = {
      close: 880,
      far: 660,
      ergo: 523,
      safe: 440,
      info: 587
    };

    const currentTime = alertAudioContext.currentTime;
    const oscillator = alertAudioContext.createOscillator();
    const gain = alertAudioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequencyMap[type] || frequencyMap.info, currentTime);

    gain.gain.setValueAtTime(0.0001, currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.34);

    oscillator.connect(gain);
    gain.connect(alertAudioContext.destination);

    oscillator.start(currentTime);
    oscillator.stop(currentTime + 0.36);
  } catch (error) {
    console.warn("Alert sound failed:", error);
  }
}

function getLocalNotificationIcon(type) {
  const iconMap = {
    close: "⚠️",
    far: "↔️",
    ergo: "👀",
    safe: "✅",
    break_complete: "✅",
    info: "ℹ️"
  };
  return iconMap[type] || "🔔";
}

function showLocalNotification(type, title, message, options = {}) {
  if (!toastContainer) return null;

  const id = options.id || `local-${type}-${Date.now()}`;
  const duration = options.duration || TOAST_DURATION_MS;

  const toast = document.createElement("div");
  toast.className = `local-alert local-alert-type-${type}`;
  toast.dataset.toastId = id;

  toast.innerHTML = `
    <div class="local-alert-icon">${getLocalNotificationIcon(type)}</div>
    <div class="local-alert-content">
      <strong>${title}</strong>
      <span>${message}</span>
      <small>Local preview shown because Windows notification is unavailable.</small>
    </div>
    <button class="local-alert-close" type="button" aria-label="Close notification">×</button>
  `;

  const close = () => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 220);
  };

  toast.querySelector(".local-alert-close")?.addEventListener("click", close);
  toastContainer.appendChild(toast);

  if (options.playSound) {
    playAlertSound(type);
  }

  if (duration > 0) {
    setTimeout(close, duration);
  }

  return id;
}

function sendNativeNotification(type, title, message, options = {}) {
  if (options.native === false) {
    if (options.localFallback) {
      showLocalNotification(type, title, message, {
        ...options,
        playSound: options.playSound ?? (type === "close" || type === "far")
      });
    }
    return Promise.resolve(false);
  }

  const isUnsafeAlert = type === "close" || type === "far";

  return fetch(NATIVE_NOTIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type,
      title,
      message,
      // "short" uses the normal Windows short banner time, usually around 6-7 seconds.
      duration: options.nativeDuration || "short",
      // "custom" now means: normal Windows banner + AiCare's own chime from Python.
      sound: options.nativeSound || (isUnsafeAlert ? "custom" : "default"),
      play_sound: options.playSound ?? isUnsafeAlert,
      launch_url: options.launchUrl || AICARE_NOTIFICATION_OPEN_URL
    })
  })
    .then(response => {
      if (!response.ok) throw new Error(`Native notification endpoint returned ${response.status}`);
      return response.json();
    })
    .then(result => {
      console.log("AiCare native notification:", result);

      if (result && result.ok === false && options.localFallback) {
        showLocalNotification(type, title, message, {
          ...options,
          playSound: options.playSound ?? isUnsafeAlert
        });
      }

      return true;
    })
    .catch(error => {
      console.warn("Native Windows notification failed:", error);

      // This allows User Settings demo buttons to still show something even
      // when python app.py is not running. Real Windows notifications still
      // require Flask/winotify, but the local preview is useful for demo UI.
      if (options.localFallback) {
        showLocalNotification(type, title, message, {
          ...options,
          playSound: options.playSound ?? isUnsafeAlert
        });
      }

      return false;
    });
}

function showToast(type, title, message, options = {}) {
  // This function name is kept so the rest of the code does not need major changes.
  // It sends a real Windows notification through Flask/winotify.
  // If Flask is not running, it falls back to a local in-page demo preview.
  const id = options.id || `${type}-${Date.now()}`;

  const shouldSendNative =
    type === "close" ||
    type === "far" ||
    type === "ergo" ||
    type === "safe" ||
    type === "break_complete" ||
    options.native === true;

  if (shouldSendNative) {
    sendNativeNotification(type, title, message, {
      localFallback: true,
      ...options
    });
  } else {
    showLocalNotification(type, title, message, {
      ...options,
      localFallback: false,
      playSound: options.playSound ?? false
    });
  }

  // Optional browser-generated fallback sound if Python sound is unavailable.
  if (options.fallbackSound === true && type !== "info") {
    playAlertSound(type);
  }

  return id;
}

function hideToast(id) {
  // No custom browser toast exists anymore, so there is nothing to hide.
  return;
}

function hideDistanceWarning() {
  if (activeDistanceToastId) {
    hideToast(activeDistanceToastId);
    activeDistanceToastId = null;
  }
}

function showSafeDistanceNotification() {
  if (!safeNotificationPending) return;

  const previousUnsafe = lastUnsafeStatusForSafeNotice || "unsafe distance";

  showToast(
    "safe",
    "Safe Distance Restored",
    `Good job. You are now back at a safe distance after ${previousUnsafe}.`,
    {
      id: `safe-distance-${Date.now()}`,
      native: true,
      nativeDuration: "short",
      nativeSound: "default",
      playSound: false
    }
  );

  safeNotificationPending = false;
  lastUnsafeStatusForSafeNotice = null;
}

function updateBreakCountdownUI() {
  if (!breakMode) return;

  const remaining = Math.max(BREAK_REQUIRED_SECONDS - noFaceSeconds, 0);

  if (noFaceSeconds <= 0) {
    reminderText.textContent = "Look away for 20 seconds to start the break countdown";
    return;
  }

  if (remaining > 0) {
    reminderText.textContent = `20-20-20 countdown: ${remaining}s left`;
  } else {
    reminderText.textContent = "20-20-20 countdown: 0s left";
  }
}

function handleDistanceNotificationTiming() {
  const status = lastStatus;
  const currentTime = nowMs();

  // Do not show distance-restored notification while the user is in break mode.
  if (breakMode) return;

  if (isUnsafeStatus(status)) {
    safeStartedAt = null;

    if (unsafeStatus !== status) {
      unsafeStatus = status;
      unsafeStartedAt = currentTime;
      clearDetectionBox();
      hideDistanceWarning();
      return;
    }

    const unsafeDuration = (currentTime - unsafeStartedAt) / 1000;

    if (unsafeDuration >= UNSAFE_CONFIRM_SECONDS && !activeDistanceToastId) {
      if (status === "Too Close") {
        activeDistanceToastId = showToast(
          "close",
          "Too Close",
          "Please move back from the screen.",
          { id: "distance-warning", nativeDuration: "short", nativeSound: "custom", playSound: true }
        );
      } else {
        activeDistanceToastId = showToast(
          "far",
          "Too Far",
          "Move slightly closer to the screen.",
          { id: "distance-warning", nativeDuration: "short", nativeSound: "custom", playSound: true }
        );
      }

      // After an unsafe alert has appeared, AiCare will notify once when the
      // user returns to a safe distance for 2 seconds.
      safeNotificationPending = true;
      lastUnsafeStatusForSafeNotice = status;
    }

    return;
  }

  unsafeStatus = null;
  unsafeStartedAt = null;

  if (status === "Safe") {
    if (!safeStartedAt) safeStartedAt = currentTime;

    const safeDuration = (currentTime - safeStartedAt) / 1000;

    if (safeDuration >= SAFE_CLEAR_SECONDS) {
      clearDetectionBox();
      hideDistanceWarning();
      showSafeDistanceNotification();
    }
  } else {
    safeStartedAt = null;
  }
}

function handleErgonomicTiming() {
  if (!breakMode && faceDetectedSeconds >= BREAK_LIMIT_SECONDS) {
    breakMode = true;
    noFaceSeconds = 0;

    breakToastId = showToast(
      "ergo",
      "20-20-20 Break Reminder",
      "You have used the screen for 20 minutes. Look away for 20 seconds.",
      { id: "ergo-warning", nativeDuration: "short", nativeSound: "reminder", playSound: false }
    );

    reminderText.textContent = "Look away for 20 seconds to start the break countdown";
    return;
  }

  if (breakMode) {
    updateBreakCountdownUI();

    if (noFaceSeconds >= BREAK_REQUIRED_SECONDS) {
      hideToast(breakToastId);
      breakToastId = null;
      breakMode = false;
      faceDetectedSeconds = 0;
      noFaceSeconds = 0;
      sessionTime.textContent = "00:00";
      safeStartedAt = null;
      unsafeStatus = null;
      unsafeStartedAt = null;
      safeNotificationPending = false;
      lastUnsafeStatusForSafeNotice = null;

      showToast(
        "break_complete",
        "20-20-20 Break Completed",
        "You have been away for 20 seconds. AiCare has reset your session timer.",
        {
          id: `break-completed-${Date.now()}`,
          native: true,
          nativeDuration: "short",
          nativeSound: "reminder",
          playSound: false
        }
      );

      reminderText.textContent = "Break completed. Session timer reset";
    }
  }
}

function updateStatusUI(status, reminder, confidence) {
  lastStatus = normalizeStatus(status);
  const statusLabel = buildStatusLabel(lastStatus, confidence);

  // If the backend returns an unexpected status, keep AiCare in loading/detecting mode.
  // Valid labels are only: Safe, Too Close, Too Far, and No face detected.
  if (!isKnownDetectionStatus(lastStatus)) {
    showCameraLoading("Waiting for AiCare detection status... Press ? for tips while waiting.", "monitoring");
    distanceState.textContent = "Distance: Detecting...";
    currentStatus.textContent = lastStatus || "Detecting";
    updateCurrentStatusStyle("No face detected");
    reminderText.textContent = reminder || "AiCare is still preparing the detection result";
    clearDetectionBox();
    return;
  }

  hideCameraLoading();
  if (previewVisible) {
    camera.style.display = "block";
    placeholder.style.display = "none";
    cameraOverlay.style.display = "flex";
  }

  distanceState.textContent = "Distance: " + lastStatus;
  currentStatus.textContent = statusLabel;
  updateCurrentStatusStyle(lastStatus);

  // During 20-20-20 break mode, keep the reminder card focused on countdown.
  if (breakMode) {
    if (lastStatus === "No face detected") {
      currentStatus.textContent = "Break countdown";
      updateCurrentStatusStyle("No face detected");
    }
    return;
  }

  if (typeof confidence === "number") {
    reminderText.textContent = `${reminder} (${formatConfidencePercent(confidence) || confidence})`;
  } else {
    reminderText.textContent = reminder;
  }

  if (lastStatus === "Too Close") {
    currentStatus.textContent = statusLabel;
    reminderText.textContent = "Please move back from the screen";
  } else if (lastStatus === "Safe") {
    currentStatus.textContent = statusLabel;
    reminderText.textContent = "Good distance detected";
  } else if (lastStatus === "Too Far") {
    currentStatus.textContent = statusLabel;
    reminderText.textContent = "Move slightly closer";
  } else {
    currentStatus.textContent = "No Face";
    updateCurrentStatusStyle("No face detected");
    reminderText.textContent = "Face not detected";
  }
}

async function startCamera() {
  try {
    unlockAlertSound();
    showCameraLoading("Starting AiCare camera... Press ? for tips while waiting.");

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    camera.srcObject = stream;
    await waitForCameraReady(900);

    // Keep a lighter loading layer while the webcam is already running,
    // until Flask/YOLO returns a valid label.
    camera.style.display = "block";
    placeholder.style.display = "none";
    cameraOverlay.style.display = "none";
    showCameraLoading("Preparing real-time distance monitoring... Press ? for tips while waiting.", "monitoring");

    statusPill.classList.add("active");
    if (stopBtn) stopBtn.classList.add("stop-live");
    statusText.textContent = "Camera active";
    monitorStrip.classList.add("active");

    setCameraAccessStatus("Granted");
    currentStatus.textContent = "Monitoring";
    updateCurrentStatusStyle("No face detected");
    reminderText.textContent = "Waiting for first AiCare label...";
    distanceState.textContent = "Distance: Detecting...";

    sessionSeconds = 0;
    faceDetectedSeconds = 0;
    totalScreenSeconds = 0;
    noFaceSeconds = 0;
    sessionTime.textContent = "00:00";
    updateTotalScreenTimeUI();
    lastStatus = "Safe";

    previewVisible = true;
    previewState.textContent = "Preview visible";
    togglePreviewBtn.textContent = "Hide Camera Preview";

    startSessionClock();
    sendFrameToBackend();

    if (!predictionInterval) {
      predictionInterval = setInterval(sendFrameToBackend, PREDICTION_INTERVAL_MS);
    }
  } catch (error) {
    console.error(error);
    hideCameraLoading();
    resetCameraPlaceholder();
    placeholder.style.display = "block";
    cameraOverlay.style.display = "none";
    camera.style.display = "none";

    if (stopBtn) stopBtn.classList.remove("stop-live");
    statusText.textContent = "Camera blocked";
    setCameraAccessStatus("Denied");
    currentStatus.textContent = "Error";
    updateCurrentStatusStyle("No face detected");
    reminderText.textContent = "Please allow webcam access";

    alert("Camera access was blocked. Please allow webcam permission.");
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  camera.srcObject = null;
  hideCameraLoading();
  resetCameraPlaceholder();
  camera.style.display = "none";
  if (detectionCanvas) detectionCanvas.style.display = "block";
  placeholder.style.display = "block";
  cameraOverlay.style.display = "none";

  statusPill.classList.remove("active");
  if (stopBtn) stopBtn.classList.remove("stop-live");
  statusText.textContent = "Camera idle";
  monitorStrip.classList.remove("active");

  currentStatus.textContent = "Waiting";
  updateCurrentStatusStyle("No face detected");
  reminderText.textContent = "No alert yet";
  setCameraAccessStatus("Not granted");

  sessionTime.textContent = "00:00";
  distanceState.textContent = "Distance: Safe";

  previewState.textContent = "Preview visible";
  togglePreviewBtn.textContent = "Hide Camera Preview";

  sessionSeconds = 0;
  faceDetectedSeconds = 0;
  totalScreenSeconds = 0;
  noFaceSeconds = 0;
  updateTotalScreenTimeUI();
  previewVisible = true;
  lastStatus = "Waiting";
  safeNotificationPending = false;
  lastUnsafeStatusForSafeNotice = null;
  unsafeStatus = null;
  unsafeStartedAt = null;
  safeStartedAt = null;

  stopSessionClock();

  if (predictionInterval) {
    clearInterval(predictionInterval);
    predictionInterval = null;
  }

  clearDetectionBox();
  hideDistanceWarning();
  hideToast(breakToastId);
  breakToastId = null;
  breakMode = false;
}

function togglePreview() {
  if (!stream) return;
  hideCameraLoading();

  previewVisible = !previewVisible;

  camera.style.display = previewVisible ? "block" : "none";
  if (detectionCanvas) detectionCanvas.style.display = previewVisible ? "block" : "none";
  if (!previewVisible) clearDetectionBox();
  placeholder.style.display = previewVisible ? "none" : "block";

  if (!previewVisible) {
    placeholder.innerHTML = `
      <div class="placeholder-icon">🟢</div>
      <h2>Monitoring still running</h2>
      <p>
        Preview is hidden, but AiCare is still running in background style mode.
      </p>
    `;
    previewState.textContent = "Preview hidden";
    togglePreviewBtn.textContent = "Show Camera Preview";
  } else {
    placeholder.innerHTML = `
      <div class="placeholder-icon">📷</div>
      <h2>Camera standby</h2>
      <p>Camera preview is visible again.</p>
    `;
    previewState.textContent = "Preview visible";
    togglePreviewBtn.textContent = "Hide Camera Preview";
  }
}

async function requestNotificationPermission() {
  // Disabled. Native notifications are handled by Python/winotify.
  return true;
}

function showWindowsNotification(title, message) {
  // Disabled. Use sendNativeNotification() instead.
  return false;
}

function clearDetectionBox() {
  if (!detectionCanvas) return;
  const ctx = detectionCanvas.getContext("2d");
  ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
}

function drawDetectionBox(data) {
  if (!previewVisible) {
    clearDetectionBox();
    return;
  }

  if (!detectionCanvas || !camera.videoWidth || !camera.videoHeight) return;

  detectionCanvas.width = camera.videoWidth;
  detectionCanvas.height = camera.videoHeight;

  const ctx = detectionCanvas.getContext("2d");
  ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);

  if (data.box && data.status !== "No face detected") {
    lastBoxData = data;
    lastBoxTime = Date.now();
  } else {
    if (lastBoxData && Date.now() - lastBoxTime < BOX_HOLD_MS) {
      data = lastBoxData;
    } else {
      return;
    }
  }

  const box = data.box;
  if (!box) return;

  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;

  // Mirror only the box x-position because camera is flipped
  const x = detectionCanvas.width - box.x2;
  const y = box.y1;

  let borderColor = "#18d39e";
  if (String(data.status).toLowerCase().includes("close")) borderColor = "#ff6b6b";
  if (String(data.status).toLowerCase().includes("far")) borderColor = "#ffd166";

  ctx.lineWidth = 4;
  ctx.strokeStyle = borderColor;
  ctx.shadowColor = borderColor;
  ctx.shadowBlur = 10;
  ctx.strokeRect(x, y, w, h);
  ctx.shadowBlur = 0;

  const confidenceText =
    typeof data.confidence === "number"
      ? ` ${(data.confidence * 100).toFixed(0)}%`
      : "";

  const label = `${normalizeStatus(data.status)}${confidenceText}`;

  ctx.font = "bold 18px Segoe UI, Arial, sans-serif";
  const textWidth = ctx.measureText(label).width;
  const labelHeight = 30;
  const labelY = Math.max(y - labelHeight, 0);

  ctx.fillStyle = "rgba(8, 16, 27, 0.88)";
  ctx.fillRect(x, labelY, textWidth + 18, labelHeight);
  ctx.fillStyle = borderColor;
  ctx.fillText(label, x + 9, labelY + 21);
}

async function sendFrameToBackend() {
  if (!stream || isSendingFrame) return;
  if (!camera.videoWidth || !camera.videoHeight) return;

  isSendingFrame = true;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(camera, 0, 0);

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );

    const formData = new FormData();
    formData.append("image", blob);

    const response = await fetch(`${BACKEND_BASE_URL}/predict`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();
    console.log(data);

    const normalizedStatus = normalizeStatus(data.status);
    updateStatusUI(data.status, data.reminder, data.confidence);

    if (isKnownDetectionStatus(normalizedStatus)) {
      drawDetectionBox(data);
    } else {
      clearDetectionBox();
    }
  } catch (error) {
    console.error("Backend connection failed:", error);
    showCameraLoading("Connecting to AiCare detection model... Press ? for tips while waiting.", "monitoring");
    distanceState.textContent = "Backend not connected";
    currentStatus.textContent = "Connection Error";
    updateCurrentStatusStyle("No face detected");
    reminderText.textContent = "Run python app.py first";
    clearDetectionBox();
  } finally {
    isSendingFrame = false;
  }
}

/* User settings / demo testing functions */
function addMinutesToFaceTimer(minutes) {
  faceDetectedSeconds += minutes * 60;
  sessionTime.textContent = formatTime(faceDetectedSeconds);

  showToast(
    "info",
    "Timer Updated",
    `${minutes} minute(s) added to the 20-20-20 timer.`,
    { id: `admin-add-${minutes}-${Date.now()}`, duration: 5000 }
  );

  handleErgonomicTiming();
}

function testNotification(type) {
  if (type === "close") {
    showToast("close", "Too Close", "Please move back from the screen.", {
      id: "admin-test-close",
      duration: TOAST_DURATION_MS,
      nativeDuration: "short",
      nativeSound: "custom",
      playSound: true
    });
  }

  if (type === "far") {
    showToast("far", "Too Far", "Move slightly closer to the screen.", {
      id: "admin-test-far",
      duration: TOAST_DURATION_MS,
      nativeDuration: "short",
      nativeSound: "custom",
      playSound: true
    });
  }

  if (type === "ergo") {
    showToast(
      "ergo",
      "20-20-20 Break Reminder",
      "You have used the screen for 20 minutes. Look away for 20 seconds.",
      { id: "admin-test-ergo", duration: TOAST_DURATION_MS, nativeDuration: "short", nativeSound: "reminder", playSound: false }
    );
  }
}

function openInfoDrawer() {
  if (!infoDrawer || !infoBackdrop) return;
  infoDrawer.classList.add("active");
  infoBackdrop.classList.add("active");
  infoDrawer.setAttribute("aria-hidden", "false");
  infoBackdrop.setAttribute("aria-hidden", "false");
}

function closeInfoDrawer() {
  if (!infoDrawer || !infoBackdrop) return;
  infoDrawer.classList.remove("active");
  infoBackdrop.classList.remove("active");
  infoDrawer.setAttribute("aria-hidden", "true");
  infoBackdrop.setAttribute("aria-hidden", "true");
}

function toggleInfoDrawer() {
  if (!infoDrawer) return;
  if (infoDrawer.classList.contains("active")) {
    closeInfoDrawer();
  } else {
    openInfoDrawer();
  }
}

updateCurrentStatusStyle("No face detected");

setCameraAccessStatus("Not granted");
updateCurrentStatusStyle("Waiting");
updateTotalScreenTimeUI();

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
togglePreviewBtn.addEventListener("click", togglePreview);

if (infoToggleBtn) infoToggleBtn.addEventListener("click", toggleInfoDrawer);
if (infoCloseBtn) infoCloseBtn.addEventListener("click", closeInfoDrawer);
if (infoBackdrop) infoBackdrop.addEventListener("click", closeInfoDrawer);
window.addEventListener("keydown", event => {
  if (event.key === "Escape") closeInfoDrawer();
});

add1MinBtn.addEventListener("click", () => addMinutesToFaceTimer(1));
add5MinBtn.addEventListener("click", () => addMinutesToFaceTimer(5));
add10MinBtn.addEventListener("click", () => addMinutesToFaceTimer(10));
testCloseBtn.addEventListener("click", () => testNotification("close"));
testFarBtn.addEventListener("click", () => testNotification("far"));
testErgoBtn.addEventListener("click", () => testNotification("ergo"));

window.addEventListener("beforeunload", stopCamera);
