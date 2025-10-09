declare module 'connect-pg-simple' {
  import type session from 'express-session';

  type ConnectPgSimple = (
    sessionImport: typeof import('express-session')
  ) => {
    new (options?: {
      conString?: string;
      conObject?: Record<string, unknown>;
      pool?: import('pg').Pool;
      tableName?: string;
      createTableIfMissing?: boolean;
      schemaName?: string;
    }): session.Store;
  };

  const connectPgSimple: ConnectPgSimple;
  export default connectPgSimple;
}
