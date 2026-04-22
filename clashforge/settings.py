import os
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, str(default))
    return value.strip().lower() in {'1', 'true', 't', 'yes', 'y', 'on', 'dev', 'development'}


def env_list(name: str, default: str = '') -> list[str]:
    value = os.getenv(name, default)
    return [item.strip() for item in value.split(',') if item.strip()]


def env_str(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default

    try:
        parsed = int(value.strip())
    except ValueError as exc:
        raise ImproperlyConfigured(f'{name} must be an integer.') from exc

    if parsed <= 0:
        raise ImproperlyConfigured(f'{name} must be greater than 0.')
    return parsed


def env_mode(name: str, default: str = 'development') -> str:
    value = env_str(name, default).lower()
    allowed = {'development', 'production', 'test'}
    if value not in allowed:
        raise ImproperlyConfigured(
            f'{name} must be one of: {", ".join(sorted(allowed))}.'
        )
    return value


def env_choice(name: str, default: str, allowed: set[str]) -> str:
    value = env_str(name, default).lower()
    if value not in allowed:
        raise ImproperlyConfigured(
            f'{name} must be one of: {", ".join(sorted(allowed))}.'
        )
    return value


RAW_CLASHFORGE_ENV = os.getenv('CLASHFORGE_ENV', '').strip()
CLASHFORGE_ENV = env_mode('CLASHFORGE_ENV', 'development')

if CLASHFORGE_ENV != 'production':
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / '.env')
    RAW_CLASHFORGE_ENV = os.getenv('CLASHFORGE_ENV', '').strip()
    CLASHFORGE_ENV = env_mode('CLASHFORGE_ENV', CLASHFORGE_ENV)

IS_PRODUCTION = CLASHFORGE_ENV == 'production'
IS_TEST = CLASHFORGE_ENV == 'test'
IS_DOCKER = env_bool('CLASHFORGE_DOCKER', False)
DEBUG = env_bool('DJANGO_DEBUG', not IS_PRODUCTION)
if not DEBUG and CLASHFORGE_ENV not in {'production', 'test'}:
    raise ImproperlyConfigured(
        'DJANGO_DEBUG=0 requires CLASHFORGE_ENV=production. '
        'Set CLASHFORGE_ENV=development for local debug mode or CLASHFORGE_ENV=production for deployment.'
    )

APP_VERSION = env_str('APP_VERSION', '0.1.0')
BUILD_VERSION = env_str('BUILD_VERSION', 'dev')

SECRET_KEY = env_str('DJANGO_SECRET_KEY', '')
if not SECRET_KEY and not IS_PRODUCTION:
    SECRET_KEY = env_str('SECRET_KEY', 'django-insecure-local-dev-only-change-me')

default_allowed_hosts = 'localhost,127.0.0.1,[::1]' if DEBUG else ''
ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', default_allowed_hosts)
CSRF_TRUSTED_ORIGINS = env_list('DJANGO_CSRF_TRUSTED_ORIGINS')

DATA_UPLOAD_MAX_MEMORY_SIZE = env_int('CLASHFORGE_DATA_UPLOAD_MAX_MEMORY_SIZE', 65536)
DATA_UPLOAD_MAX_NUMBER_FIELDS = env_int('CLASHFORGE_DATA_UPLOAD_MAX_NUMBER_FIELDS', 64)
FIGHTER_WRITE_MAX_BODY_BYTES = env_int('CLASHFORGE_FIGHTER_WRITE_MAX_BODY_BYTES', 4096)
BATTLE_RUN_MAX_BODY_BYTES = env_int('CLASHFORGE_BATTLE_RUN_MAX_BODY_BYTES', 512)
CREATIVE_ASSIST_MAX_BODY_BYTES = env_int('CLASHFORGE_CREATIVE_ASSIST_MAX_BODY_BYTES', 6144)

