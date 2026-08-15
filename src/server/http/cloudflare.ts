import { Context } from "effect";
import type { Env } from "../env.ts";

export class CloudflareEnv extends Context.Service<CloudflareEnv, Env>()(
  "bookclub/http/CloudflareEnv",
) {}

export class CloudflareExecutionContext extends Context.Service<
  CloudflareExecutionContext,
  ExecutionContext
>()("bookclub/http/CloudflareExecutionContext") {}

export class CloudflareRequest extends Request {
  constructor(
    request: Request,
    readonly env: Env,
    readonly executionContext?: ExecutionContext,
  ) {
    super(request);
  }
}

export function cloudflareRequestContext(env: Env, executionContext?: ExecutionContext) {
  const context = Context.make(CloudflareEnv, env);
  return executionContext === undefined
    ? context
    : Context.add(context, CloudflareExecutionContext, executionContext);
}
