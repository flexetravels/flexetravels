FROM python:3.11-slim

WORKDIR /app

# Install backend dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend
COPY backend/ /app/backend/

# Copy frontend
COPY index.html /app/frontend/index.html
COPY app.js /app/frontend/app.js
COPY styles.css /app/frontend/styles.css

# Expose ports
EXPOSE 8000

# Start the FastAPI server
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
