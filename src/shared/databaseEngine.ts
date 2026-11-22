export type DatabaseEngine = 'sqlite' | 'postgresql';

export interface DatabaseEngineStatus {
  active: DatabaseEngine;
  postgresConfigured: boolean;
  pending?: { engine: DatabaseEngine; requestedAt: string };
  lastTransfer?: { status: 'complete' | 'failed'; engine: DatabaseEngine; at: string; records?: number };
}

export const databaseEngineName = (engine: DatabaseEngine) => engine === 'postgresql' ? 'PostgreSQL' : 'SQLite';
