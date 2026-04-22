from django.contrib import admin

from .models import BugReport, Character, FightHistory


@admin.register(Character)
class CharacterAdmin(admin.ModelAdmin):
    list_display = (
        'name',
        'slug',
        'archetype',
        'visibility',
        'is_benchmark',
        'source',
        'strength',
        'speed',
        'durability',
        'max_health',
        'updated_at',
    )
    list_filter = ('source', 'archetype', 'visibility', 'is_benchmark')
    search_fields = ('name', 'slug', 'title', 'description', 'passive_name', 'win_condition')
    readonly_fields = ('slug', 'created_at', 'updated_at')


@admin.register(FightHistory)
class FightHistoryAdmin(admin.ModelAdmin):
    list_display = ('id', 'fighter_a', 'fighter_b', 'winner', 'sim_count', 'created_at')
    search_fields = ('fighter_a__name', 'fighter_b__name', 'winner__name', 'summary')
    readonly_fields = ('created_at',)


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    list_display = (
        'created_at',
        'summary',
        'email',
        'severity',
        'status',
        'app_version',
        'build_version',
    )
    list_filter = ('created_at', 'severity', 'status', 'app_version')
    search_fields = ('summary', 'details', 'email', 'name', 'app_version', 'build_version')
    readonly_fields = ('created_at', 'app_version', 'build_version')
