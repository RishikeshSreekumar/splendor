'use client';
import { Crown } from 'lucide-react';
import type { Card, Color, Gem, Noble } from '@/src/types';
export const COLORS: Color[] = ['white', 'blue', 'green', 'red', 'black'];
export const GEMS: Gem[] = [...COLORS, 'gold'];
export const GEM_NAMES: Record<Gem, string> = {
  white: 'diamond',
  blue: 'sapphire',
  green: 'emerald',
  red: 'ruby',
  black: 'onyx',
  gold: 'gold',
};
/** Faceted gem glyph tinted by the surrounding `.gem-*` class. */
export function GemIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="gem-icon">
      <path d="M6 3h12l4 6-10 12L2 9z" fill="currentColor" />
      <path
        d="M2 9h20M12 21 8 9l4-6 4 6z"
        fill="none"
        stroke="rgba(255,255,255,.55)"
        strokeWidth="1.2"
      />
    </svg>
  );
}
export function CostPip({
  gem,
  count,
  shape = 'circle',
}: {
  gem: Gem;
  count: number;
  shape?: 'circle' | 'card';
}) {
  return (
    <span className={`gt-pip ${shape} gem-${gem}`} title={`${count} ${GEM_NAMES[gem]}`}>
      {count}
    </span>
  );
}
export function DevelopmentCard({
  card,
  state,
  onClick,
  label,
}: {
  card: Card;
  /** Visual affordances: playable cards glow, the selected card lifts. */
  state?: { affordable?: boolean; selected?: boolean; fresh?: boolean; dimmed?: boolean };
  onClick?: () => void;
  label?: string;
}) {
  const cost = COLORS.filter((c) => card.cost[c]);
  const classes = [
    'gt-card',
    `bonus-${card.bonus}`,
    `tier-${card.tier}`,
    state?.affordable && 'affordable',
    state?.selected && 'selected',
    state?.fresh && 'fresh',
    state?.dimmed && 'dimmed',
    onClick && 'clickable',
  ]
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <span className="gt-card-head">
        <strong>{card.points || ''}</strong>
        <span className={`gt-card-gem gem-${card.bonus}`}>
          <GemIcon size={22} />
        </span>
      </span>
      <span className="gt-card-cost">
        {cost.map((c) => (
          <CostPip key={c} gem={c} count={card.cost[c]} />
        ))}
      </span>
    </>
  );
  const name =
    label ??
    `Tier ${card.tier} ${GEM_NAMES[card.bonus]} card, ${card.points} points, costs ${cost
      .map((c) => `${card.cost[c]} ${GEM_NAMES[c]}`)
      .join(', ')}`;
  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={name}
      aria-pressed={state?.selected}
    >
      {body}
    </button>
  ) : (
    <div className={classes} role="img" aria-label={name}>
      {body}
    </div>
  );
}
export function CardBack({
  tier,
  count,
  onClick,
  selected,
  small,
}: {
  tier: number;
  count?: number;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
}) {
  const content = (
    <>
      <span className="gt-back-dots">{'●'.repeat(tier)}</span>
      {count !== undefined && <strong>{count}</strong>}
      {!small && <small>{count === 0 ? 'EMPTY' : `TIER ${tier}`}</small>}
    </>
  );
  const classes = `gt-back tier-${tier} ${selected ? 'selected' : ''} ${onClick ? 'clickable' : ''} ${small ? 'small' : ''}`;
  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`Tier ${tier} deck, ${count} cards. Reserve the top card`}
    >
      {content}
    </button>
  ) : (
    <div
      className={classes}
      aria-label={`Tier ${tier} ${count === undefined ? 'hidden card' : `deck, ${count} cards`}`}
      role="img"
    >
      {content}
    </div>
  );
}
export function NobleTile({
  noble,
  onClick,
  eligible,
  progress,
}: {
  noble: Noble;
  onClick?: () => void;
  eligible?: boolean;
  /** The human's bonuses toward each required color. */
  progress?: Partial<Record<Color, number>>;
}) {
  const content = (
    <>
      <span className="gt-noble-points">
        3 <Crown size={12} />
      </span>
      <span className="gt-noble-cost">
        {COLORS.filter((c) => noble.cost[c]).map((c) => (
          <span key={c} className="gt-noble-req">
            <CostPip gem={c} count={noble.cost[c]} shape="card" />
            {progress && (
              <small className={(progress[c] ?? 0) >= noble.cost[c] ? 'met' : ''}>
                {Math.min(progress[c] ?? 0, noble.cost[c])}/{noble.cost[c]}
              </small>
            )}
          </span>
        ))}
      </span>
    </>
  );
  const label = `Noble worth 3 points, requires ${COLORS.filter((c) => noble.cost[c])
    .map((c) => `${noble.cost[c]} ${GEM_NAMES[c]} cards`)
    .join(', ')}`;
  return onClick ? (
    <button
      type="button"
      className={`gt-noble clickable ${eligible ? 'eligible' : ''}`}
      onClick={onClick}
      aria-label={`Choose: ${label}`}
    >
      {content}
    </button>
  ) : (
    <div className={`gt-noble ${eligible ? 'eligible' : ''}`} role="img" aria-label={label}>
      {content}
    </div>
  );
}
export function Token({
  gem,
  count,
  onClick,
  disabled,
  selected,
  available,
  empty,
  size = 'md',
  title,
}: {
  gem: Gem;
  count?: number;
  onClick?: () => void;
  disabled?: boolean;
  selected?: number;
  /** Glows: clicking it is a legal next step. */
  available?: boolean;
  /** None held: drawn faint so non-zero stacks stand out. */
  empty?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  title?: string;
}) {
  const content = (
    <>
      <span className={`gt-token-face gem-${gem}`}>
        <GemIcon size={{ lg: 22, md: 16, sm: 11, xs: 9 }[size]} />
      </span>
      {count !== undefined && <strong className="gt-token-count">{count}</strong>}
      {selected ? <span className="gt-token-picked">+{selected}</span> : null}
    </>
  );
  const classes = [
    'gt-token',
    size,
    selected && 'picked',
    disabled && 'disabled',
    available && 'available',
    empty && 'empty',
    onClick && 'clickable',
  ]
    .filter(Boolean)
    .join(' ');
  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title ?? `${count ?? ''} ${GEM_NAMES[gem]}`}
    >
      {content}
    </button>
  ) : (
    <span className={classes} title={title ?? `${count ?? ''} ${GEM_NAMES[gem]}`}>
      {content}
    </span>
  );
}
