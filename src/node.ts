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
  private _successor: Id;
  private _predecessor: Id | undefined;
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
    this._successor = successor;

    this.fingers = this.createFingerTable();
    this.storage = {};
  }

  get successor() {
    return this._successor;
  }

  set successor(succ) {
    console.log(
      `${Node.shortId(this.id)} has changed successor: ${Node.shortId(
        this._successor
      )} -> ${Node.shortId(succ)}`
    );
    this._successor = succ;
  }

  get predecessor() {
    return this._predecessor;
  }

  set predecessor(pred) {
    console.log(
      `${Node.shortId(this.id)} has changed predecessor: ${Node.shortId(
        this._predecessor
      )} -> ${Node.shortId(pred)}`
    );
    this._predecessor = pred;
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

    return this.fingers[fingerIndex].nodeId;
  }

  async findSuccessorForKey(key: Id): Promise<Id> {
    const within =
      withinInterval(key, {
        start: this.id,
        end: this.successor,
        includeStart: true
      }) || this.id === this.successor;

    if (within) return this.successor;

    const preNodeId = this.getClosestPrecedingNode(key);
    if (preNodeId === this.id) return this.id;

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
    return (this.id + 2n ** BigInt(fingerIndex)) % 2n ** BigInt(KEY_BITS);
  }

  static shortId(id: any) {
    const s = (id || "").toString() as string;
    return s.slice(0, 5);
  }

  async joinNode(targetNodeId: Id) {
    const { id } = await this.comm[RequestType.FindSuccessorForId](
      this,
      targetNodeId,
      { key: this.id }
    );

    this.successor = id;
  }

  toString(): string {
    return `pre: ${Node.shortId(this.predecessor)} node: ${Node.shortId(
      this.id
    )} succ: ${Node.shortId(this.successor)}`;
  }

  async stabilize() {
    if (this.successor === this.id) return;

    const { id: preId } = await this.comm[RequestType.GetPredecessor](
      this,
      this.successor,
      {}
    );

    if (preId && withinInterval(preId, { start: this.id, end: this.successor }))
      this.successor = preId;

    // console.log(
    //   `${Node.shortId(this.id)} notifies ${Node.shortId(this.successor)}`
    // );
    await this.comm[RequestType.Notify](this, this.successor, { key: this.id });
  }

  notify(id: bigint) {
    if (
      !this.predecessor ||
      withinInterval(id, { start: this.predecessor, end: this.id })
    )
      this.predecessor = id;
  }

  async *fixFingersGenerator() {
    let counter = 0;

    while (true) {
      // console.log(
      //   `${Node.shortId(this.id)} fixes finger for ${Node.shortId(
      //     this.fingers[counter].key
      //   )} (${counter})`
      // );
      this.fingers[counter].nodeId = await this.findSuccessorForKey(
        this.fingers[counter].key
      );

      counter = (counter + 1) % (this.fingers.length - 1);
      // counter++;
      // if (counter >= this.fingers.length) counter = 0;

      yield;
    }
  }

  fixFingers = this.fixFingersGenerator();

  async checkPredecessor() {
    return this.comm[RequestType.Ping](this, this.successor, {}).catch(
      () => (this.predecessor = undefined)
    );
  }

  private lifecycleActive = false;
  startLifecycle(
    periodStabilize = 500,
    periodFixFingers = 20,
    periodCheckPredecessor = 1000
  ) {
    if (this.lifecycleActive) return;

    this.lifecycleActive = true;

    const tickStabilize = async () => {
      await this.stabilize();
      setTimeout(tickStabilize, periodStabilize);
    };
    tickStabilize();

    const tickFixFingers = async () => {
      await this.fixFingers.next();
      setTimeout(tickFixFingers, periodFixFingers);
    };
    tickFixFingers();

    const tickCheckPredecessor = async () => {
      await this.checkPredecessor();
      setTimeout(tickCheckPredecessor, periodCheckPredecessor);
    };
    tickCheckPredecessor();
  }
}
