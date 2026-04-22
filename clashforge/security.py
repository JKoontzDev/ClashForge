import time
import secrets
import logging
import ipaddress

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpResponse, JsonResponse


logger = logging.getLogger('clashforge.security')
ANONYMOUS_ID_COOKIE = 'clashforge_anon_id'
ANONYMOUS_ID_MAX_AGE = 60 * 60 * 24 * 30
ANONYMOUS_ID_SALT = 'clashforge.anonymous-client'


class InvalidForwardedFor(ValueError):
    pass


class SecurityLogDefaultsFilter(logging.Filter):
    def filter(self, record):
        for field in ('path', 'method', 'client', 'scope'):
            if not hasattr(record, field):
                setattr(record, field, '-')
        return True


def get_anonymous_client_id(request) -> str:
    cookie_value = request.COOKIES.get(ANONYMOUS_ID_COOKIE, '')
    if cookie_value:
        try:
            anonymous_id = signing.loads(
                cookie_value,
                salt=ANONYMOUS_ID_SALT,
                max_age=ANONYMOUS_ID_MAX_AGE,
            )
        except signing.BadSignature:
            anonymous_id = ''
        if isinstance(anonymous_id, str) and anonymous_id:
            return anonymous_id

    anonymous_id = secrets.token_urlsafe(18)
    request._clashforge_new_anonymous_id = anonymous_id
    return anonymous_id


def attach_anonymous_client_cookie(request, response):
    anonymous_id = getattr(request, '_clashforge_new_anonymous_id', '')
    if not anonymous_id:
        return response

    response.set_cookie(
        ANONYMOUS_ID_COOKIE,
        signing.dumps(anonymous_id, salt=ANONYMOUS_ID_SALT),
        max_age=ANONYMOUS_ID_MAX_AGE,
        secure=getattr(settings, 'SESSION_COOKIE_SECURE', False),
        httponly=True,
        samesite='Lax',
    )
    return response


def build_content_security_policy(nonce: str) -> str:
    script_src = [
        "'self'",
        f"'nonce-{nonce}'",
        'https://cdn.jsdelivr.net',
    ]
    if getattr(settings, 'CLASHFORGE_CSP_ALLOW_UNSAFE_EVAL', True):
        script_src.append("'unsafe-eval'")

    directives = {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'script-src': script_src,
        'style-src': ["'self'", "'unsafe-inline'"],
        'connect-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
    }
    return '; '.join(
        f"{directive} {' '.join(values)}"
        for directive, values in directives.items()
    )


class ContentSecurityPolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.csp_nonce = secrets.token_urlsafe(16)
        response = self.get_response(request)
        response.setdefault(
            'Content-Security-Policy',
            build_content_security_policy(request.csp_nonce),
        )
        response.setdefault('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
        response.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        response.setdefault('Cross-Origin-Resource-Policy', 'same-origin')
        return response


def _parse_rate(rate: str) -> tuple[int, int]:
    if not rate or '/' not in rate:
        raise ImproperlyConfigured(f'Invalid rate limit value: {rate!r}')

    num, period = rate.split('/', 1)
    try:
        requests = int(num)
    except ValueError as exc:
        raise ImproperlyConfigured(f'Invalid rate limit request count: {rate!r}') from exc

    if requests <= 0:
        raise ImproperlyConfigured(f'Rate limit must be greater than zero: {rate!r}')

    periods = {
        's': 1,
        'm': 60,
        'h': 60 * 60,
        'd': 60 * 60 * 24,
    }
    duration = periods.get(period.strip().lower()[:1])
    if duration is None:
        raise ImproperlyConfigured(f'Invalid rate limit period: {rate!r}')
    return requests, duration


def _dynamic_route_path(path: str) -> bool:
    return not (
        path.startswith('/static/')
        or path == '/favicon.ico'
        or path.startswith('/robots.txt')
    )


def _page_view_path(path: str) -> bool:
    return (
        _dynamic_route_path(path)
        and not path.startswith('/api/')
    )


class RequestRateLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    @staticmethod
    def _client_ident(request) -> str:
        remote_addr = request.META.get('REMOTE_ADDR', 'unknown')
        trusted_proxies = set(getattr(settings, 'CLASHFORGE_TRUSTED_PROXY_IPS', []))
        trust_forwarded = getattr(settings, 'CLASHFORGE_TRUST_X_FORWARDED_FOR', False)
        if trust_forwarded and remote_addr in trusted_proxies:
            forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
            forwarded_chain = [
                entry.strip()
                for entry in forwarded_for.split(',')
                if entry.strip()
            ]
            if forwarded_for and not forwarded_chain:
                raise InvalidForwardedFor('X-Forwarded-For contains no usable entries.')
            for entry in forwarded_chain:
                try:
                    ipaddress.ip_address(entry)
                except ValueError as exc:
                    raise InvalidForwardedFor(
                        f'X-Forwarded-For contains an invalid IP address: {entry!r}.'
                    ) from exc
            if forwarded_chain:
                num_proxies = getattr(settings, 'CLASHFORGE_NUM_PROXIES', 1)
                if len(forwarded_chain) < num_proxies:
                    raise InvalidForwardedFor(
                        'X-Forwarded-For chain is shorter than CLASHFORGE_NUM_PROXIES.'
                    )
                client_index = max(0, len(forwarded_chain) - num_proxies - 1)
                return forwarded_chain[client_index]
        return remote_addr

    @staticmethod
    def _admin_path_prefix() -> str:
        return f'/{settings.CLASHFORGE_ADMIN_PATH.strip("/")}/'

    def _is_admin_path(self, path: str) -> bool:
        return path.startswith(self._admin_path_prefix())

    @staticmethod
    def _is_unsafe_api_write(request) -> bool:
        return (
            request.path.startswith('/api/')
            and request.method.upper() in {'POST', 'PATCH', 'PUT', 'DELETE'}
        )

    def _rule_specs(self, request):
        method = request.method.upper()
        path = request.path

        rules = []
        if self._is_admin_path(path):
            rules.extend(
                [
                    ('admin_burst', settings.CLASHFORGE_ADMIN_BURST_RATE, True),
                    ('admin_sustained', settings.CLASHFORGE_ADMIN_SUSTAINED_RATE, True),
                ]
            )
            if method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
                rules.extend(
                    [
                        ('admin_post_burst', settings.CLASHFORGE_ADMIN_POST_BURST_RATE, True),
                        (
                            'admin_post_sustained',
                            settings.CLASHFORGE_ADMIN_POST_SUSTAINED_RATE,
                            True,
                        ),
                    ]
                )

        if self._is_unsafe_api_write(request):
            rules.extend(
                [
                    ('api_write_burst', settings.CLASHFORGE_API_WRITE_BURST_RATE, True),
                    ('api_write_sustained', settings.CLASHFORGE_API_WRITE_SUSTAINED_RATE, True),
                ]
            )

        if _dynamic_route_path(path):
            rules.extend(
                [
                    ('dynamic_burst', settings.CLASHFORGE_DYNAMIC_BURST_RATE, False),
                    ('dynamic_sustained', settings.CLASHFORGE_DYNAMIC_SUSTAINED_RATE, False),
                ]
            )

        if method in {'GET', 'HEAD'} and _page_view_path(path):
            rules.extend(
                [
                    ('page_view_burst', settings.CLASHFORGE_PAGE_VIEW_BURST_RATE, False),
                    ('page_view_sustained', settings.CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE, False),
                ]
            )

        return rules

    def _hit_limit(self, request, scope: str, rate: str) -> int | None:
        limit, window = _parse_rate(rate)
        ident = self._client_ident(request)
        counter_key = f'clashforge:ratelimit:{scope}:count:{ident}'
        started_key = f'clashforge:ratelimit:{scope}:start:{ident}'
        now = time.time()

        try:
            cache.add(counter_key, 0, timeout=window)
            cache.add(started_key, now, timeout=window)
            current = cache.incr(counter_key)
            started = cache.get(started_key) or now
        except Exception as exc:
            logger.exception(
                'rate_limit_cache_error',
                extra={
                    'scope': scope,
                    'path': request.path,
                    'method': request.method,
                    'client': ident,
                },
            )
            raise RuntimeError('rate limit cache unavailable') from exc

        if current <= limit:
            return None

        retry_after = max(1, int(window - (now - float(started))))
        return retry_after

    def _throttled_response(self, request, retry_after: int):
        message = 'Too many requests from this IP. Slow down and try again shortly.'
        if request.path.startswith('/api/'):
            response = JsonResponse({'detail': message}, status=429)
        else:
            response = HttpResponse(message, status=429, content_type='text/plain; charset=utf-8')
        response['Retry-After'] = str(retry_after)
        return response

    @staticmethod
    def _rate_limit_unavailable_response(request):
        message = 'Request protection is temporarily unavailable. Try again shortly.'
        if request.path.startswith('/api/'):
            return JsonResponse({'detail': message}, status=503)
        return HttpResponse(message, status=503, content_type='text/plain; charset=utf-8')

    def __call__(self, request):
        for scope, rate, fail_closed in self._rule_specs(request):
            try:
                retry_after = self._hit_limit(request, scope, rate)
            except InvalidForwardedFor as exc:
                logger.warning(
                    'invalid_forwarded_for',
                    extra={
                        'scope': scope,
                        'path': request.path,
                        'method': request.method,
                        'client': request.META.get('REMOTE_ADDR', 'unknown'),
                    },
                )
                if request.path.startswith('/api/'):
                    return JsonResponse({'detail': str(exc)}, status=400)
                return HttpResponse(str(exc), status=400, content_type='text/plain; charset=utf-8')
            except RuntimeError:
                if fail_closed:
                    return self._rate_limit_unavailable_response(request)
                continue
            if retry_after is not None:
                logger.warning(
                    'request_throttled',
                    extra={
                        'scope': scope,
                        'path': request.path,
                        'method': request.method,
                        'client': self._client_ident(request),
                        'retry_after': retry_after,
                    },
                )
                return self._throttled_response(request, retry_after)
        return self.get_response(request)
