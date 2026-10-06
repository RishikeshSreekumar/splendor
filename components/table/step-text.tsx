'use client';
import type { PracticeStep } from '@/src/practice/types';
import type { Card, Tokens } from '@/src/types';
import { GEMS, GEM_NAMES, Token } from './pieces';
function Bag({ bag }: { bag: Tokens }) {
  return (
    <span className="gt-inline-bag">
      {GEMS.filter((g) => bag[g]).map((g) => (
        <span key={g} className="gt-inline-gem">
          {bag[g] > 1 && <b>{bag[g]}×</b>}
          <Token gem={g} size="sm" title={`${bag[g]} ${GEM_NAMES[g]}`} />
        </span>
      ))}
    </span>
  );
}
function CardName({ card }: { card?: Card }) {
  if (!card) return <span>a card</span>;
  return (
    <span className={`gt-inline-card bonus-${card.bonus}`}>
      T{card.tier} {GEM_NAMES[card.bonus]}
      {card.points ? ` · ${card.points}★` : ''}
    </span>
  );
}
/** The card an action refers to, found in the actor's tableau right after the step. */
export function stepCard(step: PracticeStep): Card | undefined {
  const a = step.action;
  if (a.type !== 'buy' && !(a.type === 'reserve' && a.cardId)) return undefined;
  const id = a.cardId;
  const p = step.view.players[step.seat];
  return p.cards.find((c) => c.id === id) ?? p.reserved.find((r) => r.card?.id === id)?.card;
}
/** Human-readable log line: "Greedy bought T2 ruby · 2★ for 3× sapphire". */
export function StepText({ step, name }: { step: PracticeStep; name: string }) {
  const a = step.action;
  const who = <strong>{name}</strong>;
  switch (a.type) {
    case 'take':
      return (
        <>
          {who} took <Bag bag={a.tokens} />
        </>
      );
    case 'discard':
      return (
        <>
          {who} returned <Bag bag={a.tokens} />
        </>
      );
    case 'buy': {
      const free = GEMS.every((g) => !a.payment[g]);
      return (
        <>
          {who} bought <CardName card={stepCard(step)} />
          {free ? (
            ' for free'
          ) : (
            <>
              {' '}
              for <Bag bag={a.payment} />
            </>
          )}
        </>
      );
    }
    case 'reserve':
      return a.cardId ? (
        <>
          {who} reserved <CardName card={stepCard(step)} />
        </>
      ) : (
        <>
          {who} reserved a hidden tier {a.tier} card
        </>
      );
    case 'noble':
      return <>{who} was visited by a noble (+3★)</>;
  }
}
