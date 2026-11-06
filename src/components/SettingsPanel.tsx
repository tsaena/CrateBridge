import type { ExplicitPreference, WorkspaceSettings } from '../types';
import { SEARCH_MODIFIERS, STOREFRONTS } from '../lib/providers/searchLinks';
import { ACQUISITION_PROVIDERS, type PoolId } from '../lib/acquisition/providers';
import { cx } from './cx';

interface Props {
  settings: WorkspaceSettings;
  onChange: (changes: Partial<WorkspaceSettings>) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  const togglePool = (pool: PoolId) => {
    const on = settings.poolsIUse.includes(pool);
    onChange({ poolsIUse: on ? settings.poolsIUse.filter((p) => p !== pool) : [...settings.poolsIUse, pool] });
  };

  const toggleModifier = (modifier: string) => {
    const has = settings.searchModifiers.includes(modifier);
    onChange({
      searchModifiers: has ? settings.searchModifiers.filter((m) => m !== modifier) : [...settings.searchModifiers, modifier],
    });
  };

  return (
    <section aria-label="Search settings" className="panel grid gap-5 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
      <label className="grid content-start gap-1.5 text-sm">
        <span className="font-medium text-ink-100">iTunes storefront</span>
        <select className="field" value={settings.country} onChange={(e) => onChange({ country: e.target.value })}>
          {STOREFRONTS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-400">Prices and availability differ by country. Changing this re-checks every track.</span>
      </label>

      <fieldset className="grid content-start gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium text-ink-100">Clean or explicit</legend>
        <div className="inline-flex w-fit rounded-lg border border-ink-700 bg-ink-900 p-0.5">
          {(
            [
              ['any', 'No preference'],
              ['explicit', 'Explicit'],
              ['clean', 'Clean'],
            ] as [ExplicitPreference, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={settings.explicitPreference === value}
              onClick={() => onChange({ explicitPreference: value })}
              className={cx(
                'rounded-md px-2.5 py-1.5 text-xs font-medium',
                settings.explicitPreference === value ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-400">Used to rank versions when Apple marks them. Your own picks are never changed.</span>
      </fieldset>

      <fieldset className="grid content-start gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium text-ink-100">Add to store searches</legend>
        <div className="flex flex-wrap gap-1.5">
          {SEARCH_MODIFIERS.map((m) => {
            const on = settings.searchModifiers.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => toggleModifier(m)}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-xs',
                  on ? 'border-cue-500/60 bg-cue-500/15 text-cue-300' : 'border-ink-700 text-ink-400 hover:text-ink-200',
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-ink-400">Appended to the external store search links (Amazon, Beatport, Bandcamp, Apple Music).</span>
      </fieldset>

      <fieldset className="grid content-start gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium text-ink-100">DJ pools I use</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ACQUISITION_PROVIDERS.filter((p) => p.kind === 'pool').map((pool) => (
            <label key={pool.id} className="flex items-center gap-2 text-ink-200">
              <input
                type="checkbox"
                className="size-4 accent-cue-500"
                checked={settings.poolsIUse.includes(pool.id as PoolId)}
                onChange={() => togglePool(pool.id as PoolId)}
              />
              {pool.name}
            </label>
          ))}
        </div>
        <span className="text-xs text-ink-400">Listed first for each track. This only sets the order: CrateBridge doesn’t sign in to pools or check your membership.</span>
      </fieldset>
    </section>
  );
}
