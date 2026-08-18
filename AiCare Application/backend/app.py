from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import numpy as np
import cv2
from ultralytics import YOLO
import os
import time
import platform
import threading


try:
    from winotify import Notification, audio
    WINOTIFY_AVAILABLE = True
except Exception:
    Notification = None
    audio = None
    WINOTIFY_AVAILABLE = False

# Optional Windows custom sound support.
try:
    import winsound
    WINSOUND_AVAILABLE = True
except Exception:
    winsound = None
    WINSOUND_AVAILABLE = False

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "best.pt")
WEB_APP_URL = "http://127.0.0.1:5500/frontend/aicare_ui_split_3files.html"
NOTIFICATION_OPEN_URL = "http://127.0.0.1:5500/frontend/aicare_ui_split_3files.html?fromNotification=1"


def find_asset_path(*filenames):
    """Find AiCare assets from the same project folder."""
    search_folders = [BASE_DIR, os.getcwd()]

    for folder in search_folders:
        for filename in filenames:
            path = os.path.join(folder, filename)
            if os.path.exists(path):
                return path

    return None


ICON_PATH = find_asset_path("AiCare Icon.png", "AiCare Icon.ico", "AiCare Logo.png", "aicare logo.png", "AiCare_Logo.png", "aicare_logo.png")
SOUND_PATH = find_asset_path("aicare_alert.wav", "AiCare Alert.wav", "aicare-alert.wav")

model = YOLO(MODEL_PATH)

# Prevent repeated Windows notifications from stacking too quickly.
LAST_NOTIFICATION_TIMES = {}
NOTIFICATION_COOLDOWN_SECONDS = 6


def normalize_toast_duration(duration):
    """winotify accepts short/long. short normally behaves like a 6-7 second banner."""
    duration = str(duration or "short").lower().strip()
    return "long" if duration == "long" else "short"


def get_notification_audio(sound_name):
    """Return a safe winotify audio option. Custom sound is handled separately."""
    if not WINOTIFY_AVAILABLE:
        return None

    sound_name = str(sound_name or "silent").lower().strip()

    if sound_name == "custom":
        # IMPORTANT: do not use audio.Silent here. On some Windows setups,
        # silent toast notifications are stored in Notification Center but do
        # not appear as a corner banner. Use the normal Windows toast audio
        # for the banner, then play AiCare's own chime separately with winsound.
        return getattr(audio, "Default", None)

    sound_map = {
        "silent": getattr(audio, "Silent", None),
        "default": getattr(audio, "Default", None),
        "reminder": getattr(audio, "Reminder", getattr(audio, "Default", None)),
        "sms": getattr(audio, "SMS", getattr(audio, "Default", None)),
        "mail": getattr(audio, "Mail", getattr(audio, "Default", None)),
        "alarm": getattr(audio, "LoopingAlarm", getattr(audio, "Default", None)),
    }

    return sound_map.get(sound_name, sound_map.get("default"))


def _beep_sequence(sequence):
    """Play a fallback AiCare-style alert without needing an audio file."""
    for frequency, duration_ms in sequence:
        if frequency <= 0:
            time.sleep(duration_ms / 1000)
        else:
            winsound.Beep(int(frequency), int(duration_ms))


def play_aicare_sound(alert_type="close"):
    """Play AiCare's own unsafe-distance sound in a background thread."""
    if os.name != "nt" or not WINSOUND_AVAILABLE:
        return

    def runner():
        try:
            if SOUND_PATH and os.path.exists(SOUND_PATH):
                winsound.PlaySound(SOUND_PATH, winsound.SND_FILENAME | winsound.SND_ASYNC)
                return

            # Fallback chime if aicare_alert.wav is missing.
            if str(alert_type).lower() == "far":
                _beep_sequence([(740, 95), (0, 45), (988, 135), (0, 40), (880, 90)])
            else:
                _beep_sequence([(880, 95), (0, 45), (1175, 135), (0, 40), (988, 90)])
        except Exception as error:
            print("AiCare sound failed:", error)

    threading.Thread(target=runner, daemon=True).start()


def send_windows_notification(alert_type, title, message, duration="short", sound="custom", play_sound=True, launch_url=None):
    """Show a real Windows toast notification with AiCare logo and sound."""
    if os.name != "nt":
        return False, "Windows notifications are only available on Windows."

    if not WINOTIFY_AVAILABLE:
        return False, "winotify is not installed. Run: pip install winotify"

    alert_type = str(alert_type or "info")
    now = time.time()
    last_time = LAST_NOTIFICATION_TIMES.get(alert_type, 0)

    if now - last_time < NOTIFICATION_COOLDOWN_SECONDS:
        return True, "Duplicate notification skipped."

    LAST_NOTIFICATION_TIMES[alert_type] = now

    resolved_launch_url = str(launch_url or NOTIFICATION_OPEN_URL)

    toast_kwargs = {
        "app_id": "AiCare",
        "title": str(title or "AiCare Alert"),
        "msg": str(message or "Please check your screen distance."),
        "duration": normalize_toast_duration(duration),
        # Clicking the banner body opens the AiCare web app.
        "launch": resolved_launch_url,
    }

    if ICON_PATH and os.path.exists(ICON_PATH):
        toast_kwargs["icon"] = ICON_PATH

    toast = Notification(**toast_kwargs)

    try:
        toast.add_actions(label="Open AiCare", launch=resolved_launch_url)
    except Exception as error:
        print("AiCare notification action failed:", error)

    selected_audio = get_notification_audio(sound)
    if selected_audio is not None:
        toast.set_audio(selected_audio, loop=False)

    try:
        toast.show()
    except Exception as error:
        return False, f"Notification failed: {error}"

    # Unsafe distance gets AiCare's own chime. This is separate from the toast
    # so it still works even if Windows uses a quiet toast profile.
    if play_sound and alert_type.lower() in {"close", "far", "test"}:
        play_aicare_sound(alert_type)

    return True, "Notification shown."


