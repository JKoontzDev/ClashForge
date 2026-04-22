import hashlib
import hmac
import logging
import secrets
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.exceptions import APIException, NotFound, ParseError, PermissionDenied, Throttled
from rest_framework.response import Response
from rest_framework.views import APIView

from clashforge.security import (
    RequestRateLimitMiddleware,
    attach_anonymous_client_cookie,
    get_anonymous_client_id,
)

from .models import Character, FightHistory
from .services.combat import run_official_battle
from .serializers import (
    BattleHistorySerializer,
    BattleRunRequestSerializer,
    CreativeAssistRequestSerializer,
    CreativeAssistResponseSerializer,
    CreativeSuggestionSerializer,
    FighterCreateSerializer,
    FighterCreateResponseSerializer,
    FighterPublicSerializer,
    FighterUpdateSerializer,
)
from .services.creative_assistant import (
    CreativeAssistantInvalidOutput,
    CreativeAssistantUnavailable,
    request_ollama_creative,
)
from .throttles import (
    BattleRunBurstThrottle,
    BattleRunSustainedThrottle,
    CreativeAssistBurstThrottle,
    CreativeAssistSessionSustainedThrottle,
    CreativeAssistSustainedThrottle,
    FighterCreateBurstThrottle,
    FighterCreateSessionSustainedThrottle,
    FighterCreateSustainedThrottle,
    PublicReadBurstThrottle,
    PublicReadSustainedThrottle,
    FighterUpdateBurstThrottle,
    FighterUpdateSessionSustainedThrottle,
    FighterUpdateSustainedThrottle,
    BattleRunSessionSustainedThrottle,
)


logger = logging.getLogger('clashforge.security')


class RateLimitUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = 'Request protection is temporarily unavailable. Try again shortly.'
    default_code = 'rate_limit_unavailable'


def _hash_edit_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _shareable_fighter_queryset():
    return Character.objects.filter(
        visibility__in=[
            Character.Visibility.PUBLIC,
            Character.Visibility.UNLISTED,
        ],
        is_benchmark=False,
    )


def _public_fighter_queryset():
    return Character.objects.filter(
        visibility=Character.Visibility.PUBLIC,
        is_benchmark=False,
    ).order_by('name')


def _public_battle_history_queryset():
    return FightHistory.objects.select_related('fighter_a', 'fighter_b', 'winner').filter(
        fighter_a__visibility=Character.Visibility.PUBLIC,
        fighter_a__is_benchmark=False,
        fighter_b__visibility=Character.Visibility.PUBLIC,
        fighter_b__is_benchmark=False,
    )


def _enforce_weighted_daily_quota(
    request,
    *,
    scope: str,
    amount: int,
    ip_limit: int,
    session_limit: int,
) -> None:
    client_ident = RequestRateLimitMiddleware._client_ident(request)
    anonymous_id = get_anonymous_client_id(request)
    limits = [
        (f'clashforge:quota:{scope}:ip:{client_ident}', ip_limit),
        (f'clashforge:quota:{scope}:anon:{anonymous_id}', session_limit),
    ]
    try:
        for key, limit in limits:
            cache.add(key, 0, timeout=60 * 60 * 24)
            current = cache.incr(key, amount)
            if current > limit:
                logger.warning(
                    'weighted_quota_exceeded',
                    extra={
                        'scope': scope,
                        'path': request.path,
                        'method': request.method,
                        'client': client_ident,
                    },
                )
                raise Throttled(detail='Daily quota exceeded. Try again later.')
    except Throttled:
        raise
    except Exception as exc:
        logger.exception(
            'weighted_quota_cache_error',
            extra={
                'scope': scope,
                'path': request.path,
                'method': request.method,
                'client': client_ident,
            },
        )
        raise RateLimitUnavailable() from exc


