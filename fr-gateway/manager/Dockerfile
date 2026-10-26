FROM python:3.12-slim

RUN pip install --no-cache-dir docker

WORKDIR /app
COPY manager.py /app/manager.py

ENTRYPOINT ["python", "/app/manager.py"]
