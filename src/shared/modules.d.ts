declare module "cors" {
  import type { RequestHandler } from "express";

  interface CorsOptions {
    origin?: boolean | string | RegExp | Array<boolean | string | RegExp>;
  }

  export default function cors(options?: CorsOptions): RequestHandler;
}
