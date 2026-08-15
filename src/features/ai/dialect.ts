import { z } from 'zod';

export const DIALECTS = ['us', 'british', 'canadian', 'australian', 'indian', 'irish', 'south_african', 'new_zealand'] as const;
export const DialectSchema = z.enum(DIALECTS);
export type Dialect = z.infer<typeof DialectSchema>;

export const DIALECT_LABELS: Record<Dialect, string> = {
  us: 'US', british: 'British', canadian: 'Canadian', australian: 'Australian',
  indian: 'Indian', irish: 'Irish', south_african: 'South African', new_zealand: 'New Zealand',
};
