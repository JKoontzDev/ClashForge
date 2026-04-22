import json
import re

from rest_framework import serializers

from .archetype_identity import infer_archetype
from .models import Character, FightHistory


HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
ABILITY_TYPES = ('attack', 'buff')
SCALING_FIELDS = ('strength', 'speed', 'durability', 'intelligence')
ALLOWED_EFFECT_KEYS = {
    'bleed',
    'damage_mult',
    'damage_taken_mult',
    'speed_mult',
    'stun_chance',
    'ticks',
}
MAX_FIGHTER_PAYLOAD_CHARS = 1800
MAX_NAME_LENGTH = 60
MAX_CREATOR_NAME_LENGTH = 32
MAX_TITLE_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 600
MAX_PASSIVE_NAME_LENGTH = 60
MAX_PASSIVE_DESCRIPTION_LENGTH = 320
MAX_WIN_CONDITION_LENGTH = 240
MAX_BALANCE_NOTES_LENGTH = 240
MAX_ABILITY_NAME_LENGTH = 60
MAX_ABILITY_DESCRIPTION_LENGTH = 240
MIN_CORE_STAT = 10
MAX_CORE_STAT = 100
MAX_CORE_STAT_BUDGET = 320
MIN_MAX_HEALTH = 60
MAX_MAX_HEALTH = 220
MAX_ABILITY_COUNT = 4
MAX_BATTLE_REQUEST_PAYLOAD_CHARS = 120
MAX_CREATIVE_PROMPT_LENGTH = 600
MAX_CREATIVE_REQUEST_PAYLOAD_CHARS = 2600
CREATOR_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,31}$")


def normalize_whitespace(value: str) -> str:
    return ' '.join(value.split())

class StrictFieldsSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        unexpected_fields = sorted(set(data) - set(self.fields)) if isinstance(data, dict) else []
        if unexpected_fields:
            raise serializers.ValidationError(
                {field: 'This field is not allowed.' for field in unexpected_fields}
            )
        return super().to_internal_value(data)


class AbilitySerializer(StrictFieldsSerializer):
    name = serializers.CharField(max_length=MAX_ABILITY_NAME_LENGTH)
    type = serializers.ChoiceField(choices=ABILITY_TYPES)
    power = serializers.IntegerField(min_value=0, max_value=40, required=False, default=0)
    cooldown = serializers.IntegerField(min_value=1, max_value=8)
    duration = serializers.IntegerField(min_value=1, max_value=4, required=False)
    scaling = serializers.ChoiceField(choices=SCALING_FIELDS, required=False)
    description = serializers.CharField(max_length=MAX_ABILITY_DESCRIPTION_LENGTH)
    effect = serializers.DictField(required=False)

    def validate_name(self, value: str) -> str:
        value = normalize_whitespace(value)
        if len(value) < 2:
            raise serializers.ValidationError('Ability name must be at least 2 characters.')
        return value

    def validate_description(self, value: str) -> str:
        value = normalize_whitespace(value)
        if not value:
            raise serializers.ValidationError('Ability description cannot be blank.')
        return value

    def validate_effect(self, value: dict) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError('Effect must be a flat object.')

        unexpected_keys = sorted(set(value) - ALLOWED_EFFECT_KEYS)
        if unexpected_keys:
            raise serializers.ValidationError(
                f'Unsupported effect keys: {", ".join(unexpected_keys)}.'
            )

        sanitized = {}
        for key, raw_value in value.items():
            if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                raise serializers.ValidationError(f'Effect "{key}" must be numeric.')

            if key == 'bleed' and not 0 <= raw_value <= 10:
                raise serializers.ValidationError('bleed must be between 0 and 10.')
            if key == 'damage_mult' and not 0.5 <= raw_value <= 2:
                raise serializers.ValidationError('damage_mult must be between 0.5 and 2.')
            if key == 'damage_taken_mult' and not 0.4 <= raw_value <= 1.5:
                raise serializers.ValidationError(
                    'damage_taken_mult must be between 0.4 and 1.5.'
                )
            if key == 'speed_mult' and not 0.5 <= raw_value <= 2:
                raise serializers.ValidationError('speed_mult must be between 0.5 and 2.')
            if key == 'stun_chance' and not 0 <= raw_value <= 0.5:
                raise serializers.ValidationError('stun_chance must be between 0 and 0.5.')
            if key == 'ticks':
                if int(raw_value) != raw_value or not 1 <= int(raw_value) <= 4:
                    raise serializers.ValidationError('ticks must be an integer between 1 and 4.')
                raw_value = int(raw_value)

            sanitized[key] = raw_value

        return sanitized

    def validate(self, attrs: dict) -> dict:
        ability_type = attrs['type']
        power = attrs.get('power', 0)
        duration = attrs.get('duration')
        scaling = attrs.get('scaling')
        effect = attrs.get('effect', {})

        if ability_type == 'attack':
            if power <= 0:
                raise serializers.ValidationError({'power': 'Attack abilities must deal damage.'})
            if scaling is None:
                raise serializers.ValidationError(
                    {'scaling': 'Attack abilities must declare a scaling stat.'}
                )
        else:
            if duration is None:
                raise serializers.ValidationError(
                    {'duration': 'Buff abilities must include a duration.'}
                )
            if not effect:
                raise serializers.ValidationError(
                    {'effect': 'Buff abilities must include at least one supported effect.'}
                )

        return attrs


class FighterReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Character
        fields = [
            'id',
            'name',
            'creator_name',
            'slug',
            'title',
            'source',
            'archetype',
            'visibility',
            'description',
            'avatar_color',
            'strength',
            'speed',
            'durability',
            'intelligence',
            'max_health',
            'passive_name',
            'passive_description',
            'abilities',
            'fighter_state',
            'win_condition',
            'balance_notes',
            'created_at',
            'updated_at',
        ]


class FighterPublicSerializer(serializers.ModelSerializer):
    can_battle = serializers.SerializerMethodField()

    class Meta:
        model = Character
        fields = [
            'id',
            'name',
            'creator_name',
            'slug',
            'title',
            'source',
            'archetype',
            'visibility',
            'description',
            'avatar_color',
            'strength',
            'speed',
            'durability',
            'intelligence',
            'max_health',
            'passive_name',
            'passive_description',
            'abilities',
            'win_condition',
            'balance_notes',
            'can_battle',
        ]

    def get_can_battle(self, obj: Character) -> bool:
        return (
            obj.visibility == Character.Visibility.PUBLIC
            and not obj.is_benchmark
        )


class BaseFighterWriteSerializer(serializers.ModelSerializer):
    abilities = AbilitySerializer(many=True, allow_empty=False, max_length=MAX_ABILITY_COUNT)

    class Meta:
        model = Character
        fields = [
            'name',
            'creator_name',
            'archetype',
            'visibility',
            'title',
            'description',
            'avatar_color',
            'strength',
            'speed',
            'durability',
            'intelligence',
            'max_health',
            'passive_name',
            'passive_description',
            'abilities',
            'win_condition',
            'balance_notes',
        ]

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unexpected_fields = sorted(set(data) - set(self.fields))
            if unexpected_fields:
                raise serializers.ValidationError(
                    {field: 'This field is controlled by the server or is not supported.' for field in unexpected_fields}
                )
        return super().to_internal_value(data)

    def validate_name(self, value: str) -> str:
        value = normalize_whitespace(value)
        if len(value) < 3:
            raise serializers.ValidationError('Name must be at least 3 characters.')
        if len(value) > MAX_NAME_LENGTH:
            raise serializers.ValidationError(
                f'Name must be {MAX_NAME_LENGTH} characters or fewer.'
            )
        return value

    def validate_title(self, value: str) -> str:
        return self._validate_optional_text(
            'title',
            value,
            max_length=MAX_TITLE_LENGTH,
        )

    def validate_creator_name(self, value: str) -> str:
        value = normalize_whitespace(value)
        if not value:
            return ''
        if len(value) > MAX_CREATOR_NAME_LENGTH:
            raise serializers.ValidationError(
                f'creator_name must be {MAX_CREATOR_NAME_LENGTH} characters or fewer.'
            )
        if not CREATOR_NAME_RE.fullmatch(value):
            raise serializers.ValidationError(
                'creator_name may only use letters, numbers, spaces, periods, apostrophes, hyphens, and underscores.'
            )
        return value

    def validate_description(self, value: str) -> str:
        return self._validate_optional_text(
            'description',
            value,
            max_length=MAX_DESCRIPTION_LENGTH,
        )

    def validate_passive_name(self, value: str) -> str:
        return self._validate_optional_text(
            'passive_name',
            value,
            max_length=MAX_PASSIVE_NAME_LENGTH,
        )

    def validate_passive_description(self, value: str) -> str:
        return self._validate_optional_text(
            'passive_description',
            value,
            max_length=MAX_PASSIVE_DESCRIPTION_LENGTH,
        )

    def validate_win_condition(self, value: str) -> str:
        return self._validate_optional_text(
            'win_condition',
            value,
            max_length=MAX_WIN_CONDITION_LENGTH,
        )

    def validate_balance_notes(self, value: str) -> str:
        return self._validate_optional_text(
            'balance_notes',
            value,
            max_length=MAX_BALANCE_NOTES_LENGTH,
        )

    def validate_avatar_color(self, value: str) -> str:
        value = value.strip()
        if not HEX_COLOR_RE.fullmatch(value):
            raise serializers.ValidationError('avatar_color must be a hex color like #38bdf8.')
        return value.lower()

    def validate_strength(self, value: int) -> int:
        return self._validate_stat('strength', value)

    def validate_speed(self, value: int) -> int:
        return self._validate_stat('speed', value)

    def validate_durability(self, value: int) -> int:
        return self._validate_stat('durability', value)

    def validate_intelligence(self, value: int) -> int:
        return self._validate_stat('intelligence', value)

    def validate_max_health(self, value: int) -> int:
        if not MIN_MAX_HEALTH <= value <= MAX_MAX_HEALTH:
            raise serializers.ValidationError(
                f'max_health must be between {MIN_MAX_HEALTH} and {MAX_MAX_HEALTH}.'
            )
        return value

    def validate_abilities(self, value: list[dict]) -> list[dict]:
        if not 1 <= len(value) <= MAX_ABILITY_COUNT:
            raise serializers.ValidationError(
                f'A fighter must have between 1 and {MAX_ABILITY_COUNT} abilities.'
            )

        names = [ability['name'].strip().lower() for ability in value]
        if len(names) != len(set(names)):
            raise serializers.ValidationError('Ability names must be unique per fighter.')
        return value

    def validate(self, attrs: dict) -> dict:
        attrs = super().validate(attrs)
        if self.instance is None and not attrs.get('archetype'):
            attrs['archetype'] = infer_archetype(attrs)
        self._validate_payload_size()
        self._validate_name_uniqueness(attrs)
        self._validate_budget_rules(attrs)
        return attrs

    def _validate_payload_size(self) -> None:
        try:
            payload_size = len(json.dumps(self.initial_data))
        except (TypeError, ValueError):
            raise serializers.ValidationError(
                {'non_field_errors': ['Payload could not be parsed as valid fighter JSON.']}
            )

        if payload_size > MAX_FIGHTER_PAYLOAD_CHARS:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        f'Fighter payload is too large. Keep it under {MAX_FIGHTER_PAYLOAD_CHARS} characters.'
                    ]
                }
            )

    def _validate_name_uniqueness(self, attrs: dict) -> None:
        candidate_name = attrs.get('name', getattr(self.instance, 'name', ''))
        if not candidate_name:
            return

        queryset = Character.objects.filter(name__iexact=candidate_name)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError(
                {'name': 'A fighter with this name already exists.'}
            )

    def _validate_budget_rules(self, attrs: dict) -> None:
        total_stats = sum(
            attrs.get(field, getattr(self.instance, field, 0))
            for field in ('strength', 'speed', 'durability', 'intelligence')
        )
        max_health = attrs.get('max_health', getattr(self.instance, 'max_health', 0))
        abilities = attrs.get('abilities', getattr(self.instance, 'abilities', []))

        if total_stats > MAX_CORE_STAT_BUDGET:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        f'Combined core stats must stay at or below {MAX_CORE_STAT_BUDGET}.'
                    ]
                }
            )

        if max_health > 180 and total_stats > 300:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        'High-health fighters must trade off some core stats.'
                    ]
                }
            )

        if len(abilities) > MAX_ABILITY_COUNT:
            raise serializers.ValidationError(
                {'abilities': f'A fighter can have at most {MAX_ABILITY_COUNT} abilities.'}
            )

    @staticmethod
    def _validate_optional_text(field_name: str, value: str, *, max_length: int) -> str:
        value = normalize_whitespace(value)
        if len(value) > max_length:
            raise serializers.ValidationError(
                f'{field_name} must be {max_length} characters or fewer.'
            )
        return value

    @staticmethod
    def _validate_stat(label: str, value: int) -> int:
        if not MIN_CORE_STAT <= value <= MAX_CORE_STAT:
            raise serializers.ValidationError(
                f'{label} must be between {MIN_CORE_STAT} and {MAX_CORE_STAT}.'
            )
        return value


