from django.contrib.sitemaps import Sitemap
from django.urls import reverse

from .models import Character


class StaticViewSitemap(Sitemap):
    protocol = "https"
    changefreq = "daily"
    priority = 1.0

    def items(self):
        return ["arena-index"]

    def location(self, item):
        return reverse(item)


class PublicFighterSitemap(Sitemap):
    protocol = "https"
    changefreq = "weekly"
    priority = 0.7

    def items(self):
        return Character.objects.filter(visibility=Character.Visibility.PUBLIC)

    def location(self, obj):
        return reverse("fighter-detail", kwargs={"fighter_slug": obj.slug})

    def lastmod(self, obj):
        return getattr(obj, "updated_at", None)