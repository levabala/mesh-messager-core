import { findLastIndex } from 'lodash';

import { getRandomHash } from './assembly/bigintHash';
import { Interval, withinInterval } from './assembly/interval';
import { shell } from './assembly/utility';
import { Communication, RequestType } from './communication';

export type Id = bigint;
export type IntervalId = Interval<Id>;

const KEY_BITS = 8; // sha1 contains 160 bits
const MAX_SUCCESSORS_LIST_LENGTH = Math.ceil(Math.log(KEY_BITS));

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
  _successor: Id;
  _predecessor: Id | undefined;
  successorList: Id[] = [];
  fingers: FingerEntity[];
  storage: Record<string, StoragePiece>;

  dead = false;

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

    const index = this.successorList.indexOf(this._successor);
    if (index !== -1) this.successorList.splice(index, 1);

    this._successor = succ;
    this.dead = this.successor === this.id && !this.predecessor;

    if (!this.successorList.includes(succ)) this.updateSuccesorsList(succ);
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
    this.dead = this.successor === this.id && !this.predecessor;
  }

  updateSuccesorsList(...newList: Id[]) {
    this.successorList = Array.from(new Set(newList.concat(this.successorList)))
      .sort((n1, n2) => {
        const n1Next = n1 > this.id;
        const n2Next = n2 > this.id;
        if ((n1Next && n2Next) || (!n1Next && !n2Next))
          return n1 - n2 >= 0 ? 1 : -1;

        if (n1Next && !n2Next) return -1;
        else return 1;
      })
      .slice(0, MAX_SUCCESSORS_LIST_LENGTH);
  }

  getBestSuccessor() {
    return this.successorList[0] || this.id;
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
    return `${(this.dead ? "(dead)" : "").padStart(7)} pre: ${Node.shortId(
      this.predecessor
    ).padStart(7)} node: ${Node.shortId(this.id).padStart(
      5
    )} succ: ${Node.shortId(this.successor).padStart(
      5
    )} succList: ${this.successorList
      .map(id => Node.shortId(id))
      .toString()
      .padStart(20)}`;
  }

  async stabilize() {
    if (this.successor === this.id) {
      // if (this.predecessor) {
      //   try {
      //     this.successor = await this.requestSuccessor(
      //       this.predecessor,
      //       this.id
      //     );
      //   } catch (e) {
      //     this.predecessor = undefined;
      //   }
      // }
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

      const { list: newSuccList } = await this.comm[
        RequestType.GetSuccessorsList
      ](this, this.successor, {});
      this.updateSuccesorsList(...newSuccList);
    } catch (e) {
      if (this.logging)
        console.log(
          `${Node.shortId(
            this.id
          )} has failed to access successor (${Node.shortId(this.successor)})`
        );

      const index = this.successorList.indexOf(this.successor);
      if (index !== -1) this.successorList.splice(index, 1);

      this.successor = this.getBestSuccessor();
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

      // this.fingers[counter].nodeId = await this.findSuccessorForKey(
      //   this.fingers[counter].key
      // );
      this.fingers[counter].nodeId = await this.findSuccessorForKey(
        this.id + 2n ** BigInt(counter)
      );

      counter = (counter + 1) % (this.fingers.length - 1);

      yield;
    }
  }

  fixFingers = this.fixFingersGenerator();

  async checkPredecessor() {
    if (!this.predecessor) return;

    return this.comm[RequestType.Ping](this, this.predecessor, {}).catch(() => {
      this.predecessor = undefined;
    });
  }

  lifecycleActive = false;
  lifecycleTimeouts = {
    stab: (null as unknown) as NodeJS.Timeout,
    fing: (null as unknown) as NodeJS.Timeout,
    pred: (null as unknown) as NodeJS.Timeout
  };
  startLifecycle(
    periodStabilize = 500,
    periodFixFingers = 500,
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
