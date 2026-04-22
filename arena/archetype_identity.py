from collections.abc import Mapping

from .models import Character


ARCHETYPE_GUIDES = {
    Character.Archetype.ASSASSIN: {
        'label': 'Assassin',
        'summary': 'Fast opener that lives on first-touch burst and tempo theft.',
        'strengths': [
            'Claims initiative before slower kits can stabilize.',
            'Punishes hesitation with stacked burst windows.',
            'Converts short cooldown loops into sudden round-ending pressure.',
        ],
        'weaknesses': [
            'Falls off when the fight drags into attrition.',
            'Gets punished hard by armor, stall, and missed commits.',
        ],
        'win_pattern': 'Strike first, keep the opponent off balance, and end the fight before durability takes over.',
        'benchmark_use': 'Useful for checking whether a fighter survives explosive openers and early snowball pressure.',
        'role_tags': ['burst', 'evasive', 'punish'],
    },
    Character.Archetype.TANK: {
        'label': 'Tank',
        'summary': 'Frontline anchor that slows the fight down and wins on staying power.',
        'strengths': [
            'Blunts burst-heavy opponents and survives bad openings.',
            'Turns long rounds into favorable attrition math.',
            'Punishes reckless offense with thick counter-hit windows.',
        ],
        'weaknesses': [
            'Struggles to seize initiative against cleaner tempo kits.',
            'Can be outmaneuvered if it never gets to force a long exchange.',
        ],
        'win_pattern': 'Absorb the first wave, collapse the opponent’s damage cycle, then win the late fight.',
        'benchmark_use': 'Useful for testing anti-burst damage, sustain, and whether a kit can actually break a wall.',
        'role_tags': ['frontline', 'attrition', 'punish'],
    },
    Character.Archetype.BRUISER: {
        'label': 'Bruiser',
        'summary': 'Midrange brawler that wins ugly by keeping exchanges active and costly.',
        'strengths': [
            'Pressures through chip damage without instantly folding.',
            'Combines damage and durability well in medium-length trades.',
            'Punishes passive opponents by constantly re-engaging.',
        ],
        'weaknesses': [
            'Can be kited by superior pace control.',
            'Less explosive than assassins and less stable than tanks at the extremes.',
        ],
        'win_pattern': 'Stay in the opponent’s face, drag them into repeated trades, and let sturdier pressure win out.',
        'benchmark_use': 'Useful for testing whether a build can handle sustained pressure without losing structure.',
        'role_tags': ['frontline', 'attrition', 'pressure'],
    },
    Character.Archetype.DUELIST: {
        'label': 'Duelist',
        'summary': 'Flexible all-rounder built around clean timing, spacing, and efficient punishment.',
        'strengths': [
            'Adapts cleanly across most matchups without a glaring stat hole.',
            'Rewards good sequencing and disciplined cooldown use.',
            'Keeps pressure honest with balanced offense and defense.',
        ],
        'weaknesses': [
            'Lacks the extreme ceiling of specialized archetypes.',
            'Needs cleaner decision-making to beat dedicated burst or stall kits.',
        ],
        'win_pattern': 'Trade evenly, make the cleaner read, and turn one good timing edge into control of the round.',
        'benchmark_use': 'Useful as a baseline matchup when you want a fair read instead of an extreme stress test.',
        'role_tags': ['tempo', 'punish', 'balanced'],
    },
    Character.Archetype.CONTROL: {
        'label': 'Control',
        'summary': 'Pace manipulator that wins by denying rhythm and forcing bad choices.',
        'strengths': [
            'Breaks enemy sequencing with slows, traps, and awkward turns.',
            'Punishes reckless aggression better the longer the fight lasts.',
            'Converts superior intelligence into cleaner decision pressure.',
        ],
        'weaknesses': [
            'Can lose damage races if denied time to set the pace.',
            'Looks weaker when forced into straight-up slugging contests.',
        ],
        'win_pattern': 'Distort the pace, leave the opponent stranded in bad turns, and finish once they lose structure.',
        'benchmark_use': 'Useful for testing whether a build still functions when pace control and sequencing denial show up.',
        'role_tags': ['control', 'tempo', 'punish'],
    },
    Character.Archetype.GLASS_CANNON: {
        'label': 'Glass Cannon',
        'summary': 'High-risk burst specialist that wins fast or dies fast.',
        'strengths': [
            'Carries one of the highest raw damage ceilings in the roster.',
            'Threatens immediate kills if it gets the first clean window.',
            'Forces respect because every mistake can end the round.',
        ],
        'weaknesses': [
            'Punished brutally by any clean counter-hit or stall plan.',
            'Has very little room to recover once momentum flips.',
        ],
        'win_pattern': 'Find first blood, stack damage windows, and never let the opponent reset into a long fight.',
        'benchmark_use': 'Useful for testing burst ceilings, punish discipline, and whether fragile damage builds are actually manageable.',
        'role_tags': ['burst', 'high-risk', 'evasive'],
    },
}

ROLE_TAG_LABELS = {
    'attrition': 'Attrition',
    'balanced': 'Balanced',
    'benchmark': 'Benchmark',
    'burst': 'Burst',
    'control': 'Control',
    'evasive': 'Evasive',
    'frontline': 'Frontline',
    'high-risk': 'High Risk',
    'pressure': 'Pressure',
    'punish': 'Punish',
    'tempo': 'Tempo',
}

