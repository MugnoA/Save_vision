FROM python:3.11-slim

# System dependencies for OpenCV and psycopg2
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache optimization)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .
COPY model/ model/
COPY static/ static/
COPY templates/ templates/

# Create frames folder (writable at runtime)
RUN mkdir -p static/frames

# Expose port
EXPOSE 8000

# Run with gunicorn (production-ready, not Flask dev server)
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120", "app:app"]
