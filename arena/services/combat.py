import random
import secrets
from collections import defaultdict
from dataclasses import dataclass

from arena.models import Character, FightHistory


MAX_ROUNDS = 40


@dataclass
class SimulationOutcome:
    winner: Character | None
    rounds: int
    timeline: list[dict]
    final: dict


def _fighter_summary(character: Character, slot: str) -> dict:
    return {
        'id': character.id,
        'slot': slot,
        'name': character.name,
        'avatar_color': character.avatar_color,
        'max_health': character.max_health,
    }


def _normalize_fighter(character: Character, slot: str) -> dict:
    abilities = list(character.abilities or [])
    return {
        'character': character,
        'slot': slot,
        'name': character.name,
        'strength': character.strength,
        'speed': character.speed,
        'durability': character.durability,
        'intelligence': character.intelligence,
        'max_health': character.max_health,
        'abilities': abilities,
        'current_health': character.max_health,
        'cooldowns': {ability.get('name', f'ability-{index}'): 0 for index, ability in enumerate(abilities)},
        'effects': [],
        'momentum': 0,
    }


def _event(
    *,
    round_number: int,
    event_type: str,
    actor: dict,
    target: dict | None = None,
    ability_name: str | None = None,
    damage: int | None = None,
    text: str,
    moment: str | None = None,
    priority: str | None = None,
) -> dict:
    payload = {
        'round': round_number,
        'type': event_type,
        'actor_id': actor['character'].id,
        'actor_name': actor['name'],
        'actor_slot': actor['slot'],
        'text': text,
        'actor_hp': max(0, round(actor['current_health'])),
        'actor_max_hp': actor['max_health'],
    }
    if ability_name is not None:
        payload['ability_name'] = ability_name
    if damage is not None:
        payload['damage'] = damage
    if moment is not None:
        payload['moment'] = moment
    if priority is not None:
        payload['priority'] = priority
    if target is not None:
        payload['target_id'] = target['character'].id
        payload['target_name'] = target['name']
        payload['target_slot'] = target['slot']
        payload['target_hp'] = max(0, round(target['current_health']))
        payload['target_max_hp'] = target['max_health']
    return payload


def _event_priority_for_damage(damage: int, target: dict) -> tuple[str, str]:
    if target['current_health'] <= 0:
        return 'finisher', 'critical'
    if damage >= max(22, round(target['max_health'] * 0.24)):
        return 'big_hit', 'critical'
    if damage >= max(15, round(target['max_health'] * 0.16)):
        return 'swing', 'major'
    return 'hit', 'minor'


def _choose_ability(actor: dict, enemy: dict) -> dict | None:
    ready = [
        ability for ability in actor['abilities']
        if actor['cooldowns'].get(ability.get('name'), 0) <= 0
    ]
    if not ready:
        return None

    ready.sort(key=lambda ability: ability.get('power', 0), reverse=True)
    if actor['current_health'] < actor['max_health'] * 0.45:
        defensive = next((ability for ability in ready if ability.get('type') == 'buff'), None)
        if defensive is not None:
            return defensive

    finisher = next(
        (
            ability for ability in ready
            if ability.get('type') == 'attack' and enemy['current_health'] < 30
        ),
        None,
    )
    return finisher or ready[0]


def _apply_passive_start_round(actor: dict, round_state: dict) -> None:
    if actor['name'] == 'Titan':
        # Titan still blunts the first heavy hit, but no longer erases entire matchup classes by default.
        round_state['titan_reduction'] = 2


def _compute_damage(actor: dict, enemy: dict, ability: dict, round_state: dict, rng: random.Random) -> int:
    scaling_field = ability.get('scaling')
    scaling_stat = actor.get(scaling_field, actor['strength']) if scaling_field else actor['strength']
    damage = (ability.get('power', 8) or 8) + scaling_stat * 0.18 + actor['momentum'] * 1.5

    for effect in actor['effects']:
        damage_multiplier = effect.get('effect', {}).get('damage_mult')
        if damage_multiplier:
            damage *= damage_multiplier

    damage += rng.uniform(-3, 5)
    damage -= enemy['durability'] * 0.08

    if enemy['name'] == 'Titan' and round_state.get('titan_reduction', 0) > 0:
        damage -= round_state['titan_reduction']
        round_state['titan_reduction'] = 0

    for effect in enemy['effects']:
        damage_taken_multiplier = effect.get('effect', {}).get('damage_taken_mult')
        if damage_taken_multiplier:
            damage *= damage_taken_multiplier

    return max(4, round(damage))


