from django.contrib import admin
from django.conf import settings
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path
from django.views.generic import TemplateView
from arena.sitemaps import PublicFighterSitemap, StaticViewSitemap

sitemaps = {
    "static": StaticViewSitemap,
    "fighters": PublicFighterSitemap,
}

handler404 = "arena.views.custom_404"
handler500 = "arena.views.custom_500"



urlpatterns = [
    path(f'{settings.CLASHFORGE_ADMIN_PATH}/', admin.site.urls),
    path('', include('arena.urls')),
    path('api/', include('arena.api_urls')),
    path(
        "robots.txt",
        TemplateView.as_view(template_name="robots.txt", content_type="text/plain"),
        name="robots-txt",
    ),
    path("sitemap.xml", sitemap, {"sitemaps": sitemaps}, name="django.contrib.sitemaps.views.sitemap"),
]
