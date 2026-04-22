FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CLASHFORGE_DOCKER=1

WORKDIR /app

RUN groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app

COPY requirements.txt ./

RUN python -m pip install --no-cache-dir -r requirements.txt gunicorn==23.0.0

COPY scripts/start-web.sh /usr/local/bin/start-web
COPY . .

RUN chmod 0755 /usr/local/bin/start-web \
    && mkdir -p /app/staticfiles \
    && chown -R app:app /app /usr/local/bin/start-web

USER app

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/start-web"]
CMD ["gunicorn", "--bind=0.0.0.0:8000", "--workers=2", "--threads=4", "--timeout=60", "--access-logfile=-", "--error-logfile=-", "clashforge.wsgi:application"]
