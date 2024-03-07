import { MiddlewareHandlerContext } from "$fresh/server.ts";
import { GrobberRegistry } from '../../../mod.ts'
import * as z from 'npm:zod@3.21'

export interface State {
  context: Context
}

export class Context {
  private static context: Context
  public z: typeof z
  // public registry: GrobberRegistry

  public constructor() {
    this.z = z
    // this.registry = new GrobberRegistry()
  }

  public static async init() {
    Context.context = new Context()
  }

  public static instance() {
    if (this.context) return this.context
    else throw new Error('Context is not initialized')
  }
}

export async function handler(
  req: Request,
  ctx: MiddlewareHandlerContext<State>,
) {
  ctx.state.context = Context.instance()
  const resp = await ctx.next()
  return resp
}
