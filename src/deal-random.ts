import { createHmac } from 'node:crypto';
/** Replayable deal randomness without compressing the secret seed to a 32-bit state. */
export function dealRandom(seed: string | number) {
  let counter = 0;
  return () => {
    const bytes = createHmac('sha256', String(seed))
      .update(`splendor-deal-v1:${counter++}`)
      .digest();
    return bytes.readUIntBE(0, 6) / 281474976710656;
  };
}