ROLE_TAG_ALIASES = {
    'anchor': 'frontline',
    'benchmark': 'benchmark',
    'burst': 'burst',
    'control': 'control',
    'footsies': 'punish',
    'fundamentals': 'balanced',
    'pressure': 'pressure',
    'risk': 'high-risk',
    'scrap': 'attrition',
    'tempo': 'tempo',
    'tempo-denial': 'control',
}

STAT_PRESENTATION = {
    'strength': {'label': 'Strength', 'short': 'STR'},
    'speed': {'label': 'Speed', 'short': 'SPD'},
    'durability': {'label': 'Durability', 'short': 'DUR'},
    'intelligence': {'label': 'Intelligence', 'short': 'INT'},
}


def _read(source, key: str, default=None):
    if isinstance(source, Mapping):
        return source.get(key, default)
    return getattr(source, key, default)


def infer_archetype(source) -> str:
    strength = _read(source, 'strength', 0) or 0
    speed = _read(source, 'speed', 0) or 0
    durability = _read(source, 'durability', 0) or 0
    intelligence = _read(source, 'intelligence', 0) or 0
    max_health = _read(source, 'max_health', 0) or 0

    if durability >= 82 and max_health >= 145:
        return Character.Archetype.TANK
    if strength >= 82 and speed >= 78 and durability <= 58 and max_health <= 112:
        return Character.Archetype.GLASS_CANNON
    if speed >= 86 and durability <= 58 and strength < 82:
        return Character.Archetype.ASSASSIN
    if intelligence >= 84 and speed >= 66 and strength <= 74:
        return Character.Archetype.CONTROL
    if strength >= 78 and durability >= 74 and max_health >= 126:
        return Character.Archetype.BRUISER
    return Character.Archetype.DUELIST


def derive_role_tags(source, limit: int = 4) -> list[str]:
    archetype = _read(source, 'archetype') or infer_archetype(source)
    guide = ARCHETYPE_GUIDES.get(archetype, ARCHETYPE_GUIDES[Character.Archetype.DUELIST])
    tags: list[str] = list(guide['role_tags'])

    fighter_state = _read(source, 'fighter_state', {}) or {}
    raw_tags = fighter_state.get('tags', []) if isinstance(fighter_state, dict) else []
    for raw_tag in raw_tags:
        canonical = ROLE_TAG_ALIASES.get(raw_tag)
        if canonical and canonical not in tags:
            tags.append(canonical)

    strength = _read(source, 'strength', 0) or 0
    speed = _read(source, 'speed', 0) or 0
    durability = _read(source, 'durability', 0) or 0
    intelligence = _read(source, 'intelligence', 0) or 0
    max_health = _read(source, 'max_health', 0) or 0
    abilities = _read(source, 'abilities', []) or []

    has_damage_amp = any(
        isinstance(ability, dict)
        and isinstance(ability.get('effect'), dict)
        and ability['effect'].get('damage_mult', 1) > 1.12
        for ability in abilities
    )
    has_speed_control = any(
        isinstance(ability, dict)
        and isinstance(ability.get('effect'), dict)
        and (
            ability['effect'].get('speed_mult', 1) < 1
            or ability['effect'].get('stun_chance', 0) > 0
        )
        for ability in abilities
    )

    if strength >= 82 or has_damage_amp:
        tags.append('burst')
    if speed >= 84:
        tags.append('evasive')
    if durability >= 80 or max_health >= 145:
        tags.append('frontline')
    if durability >= 72 and max_health >= 130:
        tags.append('attrition')
    if intelligence >= 82 or has_speed_control:
        tags.append('control')
    if speed >= 76 and intelligence >= 70:
        tags.append('punish')
    if _read(source, 'is_benchmark', False):
        tags.append('benchmark')

    unique_tags: list[str] = []
    for tag in tags:
        if tag in ROLE_TAG_LABELS and tag not in unique_tags:
            unique_tags.append(tag)
    return unique_tags[:limit]


def build_fighter_identity(source) -> dict:
    archetype = _read(source, 'archetype') or infer_archetype(source)
    guide = ARCHETYPE_GUIDES.get(archetype, ARCHETYPE_GUIDES[Character.Archetype.DUELIST])
    stats = sorted(
        (
            {
                'field': field,
                'value': _read(source, field, 0) or 0,
                **presentation,
            }
            for field, presentation in STAT_PRESENTATION.items()
        ),
        key=lambda entry: entry['value'],
        reverse=True,
    )
    primary_stats = stats[:2]
    stat_identity = ' / '.join(stat['short'] for stat in primary_stats)
    win_pattern = (_read(source, 'win_condition', '') or '').strip() or guide['win_pattern']
    role_tags = derive_role_tags(source)

    return {
        'archetype': archetype,
        'label': guide['label'],
        'summary': guide['summary'],
        'strengths': guide['strengths'],
        'weaknesses': guide['weaknesses'],
        'win_pattern': win_pattern,
        'benchmark_use': guide['benchmark_use'] if _read(source, 'is_benchmark', False) else '',
        'role_tags': [
            {'slug': tag, 'label': ROLE_TAG_LABELS[tag]}
            for tag in role_tags
        ],
        'stat_identity': stat_identity,
        'stat_focus': (
            f'Leans most on {primary_stats[0]["label"].lower()}'
            f' and {primary_stats[1]["label"].lower()}.'
            if len(primary_stats) == 2
            else 'Balanced statline.'
        ),
    }