class RequestBodyLimitMixin:
    max_body_bytes: int | None = None
    required_client_headers = {'web', 'api'}

    @staticmethod
    def _is_allowed_origin(request, origin: str) -> bool:
        parsed = urlsplit(origin)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            return False
        if origin in settings.CSRF_TRUSTED_ORIGINS:
            return True
        return origin == f'{request.scheme}://{request.get_host()}'

    def _enforce_unsafe_request_shape(self, request) -> None:
        if request.method not in {'POST', 'PATCH', 'PUT', 'DELETE'}:
            return

        content_type = (request.content_type or '').split(';', 1)[0].strip().lower()
        if content_type != 'application/json':
            raise ParseError('Requests must use application/json.')

        client_header = request.headers.get('X-ClashForge-Client', '').strip().lower()
        if client_header not in self.required_client_headers:
            logger.warning(
                'invalid_client_header',
                extra={'path': request.path, 'method': request.method},
            )
            raise PermissionDenied('Missing or invalid X-ClashForge-Client header.')

        fetch_site = request.headers.get('Sec-Fetch-Site', '').strip().lower()
        if fetch_site and fetch_site not in {'same-origin', 'same-site', 'none'}:
            logger.warning(
                'invalid_fetch_site',
                extra={'path': request.path, 'method': request.method, 'fetch_site': fetch_site},
            )
            raise PermissionDenied('Cross-site browser requests are not allowed.')

        origin = request.headers.get('Origin', '').strip()
        if origin and not self._is_allowed_origin(request, origin):
            logger.warning(
                'invalid_origin',
                extra={'path': request.path, 'method': request.method},
            )
            raise PermissionDenied('Origin is not allowed for this endpoint.')

    def initial(self, request, *args, **kwargs):
        self._enforce_unsafe_request_shape(request)
        if request.method in {'POST', 'PATCH', 'PUT', 'DELETE'}:
            get_anonymous_client_id(request)
        max_body_bytes = getattr(self, 'max_body_bytes', None)
        if max_body_bytes is not None:
            raw_content_length = request.META.get('CONTENT_LENGTH', '').strip()
            if raw_content_length:
                try:
                    content_length = int(raw_content_length)
                except ValueError:
                    raise ParseError('Invalid Content-Length header.')
                if content_length > max_body_bytes:
                    raise ParseError(
                        f'Request body too large. Keep it under {max_body_bytes} bytes.'
                    )

        return super().initial(request, *args, **kwargs)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if request.method in {'POST', 'PATCH', 'PUT', 'DELETE'}:
            attach_anonymous_client_cookie(request, response)
        return response


class BootstrapView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        PublicReadBurstThrottle,
        PublicReadSustainedThrottle,
    ]

    def get(self, request):
        fighters = FighterPublicSerializer(_public_fighter_queryset()[:100], many=True).data
        recent_battles = BattleHistorySerializer(
            _public_battle_history_queryset()[:12],
            many=True,
        ).data
        return Response(
            {
                'fighters': fighters,
                'characters': fighters,
                'recent_battles': recent_battles,
                'recent_fights': recent_battles,
            }
        )


class FighterListCreateView(RequestBodyLimitMixin, APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        FighterCreateBurstThrottle,
        FighterCreateSustainedThrottle,
        FighterCreateSessionSustainedThrottle,
    ]
    read_throttle_classes = [
        PublicReadBurstThrottle,
        PublicReadSustainedThrottle,
    ]
    max_body_bytes = settings.FIGHTER_WRITE_MAX_BODY_BYTES

    def get_throttles(self):
        if self.request.method != 'POST':
            return [throttle() for throttle in self.read_throttle_classes]
        return super().get_throttles()

    def get(self, request):
        fighters = _public_fighter_queryset()[:100]
        return Response(FighterPublicSerializer(fighters, many=True).data)

    def post(self, request):
        serializer = FighterCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        edit_token = secrets.token_urlsafe(24)
        fighter = serializer.save(source='user', edit_token_hash=_hash_edit_token(edit_token))
        response_data = FighterCreateResponseSerializer(fighter).data
        response_data['edit_token'] = edit_token
        return Response(response_data, status=status.HTTP_201_CREATED)