class FighterCreateSerializer(BaseFighterWriteSerializer):
    pass


class FighterUpdateSerializer(BaseFighterWriteSerializer):
    pass


class ForgePreviewSerializer(BaseFighterWriteSerializer):
    def _validate_payload_size(self) -> None:
        return None

    def _validate_name_uniqueness(self, attrs: dict) -> None:
        return None


class FighterCreateResponseSerializer(FighterPublicSerializer):
    edit_token = serializers.CharField(read_only=True)

    class Meta(FighterPublicSerializer.Meta):
        fields = FighterPublicSerializer.Meta.fields + ['edit_token']


class CreativeAbilityFlavorSerializer(StrictFieldsSerializer):
    index = serializers.IntegerField(min_value=0, max_value=MAX_ABILITY_COUNT - 1)
    name = serializers.CharField(max_length=MAX_ABILITY_NAME_LENGTH)
    description = serializers.CharField(max_length=MAX_ABILITY_DESCRIPTION_LENGTH)

    def validate_name(self, value: str) -> str:
        value = normalize_whitespace(value)
        if len(value) < 2:
            raise serializers.ValidationError('Ability name must be at least 2 characters.')
        return value

    def validate_description(self, value: str) -> str:
        value = normalize_whitespace(value)
        if not value:
            raise serializers.ValidationError('Ability description cannot be blank.')
        return value


