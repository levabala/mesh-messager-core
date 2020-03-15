import { getHasher, HashType } from 'bigint-hash';

export function getHash(id: string): bigint {
  return getHasher(HashType.SHA1)
    .update(id)
    .digestBigInt();
}
