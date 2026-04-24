// ── SafeVision Work — app.js
// Handles video capture, frame sending, detection rendering and UI updates

// ── Global state
let stream = null;
let detectionInterval = null;
const DETECTION_INTERVAL_MS = 1500; // Send a frame every 1.5 seconds

// ── DOM references
const videoArea      = document.getElementById("video-area");
const canvas         = document.getElementById("detection-canvas");
const ctx            = canvas.getContext("2d");
const alertList      = document.getElementById("alert-list");
const badgeCount     = document.getElementById("badge-count");
const metCompliance  = document.getElementById("met-cum");
const metIncidents   = document.getElementById("met-inc");
const metPersons     = document.getElementById("met-per");


// ════════════════════════════════════════════
//  CAMERA & VIDEO
// ════════════════════════════════════════════

// Start webcam stream
function startCamera() {
    const placeholder = document.getElementById("vid-placeholder");

    let video = document.getElementById("live-video");
    if (!video) {
        video = createVideoElement();
        videoArea.appendChild(video);
    }

    placeholder.style.display = "none";

    navigator.mediaDevices.getUserMedia({ video: true })
        .then(s => {
            stream = s;
            video.srcObject = s;
            video.onloadedmetadata = () => startDetectionLoop(video);
        })
        .catch(() => alert("Could not access the camera."));
}

// Load a video file
function loadVideo(input) {
    if (!input.files[0]) return;
    const placeholder = document.getElementById("vid-placeholder");

    let video = document.getElementById("live-video");
    if (!video) {
        video = createVideoElement();
        video.controls = true;
        videoArea.appendChild(video);
    }

    placeholder.style.display = "none";
    video.srcObject = null;
    video.src = URL.createObjectURL(input.files[0]);
    video.onloadedmetadata = () => startDetectionLoop(video);
}

// Stop stream and reset
function stopStream() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }

    stopDetectionLoop();
    clearCanvas();

    const video = document.getElementById("live-video");
    if (video) video.remove();

    document.getElementById("vid-placeholder").style.display = "flex";
}

// Create a reusable <video> element
function createVideoElement() {
    const video = document.createElement("video");
    video.id = "live-video";
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
    return video;
}


// ════════════════════════════════════════════
//  DETECTION LOOP
// ════════════════════════════════════════════

// Start sending frames to /detect at regular intervals
function startDetectionLoop(video) {
    stopDetectionLoop();
    detectionInterval = setInterval(() => {
        sendFrame(video);
    }, DETECTION_INTERVAL_MS);
}

// Stop the detection loop
function stopDetectionLoop() {
    if (detectionInterval) {
        clearInterval(detectionInterval);
        detectionInterval = null;
    }
}

// Capture a frame from the video and send it to Flask
function sendFrame(video) {
    // Use an offscreen canvas to capture the frame
    const offscreen = document.createElement("canvas");
    offscreen.width  = video.videoWidth  || 640;
    offscreen.height = video.videoHeight || 480;
    const offCtx = offscreen.getContext("2d");
    offCtx.drawImage(video, 0, 0, offscreen.width, offscreen.height);

    // Convert frame to base64 image
    const frameData = offscreen.toDataURL("image/jpeg", 0.8);

    // Send to Flask endpoint
    fetch("/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame: frameData })
    })
    .then(res => res.json())
    .then(data => handleDetectionResults(data, video))
    .catch(err => console.error("Detection error:", err));
}


// ════════════════════════════════════════════
//  RESULTS HANDLER
// ════════════════════════════════════════════

// Process the JSON response from Flask and update the UI
function handleDetectionResults(data, video) {
    const persons = data.persons || [];

    // Sync canvas size to video display size
    canvas.width  = video.offsetWidth;
    canvas.height = video.offsetHeight;

    // Scale factors (model coords → display coords)
    const scaleX = canvas.width  / (video.videoWidth  || 640);
    const scaleY = canvas.height / (video.videoHeight || 480);

    clearCanvas();
    drawBoundingBoxes(persons, scaleX, scaleY);
    updateAlerts(persons);
    updateMetrics(persons);
}


// ════════════════════════════════════════════
//  BOUNDING BOXES
// ════════════════════════════════════════════

function drawBoundingBoxes(persons, scaleX, scaleY) {
    persons.forEach(person => {
        const [x1, y1, x2, y2] = person.bbox;
        const compliant = person.helmet && person.vest && person.glasses;

        const x = x1 * scaleX;
        const y = y1 * scaleY;
        const w = (x2 - x1) * scaleX;
        const h = (y2 - y1) * scaleY;

        // Box color: green = compliant, red = violation
        const color = compliant ? "#27ae60" : "#f04f4f";

        // Draw bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.strokeRect(x, y, w, h);

        // Draw label background
        const label = buildLabel(person);
        ctx.font = "bold 11px 'IBM Plex Mono', monospace";
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 20, textWidth + 12, 20);

        // Draw label text
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x + 6, y - 6);
    });
}

// Build label string based on missing EPP
function buildLabel(person) {
    const missing = [];
    if (!person.helmet)  missing.push("helmet");
    if (!person.vest)    missing.push("vest");
    if (!person.glasses) missing.push("glasses");

    if (missing.length === 0) return `P${person.id} ✓ OK`;
    return `P${person.id} ✗ No ${missing.join(", ")}`;
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}


// ════════════════════════════════════════════
//  ALERTS
// ════════════════════════════════════════════

let alertCount = 0;