CLASHFORGE_CSP_ALLOW_UNSAFE_EVAL = env_bool(
    'CLASHFORGE_CSP_ALLOW_UNSAFE_EVAL',
    not IS_PRODUCTION,
)
CLASHFORGE_DYNAMIC_BURST_RATE = env_str('CLASHFORGE_THROTTLE_DYNAMIC_BURST', '180/minute')
CLASHFORGE_DYNAMIC_SUSTAINED_RATE = env_str('CLASHFORGE_THROTTLE_DYNAMIC_SUSTAINED', '3600/hour')
CLASHFORGE_PAGE_VIEW_BURST_RATE = env_str('CLASHFORGE_THROTTLE_PAGE_VIEW_BURST', '40/minute')
CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE = env_str('CLASHFORGE_THROTTLE_PAGE_VIEW_SUSTAINED', '1200/hour')
CLASHFORGE_API_WRITE_BURST_RATE = env_str('CLASHFORGE_THROTTLE_API_WRITE_BURST', '60/minute')
CLASHFORGE_API_WRITE_SUSTAINED_RATE = env_str('CLASHFORGE_THROTTLE_API_WRITE_SUSTAINED', '600/hour')
CLASHFORGE_ADMIN_BURST_RATE = env_str('CLASHFORGE_THROTTLE_ADMIN_BURST', '10/minute')
CLASHFORGE_ADMIN_SUSTAINED_RATE = env_str('CLASHFORGE_THROTTLE_ADMIN_SUSTAINED', '100/hour')
CLASHFORGE_ADMIN_POST_BURST_RATE = env_str('CLASHFORGE_THROTTLE_ADMIN_POST_BURST', '5/minute')
CLASHFORGE_ADMIN_POST_SUSTAINED_RATE = env_str('CLASHFORGE_THROTTLE_ADMIN_POST_SUSTAINED', '20/hour')
CLASHFORGE_BATTLE_SIM_IP_DAILY_QUOTA = env_int('CLASHFORGE_BATTLE_SIM_IP_DAILY_QUOTA', 5000)
CLASHFORGE_BATTLE_SIM_SESSION_DAILY_QUOTA = env_int('CLASHFORGE_BATTLE_SIM_SESSION_DAILY_QUOTA', 2000)

CLASHFORGE_TRUST_X_FORWARDED_FOR = env_bool('CLASHFORGE_TRUST_X_FORWARDED_FOR', False)
CLASHFORGE_TRUSTED_PROXY_IPS = env_list('CLASHFORGE_TRUSTED_PROXY_IPS')
for proxy_ip in CLASHFORGE_TRUSTED_PROXY_IPS:
    try:
        ipaddress.ip_address(proxy_ip)
    except ValueError as exc:
        raise ImproperlyConfigured(
            f'CLASHFORGE_TRUSTED_PROXY_IPS contains an invalid IP address: {proxy_ip!r}.'
        ) from exc
CLASHFORGE_NUM_PROXIES = env_int('CLASHFORGE_NUM_PROXIES', 1)
CLASHFORGE_ADMIN_PATH = env_str('CLASHFORGE_ADMIN_PATH', 'admin/').strip('/')
if not CLASHFORGE_ADMIN_PATH:
    raise ImproperlyConfigured('CLASHFORGE_ADMIN_PATH cannot be empty.')

OLLAMA_ENABLED = env_bool('CLASHFORGE_OLLAMA_ENABLED', False)
OLLAMA_BASE_URL = env_str('CLASHFORGE_OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
OLLAMA_MODEL = env_str('CLASHFORGE_OLLAMA_MODEL', 'llama3.1:8b')
OLLAMA_ALLOWED_MODELS = env_list('CLASHFORGE_OLLAMA_ALLOWED_MODELS', OLLAMA_MODEL)
OLLAMA_TIMEOUT_SECONDS = env_int('CLASHFORGE_OLLAMA_TIMEOUT_SECONDS', 8)
OLLAMA_PUBLIC_API_ENABLED = env_bool('CLASHFORGE_OLLAMA_PUBLIC_API_ENABLED', not IS_PRODUCTION)

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'csp',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sitemaps',
    'rest_framework',
    'arena',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'csp.middleware.CSPMiddleware',
    'clashforge.security.RequestRateLimitMiddleware',
    'clashforge.security.ContentSecurityPolicyMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'clashforge.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    }
]

WSGI_APPLICATION = 'clashforge.wsgi.application'
ASGI_APPLICATION = 'clashforge.asgi.application'

DATABASE_ENGINE = env_choice(
    'CLASHFORGE_DATABASE',
    'postgres' if IS_DOCKER else 'sqlite',
    {'postgres', 'sqlite'},
)

