export interface Interval<T> {
  start: T;
  end: T;
  includeStart?: boolean;
  includeEnd?: boolean;
}

export function withinInterval<T>(value: T, interval: Interval<T>) {
  return (
    (interval.includeStart
      ? value >= interval.start
      : value > interval.start) &&
    (interval.includeEnd ? value <= interval.end : value < interval.end)
  );
}

export function intervalToString<T>(interval: Interval<T>) {
  return `${interval.includeStart ? "[" : "("}${interval.start}, ${
    interval.end
  }${interval.includeStart ? "]" : ")"}`;
}
