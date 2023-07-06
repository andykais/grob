import { path, yaml } from './deps.ts'
import { Grob } from './grob.ts'
import { type RateLimitQueueConfig } from './queue.ts'


interface GrobberRegistryConfig {
  download_folder?: string
}

type Regex = string
type URLString = string
type FilepathString = string

type GrobEntrypoint = (grob: Grob, input: string) => Promise<void>

interface GrobberDefinition {
  name: string
  match: Regex
  permissions?: Regex[]
  throttle?: RateLimitQueueConfig
  main: URLString | FilepathString | GrobEntrypoint
  start: (grob: Grob, input: string) => Promise<void>
}

type GrobberRegistration = GrobberDefinition | URLString | FilepathString

interface CompiledGrobber {
  definition: GrobberDefinition
  main: GrobEntrypoint
}


class GrobberRegistry {
  public download_folder: string
  private registry: CompiledGrobber[]

  public constructor(config?: GrobberRegistryConfig) {
    this.download_folder = config?.download_folder ?? Deno.cwd()
    this.registry = []
  }

  public async register(registration: GrobberRegistration) {
    let registration_type: 'object' | 'url' | 'filepath'
    let grobber_definition: GrobberDefinition

    if (typeof registration === 'object') {
      registration_type = 'object'
      grobber_definition = registration
    } else if (this.is_valid_url(registration)) {
      registration_type = 'url'
      throw new Error('unimplemented')
    } else {
      const content = await Deno.readTextFile(registration)
      registration_type = 'filepath'
      grobber_definition = yaml.parse(content) as GrobberDefinition
    }


    let program: GrobEntrypoint
    if (typeof grobber_definition.main === 'function') {
      program = grobber_definition.main
    } else if (this.is_valid_url(grobber_definition.main)) {
      throw new Error('unimplemented')
    } else {
      if (registration_type === 'object') {
        // any filepath here must be relative to the cwd
        program = (await import(grobber_definition.main)).default as GrobEntrypoint
      // } else if (registration_type === 'url') {
      //   throw new Error('unimplemented')
      } else if (registration_type === 'filepath') {
        // a filepath here must be relative to the grob.yml folder
        const definition_folder = path.dirname(registration as string)
        const filepath = path.resolve(definition_folder, grobber_definition.main)
        program = (await import(filepath)).default as GrobEntrypoint
      } else {
        throw new Error(`unexpected registration type ${registration_type}`)
      }
    }

    this.registry.push({
      definition: grobber_definition,
      main: program
    })
  }

  private is_valid_url(input: string) {
    try {
      new URL(input)
      return true
    } catch (e) {
      if (e instanceof TypeError) return false
      else throw e
    }
  }

  public async start(input: string) {
    for (const grobber of this.registry) {
      const is_match = new RegExp(grobber.definition.match).test(input)
      if (is_match) {
        return this.launch_grobber(input, grobber)
      }
    }
  }

  private async launch_grobber(input: string, grobber: CompiledGrobber) {
    const sanitized_folder_name = input.replaceAll('/', '_')
    const download_folder = path.join(this.download_folder, grobber.definition.name, sanitized_folder_name)
    await Deno.mkdir(download_folder, { recursive: true })
    const grob = new Grob({ download_folder, throttle: grobber.definition.throttle })
    try {
      await grobber.main(grob, input)
    } catch (e) {
      throw e
    } finally {
      grob.close()
    }
  }

  private async resolve_reference<T extends object>(ref: T | FilepathString | URLString, parser: (filepath: FilepathString) => Promise<T>) {
    let resolved_ref: T
    if (typeof ref === 'object') {
      resolved_ref = ref
      return resolved_ref
    } else {
      try {
        // try reading the ref as a url first
        const ref_url = new URL(ref)
        throw new Error('unimplemented')
      } catch (e) {
        if (e instanceof TypeError) {
          // this must be a relative path
          resolved_ref = await parser(ref)
          return resolved_ref
        }
      }
      throw new Error(`unknown reference type ${ref}. Accepted types are javascript objects, filepaths and urls`)
    }
  }
}


export { GrobberRegistry }
export type { GrobberRegistryConfig, GrobberDefinition }
