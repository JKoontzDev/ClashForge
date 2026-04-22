from collections.abc import Iterable, Mapping

from .archetype_identity import infer_archetype
from .models import Character


BENCHMARK_CATALOG = {
    'Vesper Vale': {
        'slug': 'balanced-duel',
        'label': 'Balanced Duel',
        'bucket': 'baseline',
        'bucket_label': 'Baseline Read',
        'what_it_tests': 'Checks whether a fighter can win an honest midline duel without relying on extreme burst or stall.',
        'why_it_matters': 'Start here when you want a clean reference before pushing into harsher counters.',
        'coverage_tags': ['baseline', 'tempo', 'punish'],
        'order': 10,
    },
    'Raze': {
        'slug': 'speed-punish-check',
        'label': 'Speed Punish Check',
        'bucket': 'speed',
        'bucket_label': 'Initiative Stress',
        'what_it_tests': 'Checks whether a fighter survives fast initiative theft and can punish evasive burst windows.',
        'why_it_matters': 'Useful when a build may lose the first touch or struggle to reset after a bad opener.',
        'coverage_tags': ['speed', 'burst', 'punish'],
        'order': 20,
    },
    'Morrow Fang': {
        'slug': 'pressure-chain-check',
        'label': 'Pressure Chain Check',
        'bucket': 'pressure',
        'bucket_label': 'Pressure Stress',
        'what_it_tests': 'Checks whether a fighter stays coherent once medium-length trades keep repeating.',
        'why_it_matters': 'Useful for spotting kits that look fine on paper but collapse once pressure keeps re-engaging.',
        'coverage_tags': ['pressure', 'attrition', 'frontline'],
        'order': 30,
    },
    'Titan': {
        'slug': 'endurance-wall',
        'label': 'Endurance Wall',
        'bucket': 'wall',
        'bucket_label': 'Wall Break',
        'what_it_tests': 'Checks whether a fighter can actually break a durable anchor instead of only winning short trades.',
        'why_it_matters': 'Useful when your build needs proof that it can close against armor, health, and late-round stability.',
        'coverage_tags': ['wall', 'attrition', 'anti-burst'],
        'order': 40,
    },
    'Hexlocke': {
        'slug': 'control-check',
        'label': 'Control Check',
        'bucket': 'control',
        'bucket_label': 'Pace Denial',
        'what_it_tests': 'Checks whether a fighter still functions when rhythm, speed, and sequencing get denied.',
        'why_it_matters': 'Useful when a build looks clean until it runs into slows, traps, and bad turn structure.',
        'coverage_tags': ['control', 'tempo', 'denial'],
        'order': 50,
    },
    'Sol Vanta': {
        'slug': 'all-in-burst-check',
        'label': 'All-In Burst Check',
        'bucket': 'burst',
        'bucket_label': 'Punish Discipline',
        'what_it_tests': 'Checks whether a fighter can survive lethal damage races and punish fragile all-in offense.',
        'why_it_matters': 'Useful when you need to know if one mistake turns the matchup into an immediate loss.',
        'coverage_tags': ['burst', 'high-risk', 'punish'],
        'order': 60,
    },
}

BASELINE_BUCKET = 'baseline'


def _read(source, key: str, default=None):
    if isinstance(source, Mapping):
        return source.get(key, default)
    return getattr(source, key, default)


def _damage_amp_present(source) -> bool:
    abilities = _read(source, 'abilities', []) or []
    return any(
        isinstance(ability, dict)
        and isinstance(ability.get('effect'), dict)
        and ability['effect'].get('damage_mult', 1) > 1.12
        for ability in abilities
    )


def _speed_control_present(source) -> bool:
    abilities = _read(source, 'abilities', []) or []
    return any(
        isinstance(ability, dict)
        and isinstance(ability.get('effect'), dict)
        and (
            ability['effect'].get('speed_mult', 1) < 1
            or ability['effect'].get('stun_chance', 0) > 0
        )
        for ability in abilities
    )


