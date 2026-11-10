import { createHandler, type Env } from "./handler";

export type { Env };

const handle = createHandler();

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
} satisfies ExportedHandler<Env>;
