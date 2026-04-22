from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify
import re


FIGHTER_STATE_VERSION = 1
FIGHTER_STATE_STANCES = {'neutral', 'aggressive', 'guarded'}
HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
ABILITY_TYPES = {'attack', 'buff'}
SCALING_FIELDS = {'strength', 'speed', 'durability', 'intelligence'}
ALLOWED_EFFECT_KEYS = {
    'bleed',
    'damage_mult',
    'damage_taken_mult',
    'speed_mult',
    'stun_chance',
    'ticks',
}
CREATOR_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,31}$")
MAX_PUBLIC_NAME_LENGTH = 60
MAX_TITLE_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 600
MAX_PASSIVE_NAME_LENGTH = 60
MAX_PASSIVE_DESCRIPTION_LENGTH = 320
MAX_WIN_CONDITION_LENGTH = 240
MAX_BALANCE_NOTES_LENGTH = 240
MAX_ABILITY_COUNT = 4
MIN_CORE_STAT = 10
MAX_CORE_STAT = 100
MAX_CORE_STAT_BUDGET = 320
MIN_MAX_HEALTH = 60
MAX_MAX_HEALTH = 220


def default_fighter_state():
    return {
        'version': FIGHTER_STATE_VERSION,
        'stance': 'neutral',
        'tags': [],
    }


def normalize_fighter_state(value: dict | None) -> dict:
    if value in (None, ''):
        value = default_fighter_state()
    if not isinstance(value, dict):
        raise ValidationError('fighter_state must be an object.')

    unexpected_keys = sorted(set(value) - {'version', 'stance', 'tags'})
    if unexpected_keys:
        raise ValidationError(
            f'fighter_state contains unsupported keys: {", ".join(unexpected_keys)}.'
        )

    version = value.get('version', FIGHTER_STATE_VERSION)
    if not isinstance(version, int) or version != FIGHTER_STATE_VERSION:
        raise ValidationError(f'fighter_state.version must be {FIGHTER_STATE_VERSION}.')

    stance = value.get('stance', 'neutral')
    if stance not in FIGHTER_STATE_STANCES:
        raise ValidationError(
            f'fighter_state.stance must be one of: {", ".join(sorted(FIGHTER_STATE_STANCES))}.'
        )

    tags = value.get('tags', [])
    if not isinstance(tags, list):
        raise ValidationError('fighter_state.tags must be a list.')

    normalized_tags: list[str] = []
    for raw_tag in tags:
        if not isinstance(raw_tag, str):
            raise ValidationError('fighter_state.tags entries must be strings.')
        tag = slugify(raw_tag)
        if not tag:
            raise ValidationError('fighter_state.tags entries must contain letters or numbers.')
        if len(tag) > 24:
            raise ValidationError('fighter_state.tags entries must be 24 characters or fewer.')
        if tag not in normalized_tags:
            normalized_tags.append(tag)

    if len(normalized_tags) > 6:
        raise ValidationError('fighter_state.tags can contain at most 6 entries.')

    return {
        'version': version,
        'stance': stance,
        'tags': normalized_tags,
    }


def _validate_text_length(errors: dict, field: str, value: str, limit: int) -> None:
    if len(value or '') > limit:
        errors[field] = f'{field} must be {limit} characters or fewer.'


def _validate_ability_effect(effect: dict, errors: list[str]) -> None:
    if not isinstance(effect, dict) or isinstance(effect, list):
        errors.append('effect must be a flat object.')
        return

    unexpected_keys = sorted(set(effect) - ALLOWED_EFFECT_KEYS)
    if unexpected_keys:
        errors.append(f'unsupported effect keys: {", ".join(unexpected_keys)}.')
        return

    for key, raw_value in effect.items():
        if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
            errors.append(f'effect "{key}" must be numeric.')
            continue
        if key == 'bleed' and not 0 <= raw_value <= 10:
            errors.append('bleed must be between 0 and 10.')
        if key == 'damage_mult' and not 0.5 <= raw_value <= 2:
            errors.append('damage_mult must be between 0.5 and 2.')
        if key == 'damage_taken_mult' and not 0.4 <= raw_value <= 1.5:
            errors.append('damage_taken_mult must be between 0.4 and 1.5.')
        if key == 'speed_mult' and not 0.5 <= raw_value <= 2:
            errors.append('speed_mult must be between 0.5 and 2.')
        if key == 'stun_chance' and not 0 <= raw_value <= 0.5:
            errors.append('stun_chance must be between 0 and 0.5.')
        if key == 'ticks' and (int(raw_value) != raw_value or not 1 <= int(raw_value) <= 4):
            errors.append('ticks must be an integer between 1 and 4.')


