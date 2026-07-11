FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Model-graduation validator harness. Canonical source is
# 2_pipelines/ml/registry/validators.py; build-images.sh stages a copy into
# this build context right before `docker build`. Loaded at runtime by
# app/routes/graduation.py (_load_validators reads /app/validators.py).
# Static checks (schema/deps/resources) are the promotion gate; the optional
# 'smoke' validator's docker sandbox is not used under k8s and self-skips
# (no docker CLI in this image — k8s-only, no compose socket to bind).
COPY validators.py /app/validators.py

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
