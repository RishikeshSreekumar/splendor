'use client';
import type React from 'react';
import { Crown } from 'lucide-react';
import type { Card, Color, Gem, Noble } from '@/src/types';
import { CardArt, DeckEmblem, NobleArt } from './art';
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
/**
 * A facet is a polygon shaded over the gem's base color: positive values lighten
 * (light hitting from the top-left), negative values darken. Shading with white and
 * black overlays keeps every gem tintable by the surrounding `.gem-*` class.
 */
type Facet = [points: string, shade: number];
/** Each gem has its own cut, like the physical game: color is never the only cue. */
const GEM_SHAPES: Record<Gem, { body: React.ReactNode; facets: Facet[]; shine?: React.ReactNode }> =
  {
    // Diamond: brilliant cut seen from the side — crown, table and pointed pavilion.
    white: {
      body: <path d="M6 3h12l4 6-10 12L2 9z" />,
      facets: [
        ['2,9 6,3 8,9', 0.35],
        ['6,3 12,3 8,9', 0.5],
        ['8,9 12,3 16,9', 0.65],
        ['12,3 18,3 16,9', 0.2],
        ['18,3 22,9 16,9', -0.12],
        ['2,9 8,9 12,21', 0.15],
        ['8,9 16,9 12,21', -0.05],
        ['16,9 22,9 12,21', -0.28],
      ],
    },
    // Sapphire: pear cut seen from above.
    blue: {
      body: <path d="M12 2C9 7 4.5 10.5 4.5 15a7.5 7.5 0 0 0 15 0C19.5 10.5 15 7 12 2z" />,
      facets: [
        ['12,2 4.5,15 12,14', 0.35],
        ['12,2 19.5,15 12,14', 0.1],
        ['4.5,15 12,22.5 12,14', -0.1],
        ['19.5,15 12,22.5 12,14', -0.32],
        ['12,7 8.5,14.5 12,19 15.5,14.5', 0.18],
      ],
      shine: (
        <ellipse
          cx="9.3"
          cy="11"
          rx="1"
          ry="2"
          transform="rotate(25 9.3 11)"
          fill="#fff"
          opacity=".75"
        />
      ),
    },
    // Emerald: step cut — stepped bands around a flat rectangular table.
    green: {
      body: <path d="M8 2h8l4 4v12l-4 4H8l-4-4V6z" />,
      facets: [
        ['8,2 16,2 15,5.5 9,5.5', 0.45],
        ['16,2 20,6 17,7.5 15,5.5', 0.2],
        ['20,6 20,18 17,16.5 17,7.5', -0.18],
        ['20,18 16,22 15,18.5 17,16.5', -0.35],
        ['16,22 8,22 9,18.5 15,18.5', -0.3],
        ['8,22 4,18 7,16.5 9,18.5', -0.12],
        ['4,18 4,6 7,7.5 7,16.5', 0.22],
        ['4,6 8,2 9,5.5 7,7.5', 0.38],
        ['9.5,8 14.5,8 14.5,16 9.5,16', 0.12],
      ],
      shine: <path d="M10.5 9.5 13 9.5 11 14.5 10.5 14.5z" fill="#fff" opacity=".35" />,
    },
    // Ruby: hexagonal cut seen from above.
    red: {
      body: <path d="M12 2l9 5v10l-9 5-9-5V7z" />,
      facets: [
        ['3,7 12,2 12,7 7.5,9.5', 0.4],
        ['12,2 21,7 16.5,9.5 12,7', 0.18],
        ['21,7 21,17 16.5,14.5 16.5,9.5', -0.15],
        ['21,17 12,22 12,17 16.5,14.5', -0.35],
        ['12,22 3,17 7.5,14.5 12,17', -0.15],
        ['3,17 3,7 7.5,9.5 7.5,14.5', 0.15],
        ['12,7 16.5,9.5 16.5,14.5 12,17 7.5,14.5 7.5,9.5', 0.08],
      ],
      shine: <path d="M8.7 10.2 11.5 8.6 9.5 12.5z" fill="#fff" opacity=".55" />,
    },
    // Onyx: polished oval cabochon — smooth dome, no facets.
    black: {
      body: <ellipse cx="12" cy="12" rx="7.5" ry="10" />,
      facets: [],
      shine: (
        <>
          <ellipse cx="12.6" cy="13.2" rx="6.2" ry="8.6" fill="#000" opacity=".25" />
          <ellipse cx="11.2" cy="10.8" rx="5.4" ry="7.6" fill="#fff" opacity=".1" />
          <ellipse
            cx="9.2"
            cy="7.4"
            rx="1.5"
            ry="2.8"
            transform="rotate(-25 9.2 7.4)"
            fill="#fff"
            opacity=".7"
          />
          <ellipse
            cx="15.2"
            cy="17.4"
            rx=".8"
            ry="1.4"
            transform="rotate(-25 15.2 17.4)"
            fill="#fff"
            opacity=".25"
          />
        </>
      ),
    },
    // Gold: starred coin with a raised rim.
    gold: {
      body: <circle cx="12" cy="12" r="10" />,
      facets: [
        ['12,5.5 13.9,9.5 18.2,10 15,13 15.9,17.3 12,15.2 8.1,17.3 9,13 5.8,10 10.1,9.5', 0.45],
      ],
      shine: (
        <>
          <circle cx="12" cy="12" r="7.6" fill="#000" opacity=".14" />
          <path
            d="M4.6 9.2A8 8 0 0 1 9.2 4.6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity=".7"
          />
        </>
      ),
    },
  };
