FROM python:3.12-slim

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" docker pydantic

WORKDIR /app
COPY app.py /app/app.py
COPY static/ /app/static/

EXPOSE 8090

# LAN-Schutz uebernimmt der Host-Bind in docker-compose.yml (127.0.0.1:8090).
# Im Container 0.0.0.0, sonst erreicht der Docker-Publish den Listener nicht.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