def validate_abilities(value: list) -> None:
    if not isinstance(value, list):
        raise ValidationError('abilities must be a list.')
    if not 1 <= len(value) <= MAX_ABILITY_COUNT:
        raise ValidationError(f'abilities must contain between 1 and {MAX_ABILITY_COUNT} entries.')

    names = []
    errors: list[str] = []
    for index, ability in enumerate(value, start=1):
        if not isinstance(ability, dict):
            errors.append(f'ability {index} must be an object.')
            continue

        name = str(ability.get('name') or '').strip()
        ability_type = ability.get('type')
        cooldown = ability.get('cooldown')
        description = str(ability.get('description') or '').strip()
        names.append(name.lower())

        if not 2 <= len(name) <= 60:
            errors.append(f'ability {index} name must be between 2 and 60 characters.')
        if ability_type not in ABILITY_TYPES:
            errors.append(f'ability {index} type must be attack or buff.')
        if not isinstance(cooldown, int) or not 1 <= cooldown <= 8:
            errors.append(f'ability {index} cooldown must be an integer between 1 and 8.')
        if not description or len(description) > 240:
            errors.append(f'ability {index} description must be present and 240 characters or fewer.')

        if ability_type == 'attack':
            power = ability.get('power', 0)
            if not isinstance(power, int) or not 1 <= power <= 40:
                errors.append(f'ability {index} attack power must be an integer between 1 and 40.')
            if ability.get('scaling') not in SCALING_FIELDS:
                errors.append(f'ability {index} must declare a valid scaling stat.')
        elif ability_type == 'buff':
            duration = ability.get('duration')
            effect = ability.get('effect')
            if not isinstance(duration, int) or not 1 <= duration <= 4:
                errors.append(f'ability {index} buff duration must be an integer between 1 and 4.')
            if not effect:
                errors.append(f'ability {index} buff must include an effect.')
            else:
                _validate_ability_effect(effect, errors)

    if len(names) != len(set(names)):
        errors.append('ability names must be unique per fighter.')
    if errors:
        raise ValidationError(errors)


class Character(models.Model):
    class Source(models.TextChoices):
        SEED = 'seed', 'Seed'
        USER = 'user', 'User Generated'

    class Archetype(models.TextChoices):
        ASSASSIN = 'assassin', 'Assassin'
        TANK = 'tank', 'Tank'
        BRUISER = 'bruiser', 'Bruiser'
        DUELIST = 'duelist', 'Duelist'
        CONTROL = 'control', 'Control'
        GLASS_CANNON = 'glass_cannon', 'Glass Cannon'

    class Visibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        UNLISTED = 'unlisted', 'Unlisted'

    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=160, unique=True, editable=False)
    title = models.CharField(max_length=160, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.USER)
    archetype = models.CharField(
        max_length=20,
        choices=Archetype.choices,
        default=Archetype.DUELIST,
    )
    visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.PUBLIC,
    )
    creator_name = models.CharField(max_length=32, blank=True)
    is_benchmark = models.BooleanField(default=False)
    edit_token_hash = models.CharField(max_length=64, blank=True, editable=False)
    description = models.TextField(blank=True)
    avatar_color = models.CharField(max_length=32, default='#7c3aed')
    strength = models.PositiveIntegerField(default=50)
    speed = models.PositiveIntegerField(default=50)
    durability = models.PositiveIntegerField(default=50)
    intelligence = models.PositiveIntegerField(default=50)
    max_health = models.PositiveIntegerField(default=100)
    passive_name = models.CharField(max_length=120, blank=True)
    passive_description = models.TextField(blank=True)
    abilities = models.JSONField(default=list, blank=True)
    fighter_state = models.JSONField(default=default_fighter_state, blank=True)
    win_condition = models.TextField(blank=True)
    balance_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def clean(self):
        errors = {}
        name = (self.name or '').strip()
        if not 3 <= len(name) <= MAX_PUBLIC_NAME_LENGTH:
            errors['name'] = f'name must be between 3 and {MAX_PUBLIC_NAME_LENGTH} characters.'
        _validate_text_length(errors, 'title', self.title, MAX_TITLE_LENGTH)
        _validate_text_length(errors, 'description', self.description, MAX_DESCRIPTION_LENGTH)
        _validate_text_length(errors, 'passive_name', self.passive_name, MAX_PASSIVE_NAME_LENGTH)
        _validate_text_length(
            errors,
            'passive_description',
            self.passive_description,
            MAX_PASSIVE_DESCRIPTION_LENGTH,
        )
        _validate_text_length(errors, 'win_condition', self.win_condition, MAX_WIN_CONDITION_LENGTH)
        _validate_text_length(errors, 'balance_notes', self.balance_notes, MAX_BALANCE_NOTES_LENGTH)

        creator_name = (self.creator_name or '').strip()
        if creator_name and not CREATOR_NAME_RE.fullmatch(creator_name):
            errors['creator_name'] = (
                'creator_name may only use letters, numbers, spaces, periods, apostrophes, '
                'hyphens, and underscores.'
            )

        if not HEX_COLOR_RE.fullmatch((self.avatar_color or '').strip()):
            errors['avatar_color'] = 'avatar_color must be a hex color like #38bdf8.'

        core_stats = {
            'strength': self.strength,
            'speed': self.speed,
            'durability': self.durability,
            'intelligence': self.intelligence,
        }
        for field, value in core_stats.items():
            if not MIN_CORE_STAT <= int(value or 0) <= MAX_CORE_STAT:
                errors[field] = f'{field} must be between {MIN_CORE_STAT} and {MAX_CORE_STAT}.'
        total_stats = sum(int(value or 0) for value in core_stats.values())
        if total_stats > MAX_CORE_STAT_BUDGET:
            errors['strength'] = f'combined core stats must stay at or below {MAX_CORE_STAT_BUDGET}.'
        if not MIN_MAX_HEALTH <= int(self.max_health or 0) <= MAX_MAX_HEALTH:
            errors['max_health'] = f'max_health must be between {MIN_MAX_HEALTH} and {MAX_MAX_HEALTH}.'
        if int(self.max_health or 0) > 180 and total_stats > 300:
            errors['max_health'] = 'high-health fighters must trade off some core stats.'

        try:
            validate_abilities(self.abilities or [])
        except ValidationError as exc:
            errors['abilities'] = exc.messages

        try:
            self.fighter_state = normalize_fighter_state(self.fighter_state)
        except ValidationError as exc:
            errors['fighter_state'] = exc.messages

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.slug = self._generate_unique_slug()
        self.fighter_state = normalize_fighter_state(self.fighter_state)
        self.full_clean()
        super().save(*args, **kwargs)

    def _generate_unique_slug(self) -> str:
        base_slug = slugify(self.name)[:160] or 'fighter'
        candidate = base_slug
        suffix = 2
        while Character.objects.exclude(pk=self.pk).filter(slug=candidate).exists():
            suffix_text = f'-{suffix}'
            candidate = f'{base_slug[:160 - len(suffix_text)]}{suffix_text}'
            suffix += 1
        return candidate


