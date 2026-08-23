# AiCare – Smart Eye-Care System

![AiCare](screenshots/Logo.png)

AiCare is a computer vision project designed to monitor a user's viewing distance from the screen in real time. The system uses a YOLO model to detect the user's face and classify the viewing position as **Too Close**, **Safe**, or **Too Far**.

The project was developed as a Final Year Project and includes a Flask backend, a web-based frontend, real-time webcam processing, and Windows notification support.

## Features

* Real-time face detection using YOLO
* Viewing distance classification:

  * Too Close
  * Safe
  * Too Far
* Webcam-based detection
* On-screen reminders
* Windows desktop notifications
* Custom AiCare notification sound
* Simple web interface
* Separate webcam testing script

## Technologies Used

* Python
* Flask
* OpenCV
* Ultralytics YOLO
* NumPy
* HTML
* CSS
* JavaScript
* Flask-CORS
* Winotify

## Project Structure

```text
AiCare Application/
├── backend/
│   ├── app.py
│   ├── predict.py
│   ├── best.pt
│   └── assets/
│
├── frontend/
│   ├── aicare_ui_split_5files.html
│   ├── aicare_ui.css
│   ├── aicare_ui.js
│   └── assets/
│
├── requirements.txt
└── README.md
```

## Installation

Clone the repository and install the required packages:

```bash
pip install -r requirements.txt
```

Run the backend:

```bash
python app.py
```

For a simple webcam model test:

```bash
python predict.py
```

The webcam test can be closed by pressing **Q**.

## Model

The trained YOLO model is stored as:

```text
best.pt
```

The Flask backend loads this model and processes images received from the frontend.

## Screenshots

### Main Interface
![AiCare Main Interface](screenshots/UI.png)


### Notification
![AiCare Notification](screenshots/notification.png)

### Poster
![Poster](screenshots/Poster.png)

## Feedback

This project was developed as part of my Final Year Project.

Feedback and suggestions are welcome, especially regarding:

* Model performance
* Distance classification
* User interface
* System usability
* Future improvements

Feel free to open an **Issue** if you have any suggestions or feedback.