class FighterDetailView(RequestBodyLimitMixin, APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        FighterUpdateBurstThrottle,
        FighterUpdateSustainedThrottle,
        FighterUpdateSessionSustainedThrottle,
    ]
    read_throttle_classes = [
        PublicReadBurstThrottle,
        PublicReadSustainedThrottle,
    ]
    max_body_bytes = settings.FIGHTER_WRITE_MAX_BODY_BYTES

    def get_throttles(self):
        if self.request.method != 'PATCH':
            return [throttle() for throttle in self.read_throttle_classes]
        return super().get_throttles()

    def get(self, request, fighter_id: int):
        fighter = get_object_or_404(_public_fighter_queryset(), pk=fighter_id)
        return Response(FighterPublicSerializer(fighter).data)

    def patch(self, request, fighter_id: int):
        provided_token = request.headers.get('X-Fighter-Edit-Token', '').strip()
        if not provided_token:
            logger.warning(
                'fighter_update_token_missing',
                extra={'fighter_id': fighter_id, 'path': request.path},
            )
            raise NotFound('Fighter not found or edit token invalid.')

        fighter = Character.objects.filter(
            pk=fighter_id,
            source=Character.Source.USER,
        ).exclude(edit_token_hash='').first()

        if not fighter or not hmac.compare_digest(
            fighter.edit_token_hash,
            _hash_edit_token(provided_token),
        ):
            logger.warning(
                'fighter_update_token_invalid',
                extra={'fighter_id': fighter_id, 'path': request.path},
            )
            raise NotFound('Fighter not found or edit token invalid.')

        serializer = FighterUpdateSerializer(fighter, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fighter = serializer.save()
        return Response(FighterPublicSerializer(fighter).data)


class ShareableFighterBySlugView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        PublicReadBurstThrottle,
        PublicReadSustainedThrottle,
    ]

    def get(self, request, fighter_slug: str):
        fighter = get_object_or_404(_shareable_fighter_queryset(), slug=fighter_slug)
        return Response(FighterPublicSerializer(fighter).data)


class BattleListView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        PublicReadBurstThrottle,
        PublicReadSustainedThrottle,
    ]

    def get(self, request):
        battles = _public_battle_history_queryset()[:50]
        return Response(BattleHistorySerializer(battles, many=True).data)


class ForgeCreativeAssistView(RequestBodyLimitMixin, APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        CreativeAssistBurstThrottle,
        CreativeAssistSustainedThrottle,
        CreativeAssistSessionSustainedThrottle,
    ]
    max_body_bytes = settings.CREATIVE_ASSIST_MAX_BODY_BYTES

    def post(self, request):
        serializer = CreativeAssistRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            if not settings.OLLAMA_PUBLIC_API_ENABLED:
                raise CreativeAssistantUnavailable(
                    'Ollama flavor assist is disabled for public traffic. Using procedural flavor only.'
                )
            creative_result = request_ollama_creative(
                archetype=serializer.validated_data['archetype'],
                prompt=serializer.validated_data['prompt'],
                base_fighter=serializer.validated_data['base_fighter'],
                model=serializer.validated_data['model'],
            )
        except CreativeAssistantUnavailable as exc:
            payload = {
                'provider': 'fallback',
                'available': False,
                'used_model': '',
                'message': str(exc),
                'suggestions': None,
            }
        except CreativeAssistantInvalidOutput:
            payload = {
                'provider': 'fallback',
                'available': False,
                'used_model': '',
                'message': 'Ollama returned invalid flavor output. Using procedural flavor only.',
                'suggestions': None,
            }
        else:
            suggestion_serializer = CreativeSuggestionSerializer(data=creative_result.suggestions)
            if suggestion_serializer.is_valid():
                payload = {
                    'provider': 'ollama',
                    'available': True,
                    'used_model': creative_result.used_model,
                    'message': (
                        'Ollama flavor assist applied. Stats and combat rules still come from '
                        'the validated forge draft.'
                    ),
                    'suggestions': suggestion_serializer.validated_data,
                }
            else:
                payload = {
                    'provider': 'fallback',
                    'available': False,
                    'used_model': '',
                    'message': 'Ollama returned flavor outside the allowed schema. Using procedural flavor only.',
                    'suggestions': None,
                }

        response_serializer = CreativeAssistResponseSerializer(data=payload)
        response_serializer.is_valid(raise_exception=True)
        return Response(response_serializer.validated_data)


class BattleRunView(RequestBodyLimitMixin, APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [
        BattleRunBurstThrottle,
        BattleRunSustainedThrottle,
        BattleRunSessionSustainedThrottle,
    ]
    max_body_bytes = settings.BATTLE_RUN_MAX_BODY_BYTES

    def post(self, request):
        serializer = BattleRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sim_count = serializer.validated_data['sim_count']
        _enforce_weighted_daily_quota(
            request,
            scope='battle_sim',
            amount=sim_count,
            ip_limit=settings.CLASHFORGE_BATTLE_SIM_IP_DAILY_QUOTA,
            session_limit=settings.CLASHFORGE_BATTLE_SIM_SESSION_DAILY_QUOTA,
        )
        battle, result = run_official_battle(
            serializer.validated_data['fighter_a'],
            serializer.validated_data['fighter_b'],
            sim_count=sim_count,
        )
        return Response(
            {
                'battle': BattleHistorySerializer(battle).data,
                'result': result,
            },
            status=status.HTTP_201_CREATED,
        )
