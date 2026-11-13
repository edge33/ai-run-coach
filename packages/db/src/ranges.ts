import { addDays, type DateRange } from '@hub/contracts';

export function mergeRanges(ranges: DateRange[]): DateRange[] {
  const result: DateRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const previous = result.at(-1);
    if (previous && range.start <= addDays(previous.end, 1))
      previous.end = previous.end > range.end ? previous.end : range.end;
    else result.push({ ...range });
  }
  return result;
}
