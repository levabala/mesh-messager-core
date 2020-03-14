import { getHash } from './assembly/bigintHash';
import { Interval } from './assembly/interval';
import { shell } from './assembly/utility';
import { Communication, RequestType } from './communication';

export type Id = bigint;
export type IntervalId = Interval<Id>;

const KEY_BITS = 160; // sha1 contains 160 bits

export interface NodeShell {
  id: Id;
  successor: Id;
  predecessor?: Id;
}

interface FingerEntity {
  key: Id;
  nodeId: Id;
}

type StoragePiece = object;

export interface NodeBody {
  fingers: FingerEntity[];
  storage: Record<string, StoragePiece>;
}

export class Node implements NodeShell, NodeBody {
  id: Id;
  successor: Id;
  predecessor?: Id;
  fingers: FingerEntity[];
  storage: Record<string, StoragePiece>;

  comm: Communication;

  constructor(
    comm: Communication,
    id: Id = getHash(Math.random().toString()),
    successor: Id = id
  ) {
    this.comm = comm;

    this.id = id;
    this.successor = successor;

    this.fingers = this.createFingerTable();
    this.storage = {};
  }

  async requestSuccessor(key: Id): Promise<Id> {
    const { id } = await this.comm[RequestType.GetSuccessorForKey](
      this,
      this.successor,
      { key }
    );

    return id;
  }

  async requestStoragedValue(storageNode: Id): Promise<StoragePiece> {}

  createFingerTable(): FingerEntity[] {
    const length = KEY_BITS;

    return shell(length).map(
      (_, i) =>
        ({ key: this.generateFingerId(i), nodeId: this.id } as FingerEntity)
    );
  }

  generateFingerId(fingerIndex: number) {
    return this.id + (2n ** BigInt(fingerIndex - 1) % 2n ** BigInt(KEY_BITS));
  }
}
