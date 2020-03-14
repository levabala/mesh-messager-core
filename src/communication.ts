import { Id } from './node';

enum RequestType {
  GetSuccessorForKey,
  GetSuccessorId
}

interface RequestData {
  [RequestType.GetSuccessorForKey]: { key: Id };
  [RequestType.GetSuccessorId]: {};
}

interface ResponseData {
  [RequestType.GetSuccessorForKey]: { id: Id };
  [RequestType.GetSuccessorId]: { id: Id };
}

type Request<Req extends RequestType> = (
  requester: Node,
  target: Id,
  data: RequestData[Req]
) => Promise<ResponseData[Req]>;

export interface Communication {
  [RequestType.GetSuccessorForKey]: Req;
}
