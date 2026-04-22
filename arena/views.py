from urllib.parse import urlencode

from django.conf import settings
from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse

from .archetype_identity import build_fighter_identity
from .forms import BugReportForm
from .models import Character, FightHistory


def _shareable_fighter_queryset():
    return Character.objects.filter(
        visibility__in=[
            Character.Visibility.PUBLIC,
            Character.Visibility.UNLISTED,
        ],
        is_benchmark=False,
    )


def _public_roster_queryset():
    return Character.objects.filter(
        visibility=Character.Visibility.PUBLIC,
        is_benchmark=False,
    ).order_by('name')


def _recent_battles(limit: int = 6):
    return FightHistory.objects.select_related(
        'fighter_a',
        'fighter_b',
        'winner',
    ).filter(
        fighter_a__visibility=Character.Visibility.PUBLIC,
        fighter_a__is_benchmark=False,
        fighter_b__visibility=Character.Visibility.PUBLIC,
        fighter_b__is_benchmark=False,
    )[:limit]


def home(request):
    featured_fighters = list(_public_roster_queryset()[:6])
    recent_battles = _recent_battles(4)
    return render(
        request,
        'arena/home.html',
        {
            'page_key': 'home',
            'featured_fighters': featured_fighters,
            'recent_battles': recent_battles,
        },
    )


def index(request):
    return render(
        request,
        'arena/arena.html',
        {
            'page_key': 'arena',
        },
    )


def forge(request):
    return render(
        request,
        'arena/forge.html',
        {
            'page_key': 'forge',
        },
    )


def roster(request):
    public_fighters = _public_roster_queryset()
    featured_fighters = list(public_fighters[:8])
    recent_battles = _recent_battles(5)

    return render(
        request,
        'arena/roster.html',
        {
            'page_key': 'roster',
            'featured_fighters': featured_fighters,
            'recent_battles': recent_battles,
        },
    )


def fighters(request):
    return render(
        request,
        'arena/fighters.html',
        {
            'page_key': 'fighters',
            'fighters': _public_roster_queryset()[:48],
        },
    )


def reports(request):
    return render(
        request,
        'arena/reports.html',
        {
            'page_key': 'reports',
            'recent_battles': _recent_battles(20),
        },
    )


def privacy(request):
    return render(
        request,
        'arena/privacy.html',
        {
            'page_key': 'privacy',
        },
    )


def terms(request):
    return render(
        request,
        'arena/terms.html',
        {
            'page_key': 'terms',
        },
    )


def bug_report(request):
    if request.method == 'POST':
        form = BugReportForm(request.POST)
        if form.is_valid():
            report = form.save(commit=False)
            report.app_version = settings.APP_VERSION
            report.build_version = settings.BUILD_VERSION
            report.save()
            messages.success(request, 'Thanks. Your bug report was submitted.')
            return redirect('bug-report-page')
    else:
        form = BugReportForm()

    return render(
        request,
        'arena/bug_report.html',
        {
            'page_key': 'bug_report',
            'form': form,
            'app_version': settings.APP_VERSION,
            'build_version': settings.BUILD_VERSION,
        },
    )


def _build_absolute_url(request, route_name: str, *, kwargs: dict | None = None, query: dict | None = None) -> str:
    path = reverse(route_name, kwargs=kwargs or {})
    absolute = request.build_absolute_uri(path)
    if query:
        return f'{absolute}?{urlencode(query)}'
    return absolute


def fighter_detail(request, fighter_slug: str):
    fighter = get_object_or_404(_shareable_fighter_queryset(), slug=fighter_slug)
    fighter_identity = build_fighter_identity(fighter)

    share_url = request.build_absolute_uri()
    challenge_url = ''
    if fighter.visibility == Character.Visibility.PUBLIC:
        challenge_url = _build_absolute_url(
            request,
            'arena-index',
            query={'challenge': fighter.slug},
        )
    forge_url = _build_absolute_url(
        request,
        'forge-page',
        query={'forge': fighter.slug},
    )
    duplicate_url = _build_absolute_url(
        request,
        'forge-page',
        query={'forge': fighter.slug, 'duplicate': '1'},
    )

    detail_fighter_payload = {
        'fighter': {
            'id': str(fighter.id),
            'slug': fighter.slug,
            'name': fighter.name or '',
            'title': fighter.title or '',
            'creatorName': fighter.creator_name or '',
            'archetype': fighter.get_archetype_display(),
            'summary': fighter_identity.get('summary', ''),
            'avatarColor': fighter.avatar_color or '#6d28d9',
            'visibility': fighter.visibility or '',
            'source': fighter.get_source_display(),
            'stats': {
                'strength': fighter.strength,
                'speed': fighter.speed,
                'durability': fighter.durability,
                'intelligence': fighter.intelligence,
                'maxHealth': fighter.max_health,
            },
        },
        'urls': {
            'shareUrl': share_url,
            'challengeUrl': challenge_url,
            'duplicateUrl': duplicate_url,
            'forgeUrl': forge_url,
        },
    }

    visibility_summary = (
        'Visible in the public fighter library and shareable by direct link.'
        if fighter.visibility == Character.Visibility.PUBLIC
        else 'Hidden from the public fighter library, but anyone with this link can still open the page.'
    )

    challenge_prompt = (
        f'Bring your champion or a fresh variant into the arena and test it against {fighter.name}.'
        if fighter.visibility == Character.Visibility.PUBLIC
        else 'Duplicate this unlisted fighter into Forge to make your own public battle-ready variant.'
    )

    return render(
        request,
        'arena/fighter_detail.html',
        {
            'page_key': 'detail',
            'fighter': fighter,
            'fighter_identity': fighter_identity,
            'detail_fighter_payload': detail_fighter_payload,
            'share_url': share_url,
            'challenge_url': challenge_url,
            'forge_url': forge_url,
            'duplicate_url': duplicate_url,
            'visibility_summary': visibility_summary,
            'challenge_prompt': challenge_prompt,
        },
    )


def custom_404(request, exception):
    return render(request, "404.html", status=404)

def custom_500(request):
    return render(request, "500.html", status=500)
