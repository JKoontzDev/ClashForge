# ClashForge

ClashForge is a Django + DRF battle app starter focused on forging fighters, simulating fights, and evolving toward authoritative saved battle history.

## Current stack
- Django 5 project with an `arena` app
- Django REST Framework API for characters and fight history
- PixiJS-driven frontend presentation layer
- Docker Compose services for web, PostgreSQL, Redis, and Ollama
- SQLite for plain local Django by default, PostgreSQL for Docker Compose and production

## Docker Compose setup
```bash
cp .env.example .env
docker compose up --build
```

Before the first `docker compose up`, set a database password in `.env`:

```bash
POSTGRES_PASSWORD=change-me
```

The Compose stack includes:
- `web`: the Django app container
- `postgres`: PostgreSQL 16 with persistent storage
- `redis`: Redis 7 for cache and shared throttling
- `ollama`: optional local Ollama service with persistent model storage

By default, the repository `.env.example` keeps Django in debug mode for local browser testing:
- `CLASHFORGE_ENV=development`
- `DJANGO_DEBUG=1`

Docker Compose explicitly overrides the database backend to PostgreSQL:
- `CLASHFORGE_DATABASE=postgres`
- `POSTGRES_HOST=postgres`

That means records created through the Dockerized app are stored in the named `postgres_data` Docker volume and survive `docker compose down` / `docker compose up` cycles. Plain local `python manage.py runserver` still uses SQLite unless you intentionally set `CLASHFORGE_DATABASE=postgres`.

The web container startup flow is:
- wait for PostgreSQL when `CLASHFORGE_DATABASE=postgres`
- run migrations automatically
- run `collectstatic` automatically when `DJANGO_DEBUG=0`
- start Django `runserver` in debug mode
- start Gunicorn in non-debug mode

Once the stack is up:
- app: `http://localhost:8000`
- ollama API: `http://127.0.0.1:11434` on the host only by default

Useful commands:

```bash
docker compose up --build
docker compose logs -f web
docker compose exec web python manage.py createsuperuser
docker compose down
```

To remove persistent PostgreSQL and Ollama data as well:

```bash
docker compose down -v
```

Fresh local installs can start empty. Use Forge to create and publish fighters into your own local database.

## Environment configuration
ClashForge reads a local `.env` file automatically if present, and `docker-compose.yml` also uses that same `.env` for container configuration. These variables are currently supported:

