type SearchKind = 'flight' | 'hotel';

interface PublicWarningOptions {
  hasResults: boolean;
  noResultsMessage?: string;
}

function hasMatch(errors: string[], patterns: RegExp[]): boolean {
  return errors.some(error => patterns.some(pattern => pattern.test(error)));
}

export function publicSearchWarnings(
  kind: SearchKind,
  rawErrors: string[] | undefined,
  options: PublicWarningOptions,
): string[] {
  const errors = (rawErrors ?? []).filter(Boolean);
  if (!errors.length) return [];

  if (options.hasResults) {
    return kind === 'hotel'
      ? ['Some live hotel sources did not respond. We are showing the best available options we could verify.']
      : ['Some live fare sources did not respond. We are showing the best available options we could verify.'];
  }

  if (options.noResultsMessage) return [];

  if (hasMatch(errors, [/timed? out/i, /timeout/i, /took too long/i])) {
    return kind === 'hotel'
      ? ['Live hotel rates are taking longer than expected. Please try again or adjust your dates.']
      : ['Live flight fares are taking longer than expected. Please retry the search or adjust your dates.'];
  }

  if (hasMatch(errors, [/not configured/i, /missing/i, /token/i, /api key/i])) {
    return kind === 'hotel'
      ? ['Hotel search is temporarily unavailable. Please try again shortly.']
      : ['Flight search is temporarily unavailable. Please try again shortly.'];
  }

  if (hasMatch(errors, [/no hotels found/i, /no live hotel inventory/i, /not found/i])) {
    return ['No live hotel inventory matched this search. Try nearby areas or different dates.'];
  }

  return kind === 'hotel'
    ? ['We could not verify live hotel rates for this search. Try nearby areas or different dates.']
    : ['We could not verify live flight fares for this search. Try nearby airports or different dates.'];
}
