'use client';
import { authHeaders } from '@/src/client-auth';
import type { Action, ClockConfig, Tokens } from '@/src/types';
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store', headers: await authHeaders() }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new ApiRequestError(response.status, result);
  return result as T;
}
/** A failed API call, keeping the status and any fields the server added (e.g. activeGameId). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(typeof data.error === 'string' ? data.error : 'Request failed');
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';
export function ClockFields({
  config,
  onChange,
  disabled = false,
}: {
  config: ClockConfig;
  onChange: (c: ClockConfig) => void;
  disabled?: boolean;
}) {
  return (
    <div className="clock-fields">
      <label>
        Initial time <span>seconds / bot</span>
        <input
          type="number"
          min={1}
          max={3600}
          step={1}
          value={config.initialMs / 1000}
          disabled={disabled}
          onChange={(e) => onChange({ ...config, initialMs: Number(e.target.value) * 1000 })}
        />
      </label>
      <label>
        Increment <span>seconds / turn</span>
        <input
          type="number"
          min={0}
          max={60}
          step={1}
          value={config.incrementMs / 1000}
          disabled={disabled}
          onChange={(e) => onChange({ ...config, incrementMs: Number(e.target.value) * 1000 })}
        />
      </label>
    </div>
  );
}
export function formatClock(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
export function bagLabel(bag: Partial<Tokens>): string {
  return (
    Object.entries(bag)
      .filter(([, v]) => v)
      .map(([c, n]) => `${n} ${c}`)
      .join(', ') || 'free'
  );
}
export function actionLabel(a: Action): string {
  switch (a.type) {
    case 'take':
      return `Take ${bagLabel(a.tokens)}`;
    case 'discard':
      return `Return ${bagLabel(a.tokens)}`;
    case 'buy':
      return `Buy ${a.cardId} · ${bagLabel(a.payment)}`;
    case 'reserve':
      return a.cardId ? `Reserve ${a.cardId}` : `Reserve blind · tier ${a.tier}`;
    case 'noble':
      return `Receive noble ${a.nobleId}`;
  }
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="notice error">
      {error}
    </div>
  ) : null;
}
