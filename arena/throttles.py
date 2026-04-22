from django.core.exceptions import ImproperlyConfigured
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.settings import api_settings

from clashforge.security import RequestRateLimitMiddleware, get_anonymous_client_id


class BaseClientRateThrottle(SimpleRateThrottle):
    scope = 'client'

    def get_client_ident(self, request):
        return RequestRateLimitMiddleware._client_ident(request)

    def get_cache_key(self, request, view):
        user = getattr(request, 'user', None)
        if user and user.is_authenticated:
            ident = f'user:{user.pk}'
        else:
            ident = f'ip:{self.get_client_ident(request)}'
        return self.cache_format % {
            'scope': self.scope,
            'ident': ident,
        }

    def get_rate(self):
        try:
            return api_settings.DEFAULT_THROTTLE_RATES[self.scope]
        except KeyError as exc:
            raise ImproperlyConfigured(
                f'No default throttle rate set for "{self.scope}".'
            ) from exc


class BaseSessionRateThrottle(BaseClientRateThrottle):
    def get_cache_key(self, request, view):
        user = getattr(request, 'user', None)
        if user and user.is_authenticated:
            ident = f'user:{user.pk}'
        else:
            ident = f'anon:{get_anonymous_client_id(request)}'
        return self.cache_format % {
            'scope': self.scope,
            'ident': ident,
        }


class FighterCreateBurstThrottle(BaseClientRateThrottle):
    scope = 'fighter_create_burst'


class FighterCreateSustainedThrottle(BaseClientRateThrottle):
    scope = 'fighter_create_sustained'


class FighterCreateSessionSustainedThrottle(BaseSessionRateThrottle):
    scope = 'fighter_create_session_sustained'


class FighterUpdateBurstThrottle(BaseClientRateThrottle):
    scope = 'fighter_update_burst'


class FighterUpdateSustainedThrottle(BaseClientRateThrottle):
    scope = 'fighter_update_sustained'


class FighterUpdateSessionSustainedThrottle(BaseSessionRateThrottle):
    scope = 'fighter_update_session_sustained'


class PublicReadBurstThrottle(BaseClientRateThrottle):
    scope = 'public_read_burst'


class PublicReadSustainedThrottle(BaseClientRateThrottle):
    scope = 'public_read_sustained'


class BattleRunBurstThrottle(BaseClientRateThrottle):
    scope = 'battle_run_burst'


class BattleRunSustainedThrottle(BaseClientRateThrottle):
    scope = 'battle_run_sustained'


class BattleRunSessionSustainedThrottle(BaseSessionRateThrottle):
    scope = 'battle_run_session_sustained'


class CreativeAssistBurstThrottle(BaseClientRateThrottle):
    scope = 'creative_assist_burst'


class CreativeAssistSustainedThrottle(BaseClientRateThrottle):
    scope = 'creative_assist_sustained'


class CreativeAssistSessionSustainedThrottle(BaseSessionRateThrottle):
    scope = 'creative_assist_session_sustained'