def build_benchmark_profile(source) -> dict | None:
    if not _read(source, 'is_benchmark', False):
        return None

    catalog_entry = BENCHMARK_CATALOG.get(_read(source, 'name'))
    if not catalog_entry:
        return None

    return {
        'slug': catalog_entry['slug'],
        'label': catalog_entry['label'],
        'bucket': catalog_entry['bucket'],
        'bucket_label': catalog_entry['bucket_label'],
        'what_it_tests': catalog_entry['what_it_tests'],
        'why_it_matters': catalog_entry['why_it_matters'],
        'coverage_tags': catalog_entry['coverage_tags'],
        'order': catalog_entry['order'],
    }


def analyze_fighter_profile(source) -> dict:
    archetype = _read(source, 'archetype') or infer_archetype(source)
    strength = _read(source, 'strength', 0) or 0
    speed = _read(source, 'speed', 0) or 0
    durability = _read(source, 'durability', 0) or 0
    intelligence = _read(source, 'intelligence', 0) or 0
    max_health = _read(source, 'max_health', 0) or 0
    has_damage_amp = _damage_amp_present(source)
    has_speed_control = _speed_control_present(source)

    return {
        'archetype': archetype,
        'strength': strength,
        'speed': speed,
        'durability': durability,
        'intelligence': intelligence,
        'max_health': max_health,
        'has_damage_amp': has_damage_amp,
        'has_speed_control': has_speed_control,
        'fragile': durability <= 60 or max_health <= 110,
        'slow_start': speed <= 66,
        'low_damage': strength <= 68 and not has_damage_amp,
        'low_control': intelligence <= 68 and not has_speed_control,
        'stable_frontline': durability >= 78 or max_health >= 138,
        'balanced': 64 <= strength <= 80 and 64 <= speed <= 82 and 64 <= durability <= 78 and 64 <= intelligence <= 80,
        'high_burst': strength >= 82 or has_damage_amp,
    }


def _benchmark_reason(bucket: str, profile: dict) -> str:
    archetype_label = Character.Archetype(profile['archetype']).label

    if bucket == 'baseline':
        if profile['balanced'] or profile['archetype'] == Character.Archetype.DUELIST:
            return 'Start with a fair midline duel before moving into sharper counters.'
        return f'Use this to get a clean baseline read on how the {archetype_label.lower()} profile performs without matchup extremes.'

    if bucket == 'speed':
        if profile['slow_start']:
            return 'Speed is a thinner stat here, so losing initiative is a real risk to measure.'
        if profile['fragile']:
            return 'This profile cannot afford sloppy recovery after a fast opener.'
        return 'This checks whether the build can punish evasive tempo instead of getting run over by it.'

    if bucket == 'pressure':
        if profile['fragile']:
            return 'Repeated trades can crack this profile if its defensive structure is thin.'
        if profile['archetype'] in {Character.Archetype.CONTROL, Character.Archetype.ASSASSIN}:
            return 'Specialized tempo kits should prove they still hold together once the fight stays scrappy.'
        return 'This checks whether the build remains stable when the opponent keeps re-engaging.'

    if bucket == 'wall':
        if profile['low_damage']:
            return 'Damage output looks modest, so wall-breaking is an obvious proof point.'
        if profile['high_burst']:
            return 'Burst-heavy kits should prove they can finish a real wall instead of only spiking fragile targets.'
        return 'This checks whether the build can close against durability, armor, and late-round stability.'

    if bucket == 'control':
        if profile['low_control'] or profile['slow_start']:
            return 'Pace denial is a likely weak point because control recovery tools are limited here.'
        if profile['archetype'] in {Character.Archetype.BRUISER, Character.Archetype.TANK}:
            return 'Frontline profiles should prove they still function when they cannot force a clean brawl.'
        return 'This checks whether the build can keep its plan when rhythm and sequencing get disrupted.'

    if bucket == 'burst':
        if profile['fragile']:
            return 'Low margin for error makes all-in burst discipline an important test.'
        if profile['slow_start']:
            return 'Slower profiles need proof that one missed turn does not turn into a full damage race loss.'
        return 'This checks whether the build can punish lethal offense instead of folding to it.'

    return 'Useful benchmark coverage for this profile.'