- `CLASHFORGE_ENV`: `development`, `test`, or `production`; production enables the production database/security path and fails closed if required settings are missing. Any deployment with `DJANGO_DEBUG=0` must explicitly set `CLASHFORGE_ENV=production`
- `DJANGO_SECRET_KEY`: required for any shared or production-like environment
- `DJANGO_DEBUG`: `1`/`0` flag; must be `0` in production
- `DJANGO_ALLOWED_HOSTS`: comma-separated hostnames; defaults to `localhost,127.0.0.1,[::1]` in debug mode. Production entries must be exact hosts such as `clashforge.example.com`, not `*` and not URLs
- `DJANGO_CSRF_TRUSTED_ORIGINS`: optional comma-separated origins for proxied or custom-host setups. Production entries must be HTTPS origins such as `https://clashforge.example.com`
- `DJANGO_USE_X_FORWARDED_HOST`: optional `1`/`0`; enable if your proxy forwards the canonical host
- `CLASHFORGE_DATABASE`: `sqlite` or `postgres`; Docker Compose sets this to `postgres`, while plain local Django defaults to `sqlite`
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`: required when `CLASHFORGE_DATABASE=postgres`
- `CLASHFORGE_REDIS_URL`: required in production for shared throttling, for example `redis://redis:6379/0`
- `CLASHFORGE_TRUST_X_FORWARDED_FOR`: set to `1` only behind a trusted reverse proxy after direct app-port access is blocked
- `CLASHFORGE_TRUSTED_PROXY_IPS`: comma-separated proxy IP addresses allowed to supply `X-Forwarded-For`; malformed IPs fail startup
- `CLASHFORGE_NUM_PROXIES`: number of trusted proxies in front of Django. Configure the proxy to overwrite `X-Forwarded-For`; malformed forwarded chains are rejected
- `CLASHFORGE_ADMIN_PATH`: admin route path; defaults to `admin`
- `CLASHFORGE_DATA_UPLOAD_MAX_MEMORY_SIZE`: optional global Django request-body cap
- `CLASHFORGE_DATA_UPLOAD_MAX_NUMBER_FIELDS`: optional cap for parsed form-style field counts
- `CLASHFORGE_CSP_ALLOW_UNSAFE_EVAL`: optional `1`/`0`; must be `0` in production
- `CLASHFORGE_THROTTLE_DYNAMIC_BURST`: optional per-IP burst limit for any dynamic route, including 404 floods
- `CLASHFORGE_THROTTLE_DYNAMIC_SUSTAINED`: optional per-IP sustained limit for any dynamic route
- `CLASHFORGE_THROTTLE_PAGE_VIEW_BURST`: optional per-IP burst limit for HTML page views
- `CLASHFORGE_THROTTLE_PAGE_VIEW_SUSTAINED`: optional per-IP sustained limit for HTML page views
- `CLASHFORGE_THROTTLE_ADMIN_BURST`, `CLASHFORGE_THROTTLE_ADMIN_SUSTAINED`, `CLASHFORGE_THROTTLE_ADMIN_POST_BURST`, `CLASHFORGE_THROTTLE_ADMIN_POST_SUSTAINED`: admin route throttles
- `CLASHFORGE_THROTTLE_API_WRITE_BURST`, `CLASHFORGE_THROTTLE_API_WRITE_SUSTAINED`: coarse unsafe API write throttles
- `CLASHFORGE_THROTTLE_PUBLIC_READ_BURST`: optional DRF rate for short-window bootstrap/public read throttling
- `CLASHFORGE_THROTTLE_PUBLIC_READ_SUSTAINED`: optional DRF rate for longer-window bootstrap/public read throttling
- `CLASHFORGE_FIGHTER_WRITE_MAX_BODY_BYTES`: optional max request size for fighter create/update API bodies
- `CLASHFORGE_BATTLE_RUN_MAX_BODY_BYTES`: optional max request size for battle run API bodies
- `CLASHFORGE_CREATIVE_ASSIST_MAX_BODY_BYTES`: optional max request size for creative assist API bodies
- `CLASHFORGE_THROTTLE_FIGHTER_CREATE_BURST`: optional DRF rate for short-window fighter create throttling
- `CLASHFORGE_THROTTLE_FIGHTER_CREATE_SUSTAINED`: optional DRF rate for longer-window fighter create throttling
- `CLASHFORGE_THROTTLE_FIGHTER_CREATE_SESSION_SUSTAINED`: optional signed-session sustained create quota
- `CLASHFORGE_THROTTLE_FIGHTER_UPDATE_BURST`: optional DRF rate for short-window fighter update throttling
- `CLASHFORGE_THROTTLE_FIGHTER_UPDATE_SUSTAINED`: optional DRF rate for longer-window fighter update throttling
- `CLASHFORGE_THROTTLE_FIGHTER_UPDATE_SESSION_SUSTAINED`: optional signed-session sustained update quota
- `CLASHFORGE_THROTTLE_BATTLE_RUN_BURST`: optional DRF rate for short-window battle run throttling
- `CLASHFORGE_THROTTLE_BATTLE_RUN_SUSTAINED`: optional DRF rate for longer-window battle run throttling
- `CLASHFORGE_THROTTLE_BATTLE_RUN_SESSION_SUSTAINED`: optional signed-session sustained battle quota
- `CLASHFORGE_BATTLE_SIM_IP_DAILY_QUOTA`: weighted daily simulation quota per client IP
- `CLASHFORGE_BATTLE_SIM_SESSION_DAILY_QUOTA`: weighted daily simulation quota per signed browser session
- `CLASHFORGE_THROTTLE_CREATIVE_ASSIST_BURST`: optional DRF rate for short-window creative assist throttling
- `CLASHFORGE_THROTTLE_CREATIVE_ASSIST_SUSTAINED`: optional DRF rate for longer-window creative assist throttling
- `CLASHFORGE_THROTTLE_CREATIVE_ASSIST_SESSION_SUSTAINED`: optional signed-session sustained creative-assist quota
- `CLASHFORGE_OLLAMA_ENABLED`: set to `1` to enable local Ollama flavor suggestions
- `CLASHFORGE_OLLAMA_PUBLIC_API_ENABLED`: must be explicitly set to `1` to expose Ollama assist to public traffic in production
- `CLASHFORGE_OLLAMA_BASE_URL`: local Ollama base URL; defaults to `http://127.0.0.1:11434`
- `CLASHFORGE_OLLAMA_MODEL`: model tag to use for flavor suggestions
- `CLASHFORGE_OLLAMA_ALLOWED_MODELS`: comma-separated server-side allowlist for creative assist models
- `CLASHFORGE_OLLAMA_TIMEOUT_SECONDS`: request timeout for local Ollama calls
- `OLLAMA_BIND_ADDR`: Docker Compose host bind address for Ollama; defaults to `127.0.0.1`. Do not set this to `0.0.0.0` on a public host unless Ollama is protected behind a private network, firewall, or authenticated proxy
- `OLLAMA_PORT`: Docker Compose host port for Ollama; defaults to `11434`
- `CLASHFORGE_SECURITY_LOG_LEVEL`: log level for security-relevant events

