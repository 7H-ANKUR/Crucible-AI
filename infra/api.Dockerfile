FROM python:3.11-slim

WORKDIR /app

COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api ./apps/api
COPY apps/ml/artifacts ./apps/ml/artifacts

ENV ML_ARTIFACTS_DIR=/app/apps/ml/artifacts
EXPOSE 8000

CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
