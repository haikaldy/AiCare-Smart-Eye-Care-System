import cv2
from ultralytics import YOLO

def main():
    model = YOLO("best.pt")
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("Cannot open webcam")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to grab frame")
            break

        results = model(frame)

        annotated_frame = results[0].plot()

        cv2.imshow("AiCare Webcam Test", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()