When `CLASHFORGE_ENV=production`:
- `DJANGO_SECRET_KEY` must be set
- `DJANGO_ALLOWED_HOSTS` must be explicitly set
- `DJANGO_ALLOWED_HOSTS` cannot contain `*`, URL schemes, or path fragments
- `DJANGO_CSRF_TRUSTED_ORIGINS` must be explicitly set
- `DJANGO_CSRF_TRUSTED_ORIGINS` must use HTTPS origins only
- `CLASHFORGE_REDIS_URL` must be set
- PostgreSQL credentials must be set
- `CLASHFORGE_DATABASE` must be `postgres`
- `DJANGO_DEBUG` must be `0`
- the DRF browsable API is disabled and JSON responses remain enabled
- secure cookies, HTTPS redirect, and HSTS are enabled
- startup raises `ImproperlyConfigured` if production settings are incomplete or insecure

For Compose-based PostgreSQL deployment testing, set at least:
- `CLASHFORGE_ENV=production`
- `CLASHFORGE_DATABASE=postgres`
- `DJANGO_DEBUG=0`
- `DJANGO_SECRET_KEY` to a strong secret
- `DJANGO_ALLOWED_HOSTS` to your real hostnames
- `DJANGO_CSRF_TRUSTED_ORIGINS` to HTTPS origins only
- `POSTGRES_PASSWORD` to a real password
- `CLASHFORGE_REDIS_URL=redis://redis:6379/0`

The Compose file already wires these internal hostnames correctly:
- PostgreSQL host: `postgres`
- Redis host inside `CLASHFORGE_REDIS_URL`: `redis`
- Ollama base URL: `http://ollama:11434`

If `DJANGO_DEBUG=0` is set without `CLASHFORGE_ENV=production`, startup fails. This prevents an ambiguous mode where debug is off but production hardening is not active.

When you run production mode through Compose, Django will enforce HTTPS redirects and secure-cookie behavior. Direct plain-HTTP access to `http://localhost:8000` is therefore not a realistic production test by itself; use a proper TLS-terminating reverse proxy in front of Django for real production-like validation.

Dynamic routes are protected by cache-backed per-IP middleware throttles, admin routes have additional throttles, and the API also keeps tighter DRF throttles on public reads plus create/update/battle/creative write paths. Unsafe browser API calls use a lightweight signed anonymous cookie and are limited by both client IP and anonymous browser identity where practical. Browser clients must send `X-ClashForge-Client: web` on unsafe API calls; the bundled frontend already does this.

The current CSP is intentionally strict on origins, but it still allows one compatibility exception:
- `style-src 'unsafe-inline'` remains because the current UI uses inline style attributes for dynamic color chips and health bars.

Production admin access must also be restricted at the deployment layer, such as VPN, private network, identity-aware proxy, or IP allowlist. Django password validators are enabled, but MFA should be provided by your admin access layer or a dedicated Django MFA package before high-risk production use.

Do not commit `.env`, secrets, Redis credentials, PostgreSQL credentials, or local SQLite data.

## MVP Notes
- Docker setup: start with `docker compose up --build`, then create or publish fighters through Forge as needed.
- Env vars: `.env.example` includes the Django security basics, API abuse-protection limits, and optional Ollama settings for flavor-only creative assist.
- Legacy benchmark seed commands still exist in the codebase for compatibility work, but benchmark fighters are intentionally excluded from the shipped MVP product surface.
- Official battles: the frontend only renders the fight. `POST /api/battles/run/` is the authoritative path that validates public battle-eligible fighter IDs, runs the sim on the backend, saves history, and returns the timeline used for presentation.
- Current limitations: there are no full user accounts yet, unlisted fighters are still reachable by direct share link for view/duplicate workflows, unlisted/internal/benchmark fighters are not eligible for public battle endpoints, the creative assistant is optional and local-only by default, and battle events do not yet expose explicit miss/block event types.

## Endpoints
- `GET /api/bootstrap/`
- `GET|POST /api/fighters/`
- `GET|PATCH /api/fighters/<id>/`
- `POST /api/forge/creative/`
- `GET /api/battles/`
- `POST /api/battles/run/`

## Ollama note
Creative assist is optional and flavor-only. The frontend still assembles a local forge draft first, then `POST /api/forge/creative/` can ask a local Ollama instance for names, lore, passive text, and ability flavor. Stats, mechanics, saves, and official battle results remain validated and authoritative on the backend.
