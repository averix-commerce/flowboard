FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLOWBOARD_STORAGE=/data
ENV FLOWBOARD_DB=/data/flowboard.db

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8101 9223

CMD ["uvicorn", "flowboard.main:app", "--host", "0.0.0.0", "--port", "8101", "--timeout-graceful-shutdown", "2"]
