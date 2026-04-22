import json
import socket
from dataclasses import dataclass
from urllib import error, request

from django.conf import settings


MAX_OLLAMA_RESPONSE_CHARS = 4000


class CreativeAssistantUnavailable(Exception):
    pass


class CreativeAssistantInvalidOutput(Exception):
    pass


@dataclass
class CreativeAssistResult:
    used_model: str
    suggestions: dict


def _trim_text(value: str, limit: int) -> str:
    return str(value or '').strip()[:limit]


def _build_ollama_prompt(archetype: str, prompt: str, base_fighter: dict) -> str:
    ability_lines = []
    for index, ability in enumerate(base_fighter.get('abilities', [])):
        ability_lines.append(
            (
                f'{index}: {ability.get("type")} | power={ability.get("power", 0)} '
                f'cooldown={ability.get("cooldown", 0)} '
                f'scaling={ability.get("scaling", "n/a")} '
                f'duration={ability.get("duration", "n/a")} '
                f'effect={json.dumps(ability.get("effect", {}), sort_keys=True)}'
            )
        )

    summary = {
        'archetype': archetype,
        'prompt': _trim_text(prompt, 600),
        'base_fighter': {
            'name': _trim_text(base_fighter.get('name', ''), 60),
            'title': _trim_text(base_fighter.get('title', ''), 80),
            'description': _trim_text(base_fighter.get('description', ''), 600),
            'passive_name': _trim_text(base_fighter.get('passive_name', ''), 60),
            'passive_description': _trim_text(base_fighter.get('passive_description', ''), 320),
            'stats': {
                'strength': base_fighter.get('strength'),
                'speed': base_fighter.get('speed'),
                'durability': base_fighter.get('durability'),
                'intelligence': base_fighter.get('intelligence'),
                'max_health': base_fighter.get('max_health'),
            },
            'abilities': ability_lines,
            'win_condition': _trim_text(base_fighter.get('win_condition', ''), 240),
        },
    }

    return (
        'You are writing creative flavor for ClashForge fighters. '
        'You may only suggest flavor text. Do not change combat mechanics, stats, cooldowns, '
        'effect keys, durations, archetypes, visibility, or any security-sensitive field.\n\n'
        'Return JSON only with this shape:\n'
        '{'
        '"name":"string",'
        '"title":"string",'
        '"description":"string",'
        '"passive_name":"string",'
        '"passive_description":"string",'
        '"abilities":[{"index":0,"name":"string","description":"string"}]'
        '}\n'
        'Rules:\n'
        '- Keep the same number of abilities and use only the provided indexes.\n'
        '- Keep names stylish but practical.\n'
        '- Do not include markdown, commentary, or extra keys.\n'
        '- Stay within these character limits: name 60, title 80, description 600, '
        'passive_name 60, passive_description 320, ability name 60, ability description 240.\n\n'
        f'Forge context:\n{json.dumps(summary, ensure_ascii=True)}'
    )


def request_ollama_creative(*, archetype: str, prompt: str, base_fighter: dict, model: str = '') -> CreativeAssistResult:
    if not settings.OLLAMA_ENABLED:
        raise CreativeAssistantUnavailable(
            'Ollama flavor assist is disabled. Using procedural flavor only.'
        )

    allowed_models = {
        candidate.strip()
        for candidate in getattr(settings, 'OLLAMA_ALLOWED_MODELS', [])
        if candidate.strip()
    }
    default_model = settings.OLLAMA_MODEL.strip()
    requested_model = (model or '').strip()
    if requested_model and requested_model not in allowed_models:
        raise CreativeAssistantUnavailable(
            'Requested flavor model is not allowed. Using procedural flavor only.'
        )
    used_model = requested_model or default_model
    if allowed_models and used_model not in allowed_models:
        raise CreativeAssistantUnavailable(
            'Configured flavor model is not allowed. Using procedural flavor only.'
        )
    endpoint = f'{settings.OLLAMA_BASE_URL.rstrip("/")}/api/generate'
    payload = {
        'model': used_model,
        'prompt': _build_ollama_prompt(archetype, prompt, base_fighter),
        'format': 'json',
        'stream': False,
    }
    body = json.dumps(payload).encode('utf-8')
    req = request.Request(
        endpoint,
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with request.urlopen(req, timeout=settings.OLLAMA_TIMEOUT_SECONDS) as response:
            raw_body = response.read().decode('utf-8')
    except error.HTTPError as exc:
        raise CreativeAssistantUnavailable(
            f'Ollama returned HTTP {exc.code}. Using procedural flavor only.'
        ) from exc
    except (error.URLError, TimeoutError, socket.timeout) as exc:
        raise CreativeAssistantUnavailable(
            'Ollama is unavailable. Using procedural flavor only.'
        ) from exc

    try:
        envelope = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise CreativeAssistantInvalidOutput('Ollama returned invalid JSON.') from exc

    response_text = str(envelope.get('response', '')).strip()
    if not response_text:
        raise CreativeAssistantInvalidOutput('Ollama returned an empty response.')
    if len(response_text) > MAX_OLLAMA_RESPONSE_CHARS:
        raise CreativeAssistantInvalidOutput('Ollama response exceeded the safe size limit.')

    try:
        suggestions = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise CreativeAssistantInvalidOutput('Ollama returned malformed flavor JSON.') from exc

    if not isinstance(suggestions, dict):
        raise CreativeAssistantInvalidOutput('Ollama returned an unsupported response shape.')

    return CreativeAssistResult(
        used_model=used_model,
        suggestions=suggestions,
    )
