import { Id, Node, StoragePiece } from './node';

export enum RequestType {
  FindSuccessorForId,
  GetSuccessorId,
  GetStorageValue
}

interface RequestData {
  [RequestType.FindSuccessorForId]: { key: Id };
  [RequestType.GetSuccessorId]: {};
  [RequestType.GetStorageValue]: { key: string };
}

interface ResponseData {
  [RequestType.FindSuccessorForId]: { id: Id };
  [RequestType.GetSuccessorId]: { id: Id };
  [RequestType.GetStorageValue]: { value: StoragePiece };
}

type Request<Req extends RequestType> = (
  requester: Node,
  target: Id,
  data: RequestData[Req]
) => Promise<ResponseData[Req]>;

export type Communication = {
  [key in RequestType]: Request<key>;
};
