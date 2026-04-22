from django.urls import path
from django.views.generic import RedirectView

from .views import (
    bug_report,
    fighter_detail,
    fighters,
    forge,
    home,
    index,
    privacy,
    reports,
    roster,
    terms,
)

urlpatterns = [
    path("home/", RedirectView.as_view(url="/", permanent=True)),
    path('', home, name='home-page'),
    path('arena/', index, name='arena-index'),
    path('forge/', forge, name='forge-page'),
    path('roster/', roster, name='roster-page'),
    path('fighters/', fighters, name='fighters-page'),
    path('fighters/<slug:fighter_slug>/', fighter_detail, name='fighter-detail'),
    path('reports/', reports, name='reports-page'),
    path('privacy/', privacy, name='privacy-page'),
    path('terms/', terms, name='terms-page'),
    path('bug-report/', bug_report, name='bug-report-page'),
]
