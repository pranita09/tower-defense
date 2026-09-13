/**
 * Selectable game speeds. Higher speeds run more simulation ticks per second
 * rather than larger ticks, so fast-forwarding never changes game behaviour.
 */
export const SPEED_OPTIONS = [1, 2, 4] as const;

export type SpeedOption = (typeof SPEED_OPTIONS)[number];
