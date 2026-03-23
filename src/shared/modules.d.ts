declare module "cors" {
  import type { RequestHandler } from "express";

  interface CorsOptions {
    origin?: boolean | string | RegExp | Array<boolean | string | RegExp>;
  }

  export default function cors(options?: CorsOptions): RequestHandler;
}

declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Statement {
    run(values?: unknown[]): void;
    free(): void;
  }

  export interface Database {
    run(sql: string): void;
    prepare(sql: string): Statement;
    exec(sql: string): QueryExecResult[];
  }

  export interface SqlJsStatic {
    Database: new () => Database;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