function updateAlerts(persons) {
    persons.forEach(person => {
        const compliant = person.helmet && person.vest && person.glasses;
        if (compliant) return;

        alertCount++;
        badgeCount.textContent = alertCount;

        const missing = [];
        if (!person.helmet)  missing.push("helmet");
        if (!person.vest)    missing.push("vest");
        if (!person.glasses) missing.push("glasses");

        const now = new Date();
        const time = now.toTimeString().slice(0, 8);

        // Build alert row
        const row = document.createElement("div");
        row.className = "alert-row";
        row.innerHTML = `
            <div class="alert-icon red"></div>
            <div>
                <div class="alert-text-main">No ${missing.join(", ")} — Person ${person.id}</div>
                <div class="alert-text-sub">Production A · ${time}</div>
            </div>
        `;

        // Insert at the top of the list
        alertList.insertBefore(row, alertList.firstChild);

        // Keep only the last 20 alerts visible
        while (alertList.children.length > 20) {
            alertList.removeChild(alertList.lastChild);
        }
    });
}


// ════════════════════════════════════════════
//  METRICS
// ════════════════════════════════════════════

let totalDetections  = 0;
let totalViolations  = 0;

function updateMetrics(persons) {
    if (persons.length === 0) return;

    totalDetections += persons.length;
    const violations = persons.filter(p => !p.helmet || !p.vest || !p.glasses).length;
    totalViolations += violations;

    const compliance = Math.round(((totalDetections - totalViolations) / totalDetections) * 100);

    metPersons.textContent   = persons.length;
    metIncidents.textContent = totalViolations;
    metCompliance.textContent = compliance + "%";

    // Update compliance color
    metCompliance.className = "metric-value " + (
        compliance >= 90 ? "success" :
        compliance >= 70 ? "warning" : "danger"
    );
}


// ════════════════════════════════════════════
//  CLOCK
// ════════════════════════════════════════════

function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const el = document.getElementById("ts");
    if (el) el.textContent = `${hh} : ${mm} : ${ss}`;
}

setInterval(updateClock, 1000);
updateClock();


// ════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════

function showPage(page) {
    const live    = document.getElementById("view-live");
    const events  = document.getElementById("view-events");
    const reports = document.getElementById("view-reports");

    const titles = {
        live:    "Live view",
        events:  "Event log",
        reports: "Reports"
    };

    live.style.display = page === "live" ? "flex" : "none";
    events.classList.toggle("active",  page === "events");
    reports.classList.toggle("active", page === "reports");

    document.getElementById("topbar-title").textContent = titles[page];

    const pill = document.getElementById("topbar-pill");
    pill.style.display = page === "live" ? "flex" : "none";

    document.querySelectorAll(".nav-item").forEach((el, i) => {
        el.classList.remove("active");
        if (i === ["live", "events", "reports"].indexOf(page)) {
            el.classList.add("active");
        }
    });
    if (page === "events") loadEvents();
}

// ════════════════════════════════════════════
//  EVENT LOG
// ════════════════════════════════════════════

let eventsData = {};

function loadEvents() {
    fetch("/events")
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById("events-tbody");
            tbody.innerHTML = "";
            eventsData = {};

            if (data.detections.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align:center;color:var(--text-3);padding:24px;font-family:var(--mono)">
                            No events registered yet.
                        </td>
                    </tr>`;
                return;
            }

            data.detections.forEach(det => {
                const missing = [];
                if (!det.helmet)  missing.push("helmet");
                if (!det.vest)    missing.push("vest");
                if (!det.glasses) missing.push("glasses");

                const eppText    = missing.length === 0 ? "None" : missing.join(", ");
                const tagClass   = missing.length === 0 ? "tag-ok-bg" : "tag-danger";
                const statusText = missing.length === 0 ? "Compliant" : "Violation";
                const confidence = Math.round(det.confidence * 100) + "%";
                const time       = det.timestamp.slice(11, 19);

                // Store detection data by id for modal access
                eventsData[det.id] = det;

                tbody.innerHTML += `
                    <tr onclick="openModal(${det.id})" style="cursor:pointer;">
                        <td style="font-family:var(--mono);font-size:12px">${time}</td>
                        <td>${det.area}</td>
                        <td><span class="tag ${tagClass}">${eppText}</span></td>
                        <td style="font-family:var(--mono)">${confidence}</td>
                        <td><span class="tag ${tagClass}">${statusText}</span></td>
                    </tr>`;
            });
        })
        .catch(err => console.error("Error loading events:", err));
}

// ════════════════════════════════════════════
//  EVIDENCE MODAL
// ════════════════════════════════════════════

function openModal(id) {
    const det   = eventsData[id];
    const modal = document.getElementById("evidence-modal");
    const img   = document.getElementById("modal-image");
    const noImg = document.getElementById("modal-no-image");

    if (det.frame_path) {
        img.src             = "/" + det.frame_path.replace(/\\/g, "/");
        img.style.display   = "block";
        noImg.style.display = "none";
    } else {
        img.style.display   = "none";
        noImg.style.display = "block";
    }

    const missing = [];
    if (!det.helmet)  missing.push("helmet");
    if (!det.vest)    missing.push("vest");
    if (!det.glasses) missing.push("glasses");

    document.getElementById("modal-timestamp").textContent  = det.timestamp;
    document.getElementById("modal-area").textContent       = det.area;
    document.getElementById("modal-person").textContent     = "Person " + det.person_id;
    document.getElementById("modal-confidence").textContent = Math.round(det.confidence * 100) + "%";
    document.getElementById("modal-epp").innerHTML = missing.length === 0
        ? '<span class="tag tag-ok-bg">None</span>'
        : missing.map(m => `<span class="tag tag-danger">${m}</span>`).join(" ");

    modal.style.display = "flex";
}

function closeModal() {
    document.getElementById("evidence-modal").style.display = "none";
}