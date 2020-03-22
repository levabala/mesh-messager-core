import { findLastIndex } from 'lodash';

import { getRandomHash } from './assembly/bigintHash';
import { Interval, withinInterval } from './assembly/interval';
import { shell } from './assembly/utility';
import { Communication, RequestType } from './communication';

export type Id = bigint;
export type IntervalId = Interval<Id>;

const KEY_BITS = 6; // sha1 contains 160 bits

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

  logging = true;

  constructor(
    comm: Communication,
    id: Id = getRandomHash(KEY_BITS),
    successor: Id = id
  ) {
    this.comm = comm;

    this.id = id;
    this._successor = successor;

    this.fingers = this.createFingerTable();
    this.storage = {};
  }

  setLogging(val: boolean) {
    this.logging = val;

    return this;
  }

  get successor() {
    return this._successor;
  }

  set successor(succ) {
    if (this.logging)
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
    if (this.logging)
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

  // getClosestSuccessingNode(key: Id): Id {
  //   const fingerIndex = findIndex(this.fingers, ({ nodeId }) =>
  //     withinInterval(nodeId, { start: this.id, end: key })
  //   );

  //   if (fingerIndex === -1) return this.id;

  //   return this.fingers[fingerIndex].nodeId;
  // }

  async findSuccessorForKey(key: Id): Promise<Id> {
    const within = withinInterval(key, {
      start: this.id,
      end: this.successor,
      includeEnd: true
    });

    if (within) return this.successor;

    const preNodeId = this.getClosestPrecedingNode(key);
    if (preNodeId === this.id) return this.id;

    try {
      return await this.requestSuccessor(preNodeId, key);
    } catch (e) {
      // return this.getClosestSuccessingNode(this.id);
      return this.id;
    }
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

  static shortId(id: any, rev = false) {
    const s = (id || "").toString() as string;
    return rev ? s.slice(s.length - 6, s.length) : s.slice(0, 5);
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
    return `${(this.successor === this.id && !this.predecessor
      ? "(dead)"
      : ""
    ).padStart(7)} pre: ${Node.shortId(this.predecessor).padStart(
      7
    )} node: ${Node.shortId(this.id).padStart(5)} succ: ${Node.shortId(
      this.successor
    ).padStart(5)}`;
  }

  async stabilize() {
    if (this.successor === this.id) {
      if (this.predecessor) {
        try {
          this.successor = await this.requestSuccessor(
            this.predecessor,
            this.id
          );
        } catch (e) {
          this.predecessor = undefined;
        }
      }
      return;
    }

    try {
      const { id: preId } = await this.comm[RequestType.GetPredecessor](
        this,
        this.successor,
        {}
      );

      if (
        preId &&
        withinInterval(preId, { start: this.id, end: this.successor })
      )
        this.successor = preId;

      // if (this.logging) console.log(
      //   `${Node.shortId(this.id)} notifies ${Node.shortId(this.successor)}`
      // );
      await this.comm[RequestType.Notify](this, this.successor, {
        key: this.id
      });
    } catch (e) {
      if (this.logging)
        console.log(
          `${Node.shortId(
            this.id
          )} has failed to access successor (${Node.shortId(this.successor)})`
        );
      this.successor = this.id;
    }
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
      // if (this.logging) console.log(
      //   `${Node.shortId(this.id)} fixes finger for ${Node.shortId(
      //     this.fingers[counter].key
      //   )} (${counter})`
      // );

      this.fingers[counter].nodeId = await this.findSuccessorForKey(
        this.fingers[counter].key
      );
      // this.fingers[counter].nodeId = await this.findSuccessorForKey(
      //   this.id + 2n ** BigInt(counter)
      // );

      counter = (counter + 1) % (this.fingers.length - 1);
      // counter++;
      // if (counter >= this.fingers.length) counter = 0;

      yield;
    }
  }

  fixFingers = this.fixFingersGenerator();

  async checkPredecessor() {
    if (!this.predecessor) return;

    return this.comm[RequestType.Ping](this, this.predecessor, {}).catch(
      () => (this.predecessor = undefined)
    );
  }

  private lifecycleActive = false;
  private lifecycleTimeouts = {
    stab: (null as unknown) as NodeJS.Timeout,
    fing: (null as unknown) as NodeJS.Timeout,
    pred: (null as unknown) as NodeJS.Timeout
  };
  startLifecycle(
    periodStabilize = 500,
    periodFixFingers = 20,
    periodCheckPredecessor = 1000
  ) {
    if (this.lifecycleActive) return;

    this.lifecycleActive = true;

    const tickStabilize = async () => {
      await this.stabilize();
      this.lifecycleTimeouts.stab = global.setTimeout(
        tickStabilize,
        periodStabilize
      );
    };
    tickStabilize();

    const tickFixFingers = async () => {
      await this.fixFingers.next();
      this.lifecycleTimeouts.fing = global.setTimeout(
        tickFixFingers,
        periodFixFingers
      );
    };
    tickFixFingers();

    const tickCheckPredecessor = async () => {
      await this.checkPredecessor();
      this.lifecycleTimeouts.pred = global.setTimeout(
        tickCheckPredecessor,
        periodCheckPredecessor
      );
    };
    tickCheckPredecessor();
  }

  stopLifecycle() {
    Object.values(this.lifecycleTimeouts).forEach(t => clearTimeout(t));
  }
}
