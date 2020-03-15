export function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

export function shell(size: number): null[] {
  return new Array(size).fill(null);
}

export function isPromise(p: any): boolean {
  return Promise.resolve(p) === p;
}
