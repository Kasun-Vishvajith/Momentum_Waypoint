FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home waypoint
COPY backend ./backend
COPY frontend ./frontend
COPY data ./data
RUN mkdir -p /app/var && chown -R waypoint:waypoint /app
USER waypoint
ENV HOST=0.0.0.0 PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health',timeout=4)"
CMD ["python", "backend/server.py"]