def _score_benchmark(profile: dict, benchmark) -> tuple[int, str]:
    benchmark_profile = build_benchmark_profile(benchmark)
    if not benchmark_profile:
        return 0, ''

    bucket = benchmark_profile['bucket']
    score = 1

    if bucket == 'baseline':
        score += 3
        if profile['balanced'] or profile['archetype'] == Character.Archetype.DUELIST:
            score += 2
    elif bucket == 'speed':
        if profile['slow_start']:
            score += 4
        if profile['fragile']:
            score += 2
        if profile['archetype'] in {Character.Archetype.TANK, Character.Archetype.BRUISER}:
            score += 1
    elif bucket == 'pressure':
        if not profile['stable_frontline']:
            score += 3
        if profile['fragile']:
            score += 1
        if profile['archetype'] in {Character.Archetype.CONTROL, Character.Archetype.ASSASSIN, Character.Archetype.GLASS_CANNON}:
            score += 2
    elif bucket == 'wall':
        if profile['low_damage']:
            score += 4
        if profile['high_burst']:
            score += 2
        if profile['archetype'] in {Character.Archetype.ASSASSIN, Character.Archetype.GLASS_CANNON, Character.Archetype.CONTROL}:
            score += 1
    elif bucket == 'control':
        if profile['low_control']:
            score += 4
        if profile['slow_start']:
            score += 2
        if profile['archetype'] in {Character.Archetype.BRUISER, Character.Archetype.TANK, Character.Archetype.ASSASSIN}:
            score += 1
    elif bucket == 'burst':
        if profile['fragile']:
            score += 4
        if profile['slow_start']:
            score += 2
        if profile['archetype'] in {Character.Archetype.TANK, Character.Archetype.CONTROL}:
            score += 1

    return score, _benchmark_reason(bucket, profile)


def recommend_benchmarks(source, benchmarks: Iterable, limit: int = 3) -> list[dict]:
    profile = analyze_fighter_profile(source)
    ranked: list[dict] = []

    for benchmark in benchmarks:
        benchmark_profile = build_benchmark_profile(benchmark)
        if not benchmark_profile:
            continue
        score, reason = _score_benchmark(profile, benchmark)
        ranked.append(
            {
                'fighter': benchmark,
                'id': _read(benchmark, 'id'),
                'name': _read(benchmark, 'name', ''),
                'slug': _read(benchmark, 'slug', ''),
                'archetype': _read(benchmark, 'archetype', ''),
                'profile': benchmark_profile,
                'reason': reason,
                'score': score,
            }
        )

    ranked.sort(
        key=lambda entry: (
            -entry['score'],
            BENCHMARK_CATALOG.get(entry['name'], {}).get('order', 999),
            entry['name'],
        )
    )
    return ranked[:limit]


def build_benchmark_gauntlet(source, benchmarks: Iterable, limit: int = 3) -> list[dict]:
    ranked = recommend_benchmarks(source, benchmarks, limit=max(limit + 3, 6))
    if not ranked:
        return []

    steps: list[dict] = []
    used_buckets: set[str] = set()
    baseline = next(
        (entry for entry in ranked if entry['profile']['bucket'] == BASELINE_BUCKET),
        None,
    )
    if baseline:
        steps.append(baseline)
        used_buckets.add(BASELINE_BUCKET)

    for entry in ranked:
        bucket = entry['profile']['bucket']
        if bucket in used_buckets:
            continue
        steps.append(entry)
        used_buckets.add(bucket)
        if len(steps) >= limit:
            break

    if len(steps) < limit:
        for entry in ranked:
            if entry['name'] in {step['name'] for step in steps}:
                continue
            steps.append(entry)
            if len(steps) >= limit:
                break

    labeled_steps: list[dict] = []
    step_labels = [
        'Step 1 · Baseline',
        'Step 2 · Main Stress',
        'Step 3 · Coverage Gap',
        'Step 4 · Extra Read',
    ]
    for index, entry in enumerate(steps[:limit]):
        labeled_steps.append(
            {
                **entry,
                'step_label': step_labels[index] if index < len(step_labels) else f'Step {index + 1}',
            }
        )
    return labeled_steps


def sort_benchmarks(benchmarks: Iterable) -> list:
    return sorted(
        benchmarks,
        key=lambda benchmark: (
            BENCHMARK_CATALOG.get(_read(benchmark, 'name', ''), {}).get('order', 999),
            _read(benchmark, 'name', ''),
        ),
    )