if IS_DOCKER and DATABASE_ENGINE != 'postgres':
    raise ImproperlyConfigured(
        'Dockerized ClashForge must use PostgreSQL. Set CLASHFORGE_DATABASE=postgres.'
    )

if DATABASE_ENGINE == 'postgres':
    postgres_host = env_str('POSTGRES_HOST', 'postgres')
    if IS_DOCKER and postgres_host in {'localhost', '127.0.0.1', '::1'}:
        raise ImproperlyConfigured(
            'Dockerized ClashForge must connect to PostgreSQL by Compose service name, not localhost.'
        )
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': env_str('POSTGRES_DB', 'app_db'),
            'USER': env_str('POSTGRES_USER', ''),
            'PASSWORD': env_str('POSTGRES_PASSWORD', ''),
            'HOST': postgres_host,
            'PORT': env_str('POSTGRES_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

if DATABASE_ENGINE == 'postgres' and (
    not DATABASES['default'].get('NAME')
    or not DATABASES['default'].get('USER')
    or not DATABASES['default'].get('PASSWORD')
):
    raise ImproperlyConfigured(
        'POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD must be set when CLASHFORGE_DATABASE=postgres.'
    )

redis_url = env_str('CLASHFORGE_REDIS_URL', '')
if redis_url:
    CACHES = {
        'default': {
            'BACKEND': 'django_redis.cache.RedisCache',
            'LOCATION': redis_url,
            'OPTIONS': {
                'CLIENT_CLASS': 'django_redis.client.DefaultClient',
                'IGNORE_EXCEPTIONS': False,
            },
            'KEY_PREFIX': env_str('CLASHFORGE_CACHE_KEY_PREFIX', 'clashforge'),
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'clashforge-local-dev',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 12},
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'America/New_York'
USE_I18N = True
USE_TZ = True
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

SESSION_COOKIE_AGE = 6000
SESSION_EXPIRE_AT_BROWSER_CLOSE = True

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
SECURE_CROSS_ORIGIN_RESOURCE_POLICY = 'same-origin'

if IS_PRODUCTION:
    SESSION_SAVE_EVERY_REQUEST = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = True
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 31536000
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    X_FRAME_OPTIONS = 'DENY'
    USE_X_FORWARDED_HOST = env_bool('DJANGO_USE_X_FORWARDED_HOST', True)
    CSRF_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_SAMESITE = 'Lax'
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
else:
    SECURE_SSL_REDIRECT = False
    SESSION_COOKIE_SECURE = False
    CSRF_COOKIE_SECURE = False
    SECURE_HSTS_SECONDS = 0
    X_FRAME_OPTIONS = 'DENY'

default_renderer_classes = ['rest_framework.renderers.JSONRenderer']
if not IS_PRODUCTION:
    default_renderer_classes.append('rest_framework.renderers.BrowsableAPIRenderer')

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': default_renderer_classes,
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
    'NUM_PROXIES': CLASHFORGE_NUM_PROXIES if CLASHFORGE_TRUST_X_FORWARDED_FOR else None,
    'DEFAULT_THROTTLE_RATES': {
        'public_read_burst': env_str('CLASHFORGE_THROTTLE_PUBLIC_READ_BURST', '5/minute'),
        'public_read_sustained': env_str('CLASHFORGE_THROTTLE_PUBLIC_READ_SUSTAINED', '300/hour'),
        'fighter_create_burst': env_str('CLASHFORGE_THROTTLE_FIGHTER_CREATE_BURST', '5/minute'),
        'fighter_create_sustained': env_str('CLASHFORGE_THROTTLE_FIGHTER_CREATE_SUSTAINED', '20/hour'),
        'fighter_create_session_sustained': env_str(
            'CLASHFORGE_THROTTLE_FIGHTER_CREATE_SESSION_SUSTAINED',
            '12/day',
        ),
        'fighter_update_burst': env_str('CLASHFORGE_THROTTLE_FIGHTER_UPDATE_BURST', '5/minute'),
        'fighter_update_sustained': env_str('CLASHFORGE_THROTTLE_FIGHTER_UPDATE_SUSTAINED', '30/hour'),
        'fighter_update_session_sustained': env_str(
            'CLASHFORGE_THROTTLE_FIGHTER_UPDATE_SESSION_SUSTAINED',
            '60/day',
        ),
        'battle_run_burst': env_str('CLASHFORGE_THROTTLE_BATTLE_RUN_BURST', '5/minute'),
        'battle_run_sustained': env_str('CLASHFORGE_THROTTLE_BATTLE_RUN_SUSTAINED', '30/hour'),
        'battle_run_session_sustained': env_str(
            'CLASHFORGE_THROTTLE_BATTLE_RUN_SESSION_SUSTAINED',
            '60/day',
        ),
        'creative_assist_burst': env_str('CLASHFORGE_THROTTLE_CREATIVE_ASSIST_BURST', '3/minute'),
        'creative_assist_sustained': env_str('CLASHFORGE_THROTTLE_CREATIVE_ASSIST_SUSTAINED', '12/hour'),
        'creative_assist_session_sustained': env_str(
            'CLASHFORGE_THROTTLE_CREATIVE_ASSIST_SESSION_SUSTAINED',
            '24/day',
        ),
    },
}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'security': {
            'format': (
                '%(asctime)s %(levelname)s %(name)s %(message)s '
                'path=%(path)s method=%(method)s client=%(client)s scope=%(scope)s'
            ),
        },
    },
    'filters': {
        'security_defaults': {
            '()': 'clashforge.security.SecurityLogDefaultsFilter',
        },
    },
    'handlers': {
        'security_console': {
            'class': 'logging.StreamHandler',
            'formatter': 'security',
            'filters': ['security_defaults'],
        },
    },
    'loggers': {
        'clashforge.security': {
            'handlers': ['security_console'],
            'level': env_str('CLASHFORGE_SECURITY_LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
    },
}


def validate_production_settings() -> None:
    if not IS_PRODUCTION:
        return

    errors = []
    if not RAW_CLASHFORGE_ENV:
        errors.append('CLASHFORGE_ENV must be explicitly set to production.')
    if DEBUG:
        errors.append('DJANGO_DEBUG must be false in production.')
    if not SECRET_KEY or len(SECRET_KEY) < 50:
        errors.append('DJANGO_SECRET_KEY must be set to a strong production secret.')
    if not ALLOWED_HOSTS:
        errors.append('DJANGO_ALLOWED_HOSTS must be set in production.')
    for host in ALLOWED_HOSTS:
        if host == '*':
            errors.append('DJANGO_ALLOWED_HOSTS cannot contain * in production.')
            continue
        if '://' in host or '/' in host or not host.strip():
            errors.append(f'DJANGO_ALLOWED_HOSTS contains an invalid host entry: {host!r}.')
    if not CSRF_TRUSTED_ORIGINS:
        errors.append('DJANGO_CSRF_TRUSTED_ORIGINS must be set in production.')
    for origin in CSRF_TRUSTED_ORIGINS:
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.path not in {'', '/'}:
            errors.append(
                'DJANGO_CSRF_TRUSTED_ORIGINS entries must be HTTPS origins like '
                f'https://example.com; invalid entry: {origin!r}.'
            )
    if not redis_url:
        errors.append('CLASHFORGE_REDIS_URL must be set in production for shared throttling.')
    if not DATABASES['default'].get('USER') or not DATABASES['default'].get('PASSWORD'):
        errors.append('POSTGRES_USER and POSTGRES_PASSWORD must be set in production.')
    if DATABASE_ENGINE != 'postgres':
        errors.append('CLASHFORGE_DATABASE must be postgres in production.')
    if not SECURE_SSL_REDIRECT:
        errors.append('SECURE_SSL_REDIRECT must be enabled in production.')
    if not SESSION_COOKIE_SECURE or not CSRF_COOKIE_SECURE:
        errors.append('Secure session and CSRF cookies must be enabled in production.')
    if SECURE_HSTS_SECONDS < 31536000:
        errors.append('SECURE_HSTS_SECONDS must be at least one year in production.')
    if CLASHFORGE_CSP_ALLOW_UNSAFE_EVAL:
        errors.append('CLASHFORGE_CSP_ALLOW_UNSAFE_EVAL must be disabled in production.')

    if errors:
        raise ImproperlyConfigured('Production configuration is unsafe: ' + ' '.join(errors))


validate_production_settings()