class CreativeSuggestionSerializer(StrictFieldsSerializer):
    name = serializers.CharField(max_length=MAX_NAME_LENGTH, required=False, allow_blank=True)
    title = serializers.CharField(max_length=MAX_TITLE_LENGTH, required=False, allow_blank=True)
    description = serializers.CharField(
        max_length=MAX_DESCRIPTION_LENGTH,
        required=False,
        allow_blank=True,
    )
    passive_name = serializers.CharField(
        max_length=MAX_PASSIVE_NAME_LENGTH,
        required=False,
        allow_blank=True,
    )
    passive_description = serializers.CharField(
        max_length=MAX_PASSIVE_DESCRIPTION_LENGTH,
        required=False,
        allow_blank=True,
    )
    abilities = CreativeAbilityFlavorSerializer(
        many=True,
        required=False,
        allow_empty=True,
        max_length=MAX_ABILITY_COUNT,
    )

    def validate_name(self, value: str) -> str:
        value = normalize_whitespace(value)
        if value and len(value) < 3:
            raise serializers.ValidationError('Name must be at least 3 characters.')
        return value

    def validate_title(self, value: str) -> str:
        return BaseFighterWriteSerializer._validate_optional_text(
            'title',
            value,
            max_length=MAX_TITLE_LENGTH,
        )

    def validate_description(self, value: str) -> str:
        return BaseFighterWriteSerializer._validate_optional_text(
            'description',
            value,
            max_length=MAX_DESCRIPTION_LENGTH,
        )

    def validate_passive_name(self, value: str) -> str:
        return BaseFighterWriteSerializer._validate_optional_text(
            'passive_name',
            value,
            max_length=MAX_PASSIVE_NAME_LENGTH,
        )

    def validate_passive_description(self, value: str) -> str:
        return BaseFighterWriteSerializer._validate_optional_text(
            'passive_description',
            value,
            max_length=MAX_PASSIVE_DESCRIPTION_LENGTH,
        )

    def validate_abilities(self, value: list[dict]) -> list[dict]:
        indexes = [ability['index'] for ability in value]
        if len(indexes) != len(set(indexes)):
            raise serializers.ValidationError('Ability flavor suggestions must target unique indexes.')
        return value


class CreativeAssistRequestSerializer(StrictFieldsSerializer):
    archetype = serializers.ChoiceField(choices=Character.Archetype.choices)
    prompt = serializers.CharField(
        max_length=MAX_CREATIVE_PROMPT_LENGTH,
        required=False,
        allow_blank=True,
        default='',
    )
    model = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
    base_fighter = ForgePreviewSerializer()

    def validate(self, attrs: dict) -> dict:
        attrs = super().validate(attrs)
        self._validate_payload_size()

        if attrs['base_fighter']['archetype'] != attrs['archetype']:
            raise serializers.ValidationError(
                {'base_fighter': 'base_fighter.archetype must match the requested archetype.'}
            )

        return attrs

    def _validate_payload_size(self) -> None:
        try:
            payload_size = len(json.dumps(self.initial_data))
        except (TypeError, ValueError):
            raise serializers.ValidationError(
                {'non_field_errors': ['Payload could not be parsed as valid creative JSON.']}
            )

        if payload_size > MAX_CREATIVE_REQUEST_PAYLOAD_CHARS:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        (
                            'Creative assist payload is too large. '
                            f'Keep it under {MAX_CREATIVE_REQUEST_PAYLOAD_CHARS} characters.'
                        )
                    ]
                }
            )


