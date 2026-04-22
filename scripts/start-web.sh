#!/bin/sh
set -eu

wait_for_postgres() {
  python -c 'import os, socket, sys, time
host = os.environ.get("POSTGRES_HOST", "postgres")
port = int(os.environ.get("POSTGRES_PORT", "5432"))
deadline = time.time() + int(os.environ.get("DB_WAIT_TIMEOUT", "60"))
while True:
    try:
        with socket.create_connection((host, port), timeout=2):
            break
    except OSError as exc:
        if time.time() >= deadline:
            print(f"Timed out waiting for PostgreSQL at {host}:{port}: {exc}", file=sys.stderr)
            sys.exit(1)
        print(f"Waiting for PostgreSQL at {host}:{port}...", flush=True)
        time.sleep(2)
'
}

if [ "${CLASHFORGE_DATABASE:-}" = "postgres" ] || [ "${CLASHFORGE_ENV:-development}" = "production" ]; then
  wait_for_postgres
fi

if [ "${APPLY_MIGRATIONS:-1}" = "1" ]; then
  python manage.py migrate --noinput
fi

if [ "${DJANGO_DEBUG:-0}" != "1" ] && [ "${COLLECTSTATIC:-1}" = "1" ]; then
  python manage.py collectstatic --noinput
fi

if [ "${DJANGO_DEBUG:-0}" = "1" ]; then
  exec python manage.py runserver 0.0.0.0:8000
fi

exec "$@"
