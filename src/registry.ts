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
  private registry_grob: Grob

  public constructor(config?: GrobberRegistryConfig) {
    this.download_folder = config?.download_folder ?? Deno.cwd()
    this.registry = []
    const registry_grob_folder = path.join(this.download_folder, '.registry')
    this.registry_grob = new Grob({ download_folder: registry_grob_folder })
  }

  public async register(registration: GrobberRegistration) {
    // TODO mkdir?
    let registration_type: 'object' | 'url' | 'filepath'
    let grobber_definition: GrobberDefinition

    if (typeof registration === 'object') {
      registration_type = 'object'
      grobber_definition = registration
    } else if (this.is_valid_url(registration)) {
      registration_type = 'url'
      // TODO dogfood grob, rather than fetching every time
      const content = await this.registry_grob.fetch_text(registration)
      grobber_definition = yaml.parse(content) as GrobberDefinition
    } else {
      const content = await Deno.readTextFile(registration)
      registration_type = 'filepath'
      grobber_definition = yaml.parse(content) as GrobberDefinition
    }


    let program: GrobEntrypoint
    if (typeof grobber_definition.main === 'function') {
      program = grobber_definition.main
    } else if (this.is_valid_url(grobber_definition.main)) {
      const filepath = await this.registry_grob.fetch_file(grobber_definition.main)
      program = (await import(filepath)).default as GrobEntrypoint
    } else {
      if (registration_type === 'object') {
        // any filepath here must be relative to the cwd
        program = (await import(grobber_definition.main)).default as GrobEntrypoint
      } else if (registration_type === 'url') {
        const registration_url = new URL(registration as string)

        const resolved_path = path.join(path.dirname(registration_url.pathname), grobber_definition.main)
        const resolved_url = registration_url.origin + resolved_path
        const filepath = await this.registry_grob.fetch_file(resolved_url)
        program = (await import(filepath)).default as GrobEntrypoint
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

  public close() {
    this.registry_grob.close()
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
}


export { GrobberRegistry }
export type { GrobberRegistryConfig, GrobberDefinition }
