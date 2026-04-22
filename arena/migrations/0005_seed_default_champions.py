from django.db import migrations
from django.utils.text import slugify


DEFAULT_CHAMPIONS = [
    {
        'name': 'Iron Warden',
        'title': 'Oathbound Bastion',
        'source': 'seed',
        'archetype': 'tank',
        'visibility': 'public',
        'creator_name': 'ClashForge',
        'is_benchmark': False,
        'description': (
            'A shield captain wrapped in riveted plate, built to hold the center line '
            'and punish reckless openings.'
        ),
        'avatar_color': '#64748b',
        'strength': 64,
        'speed': 36,
        'durability': 86,
        'intelligence': 54,
        'max_health': 158,
        'passive_name': 'Wardplate',
        'passive_description': 'Opening blows glance off layered armor before the Warden answers in kind.',
        'abilities': [
            {
                'name': 'Gatebreaker',
                'type': 'attack',
                'power': 26,
                'cooldown': 3,
                'scaling': 'strength',
                'description': 'A crushing mace swing that turns defense into forward pressure.',
            },
            {
                'name': 'Bulwark Vow',
                'type': 'buff',
                'cooldown': 5,
                'duration': 2,
                'effect': {'damage_taken_mult': 0.72},
                'description': 'Plants a guard stance and sharply reduces incoming damage.',
            },
        ],
        'fighter_state': {
            'version': 1,
            'stance': 'guarded',
            'tags': ['starter', 'tank', 'anchor'],
        },
        'win_condition': 'Absorb burst, slow the fight down, and win through heavy counterattacks.',
        'balance_notes': 'Durable starter tank with limited speed and moderate burst.',
    },
    {
        'name': 'Ashen Duelist',
        'title': 'Cinderblade Prodigy',
        'source': 'seed',
        'archetype': 'duelist',
        'visibility': 'public',
        'creator_name': 'ClashForge',
        'is_benchmark': False,
        'description': (
            'A disciplined swordfighter who reads tempo through smoke and turns clean parries '
            'into precise finishing cuts.'
        ),
        'avatar_color': '#ef4444',
        'strength': 62,
        'speed': 70,
        'durability': 52,
        'intelligence': 68,
        'max_health': 118,
        'passive_name': 'Cinder Read',
        'passive_description': 'Careful footwork rewards balanced stats with reliable counter windows.',
        'abilities': [
            {
                'name': 'Ember Riposte',
                'type': 'attack',
                'power': 22,
                'cooldown': 2,
                'scaling': 'speed',
                'description': 'A fast countercut that favors initiative and clean timing.',
            },
            {
                'name': 'Smoke Measure',
                'type': 'buff',
                'cooldown': 4,
                'duration': 2,
                'effect': {'speed_mult': 1.16},
                'description': 'Uses drifting ash to reset angle and sharpen the next exchange.',
            },
        ],
        'fighter_state': {
            'version': 1,
            'stance': 'neutral',
            'tags': ['starter', 'duelist', 'tempo'],
        },
        'win_condition': 'Stay even on tempo, then convert a clean read into repeated pressure.',
        'balance_notes': 'Flexible duelist with no extreme stat spike.',
    },
    {
        'name': 'Thorn Beast',
        'title': 'Wildroot Mauler',
        'source': 'seed',
        'archetype': 'bruiser',
        'visibility': 'public',
        'creator_name': 'ClashForge',
        'is_benchmark': False,
        'description': (
            'A living knot of bark, horn, and briar muscle that wins by making every trade hurt.'
        ),
        'avatar_color': '#16a34a',
        'strength': 78,
        'speed': 44,
        'durability': 72,
        'intelligence': 42,
        'max_health': 142,
        'passive_name': 'Briarhide',
        'passive_description': 'Anyone who stays close too long is dragged into painful thorn trades.',
        'abilities': [
            {
                'name': 'Root Maul',
                'type': 'attack',
                'power': 29,
                'cooldown': 3,
                'scaling': 'strength',
                'description': 'A heavy tearing blow backed by wildroot momentum.',
            },
            {
                'name': 'Thorn Surge',
                'type': 'buff',
                'cooldown': 5,
                'duration': 2,
                'effect': {'damage_mult': 1.2, 'damage_taken_mult': 1.08},
                'description': 'Trades a little safety for punishing close-range damage.',
            },
        ],
        'fighter_state': {
            'version': 1,
            'stance': 'aggressive',
            'tags': ['starter', 'bruiser', 'trade'],
        },
        'win_condition': 'Force close trades and win by making every exchange more expensive.',
        'balance_notes': 'Strong bruiser pressure with predictable speed limitations.',
    },
    {
        'name': 'Storm Monk',
        'title': 'Thunderstep Adept',
        'source': 'seed',
        'archetype': 'assassin',
        'visibility': 'public',
        'creator_name': 'ClashForge',
        'is_benchmark': False,
        'description': (
            'A lightning-fast ascetic who chains breath, footwork, and thunderclap strikes into '
            'sudden knockouts.'
        ),
        'avatar_color': '#0ea5e9',
        'strength': 52,
        'speed': 88,
        'durability': 40,
        'intelligence': 64,
        'max_health': 96,
        'passive_name': 'Static Footwork',
        'passive_description': 'High speed lets the Monk seize early angles before heavier fighters stabilize.',
        'abilities': [
            {
                'name': 'Thunder Palm',
                'type': 'attack',
                'power': 24,
                'cooldown': 2,
                'scaling': 'speed',
                'description': 'A snapping palm strike that lands before guards fully form.',
            },
            {
                'name': 'Lightning Breath',
                'type': 'buff',
                'cooldown': 4,
                'duration': 2,
                'effect': {'speed_mult': 1.22},
                'description': 'Focuses breath into a burst of explosive movement.',
            },
        ],
        'fighter_state': {
            'version': 1,
            'stance': 'aggressive',
            'tags': ['starter', 'assassin', 'speed'],
        },
        'win_condition': 'Win initiative early and end the fight before durability becomes decisive.',
        'balance_notes': 'Fast assassin starter with low health and low durability.',
    },
    {
        'name': 'Grave Hexer',
        'title': 'Lantern-Bound Occultist',
        'source': 'seed',
        'archetype': 'control',
        'visibility': 'public',
        'creator_name': 'ClashForge',
        'is_benchmark': False,
        'description': (
            'A patient cursewright who fights by dimming enemy momentum and turning hesitation '
            'into inevitability.'
        ),
        'avatar_color': '#8b5cf6',
        'strength': 38,
        'speed': 52,
        'durability': 56,
        'intelligence': 88,
        'max_health': 112,
        'passive_name': 'Grave Lantern',
        'passive_description': 'Measured cursework rewards longer fights and punishes rushed attacks.',
        'abilities': [
            {
                'name': 'Hex Needle',
                'type': 'attack',
                'power': 20,
                'cooldown': 3,
                'scaling': 'intelligence',
                'description': 'A precise curse-prick that leaves lingering harm.',
            },
            {
                'name': 'Dread Seal',
                'type': 'buff',
                'cooldown': 5,
                'duration': 2,
                'effect': {'damage_taken_mult': 0.84, 'damage_mult': 1.12},
                'description': 'Marks the rhythm of the duel and bends trades in the Hexer’s favor.',
            },
        ],
        'fighter_state': {
            'version': 1,
            'stance': 'guarded',
            'tags': ['starter', 'control', 'curse'],
        },
        'win_condition': 'Deny clean tempo, extend the fight, and win through controlled exchanges.',
        'balance_notes': 'High-intelligence control starter with modest direct damage.',
    },
    {
        'name': 'Sunsteel Vanguard',
        'title': 'Dawnline Commander',
        'source': 'seed',
        'archetype': 'glass_cannon',
        'visibility': 'public',
        'creator_name': 'ClashForge',
        'is_benchmark': False,
        'description': (
            'A radiant spear-bearer who commits fully to decisive openings and trusts sunsteel '
            'discipline to finish first.'
        ),
        'avatar_color': '#f59e0b',
        'strength': 82,
        'speed': 74,
        'durability': 34,
        'intelligence': 58,
        'max_health': 92,
        'passive_name': 'Dawnline Charge',
        'passive_description': 'Opening aggression burns brightest when the Vanguard keeps the fight short.',
        'abilities': [
            {
                'name': 'Solar Lance',
                'type': 'attack',
                'power': 32,
                'cooldown': 3,
                'scaling': 'strength',
                'description': 'A brilliant spear thrust built to decide the exchange immediately.',
            },
            {
                'name': 'Radiant Overrun',
                'type': 'buff',
                'cooldown': 5,
                'duration': 2,
                'effect': {'damage_mult': 1.24, 'damage_taken_mult': 1.12},
                'description': 'Commits to an all-out advance with little room for retreat.',
            },
        ],
        'fighter_state': {
            'version': 1,
            'stance': 'aggressive',
            'tags': ['starter', 'burst', 'sunsteel'],
        },
        'win_condition': 'Create one decisive opening and convert it before counters arrive.',
        'balance_notes': 'High burst starter balanced by low durability and health.',
    },
]


def _unique_slug(Character, name):
    base_slug = slugify(name)[:160] or 'champion'
    candidate = base_slug
    suffix = 2
    while Character.objects.filter(slug=candidate).exists():
        suffix_text = f'-{suffix}'
        candidate = f'{base_slug[:160 - len(suffix_text)]}{suffix_text}'
        suffix += 1
    return candidate


def seed_default_champions(apps, schema_editor):
    Character = apps.get_model('arena', 'Character')

    for champion in DEFAULT_CHAMPIONS:
        if Character.objects.filter(name=champion['name']).exists():
            continue

        Character.objects.create(
            slug=_unique_slug(Character, champion['name']),
            edit_token_hash='',
            **champion,
        )


def unseed_default_champions(apps, schema_editor):
    Character = apps.get_model('arena', 'Character')
    Character.objects.filter(
        name__in=[champion['name'] for champion in DEFAULT_CHAMPIONS],
        source='seed',
        creator_name='ClashForge',
        is_benchmark=False,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('arena', '0004_character_creator_name'),
    ]

    operations = [
        migrations.RunPython(seed_default_champions, unseed_default_champions),
    ]
