import { AsyncLocalStorage } from 'node:async_hooks';
const requests = new AsyncLocalStorage<string>();
export const currentCorrelationId = () => requests.getStore();
export const withRequestCorrelation = (id: string, next: () => void) => requests.run(id, next);
