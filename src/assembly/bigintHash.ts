import { getHasher, HashType } from 'bigint-hash';

// @ts-ignore
import random from 'random-bigint';

export function getHash(id: string): bigint {
  return getHasher(HashType.xxHash32)
    .update(id)
    .digestBigInt();
}

export function getRandomHash(bits = 8): bigint {
  return random(bits);
}
