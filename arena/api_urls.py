from django.urls import path

from .api_views import (
    BattleListView,
    BattleRunView,
    BootstrapView,
    FighterDetailView,
    FighterListCreateView,
    ForgeCreativeAssistView,
    ShareableFighterBySlugView,
)


urlpatterns = [
    path('bootstrap/', BootstrapView.as_view(), name='api-bootstrap'),
    path('fighters/', FighterListCreateView.as_view(), name='api-fighters'),
    path('fighters/by-slug/<slug:fighter_slug>/', ShareableFighterBySlugView.as_view(), name='api-fighter-by-slug'),
    path('fighters/<int:fighter_id>/', FighterDetailView.as_view(), name='api-fighter-detail'),
    path('forge/creative/', ForgeCreativeAssistView.as_view(), name='api-forge-creative'),
    path('battles/', BattleListView.as_view(), name='api-battles'),
    path('battles/run/', BattleRunView.as_view(), name='api-battles-run'),
]
