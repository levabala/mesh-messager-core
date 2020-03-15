import { findLastIndex } from 'lodash';

import { getHash } from './assembly/bigintHash';
import { Interval, withinInterval } from './assembly/interval';
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

export type StoragePiece = object;

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

  async requestSuccessor(targetNode: Id, key: Id): Promise<Id> {
    const { id } = await this.comm[RequestType.FindSuccessorForId](
      this,
      targetNode,
      { key }
    );

    return id;
  }

  async requestStoragedValue(
    storageNode: Id,
    valueKey: string
  ): Promise<StoragePiece> {
    const { value } = await this.comm[RequestType.GetStorageValue](
      this,
      storageNode,
      { key: valueKey }
    );

    return value;
  }

  getClosestPrecedingNode(key: Id): Id {
    const fingerIndex = findLastIndex(this.fingers, ({ nodeId }) =>
      withinInterval(nodeId, { start: this.id, end: key })
    );

    if (fingerIndex === -1) return this.id;

    return this.fingers[fingerIndex].key;
  }

  async findSuccessorForKey(key: Id): Promise<Id> {
    if (
      withinInterval(key, {
        start: this.id,
        end: this.successor,
        includeStart: true
      })
    )
      return this.successor;

    const preNodeId = this.getClosestPrecedingNode(key);
    return await this.requestSuccessor(preNodeId, key);
  }

  createFingerTable(): FingerEntity[] {
    const length = KEY_BITS;

    return shell(length).map(
      (_, i) =>
        ({ key: this.generateFingerId(i), nodeId: this.id } as FingerEntity)
    );
  }

  generateFingerId(fingerIndex: number) {
    return this.id + (2n ** BigInt(fingerIndex) % 2n ** BigInt(KEY_BITS));
  }

  async joinNode(targetNodeId: Id) {
    const { id } = await this.comm[RequestType.FindSuccessorForId](
      this,
      targetNodeId,
      { key: this.id }
    );
    this.successor = id;
  }
}
