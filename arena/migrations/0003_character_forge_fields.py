from django.db import migrations, models
from django.utils.text import slugify

import arena.models


def _existing_column_names(schema_editor, table_name):
    with schema_editor.connection.cursor() as cursor:
        return {
            column.name
            for column in schema_editor.connection.introspection.get_table_description(
                cursor,
                table_name,
            )
        }


class AddFieldIfMissing(migrations.AddField):
    """Add the field unless a prior failed migration attempt already added it."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        to_model = to_state.apps.get_model(app_label, self.model_name)
        field = to_model._meta.get_field(self.name)
        existing_columns = _existing_column_names(schema_editor, to_model._meta.db_table)
        if field.column in existing_columns:
            return

        super().database_forwards(app_label, schema_editor, from_state, to_state)


class AlterSlugUniqueIfNeeded(migrations.AlterField):
    """Add slug uniqueness unless a prior failed migration attempt already did it."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        to_model = to_state.apps.get_model(app_label, self.model_name)
        field = to_model._meta.get_field(self.name)

        with schema_editor.connection.cursor() as cursor:
            constraints = schema_editor.connection.introspection.get_constraints(
                cursor,
                to_model._meta.db_table,
            )

        for constraint in constraints.values():
            if constraint.get('unique') and constraint.get('columns') == [field.column]:
                return

        super().database_forwards(app_label, schema_editor, from_state, to_state)


def populate_character_forge_fields(apps, schema_editor):
    Character = apps.get_model('arena', 'Character')
    benchmark_overrides = {
        'Raze': {
            'archetype': 'assassin',
            'is_benchmark': True,
            'fighter_state': {
                'version': 1,
                'stance': 'aggressive',
                'tags': ['benchmark', 'burst', 'tempo'],
            },
        },
        'Titan': {
            'archetype': 'tank',
            'is_benchmark': True,
            'fighter_state': {
                'version': 1,
                'stance': 'guarded',
                'tags': ['benchmark', 'anchor', 'attrition'],
            },
        },
    }

    used_slugs = set()
    for character in Character.objects.order_by('id'):
        base_slug = slugify(character.name)[:160] or f'fighter-{character.pk}'
        candidate = base_slug
        suffix = 2
        while candidate in used_slugs:
            suffix_text = f'-{suffix}'
            candidate = f'{base_slug[:160 - len(suffix_text)]}{suffix_text}'
            suffix += 1

        character.slug = candidate
        used_slugs.add(candidate)
        character.visibility = character.visibility or 'public'

        override = benchmark_overrides.get(character.name)
        if override is not None:
            character.archetype = override['archetype']
            character.is_benchmark = override['is_benchmark']
            character.fighter_state = override['fighter_state']
        elif not character.fighter_state:
            character.fighter_state = {
                'version': 1,
                'stance': 'neutral',
                'tags': [],
            }

        character.save(
            update_fields=[
                'slug',
                'visibility',
                'archetype',
                'is_benchmark',
                'fighter_state',
            ]
        )


class Migration(migrations.Migration):

    dependencies = [
        ('arena', '0002_character_edit_token_hash'),
    ]

    operations = [
        AddFieldIfMissing(
            model_name='character',
            name='archetype',
            field=models.CharField(
                choices=[
                    ('assassin', 'Assassin'),
                    ('tank', 'Tank'),
                    ('bruiser', 'Bruiser'),
                    ('duelist', 'Duelist'),
                    ('control', 'Control'),
                    ('glass_cannon', 'Glass Cannon'),
                ],
                default='duelist',
                max_length=20,
            ),
        ),
        AddFieldIfMissing(
            model_name='character',
            name='fighter_state',
            field=models.JSONField(blank=True, default=arena.models.default_fighter_state),
        ),
        AddFieldIfMissing(
            model_name='character',
            name='is_benchmark',
            field=models.BooleanField(default=False),
        ),
        AddFieldIfMissing(
            model_name='character',
            name='slug',
            field=models.SlugField(db_index=False, default='', editable=False, max_length=160),
        ),
        AddFieldIfMissing(
            model_name='character',
            name='visibility',
            field=models.CharField(
                choices=[('public', 'Public'), ('unlisted', 'Unlisted')],
                default='public',
                max_length=20,
            ),
        ),
        migrations.RunPython(populate_character_forge_fields, migrations.RunPython.noop),
        AlterSlugUniqueIfNeeded(
            model_name='character',
            name='slug',
            field=models.SlugField(editable=False, max_length=160, unique=True),
        ),
    ]