def _tick_effects(fighter: dict, timeline: list[dict], round_number: int, record_timeline: bool) -> None:
    active_effects = []
    for entry in fighter['effects']:
        bleed = entry.get('effect', {}).get('bleed')
        if bleed:
            fighter['current_health'] -= bleed
            if record_timeline:
                moment = 'effect_tick'
                priority = 'minor'
                if fighter['current_health'] <= 0:
                    moment = 'effect_finisher'
                    priority = 'critical'
                timeline.append(
                    _event(
                        round_number=round_number,
                        event_type='effect_tick',
                        actor=fighter,
                        damage=bleed,
                        text=f"{fighter['name']} bleeds for {bleed}.",
                        moment=moment,
                        priority=priority,
                    )
                )

        entry['turns'] -= 1
        if entry['turns'] > 0:
            active_effects.append(entry)

    fighter['effects'] = active_effects


def _decrement_cooldowns(fighter: dict) -> None:
    for name, value in fighter['cooldowns'].items():
        fighter['cooldowns'][name] = max(0, value - 1)


def run_single_fight(
    fighter_a: Character,
    fighter_b: Character,
    rng: random.Random,
    *,
    record_timeline: bool = True,
) -> SimulationOutcome:
    a = _normalize_fighter(fighter_a, 'A')
    b = _normalize_fighter(fighter_b, 'B')
    timeline: list[dict] = []
    rounds = 0

    while a['current_health'] > 0 and b['current_health'] > 0 and rounds < MAX_ROUNDS:
        rounds += 1
        round_state: dict = {}
        _apply_passive_start_round(a, round_state)
        _apply_passive_start_round(b, round_state)

        actors = sorted(
            [a, b],
            key=lambda fighter: fighter['speed'] + fighter['momentum'],
            reverse=True,
        )
        for actor in actors:
            enemy = b if actor is a else a
            if actor['current_health'] <= 0 or enemy['current_health'] <= 0:
                continue

            ability = _choose_ability(actor, enemy)
            if ability is None:
                chip = max(3, round(actor['strength'] * 0.11 - enemy['durability'] * 0.05))
                enemy['current_health'] -= chip
                if record_timeline:
                    timeline.append(
                        _event(
                            round_number=rounds,
                            event_type='basic_attack',
                            actor=actor,
                            target=enemy,
                            damage=chip,
                            text=f"{actor['name']} throws a basic strike for {chip}.",
                            moment='hit',
                            priority='minor',
                        )
                    )
            elif ability.get('type') == 'buff':
                actor['effects'].append(
                    {'effect': dict(ability.get('effect', {})), 'turns': ability.get('duration', 1)}
                )
                actor['cooldowns'][ability['name']] = ability.get('cooldown', 0)
                if actor['name'] == 'Raze':
                    actor['momentum'] += 2
                if record_timeline:
                    priority = 'major' if ability.get('effect', {}).get('damage_mult') or ability.get('effect', {}).get('speed_mult') else 'minor'
                    timeline.append(
                        _event(
                            round_number=rounds,
                            event_type='buff',
                            actor=actor,
                            ability_name=ability['name'],
                            text=f"{actor['name']} pops {ability['name']}!",
                            moment='buff',
                            priority=priority,
                        )
                    )
            else:
                damage = _compute_damage(actor, enemy, ability, round_state, rng)
                enemy['current_health'] -= damage
                actor['cooldowns'][ability['name']] = ability.get('cooldown', 0)

                event_type = 'ability_attack'
                text = f"{actor['name']} uses {ability['name']} for {damage}."
                bleed = ability.get('effect', {}).get('bleed')
                if bleed:
                    enemy['effects'].append(
                        {
                            'effect': {'bleed': bleed},
                            'turns': ability.get('effect', {}).get('ticks', 2),
                        }
                    )

                stun_chance = ability.get('effect', {}).get('stun_chance')
                if stun_chance and rng.random() < stun_chance:
                    enemy['cooldowns'] = {
                        name: value + 1 for name, value in enemy['cooldowns'].items()
                    }
                    event_type = 'stun_attack'
                    text = (
                        f"{actor['name']} lands {ability['name']} for {damage} and rattles "
                        f"{enemy['name']}'s timing!"
                    )

                if record_timeline:
                    moment, priority = _event_priority_for_damage(damage, enemy)
                    if event_type == 'stun_attack':
                        moment = 'stun'
                        priority = 'critical'
                    timeline.append(
                        _event(
                            round_number=rounds,
                            event_type=event_type,
                            actor=actor,
                            target=enemy,
                            ability_name=ability['name'],
                            damage=damage,
                            text=text,
                            moment=moment,
                            priority=priority,
                        )
                    )

                if actor['name'] == 'Raze':
                    actor['momentum'] += 1

            actor['momentum'] = min(actor['momentum'], 6)
            if enemy['current_health'] <= 0:
                break

        _tick_effects(a, timeline, rounds, record_timeline)
        _tick_effects(b, timeline, rounds, record_timeline)
        _decrement_cooldowns(a)
        _decrement_cooldowns(b)

    winner = None
    if a['current_health'] > b['current_health']:
        winner = fighter_a
    elif b['current_health'] > a['current_health']:
        winner = fighter_b

    return SimulationOutcome(
        winner=winner,
        rounds=rounds,
        timeline=timeline if record_timeline else [],
        final={
            'fighter_a_hp': max(0, round(a['current_health'])),
            'fighter_b_hp': max(0, round(b['current_health'])),
            'fighter_a_cooldowns': a['cooldowns'],
            'fighter_b_cooldowns': b['cooldowns'],
        },
    )


