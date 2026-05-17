import os
import base64
import random
from datetime import datetime

import psycopg2
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ── Folder to store detection frames
FRAMES_FOLDER = os.path.join("static", "frames")
os.makedirs(FRAMES_FOLDER, exist_ok=True)


# ════════════════════════════════════════════
#  DATABASE CONNECTION
# ════════════════════════════════════════════

def get_db_connection():
    conn = psycopg2.connect(
        host=os.environ.get("RDS_HOSTNAME"),
        port=os.environ.get("RDS_PORT", "5432"),
        database=os.environ.get("RDS_DB_NAME", "ebdb")
        user=os.environ.get("RDS_USERNAME"),
        password=os.environ.get("RDS_PASSWORD")
    )
    return conn


# ════════════════════════════════════════════
#  FRAME SAVING
# ════════════════════════════════════════════

def save_frame(frame_base64, detection_id):
    """Decode base64 frame and save it as a .jpg file."""
    try:
        # Remove base64 header if present (e.g. "data:image/jpeg;base64,...")
        if "," in frame_base64:
            frame_base64 = frame_base64.split(",")[1]

        frame_bytes = base64.b64decode(frame_base64)

        # Organize frames by date
        date_folder = datetime.now().strftime("%Y-%m-%d")
        folder_path = os.path.join(FRAMES_FOLDER, date_folder)
        os.makedirs(folder_path, exist_ok=True)

        filename  = f"frame_{detection_id}.jpg"
        file_path = os.path.join(folder_path, filename)

        with open(file_path, "wb") as f:
            f.write(frame_bytes)

        # Return relative path for storage in DB
        return os.path.join("static", "frames", date_folder, filename)

    except Exception as e:
        print(f"Error saving frame: {e}")
        return None


# ════════════════════════════════════════════
#  DATABASE INSERTION
# ════════════════════════════════════════════

def save_detection(person, frame_path, area="Production A"):
    """Insert a detection event into the database."""
    try:
        conn   = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO detections
                (area, person_id, helmet, vest, glasses, confidence, frame_path)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            area,
            person["id"],
            person["helmet"],
            person["vest"],
            person["glasses"],
            person["confidence"],
            frame_path
        ))

        detection_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
        return detection_id

    except Exception as e:
        print(f"Error saving detection: {e}")
        return None


# ════════════════════════════════════════════
#  ROUTES
# ════════════════════════════════════════════

# Main route: serves the web interface
@app.route("/")
def index():
    return render_template("index.html")


# Detection endpoint: receives a frame and returns EPP detection results
@app.route("/detect", methods=["POST"])
def detect():
    data  = request.get_json()
    frame = data.get("frame", "")

    # ── SIMULATED RESPONSE (replace with model call once ready)
    # When the model is ready, this block will be replaced by:
    #   from model.detector import run_detector
    #   results = run_detector(frame)
    simulated_persons = [
        {
            "id": 1,
            "helmet":     random.choice([True, False]),
            "vest":       True,
            "glasses":    True,
            "confidence": round(random.uniform(0.80, 0.99), 2),
            "bbox":       [120, 80, 190, 210]
        },
        {
            "id": 2,
            "helmet":     True,
            "vest":       random.choice([True, False]),
            "glasses":    True,
            "confidence": round(random.uniform(0.80, 0.99), 2),
            "bbox":       [310, 95, 375, 220]
        }
    ]

    # ── Save violations to database
    for person in simulated_persons:
        violation = not person["helmet"] or not person["vest"] or not person["glasses"]
        if violation:
            # First insert to get the detection ID, then save the frame
            detection_id = save_detection(person, frame_path=None)
            if detection_id:
                frame_path = save_frame(frame, detection_id)
                # Update the record with the frame path
                try:
                    conn   = get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE detections SET frame_path = %s WHERE id = %s",
                        (frame_path, detection_id)
                    )
                    conn.commit()
                    cursor.close()
                    conn.close()
                except Exception as e:
                    print(f"Error updating frame path: {e}")

    return jsonify({ "persons": simulated_persons })


# Event log endpoint: returns all detections from the database
@app.route("/events", methods=["GET"])
def events():
    try:
        conn   = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, timestamp, area, person_id,
                   helmet, vest, glasses, confidence, frame_path
            FROM detections
            ORDER BY timestamp DESC
            LIMIT 100
        """)

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        detections = []
        for row in rows:
            detections.append({
                "id":         row[0],
                "timestamp":  row[1].strftime("%Y-%m-%d %H:%M:%S"),
                "area":       row[2],
                "person_id":  row[3],
                "helmet":     row[4],
                "vest":       row[5],
                "glasses":    row[6],
                "confidence": row[7],
                "frame_path": row[8]
            })

        return jsonify({ "detections": detections })

    except Exception as e:
        return jsonify({ "error": str(e) }), 500


if __name__ == "__main__":
    app.run(debug=True)