from django.core.management.base import BaseCommand

from arena.benchmark_fighters import seed_benchmark_fighters


class Command(BaseCommand):
    help = 'Compatibility wrapper for seeding ClashForge benchmark fighters.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--purge-missing',
            action='store_true',
            help='Delete benchmark fighters that are not present in the current benchmark catalog.',
        )

    def handle(self, *args, **options):
        result = seed_benchmark_fighters(purge_missing=options['purge_missing'])
        self.stdout.write(
            self.style.SUCCESS(
                'Seeded ClashForge benchmarks '
                f'(created={result["created"]}, updated={result["updated"]}, '
                f'deleted={result["deleted"]}, total={result["total"]}).'
            )
        )
