# Palladium Demo Console
#
# One stage, no build step: the UI is hand-written HTML/CSS/JS, so there is no
# bundler to run and the image is small enough to rebuild during a demo week.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CONSOLE_ENV=prod

WORKDIR /srv

# LibreOffice, headless, for one job: turning an uploaded deck or document into
# a PDF the browser can actually show. It is the single biggest thing in this
# image (~400MB) and it is optional — the app detects it at runtime and says so
# plainly when it is absent, so a slimmer build stays correct and simply offers
# download instead of preview. Drop this layer to get that build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress libreoffice-writer fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY web ./web

# Non-root: the console holds per-project secrets and has no reason to run as 0.
# Uploaded bytes live here, on a volume — see docker-compose.yml.
RUN mkdir -p /srv/data
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin console \
 && chown -R console:console /srv
USER console

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