@app.route("/notify", methods=["POST"])
def notify():
    """Called by the frontend when AiCare needs a Windows notification."""
    data = request.get_json(silent=True) or {}

    ok, message = send_windows_notification(
        alert_type=data.get("type", "info"),
        title=data.get("title", "AiCare Alert"),
        message=data.get("message", "Please check your screen distance."),
        duration=data.get("duration", "short"),
        sound=data.get("sound", "custom"),
        play_sound=bool(data.get("play_sound", True)),
        launch_url=data.get("launch_url", NOTIFICATION_OPEN_URL),
    )

    return jsonify({
        "ok": ok,
        "message": message,
        "winotify_available": WINOTIFY_AVAILABLE,
        "winsound_available": WINSOUND_AVAILABLE,
        "platform": platform.system(),
        "icon_found": bool(ICON_PATH and os.path.exists(ICON_PATH)),
        "sound_found": bool(SOUND_PATH and os.path.exists(SOUND_PATH)),
    })


@app.route("/notify/status", methods=["GET"])
def notify_status():
    """Small helper route to check whether native notifications are ready."""
    return jsonify({
        "windows_notification_ready": os.name == "nt" and WINOTIFY_AVAILABLE,
        "winotify_available": WINOTIFY_AVAILABLE,
        "winsound_available": WINSOUND_AVAILABLE,
        "platform": platform.system(),
        "icon_found": bool(ICON_PATH and os.path.exists(ICON_PATH)),
        "icon_path": ICON_PATH,
        "web_app_url": WEB_APP_URL,
        "notification_open_url": NOTIFICATION_OPEN_URL,
        "sound_found": bool(SOUND_PATH and os.path.exists(SOUND_PATH)),
        "sound_path": SOUND_PATH,
    })


@app.route("/notify/test", methods=["GET"])
def notify_test():
    """Open this in a browser to test the real Windows popup notification."""
    ok, message = send_windows_notification(
        alert_type="test",
        title="AiCare Test Notification",
        message="This is a short real Windows notification from AiCare.",
        duration="short",
        sound="custom",
        play_sound=True,
        launch_url=NOTIFICATION_OPEN_URL,
    )
    return jsonify({
        "ok": ok,
        "message": message,
        "winotify_available": WINOTIFY_AVAILABLE,
        "winsound_available": WINSOUND_AVAILABLE,
        "platform": platform.system(),
        "icon_found": bool(ICON_PATH and os.path.exists(ICON_PATH)),
        "icon_path": ICON_PATH,
        "web_app_url": WEB_APP_URL,
        "notification_open_url": NOTIFICATION_OPEN_URL,
        "sound_found": bool(SOUND_PATH and os.path.exists(SOUND_PATH)),
        "sound_path": SOUND_PATH,
    })


@app.route("/", methods=["GET"])
def serve_aicare_app():
    """Open the AiCare web app from Flask, so notification clicks can return here."""
    return send_from_directory(BASE_DIR, "aicare_ui_split_3files.html")


@app.route("/<path:filename>", methods=["GET"])
def serve_aicare_assets(filename):
    """Serve only AiCare frontend assets needed by the local web app."""
    allowed_files = {
        "aicare_ui_split_3files.html",
        "aicare_ui.css",
        "aicare_ui.js",
        "AiCare Logo.png",
        "AiCare Icon.png",
        "AiCare Icon.ico",
        "aicare_alert.wav",
    }

    if filename in allowed_files and os.path.exists(os.path.join(BASE_DIR, filename)):
        return send_from_directory(BASE_DIR, filename)

    return jsonify({"error": "File not found"}), 404


@app.route("/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        return jsonify({"error": "No image received"}), 400

    file = request.files["image"]

    img_bytes = file.read()
    npimg = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

    if frame is None:
        return jsonify({"error": "Invalid image"}), 400

    results = model(frame)

    boxes = results[0].boxes

    if boxes is not None and len(boxes) > 0:
        frame_height = frame.shape[0]

        # If more than one person/face is detected, AiCare prioritises the
        # closest user. The closest user normally has the largest face box in
        # the webcam frame, so box height is used first and confidence second.
        def closest_user_score(box):
            bx1, by1, bx2, by2 = box.xyxy[0].tolist()
            box_height_score = by2 - by1
            confidence_score = float(box.conf[0])
            return (box_height_score, confidence_score)

        best_box = max(boxes, key=closest_user_score)

        x1, y1, x2, y2 = best_box.xyxy[0].tolist()
        box_height = y2 - y1

        face_ratio = box_height / frame_height
        confidence = float(best_box.conf[0])

        if face_ratio > 0.45:
            status = "Too Close"
            reminder = "Please move back from the screen"
        elif face_ratio < 0.22:
            status = "Too Far"
            reminder = "Move slightly closer"
        else:
            status = "Safe"
            reminder = "Good distance detected"

        return jsonify({
            "status": status,
            "reminder": reminder,
            "face_ratio": round(face_ratio, 2),
            "confidence": round(confidence, 2),
            "box": {
                "x1": round(x1, 2),
                "y1": round(y1, 2),
                "x2": round(x2, 2),
                "y2": round(y2, 2)
            },
            "frame": {
                "width": frame.shape[1],
                "height": frame.shape[0]
            }
        })

    return jsonify({
        "status": "No face detected",
        "reminder": "Face not detected",
        "face_ratio": 0,
        "confidence": 0,
        "box": None,
        "frame": None
    })



if __name__ == "__main__":
    app.run(debug=False)