class FightHistory(models.Model):
    fighter_a = models.ForeignKey(Character, on_delete=models.SET_NULL, null=True, related_name='fights_as_a')
    fighter_b = models.ForeignKey(Character, on_delete=models.SET_NULL, null=True, related_name='fights_as_b')
    winner = models.ForeignKey(Character, on_delete=models.SET_NULL, null=True, blank=True, related_name='wins')
    log = models.JSONField(default=list, blank=True)
    summary = models.TextField(blank=True)
    seed = models.CharField(max_length=80, blank=True)
    rounds = models.PositiveIntegerField(default=0)
    sim_count = models.PositiveIntegerField(default=1)
    fighter_a_wins = models.PositiveIntegerField(default=0)
    fighter_b_wins = models.PositiveIntegerField(default=0)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        a = self.fighter_a.name if self.fighter_a else 'Unknown A'
        b = self.fighter_b.name if self.fighter_b else 'Unknown B'
        return f'{a} vs {b} ({self.created_at:%Y-%m-%d %H:%M})'


class BugReport(models.Model):
    class Category(models.TextChoices):
        BUG = 'bug', 'Bug'
        DISPLAY = 'display', 'Display or layout'
        ACCOUNT = 'account', 'Account or access'
        PERFORMANCE = 'performance', 'Performance'
        OTHER = 'other', 'Other'

    class Severity(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        BLOCKING = 'blocking', 'Blocking'

    class Status(models.TextChoices):
        NEW = 'new', 'New'
        REVIEWING = 'reviewing', 'Reviewing'
        RESOLVED = 'resolved', 'Resolved'
        CLOSED = 'closed', 'Closed'

    name = models.CharField(max_length=80, blank=True)
    email = models.EmailField(blank=True)
    category = models.CharField(max_length=24, choices=Category.choices, blank=True)
    page_url = models.URLField(max_length=500, blank=True)
    summary = models.CharField(max_length=160)
    details = models.TextField(max_length=4000)
    severity = models.CharField(max_length=16, choices=Severity.choices, blank=True)
    app_version = models.CharField(max_length=32, blank=True)
    build_version = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NEW)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.summary