/** Shaded gem glyph whose cut identifies the gem; tinted by the surrounding `.gem-*` class. */
export function GemIcon({ gem, size = 16 }: { gem: Gem; size?: number }) {
  const { body, facets, shine } = GEM_SHAPES[gem];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="gem-icon">
      <g fill="currentColor">{body}</g>
      <g stroke="rgba(0,0,0,.14)" strokeWidth=".4" strokeLinejoin="round">
        {facets.map(([points, shade]) => (
          <polygon
            key={points}
            points={points}
            fill={shade > 0 ? '#fff' : '#000'}
            fillOpacity={Math.abs(shade)}
          />
        ))}
      </g>
      {shine}
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
  fly,
}: {
  card: Card;
  /** Visual affordances: playable cards glow, the selected card lifts. */
  state?: { affordable?: boolean; selected?: boolean; fresh?: boolean; dimmed?: boolean };
  onClick?: () => void;
  label?: string;
  /** Lets the table animate this piece moving between places. */
  fly?: string;
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
      <CardArt tier={card.tier} id={card.id} />
      <span className="gt-card-head">
        <strong>{card.points || ''}</strong>
        <span className={`gt-card-gem gem-${card.bonus}`}>
          <GemIcon gem={card.bonus} size={22} />
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
      data-fly={fly}
    >
      {body}
    </button>
  ) : (
    <div className={classes} role="img" aria-label={name} data-fly={fly}>
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
  fly,
}: {
  tier: number;
  count?: number;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  fly?: string;
}) {
  const content = (
    <>
      <span className="gt-back-dots" aria-hidden="true">
        {Array.from({ length: tier }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      {!small && <DeckEmblem />}
      {count !== undefined && (
        <strong className="gt-back-count">{count === 0 ? 'Empty' : count}</strong>
      )}
    </>
  );
  const classes = `gt-back tier-${tier} ${selected ? 'selected' : ''} ${onClick ? 'clickable' : ''} ${small ? 'small' : ''}`;
  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`Tier ${tier} deck, ${count} cards. Reserve the top card`}
      data-fly={fly}
    >
      {content}
    </button>
  ) : (
    <div
      className={classes}
      aria-label={`Tier ${tier} ${count === undefined ? 'hidden card' : `deck, ${count} cards`}`}
      role="img"
      data-fly={fly}
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
  fly,
}: {
  noble: Noble;
  onClick?: () => void;
  eligible?: boolean;
  /** The human's bonuses toward each required color. */
  progress?: Partial<Record<Color, number>>;
  fly?: string;
}) {
  const content = (
    <>
      <NobleArt id={noble.id} />
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
      data-fly={fly}
    >
      {content}
    </button>
  ) : (
    <div
      className={`gt-noble ${eligible ? 'eligible' : ''}`}
      role="img"
      aria-label={label}
      data-fly={fly}
    >
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
  countInside,
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
  /** Print the count on the chip itself instead of the gem glyph beside it. */
  countInside?: boolean;
}) {
  const content = (
    <>
      <span className={`gt-token-face gem-${gem}`}>
        {countInside ? (
          <strong className="gt-token-num">{count}</strong>
        ) : (
          <GemIcon gem={gem} size={{ lg: 22, md: 16, sm: 11, xs: 9 }[size]} />
        )}
      </span>
      {count !== undefined && !countInside && <strong className="gt-token-count">{count}</strong>}
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