def _analyze_single_fight(
    fighter_a: Character,
    fighter_b: Character,
    outcome: SimulationOutcome,
    winner: Character | None,
) -> dict:
    slot_names = {'A': fighter_a.name, 'B': fighter_b.name}
    metrics = {
        'A': {'damage': 0, 'buffs': 0, 'stuns': 0, 'big_hits': 0},
        'B': {'damage': 0, 'buffs': 0, 'stuns': 0, 'big_hits': 0},
    }
    round_damage = {'A': defaultdict(int), 'B': defaultdict(int)}
    biggest_hit = None
    clutch_event = None
    finisher_event = None

    for event in outcome.timeline:
        actor_slot = event['actor_slot']
        if event['type'] == 'buff':
            metrics[actor_slot]['buffs'] += 1
        if event['type'] == 'stun_attack':
            metrics[actor_slot]['stuns'] += 1
        if event.get('target_slot') and event.get('damage'):
            damage = int(event['damage'])
            metrics[actor_slot]['damage'] += damage
            round_damage[actor_slot][event['round']] += damage
            if event.get('moment') in {'big_hit', 'finisher'}:
                metrics[actor_slot]['big_hits'] += 1
            if biggest_hit is None or damage > biggest_hit['damage']:
                biggest_hit = event
            target_max_hp = event.get('target_max_hp') or 1
            target_ratio = (event.get('target_hp', 0) / target_max_hp)
            if target_ratio <= 0.2 and clutch_event is None:
                clutch_event = event
        if event.get('moment') in {'finisher', 'effect_finisher'}:
            finisher_event = event

    if winner is None:
        return {
            'headline': f'Draw after {outcome.rounds} rounds.',
            'win_reason': 'Neither fighter found a decisive edge.',
            'turning_point': 'The fight stayed close enough that no single swing ended it.',
            'finisher': 'No finishing blow landed.',
            'key_moments': [],
            'fighter_a': metrics['A'],
            'fighter_b': metrics['B'],
        }

    winner_slot = 'A' if winner == fighter_a else 'B'
    loser_slot = 'B' if winner_slot == 'A' else 'A'
    winner_metrics = metrics[winner_slot]
    loser_metrics = metrics[loser_slot]

    if winner_metrics['stuns'] > loser_metrics['stuns'] and winner_metrics['stuns'] > 0:
        win_reason = f"{winner.name} won the tempo war with {winner_metrics['stuns']} stun swing(s)."
    elif winner_metrics['big_hits'] > loser_metrics['big_hits'] and winner_metrics['big_hits'] > 0:
        win_reason = f"{winner.name} found the heavier burst windows when it mattered."
    elif outcome.rounds >= 8:
        win_reason = f"{winner.name} held up better once the fight became a long exchange."
    elif winner_metrics['damage'] >= loser_metrics['damage'] + 18:
        win_reason = f"{winner.name} clearly won the damage race."
    else:
        win_reason = f"{winner.name} kept the cleaner pressure for most of the duel."

    if biggest_hit and biggest_hit['actor_slot'] == winner_slot:
        turning_point = (
            f"Turning point: round {biggest_hit['round']} when {biggest_hit['actor_name']} landed "
            f"{biggest_hit.get('ability_name') or 'a heavy hit'} for {biggest_hit['damage']}."
        )
    elif clutch_event and clutch_event['actor_slot'] == winner_slot:
        turning_point = (
            f"Turning point: round {clutch_event['round']} when {clutch_event['actor_name']} pushed "
            f"{clutch_event['target_name']} to the brink."
        )
    else:
        decisive_round = 0
        decisive_round_damage = -1
        for round_number, damage in round_damage[winner_slot].items():
            if damage > decisive_round_damage:
                decisive_round_damage = damage
                decisive_round = round_number
        turning_point = f"Turning point: round {decisive_round} where {winner.name} created the widest damage swing."

    if finisher_event:
        if finisher_event['moment'] == 'effect_finisher':
            finisher = f"Finish: {finisher_event['actor_name']} bled out after the last exchange."
        else:
            finisher = (
                f"Finish: {finisher_event['actor_name']} closed it with "
                f"{finisher_event.get('ability_name') or 'a final strike'}."
            )
    else:
        loser_hp_key = 'fighter_b_hp' if winner_slot == 'A' else 'fighter_a_hp'
        finisher = f"Finish: {slot_names[loser_slot]} was left at {outcome.final.get(loser_hp_key, 0)} HP."

    key_moments = []
    if biggest_hit:
        key_moments.append(
            f"Biggest hit: {biggest_hit['actor_name']} dealt {biggest_hit['damage']} with {biggest_hit.get('ability_name') or 'a strike'}."
        )
    if winner_metrics['buffs']:
        key_moments.append(f"{winner.name} found {winner_metrics['buffs']} buff window(s).")
    if winner_metrics['stuns']:
        key_moments.append(f"{winner.name} forced {winner_metrics['stuns']} timing break(s).")

    return {
        'headline': f"{winner.name} wins in {outcome.rounds} rounds.",
        'win_reason': win_reason,
        'turning_point': turning_point,
        'finisher': finisher,
        'key_moments': key_moments,
        'fighter_a': metrics['A'],
        'fighter_b': metrics['B'],
        'biggest_hit': {
            'actor_name': biggest_hit['actor_name'],
            'actor_slot': biggest_hit['actor_slot'],
            'ability_name': biggest_hit.get('ability_name', ''),
            'damage': biggest_hit['damage'],
            'round': biggest_hit['round'],
        } if biggest_hit else None,
    }


