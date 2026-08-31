/**
 * `redlock@5.0.0-beta.2` ships type declarations that its `package.json#exports` map does not expose
 * to NodeNext resolution. These declarations cover the surface this codebase uses.
 */
declare module 'redlock' {
  import type { EventEmitter } from 'node:events';
  import type { Redis } from 'ioredis';

  export class ResourceLockedError extends Error {
    readonly name: 'ResourceLockedError';
    constructor(message: string);
  }

  export class ExecutionError extends Error {
    readonly name: 'ExecutionError';
    readonly attempts: ReadonlyArray<Promise<unknown>>;
    constructor(message: string, attempts: ReadonlyArray<Promise<unknown>>);
  }

  export class Lock {
    readonly redlock: Redlock;
    readonly resources: string[];
    readonly value: string;
    readonly attempts: ReadonlyArray<Promise<unknown>>;
    readonly expiration: number;
    release(): Promise<ExecutionResult>;
    extend(duration: number): Promise<Lock>;
  }

  export interface ExecutionResult {
    attempts: ReadonlyArray<Promise<unknown>>;
    start: number;
  }

  export interface Settings {
    readonly driftFactor?: number;
    readonly retryCount?: number;
    readonly retryDelay?: number;
    readonly retryJitter?: number;
    readonly automaticExtensionThreshold?: number;
  }

  export default class Redlock extends EventEmitter {
    constructor(clients: Iterable<Redis>, settings?: Settings);
    acquire(resources: string[], duration: number, settings?: Settings): Promise<Lock>;
    release(lock: Lock, settings?: Settings): Promise<ExecutionResult>;
    extend(lock: Lock, duration: number, settings?: Settings): Promise<Lock>;
    using<T>(
      resources: string[],
      duration: number,
      routine: (signal: AbortSignal) => Promise<T>,
    ): Promise<T>;
    quit(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): this;
  }
}