class CreativeAssistResponseSerializer(StrictFieldsSerializer):
    provider = serializers.ChoiceField(choices=('ollama', 'fallback'))
    available = serializers.BooleanField()
    used_model = serializers.CharField(required=False, allow_blank=True, default='')
    message = serializers.CharField()
    suggestions = CreativeSuggestionSerializer(required=False, allow_null=True)


class BattleHistorySerializer(serializers.ModelSerializer):
    fighter_a_name = serializers.CharField(source='fighter_a.name', read_only=True)
    fighter_b_name = serializers.CharField(source='fighter_b.name', read_only=True)
    winner_name = serializers.SerializerMethodField()
    meta = serializers.SerializerMethodField()

    class Meta:
        model = FightHistory
        fields = [
            'id',
            'fighter_a_name',
            'fighter_b_name',
            'winner_name',
            'summary',
            'rounds',
            'sim_count',
            'fighter_a_wins',
            'fighter_b_wins',
            'meta',
            'created_at',
        ]
        read_only_fields = fields

    def get_winner_name(self, obj: FightHistory) -> str:
        if obj.winner_id and obj.winner_id in {obj.fighter_a_id, obj.fighter_b_id}:
            return obj.winner.name if obj.winner else ''
        return ''

    def get_meta(self, obj: FightHistory) -> dict:
        meta = obj.meta if isinstance(obj.meta, dict) else {}
        allowed_recap_keys = {
            'headline',
            'win_reason',
            'turning_point',
            'finisher',
            'key_moments',
        }
        allowed_aggregate_keys = {
            'leader_name',
            'leader_slot',
            'fighter_a_pct',
            'fighter_b_pct',
            'margin_pct',
            'consistency',
            'matchup_story',
            'likely_pattern',
        }
        recap = meta.get('recap') or meta.get('sample_recap') or {}
        aggregate = meta.get('aggregate_insights') or {}
        public_meta = {}
        if isinstance(recap, dict):
            public_meta['recap'] = {
                key: value
                for key, value in recap.items()
                if key in allowed_recap_keys
            }
        if isinstance(aggregate, dict):
            public_meta['aggregate_insights'] = {
                key: value
                for key, value in aggregate.items()
                if key in allowed_aggregate_keys
            }
        return public_meta


class BattleRunRequestSerializer(StrictFieldsSerializer):
    fighter_a_id = serializers.IntegerField(min_value=1)
    fighter_b_id = serializers.IntegerField(min_value=1)
    sim_count = serializers.IntegerField(min_value=1, max_value=1000, required=False, default=1)

    def validate(self, attrs: dict) -> dict:
        attrs = super().validate(attrs)
        self._validate_payload_size()
        fighter_a_id = attrs['fighter_a_id']
        fighter_b_id = attrs['fighter_b_id']

        if fighter_a_id == fighter_b_id:
            raise serializers.ValidationError(
                'fighter_a_id and fighter_b_id must reference different fighters.'
            )

        battle_queryset = Character.objects.filter(
            visibility=Character.Visibility.PUBLIC,
            is_benchmark=False,
        )
        fighters = battle_queryset.in_bulk([fighter_a_id, fighter_b_id])
        missing_ids = [
            fighter_id for fighter_id in (fighter_a_id, fighter_b_id)
            if fighter_id not in fighters
        ]
        if missing_ids:
            raise serializers.ValidationError(
                {
                    'fighter_ids': 'One or more fighters are not available for public battles.'
                }
            )

        attrs['fighter_a'] = fighters[fighter_a_id]
        attrs['fighter_b'] = fighters[fighter_b_id]
        return attrs

    def _validate_payload_size(self) -> None:
        try:
            payload_size = len(json.dumps(self.initial_data))
        except (TypeError, ValueError):
            raise serializers.ValidationError(
                {'non_field_errors': ['Payload could not be parsed as valid battle JSON.']}
            )

        if payload_size > MAX_BATTLE_REQUEST_PAYLOAD_CHARS:
            raise serializers.ValidationError(
                {
                    'non_field_errors': [
                        f'Battle payload is too large. Keep it under {MAX_BATTLE_REQUEST_PAYLOAD_CHARS} characters.'
                    ]
                }
            )