def _build_aggregate_insights(
    fighter_a: Character,
    fighter_b: Character,
    sim_count: int,
    fighter_a_wins: int,
    fighter_b_wins: int,
    sample_recap: dict,
) -> dict:
    fighter_a_pct = (fighter_a_wins / sim_count) * 100
    fighter_b_pct = (fighter_b_wins / sim_count) * 100
    margin_pct = abs(fighter_a_pct - fighter_b_pct)
    leader = fighter_a if fighter_a_pct > fighter_b_pct else fighter_b if fighter_b_pct > fighter_a_pct else None

    if margin_pct < 8:
        consistency = 'volatile'
        matchup_story = 'This matchup plays close to even; small swings likely decide each sim.'
    elif margin_pct < 18:
        consistency = 'lean'
        matchup_story = f"{leader.name} is slightly favored, but the set still swings often."
    elif margin_pct < 35:
        consistency = 'consistent'
        matchup_story = f"{leader.name} is consistently favored across the sample."
    else:
        consistency = 'one-sided'
        matchup_story = f"{leader.name} dominates this pairing in most simulations."

    likely_pattern = sample_recap.get('win_reason', '') if leader else 'Neither side established a stable edge.'
    return {
        'leader_name': leader.name if leader else '',
        'leader_slot': 'A' if leader == fighter_a else 'B' if leader == fighter_b else '',
        'fighter_a_pct': round(fighter_a_pct, 1),
        'fighter_b_pct': round(fighter_b_pct, 1),
        'margin_pct': round(margin_pct, 1),
        'consistency': consistency,
        'matchup_story': matchup_story,
        'likely_pattern': likely_pattern,
    }


