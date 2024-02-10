import { type Grob } from './grob.ts'


type Optional<T> = T | undefined

type UntypedVars = {}

type GrobberFn<Vars> = (grob: Grob, input: string, vars: Vars) => void

interface GrobberEntrypoint<Vars extends UntypedVars> {
  fn: GrobberFn<Vars>
  match: RegExp | RegExp[]
}

interface GrobberEntrypointInternal<Vars> {
  fn: GrobberFn<Vars>
  matchers: RegExp[]
}

interface MatchedGrobberEntrypoint<Vars> {
  fn: GrobberFn<Vars>
  vars: Vars
}


class Grobber<Vars extends UntypedVars = UntypedVars> {
  // this is `any` because typescript does not like assigning different subtypes ot UntypedVars in the register fn
  #entrypoints: GrobberEntrypointInternal<any>[]

  public constructor() {
    this.#entrypoints = []
  }

  public match(input: string): Optional<MatchedGrobberEntrypoint<UntypedVars>> {
    for (const entrypoint of this.#entrypoints) {
      for (const match of entrypoint.matchers) {
        const matched_input = input.match(match)
        if (matched_input) {
          return { vars: matched_input.groups ?? {}, fn: entrypoint.fn }
        }
      }
    }
  }

  public register<V extends Vars>(registration: GrobberEntrypoint<V>) {
    this.#entrypoints.push({
      fn: registration.fn,
      matchers: Array.isArray(registration.match) ? registration.match : [registration.match],
    })

    return registration.fn
  }

  public start<V extends Vars>(input: string, vars?: V) {

  }

  public _internal_wireup(grob: Grob) {

  }

  public get entrypoints() {
    return this.#entrypoints
  }
}

export { Grobber }
