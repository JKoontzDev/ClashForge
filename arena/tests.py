import hashlib
import random
from copy import deepcopy
from unittest.mock import patch

from django.conf import settings
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .benchmark_fighters import BENCHMARK_FIGHTERS
from .benchmark_guidance import build_benchmark_gauntlet, recommend_benchmarks
from .models import BugReport, Character, FightHistory
from .services.combat import run_single_fight
from .services.creative_assistant import CreativeAssistResult


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def rest_framework_with_rates(**rates):
    config = deepcopy(settings.REST_FRAMEWORK)
    config['DEFAULT_THROTTLE_RATES'] = {
        **config.get('DEFAULT_THROTTLE_RATES', {}),
        **rates,
    }
    return config


@override_settings(APP_VERSION='9.8.7', BUILD_VERSION='test-build')
class BugReportPageTests(TestCase):
    def test_valid_bug_report_saves_server_version_fields(self):
        response = self.client.post(
            reverse('bug-report-page'),
            {
                'name': '  Tester  ',
                'email': 'tester@example.com',
                'category': BugReport.Category.BUG,
                'page_url': 'https://example.com/arena/',
                'summary': '  Arena button failed  ',
                'details': '  Clicking the arena button did nothing.  ',
                'severity': BugReport.Severity.MEDIUM,
                'website': '',
            },
        )

        self.assertRedirects(response, reverse('bug-report-page'))
        report = BugReport.objects.get()
        self.assertEqual(report.name, 'Tester')
        self.assertEqual(report.summary, 'Arena button failed')
        self.assertEqual(report.details, 'Clicking the arena button did nothing.')
        self.assertEqual(report.app_version, '9.8.7')
        self.assertEqual(report.build_version, 'test-build')

    def test_honeypot_blocks_bug_report_submission(self):
        response = self.client.post(
            reverse('bug-report-page'),
            {
                'summary': 'Arena button failed',
                'details': 'Clicking the arena button did nothing.',
                'website': 'spam',
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(BugReport.objects.count(), 0)


class ArenaApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.credentials(HTTP_X_CLASHFORGE_CLIENT='web')
        self.raze = Character.objects.create(
            name='Raze',
            source='seed',
            archetype=Character.Archetype.ASSASSIN,
            visibility=Character.Visibility.PUBLIC,
            is_benchmark=True,
            avatar_color='#ff4d6d',
            strength=82,
            speed=88,
            durability=54,
            intelligence=68,
            max_health=108,
            abilities=[
                {
                    'name': 'Ion Slash',
                    'type': 'attack',
                    'power': 18,
                    'cooldown': 2,
                    'scaling': 'speed',
                    'description': 'Fast arc strike.',
                },
                {
                    'name': 'Overclock',
                    'type': 'buff',
                    'power': 0,
                    'cooldown': 5,
                    'duration': 2,
                    'effect': {'speed_mult': 1.3, 'damage_mult': 1.2},
                    'description': 'Pushes core systems beyond safe thresholds.',
                },
            ],
        )
        self.titan = Character.objects.create(
            name='Titan',
            source='seed',
            archetype=Character.Archetype.TANK,
            visibility=Character.Visibility.PUBLIC,
            is_benchmark=True,
            avatar_color='#38bdf8',
            strength=76,
            speed=42,
            durability=92,
            intelligence=61,
            max_health=148,
            abilities=[
                {
                    'name': 'Crusher Fist',
                    'type': 'attack',
                    'power': 24,
                    'cooldown': 3,
                    'scaling': 'strength',
                    'description': 'Single brutal strike.',
                },
                {
                    'name': 'Fortress Stance',
                    'type': 'buff',
                    'power': 0,
                    'cooldown': 5,
                    'duration': 2,
                    'effect': {'damage_taken_mult': 0.7},
                    'description': 'Cuts incoming damage.',
                },
            ],
        )
        self.mira = Character.objects.create(
            name='Mira Volt',
            source='user',
            archetype=Character.Archetype.DUELIST,
            visibility=Character.Visibility.PUBLIC,
            avatar_color='#22c55e',
            strength=70,
            speed=78,
            durability=64,
            intelligence=68,
            max_health=118,
            abilities=[
                {
                    'name': 'Circuit Jab',
                    'type': 'attack',
                    'power': 18,
                    'cooldown': 2,
                    'scaling': 'speed',
                    'description': 'Fast tempo check.',
                }
            ],
        )
        self.bastion = Character.objects.create(
            name='Bastion Vale',
            source='user',
            archetype=Character.Archetype.TANK,
            visibility=Character.Visibility.PUBLIC,
            avatar_color='#0ea5e9',
            strength=76,
            speed=52,
            durability=88,
            intelligence=60,
            max_health=146,
            abilities=[
                {
                    'name': 'Anchor Strike',
                    'type': 'attack',
                    'power': 22,
                    'cooldown': 3,
                    'scaling': 'durability',
                    'description': 'Heavy counterpunch.',
                }
            ],
        )

    def build_fighter_payload(self, **overrides):
        payload = {
            'name': 'Nova Rift',
            'title': 'Starforged Duelist',
            'description': 'A precise pressure fighter.',
            'avatar_color': '#22c55e',
            'strength': 72,
            'speed': 70,
            'durability': 68,
            'intelligence': 66,
            'max_health': 122,
            'passive_name': 'Adaptive Nerves',
            'passive_description': 'Gains a slight edge after each cast.',
            'abilities': [
                {
                    'name': 'Arc Lunge',
                    'type': 'attack',
                    'power': 18,
                    'cooldown': 2,
                    'scaling': 'speed',
                    'description': 'Low cooldown opener.',
                },
                {
                    'name': 'Core Sync',
                    'type': 'buff',
                    'power': 0,
                    'cooldown': 5,
                    'duration': 2,
                    'effect': {'damage_taken_mult': 0.8, 'damage_mult': 1.15},
                    'description': 'Short-lived tempo swing.',
                },
            ],
            'win_condition': 'Force favorable cooldown trades.',
            'balance_notes': 'Balanced around a fair duel.',
        }
        payload.update(overrides)
        return payload

    def build_creative_payload(self, **fighter_overrides):
        base_fighter = self.build_fighter_payload(
            archetype=Character.Archetype.DUELIST,
            visibility=Character.Visibility.UNLISTED,
            **fighter_overrides,
        )
        return {
            'archetype': Character.Archetype.DUELIST,
            'prompt': 'A measured duelist who turns hesitation into pressure.',
            'model': '',
            'base_fighter': base_fighter,
        }

    def test_create_fighter_returns_edit_token(self):
        payload = self.build_fighter_payload(name='  Nova   Rift  ')

        response = self.client.post('/api/fighters/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['source'], 'user')
        self.assertEqual(response.data['name'], 'Nova Rift')
        self.assertEqual(response.data['slug'], 'nova-rift')
        self.assertEqual(response.data['archetype'], Character.Archetype.DUELIST)
        self.assertEqual(response.data['visibility'], Character.Visibility.PUBLIC)
        self.assertTrue(response.data['can_battle'])
        self.assertNotIn('is_benchmark', response.data)
        self.assertNotIn('fighter_state', response.data)
        self.assertIn('edit_token', response.data)
        fighter = Character.objects.get(name='Nova Rift')
        self.assertTrue(fighter.edit_token_hash)
        self.assertEqual(fighter.slug, 'nova-rift')

    def test_create_inferrs_glass_cannon_before_assassin(self):
        response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(
                name='Solar Knife',
                strength=88,
                speed=80,
                durability=48,
                intelligence=68,
                max_health=102,
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['archetype'], Character.Archetype.GLASS_CANNON)

    def test_patch_fighter_requires_valid_edit_token(self):
        token = 'fighter-secret-token'
        fighter = Character.objects.create(
            name='Patch Target',
            source='user',
            edit_token_hash=hash_token(token),
            avatar_color='#8b5cf6',
            strength=70,
            speed=70,
            durability=70,
            intelligence=70,
            max_health=120,
            abilities=[
                {
                    'name': 'Rift Breaker',
                    'type': 'attack',
                    'power': 20,
                    'cooldown': 3,
                    'scaling': 'strength',
                    'description': 'Commitment strike.',
                }
            ],
        )

        url = f'/api/fighters/{fighter.id}/'
        response = self.client.patch(url, {'title': 'No Token'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.patch(
            url,
            {'title': 'Wrong Token'},
            format='json',
            HTTP_X_FIGHTER_EDIT_TOKEN='bad-token',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.patch(
            url,
            {'title': 'Token Verified'},
            format='json',
            HTTP_X_FIGHTER_EDIT_TOKEN=token,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        fighter.refresh_from_db()
        self.assertEqual(fighter.title, 'Token Verified')

    def test_create_rejects_duplicate_name_after_normalization(self):
        response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(name='  raze  '),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)

    def test_create_rejects_server_controlled_fields(self):
        response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(source='seed', edit_token_hash='tamper'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('source', response.data)
        self.assertIn('edit_token_hash', response.data)

    def test_public_writes_require_client_marker_header(self):
        self.client.credentials()

        response = self.client.post('/api/fighters/', self.build_fighter_payload(), format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Character.objects.filter(name='Nova Rift').count(), 0)

    def test_invalid_public_writes_do_not_create_server_sessions(self):
        before_count = Session.objects.count()

        for index in range(3):
            response = self.client.post(
                '/api/fighters/',
                {'name': f'Bad {index}'},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(Session.objects.count(), before_count)
        self.assertIn('clashforge_anon_id', self.client.cookies)

    def test_create_rejects_server_owned_forge_state_fields(self):
        response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(
                slug='tampered-slug',
                is_benchmark=True,
                fighter_state={'version': 99, 'stance': 'aggressive', 'tags': ['pwned']},
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('slug', response.data)
        self.assertIn('is_benchmark', response.data)
        self.assertIn('fighter_state', response.data)

    def test_create_rejects_balance_breaking_payloads(self):
        response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(
                strength=95,
                speed=95,
                durability=95,
                intelligence=95,
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('non_field_errors', response.data)

    def test_create_rejects_malformed_abilities_and_large_payloads(self):
        malformed_response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(
                abilities=[
                    {
                        'name': 'Arc Lunge',
                        'type': 'attack',
                        'power': 18,
                        'cooldown': 2,
                        'scaling': 'speed',
                        'effect': {'bleed': {'bad': 'nested'}},
                        'description': 'Low cooldown opener.',
                    }
                ],
            ),
            format='json',
        )
        self.assertEqual(malformed_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('abilities', malformed_response.data)

        oversized_payload = self.build_fighter_payload(
            title='T' * 80,
            description='D' * 600,
            passive_name='P' * 60,
            passive_description='Q' * 320,
            win_condition='W' * 240,
            balance_notes='B' * 240,
            abilities=[
                {
                    'name': 'A' * 40,
                    'type': 'attack',
                    'power': 18,
                    'cooldown': 2,
                    'scaling': 'speed',
                    'description': 'X' * 240,
                },
                {
                    'name': 'B' * 40,
                    'type': 'attack',
                    'power': 20,
                    'cooldown': 3,
                    'scaling': 'strength',
                    'description': 'Y' * 240,
                },
                {
                    'name': 'C' * 40,
                    'type': 'buff',
                    'power': 0,
                    'cooldown': 5,
                    'duration': 2,
                    'effect': {'damage_mult': 1.1},
                    'description': 'Z' * 240,
                },
                {
                    'name': 'D' * 40,
                    'type': 'buff',
                    'power': 0,
                    'cooldown': 4,
                    'duration': 2,
                    'effect': {'speed_mult': 1.2},
                    'description': 'K' * 240,
                },
            ],
        )
        oversized_response = self.client.post(
            '/api/fighters/',
            oversized_payload,
            format='json',
        )
        self.assertEqual(oversized_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('non_field_errors', oversized_response.data)

    def test_seed_fighters_cannot_be_patched_through_public_api(self):
        response = self.client.patch(
            f'/api/fighters/{self.raze.id}/',
            {'title': 'Tampered'},
            format='json',
            HTTP_X_FIGHTER_EDIT_TOKEN='anything',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unlisted_fighters_are_hidden_from_public_list(self):
        response = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(
                name='Ghost Circuit',
                visibility=Character.Visibility.UNLISTED,
            ),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        list_response = self.client.get('/api/fighters/')
        listed_names = {fighter['name'] for fighter in list_response.data}

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertNotIn('Ghost Circuit', listed_names)
        self.assertNotIn('Raze', listed_names)
        self.assertIn('Mira Volt', listed_names)

    def test_benchmark_seed_command_is_idempotent(self):
        call_command('seed_benchmark_fighters')
        call_command('seed_benchmark_fighters')

        benchmarks = Character.objects.filter(is_benchmark=True)

        self.assertEqual(benchmarks.count(), len(BENCHMARK_FIGHTERS))
        self.assertEqual(
            set(benchmarks.values_list('archetype', flat=True)),
            {choice for choice, _ in Character.Archetype.choices},
        )
        self.assertTrue(benchmarks.filter(name='Raze', source=Character.Source.SEED).exists())

    def test_benchmark_fighter_detail_page_is_not_publicly_shareable(self):
        response = self.client.get(f'/fighters/{self.raze.slug}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_public_bootstrap_excludes_benchmark_profiles(self):
        response = self.client.get('/api/bootstrap/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        fighters = response.data['fighters']
        names = {fighter['name'] for fighter in fighters}
        self.assertNotIn('Raze', names)
        self.assertNotIn('Titan', names)
        mira = next(fighter for fighter in fighters if fighter['name'] == 'Mira Volt')
        self.assertTrue(mira['can_battle'])
        self.assertNotIn('benchmark_profile', mira)
        self.assertNotIn('is_benchmark', mira)
        self.assertNotIn('fighter_state', mira)

        created = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(name='Signal Bloom'),
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertTrue(created.data['can_battle'])

    def test_benchmark_recommendations_and_gauntlet_are_deterministic(self):
        call_command('seed_benchmark_fighters')
        fighter = self.build_fighter_payload(
            name='Anchor Test',
            archetype=Character.Archetype.TANK,
            strength=66,
            speed=44,
            durability=90,
            intelligence=58,
            max_health=152,
        )

        benchmarks = Character.objects.filter(is_benchmark=True).order_by('name')
        recommendations = recommend_benchmarks(fighter, benchmarks, limit=3)
        gauntlet = build_benchmark_gauntlet(fighter, benchmarks, limit=3)

        self.assertEqual(recommendations[0]['name'], 'Hexlocke')
        self.assertEqual(gauntlet[0]['name'], 'Vesper Vale')
        self.assertEqual(len({step['profile']['bucket'] for step in gauntlet}), 3)

    def test_seeded_benchmark_balance_has_no_universal_pick_outlier(self):
        call_command('seed_benchmark_fighters')
        benchmarks = list(Character.objects.filter(is_benchmark=True).order_by('name'))

        totals: dict[str, list[int]] = {
            fighter.name: [0, 0, 0]
            for fighter in benchmarks
        }
        for left_index, fighter_a in enumerate(benchmarks):
            for fighter_b in benchmarks[left_index + 1:]:
                for seed_index in range(30):
                    outcome = run_single_fight(
                        fighter_a,
                        fighter_b,
                        random.Random(f'balance-{fighter_a.name}-{fighter_b.name}-{seed_index}'),
                        record_timeline=False,
                    )
                    if outcome.winner == fighter_a:
                        totals[fighter_a.name][0] += 1
                        totals[fighter_b.name][1] += 1
                    elif outcome.winner == fighter_b:
                        totals[fighter_b.name][0] += 1
                        totals[fighter_a.name][1] += 1
                    else:
                        totals[fighter_a.name][2] += 1
                        totals[fighter_b.name][2] += 1

        win_rates = {
            name: wins / (wins + losses + draws)
            for name, (wins, losses, draws) in totals.items()
        }

        self.assertLess(max(win_rates.values()), 0.75)
        self.assertGreater(win_rates['Hexlocke'], 0.25)
        self.assertLess(win_rates['Titan'], 0.7)

    def test_unlisted_fighter_detail_page_is_shareable_by_slug(self):
        fighter = Character.objects.create(
            name='Shadow Draft',
            source='user',
            visibility=Character.Visibility.UNLISTED,
            avatar_color='#0ea5e9',
            strength=68,
            speed=81,
            durability=58,
            intelligence=74,
            max_health=112,
            abilities=[
                {
                    'name': 'Slip Arc',
                    'type': 'attack',
                    'power': 17,
                    'cooldown': 2,
                    'scaling': 'speed',
                    'description': 'Fast check-in strike.',
                }
            ],
        )

        response = self.client.get(f'/fighters/{fighter.slug}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertContains(response, 'Shadow Draft')
        self.assertContains(response, 'Unlisted')
        self.assertContains(response, 'Hidden from the public fighter library')
        self.assertContains(response, 'official public battles require a published variant')
        self.assertNotContains(response, 'Copy Challenge URL')
        self.assertNotContains(response, '?challenge=')

    def test_shareable_fighter_slug_api_exposes_unlisted_fighter(self):
        fighter = Character.objects.create(
            name='Link Ghost',
            source='user',
            visibility=Character.Visibility.UNLISTED,
            avatar_color='#0ea5e9',
            strength=66,
            speed=77,
            durability=60,
            intelligence=74,
            max_health=114,
            abilities=[
                {
                    'name': 'Slip Arc',
                    'type': 'attack',
                    'power': 17,
                    'cooldown': 2,
                    'scaling': 'speed',
                    'description': 'Fast check-in strike.',
                }
            ],
        )

        response = self.client.get(f'/api/fighters/by-slug/{fighter.slug}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Link Ghost')
        self.assertEqual(response.data['visibility'], Character.Visibility.UNLISTED)

    @override_settings(
        REST_FRAMEWORK=rest_framework_with_rates(
            fighter_create_burst='1/minute',
            fighter_create_sustained='10/hour',
        )
    )
    def test_fighter_create_is_rate_limited(self):
        first = self.client.post('/api/fighters/', self.build_fighter_payload(), format='json')
        second = self.client.post(
            '/api/fighters/',
            self.build_fighter_payload(name='Second Forge'),
            format='json',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    @override_settings(
        REST_FRAMEWORK=rest_framework_with_rates(
            creative_assist_burst='1/minute',
            creative_assist_sustained='10/hour',
        )
    )
    def test_creative_assist_is_rate_limited(self):
        payload = self.build_creative_payload()

        first = self.client.post('/api/forge/creative/', payload, format='json')
        second = self.client.post('/api/forge/creative/', payload, format='json')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_creative_assist_falls_back_cleanly_when_disabled(self):
        response = self.client.post('/api/forge/creative/', self.build_creative_payload(), format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['provider'], 'fallback')
        self.assertFalse(response.data['available'])
        self.assertIsNone(response.data['suggestions'])

    @override_settings(OLLAMA_ENABLED=True, OLLAMA_PUBLIC_API_ENABLED=True)
    @patch('arena.api_views.request_ollama_creative')
    def test_creative_assist_returns_validated_flavor(self, mocked_request):
        mocked_request.return_value = CreativeAssistResult(
            used_model='llama3.1:8b',
            suggestions={
                'name': '  Nova   Prism  ',
                'title': '  Mirror Saint ',
                'description': '  A precise duelist with a punishing second beat. ',
                'passive_name': '  Quiet Tempo ',
                'passive_description': '  Small timing wins stack into sharper turns. ',
                'abilities': [
                    {'index': 0, 'name': '  Rift Check ', 'description': '  Fast opener. '},
                    {'index': 1, 'name': '  Core Ledger ', 'description': '  Tight buff window. '},
                ],
            },
        )

        response = self.client.post('/api/forge/creative/', self.build_creative_payload(), format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['provider'], 'ollama')
        self.assertTrue(response.data['available'])
        self.assertEqual(response.data['used_model'], 'llama3.1:8b')
        self.assertEqual(response.data['suggestions']['name'], 'Nova Prism')
        self.assertEqual(response.data['suggestions']['title'], 'Mirror Saint')
        self.assertEqual(response.data['suggestions']['abilities'][0]['name'], 'Rift Check')

    @override_settings(OLLAMA_ENABLED=True, OLLAMA_PUBLIC_API_ENABLED=True)
    @patch('arena.api_views.request_ollama_creative')
    def test_creative_assist_rejects_model_output_outside_allowed_schema(self, mocked_request):
        mocked_request.return_value = CreativeAssistResult(
            used_model='llama3.1:8b',
            suggestions={
                'name': 'Nova Prism',
                'strength': 999,
            },
        )

        response = self.client.post('/api/forge/creative/', self.build_creative_payload(), format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['provider'], 'fallback')
        self.assertFalse(response.data['available'])
        self.assertIsNone(response.data['suggestions'])

    @override_settings(
        REST_FRAMEWORK=rest_framework_with_rates(
            battle_run_burst='1/minute',
            battle_run_sustained='10/hour',
        )
    )
    def test_battle_run_is_rate_limited(self):
        payload = {
            'fighter_a_id': self.mira.id,
            'fighter_b_id': self.bastion.id,
            'sim_count': 1,
        }

        first = self.client.post('/api/battles/run/', payload, format='json')
        second = self.client.post('/api/battles/run/', payload, format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_battle_run_rejects_oversized_payloads_early(self):
        oversized_body = (
            '{"fighter_a_id": %d, "fighter_b_id": %d, "sim_count": 1, "junk": "%s"}'
            % (self.raze.id, self.titan.id, 'x' * 600)
        )

        response = self.client.post(
            '/api/battles/run/',
            oversized_body,
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Request body too large', str(response.data))

    def test_battle_run_rejects_benchmark_fighter_ids(self):
        response = self.client.post(
            '/api/battles/run/',
            {
                'fighter_a_id': self.raze.id,
                'fighter_b_id': self.mira.id,
                'sim_count': 1,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('not available for public battles', str(response.data))
        self.assertNotIn('Raze', str(response.data))
        self.assertEqual(FightHistory.objects.count(), 0)

    def test_public_battle_history_excludes_benchmark_fights_and_internal_fields(self):
        FightHistory.objects.create(
            fighter_a=self.raze,
            fighter_b=self.mira,
            winner=self.raze,
            summary='internal benchmark fight',
            seed='secret-seed',
            rounds=3,
            sim_count=1,
            fighter_a_wins=1,
            fighter_b_wins=0,
            log=[{'text': 'secret'}],
        )
        FightHistory.objects.create(
            fighter_a=self.mira,
            fighter_b=self.bastion,
            winner=self.mira,
            summary='public fight',
            seed='another-secret',
            rounds=4,
            sim_count=1,
            fighter_a_wins=1,
            fighter_b_wins=0,
            log=[{'text': 'public'}],
        )

        response = self.client.get('/api/battles/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        summaries = {battle['summary'] for battle in response.data}
        self.assertIn('public fight', summaries)
        self.assertNotIn('internal benchmark fight', summaries)
        battle = response.data[0]
        self.assertNotIn('seed', battle)
        self.assertNotIn('log', battle)
        self.assertNotIn('fighter_a', battle)
        self.assertNotIn('fighter_b', battle)

        bootstrap = self.client.get('/api/bootstrap/')
        bootstrap_summaries = {battle['summary'] for battle in bootstrap.data['recent_battles']}
        self.assertIn('public fight', bootstrap_summaries)
        self.assertNotIn('internal benchmark fight', bootstrap_summaries)

    def test_public_battle_history_does_not_leak_malformed_winner_names(self):
        FightHistory.objects.create(
            fighter_a=self.mira,
            fighter_b=self.bastion,
            winner=self.raze,
            summary='malformed winner fight',
            rounds=2,
            sim_count=1,
            fighter_a_wins=1,
            fighter_b_wins=0,
        )

        response = self.client.get('/api/battles/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        battle = response.data[0]
        self.assertEqual(battle['summary'], 'malformed winner fight')
        self.assertEqual(battle['winner_name'], '')

    def test_battle_run_creates_history_and_rejects_direct_history_payloads(self):
        response = self.client.post(
            '/api/battles/run/',
            {
                'fighter_a_id': self.mira.id,
                'fighter_b_id': self.bastion.id,
                'winner': self.raze.id,
                'log': ['fake'],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            '/api/battles/run/',
            {
                'fighter_a_id': self.mira.id,
                'fighter_b_id': self.bastion.id,
                'sim_count': 3,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(FightHistory.objects.count(), 1)
        battle = FightHistory.objects.get()
        self.assertEqual(battle.fighter_a, self.mira)
        self.assertEqual(battle.fighter_b, self.bastion)
        self.assertEqual(battle.sim_count, 3)
        self.assertEqual(
            battle.fighter_a_wins + battle.fighter_b_wins,
            3,
        )
        self.assertIn('fighters', response.data['result'])
        self.assertIn('winner', response.data['result'])
        self.assertIn('timeline', response.data['result'])
        self.assertIn('aggregate', response.data['result'])
        self.assertEqual(response.data['result']['fighters']['fighter_a']['id'], self.mira.id)
        self.assertEqual(response.data['result']['fighters']['fighter_b']['id'], self.bastion.id)
        self.assertEqual(
            response.data['result']['aggregate']['fighter_a_wins']
            + response.data['result']['aggregate']['fighter_b_wins'],
            3,
        )
        self.assertIn('recap', response.data['result'])
        self.assertIn('aggregate_insights', response.data['result'])
        self.assertIn('headline', response.data['result']['recap'])
        self.assertIn('consistency', response.data['result']['aggregate_insights'])
        self.assertIsInstance(battle.log, list)
        self.assertIn('sample_recap', battle.meta)
        self.assertIn('aggregate_insights', battle.meta)

    def test_single_battle_response_contains_structured_timeline_events(self):
        response = self.client.post(
            '/api/battles/run/',
            {
                'fighter_a_id': self.mira.id,
                'fighter_b_id': self.bastion.id,
                'sim_count': 1,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        result = response.data['result']
        self.assertEqual(result['fighters']['fighter_a']['slot'], 'A')
        self.assertEqual(result['fighters']['fighter_b']['slot'], 'B')
        self.assertIn('summary', result)
        self.assertIn('final', result)
        self.assertTrue(result['timeline'])
        first_event = result['timeline'][0]
        self.assertIn('round', first_event)
        self.assertIn('type', first_event)
        self.assertIn('actor_slot', first_event)
        self.assertIn('text', first_event)
        self.assertIn('moment', first_event)
        self.assertIn('priority', first_event)
        self.assertIn(first_event['priority'], {'minor', 'major', 'critical'})
        self.assertIn('recap', result)
        self.assertIn('headline', result['recap'])
        self.assertIn('win_reason', result['recap'])
        self.assertIn('aggregate_insights', result)

        battle = FightHistory.objects.get()
        self.assertIn('recap', battle.meta)
        self.assertIn('finisher', battle.meta['recap'])

    def test_legacy_direct_fight_save_endpoint_is_gone(self):
        response = self.client.post('/api/save-fight/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class RouteProtectionTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.credentials(HTTP_X_CLASHFORGE_CLIENT='web')

    @override_settings(
        CLASHFORGE_DYNAMIC_BURST_RATE='20/minute',
        CLASHFORGE_DYNAMIC_SUSTAINED_RATE='200/hour',
        CLASHFORGE_PAGE_VIEW_BURST_RATE='1/minute',
        CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE='20/hour',
    )
    def test_html_page_views_are_rate_limited(self):
        first = self.client.get('/')
        second = self.client.get('/forge/')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('Retry-After', second)

    @override_settings(
        CLASHFORGE_DYNAMIC_BURST_RATE='1/minute',
        CLASHFORGE_DYNAMIC_SUSTAINED_RATE='20/hour',
        CLASHFORGE_PAGE_VIEW_BURST_RATE='20/minute',
        CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE='200/hour',
    )
    def test_unknown_dynamic_routes_are_rate_limited(self):
        first = self.client.get('/missing-one/')
        second = self.client.get('/missing-two/')

        self.assertEqual(first.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('Retry-After', second)

    @override_settings(
        CLASHFORGE_TRUST_X_FORWARDED_FOR=True,
        CLASHFORGE_TRUSTED_PROXY_IPS=['10.0.0.10'],
        CLASHFORGE_NUM_PROXIES=1,
    )
    def test_malformed_forwarded_for_from_trusted_proxy_is_rejected(self):
        response = self.client.get(
            '/api/bootstrap/',
            REMOTE_ADDR='10.0.0.10',
            HTTP_X_FORWARDED_FOR='not-an-ip',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(
        CLASHFORGE_TRUST_X_FORWARDED_FOR=True,
        CLASHFORGE_TRUSTED_PROXY_IPS=['10.0.0.10'],
        CLASHFORGE_NUM_PROXIES=1,
        REST_FRAMEWORK=rest_framework_with_rates(
            public_read_burst='1/minute',
            public_read_sustained='10/hour',
        ),
        CLASHFORGE_DYNAMIC_BURST_RATE='20/minute',
        CLASHFORGE_DYNAMIC_SUSTAINED_RATE='200/hour',
        CLASHFORGE_PAGE_VIEW_BURST_RATE='20/minute',
        CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE='200/hour',
    )
    def test_forwarded_for_from_untrusted_source_is_not_used_for_throttle_identity(self):
        first = self.client.get(
            '/api/bootstrap/',
            REMOTE_ADDR='203.0.113.20',
            HTTP_X_FORWARDED_FOR='198.51.100.1',
        )
        second = self.client.get(
            '/api/fighters/',
            REMOTE_ADDR='203.0.113.20',
            HTTP_X_FORWARDED_FOR='198.51.100.2',
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    @override_settings(
        CLASHFORGE_ADMIN_BURST_RATE='1/minute',
        CLASHFORGE_ADMIN_SUSTAINED_RATE='20/hour',
        CLASHFORGE_ADMIN_POST_BURST_RATE='5/minute',
        CLASHFORGE_ADMIN_POST_SUSTAINED_RATE='20/hour',
        CLASHFORGE_DYNAMIC_BURST_RATE='20/minute',
        CLASHFORGE_DYNAMIC_SUSTAINED_RATE='200/hour',
        CLASHFORGE_PAGE_VIEW_BURST_RATE='20/minute',
        CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE='200/hour',
    )
    def test_admin_login_path_is_rate_limited(self):
        first = self.client.get('/admin/login/')
        second = self.client.get('/admin/login/')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('Retry-After', second)

    @override_settings(
        REST_FRAMEWORK=rest_framework_with_rates(
            public_read_burst='1/minute',
            public_read_sustained='10/hour',
        ),
        CLASHFORGE_DYNAMIC_BURST_RATE='20/minute',
        CLASHFORGE_DYNAMIC_SUSTAINED_RATE='200/hour',
        CLASHFORGE_PAGE_VIEW_BURST_RATE='20/minute',
        CLASHFORGE_PAGE_VIEW_SUSTAINED_RATE='200/hour',
    )
    def test_public_api_reads_are_rate_limited(self):
        first = self.client.get('/api/bootstrap/')
        second = self.client.get('/api/fighters/')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