def run_official_battle(
    fighter_a: Character,
    fighter_b: Character,
    *,
    sim_count: int = 1,
) -> tuple[FightHistory, dict]:
    seed = secrets.token_hex(8)
    rng = random.Random(seed)
    sample_outcome: SimulationOutcome | None = None
    fighter_a_wins = 0
    fighter_b_wins = 0

    for index in range(sim_count):
        outcome = run_single_fight(
            fighter_a,
            fighter_b,
            rng,
            record_timeline=index == 0,
        )
        if sample_outcome is None:
            sample_outcome = outcome

        if outcome.winner == fighter_a:
            fighter_a_wins += 1
        elif outcome.winner == fighter_b:
            fighter_b_wins += 1

    assert sample_outcome is not None

    winner = None
    if fighter_a_wins > fighter_b_wins:
        winner = fighter_a
    elif fighter_b_wins > fighter_a_wins:
        winner = fighter_b
    elif sim_count == 1:
        winner = sample_outcome.winner

    sample_recap = _analyze_single_fight(fighter_a, fighter_b, sample_outcome, sample_outcome.winner)
    aggregate_insights = _build_aggregate_insights(
        fighter_a,
        fighter_b,
        sim_count,
        fighter_a_wins,
        fighter_b_wins,
        sample_recap,
    )

    if sim_count == 1:
        winner_label = winner.name if winner else 'Draw'
        summary = (
            f'{winner_label} wins in {sample_outcome.rounds} rounds. {sample_recap["win_reason"]}'
            if winner
            else f'Draw after {sample_outcome.rounds} rounds.'
        )
        meta = {
            'final': sample_outcome.final,
            'recap': sample_recap,
        }
    else:
        fighter_a_pct = (fighter_a_wins / sim_count) * 100
        fighter_b_pct = (fighter_b_wins / sim_count) * 100
        summary = (
            f'{fighter_a.name} {fighter_a_pct:.1f}% vs {fighter_b.name} {fighter_b_pct:.1f}% '
            f'over {sim_count} sims. {aggregate_insights["matchup_story"]}'
        )
        meta = {
            'sample_final': sample_outcome.final,
            'sample_recap': sample_recap,
            'aggregate_insights': aggregate_insights,
        }

    history = FightHistory.objects.create(
        fighter_a=fighter_a,
        fighter_b=fighter_b,
        winner=winner,
        log=sample_outcome.timeline,
        summary=summary,
        seed=seed,
        rounds=sample_outcome.rounds,
        sim_count=sim_count,
        fighter_a_wins=fighter_a_wins,
        fighter_b_wins=fighter_b_wins,
        meta=meta,
    )

    return history, {
        'fighters': {
            'fighter_a': _fighter_summary(fighter_a, 'A'),
            'fighter_b': _fighter_summary(fighter_b, 'B'),
        },
        'winner': {
            'id': winner.id if winner else None,
            'name': winner.name if winner else None,
            'slot': 'A' if winner == fighter_a else ('B' if winner == fighter_b else None),
        },
        'rounds': sample_outcome.rounds,
        'summary': summary,
        'sim_count': sim_count,
        'timeline': sample_outcome.timeline,
        'aggregate': {
            'fighter_a_wins': fighter_a_wins,
            'fighter_b_wins': fighter_b_wins,
        },
        'final': sample_outcome.final,
        'recap': sample_recap,
        'aggregate_insights': aggregate_insights,
    }
