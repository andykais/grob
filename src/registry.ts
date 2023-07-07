import { path, yaml } from './deps.ts'
import { Grob } from './grob.ts'
import { type RateLimitQueueConfig } from './queue.ts'


interface GrobberRegistryConfig {
  download_folder?: string
}

type Regex = string
type URLString = string
type FilepathString = string
type GrobName = string

type GrobEntrypoint = (grob: Grob, input: string) => Promise<void>

interface GrobberDefinition {
  name: GrobName
  match: Regex
  permissions?: Regex[]
  throttle?: RateLimitQueueConfig
  depends_on?: GrobberRegistration[]
  main: URLString | FilepathString
}

type GrobberRegistration = URLString | FilepathString


interface CompiledGrobber {
  registration_identifier: string
  definition: GrobberDefinition
  main: GrobEntrypoint
}


class GrobberRegistry {
  public download_folder: string
  private registry: Map<GrobName, CompiledGrobber>
  private registry_grob: Grob

  public constructor(config?: GrobberRegistryConfig) {
    this.download_folder = config?.download_folder ?? Deno.cwd()
    this.registry = new Map()
    const registry_grob_folder = path.join(this.download_folder, '.registry')
    this.registry_grob = new Grob({ download_folder: registry_grob_folder })
  }

  public async register(registration: GrobberRegistration) {
    let registration_identifier: string
    let registration_type: 'url' | 'filepath'
    let grobber_definition: GrobberDefinition

    if (this.is_valid_url(registration)) {
      registration_identifier = registration
      registration_type = 'url'
      // TODO dogfood grob, rather than fetching every time
      const content = await this.registry_grob.fetch_text(registration)
      grobber_definition = yaml.parse(content) as GrobberDefinition
    } else {
      registration_identifier = registration
      const content = await Deno.readTextFile(registration)
      registration_type = 'filepath'
      grobber_definition = yaml.parse(content) as GrobberDefinition
    }

    if (grobber_definition.depends_on) {
      throw new Error('unimplemented')
    }
    // if (grobber_definition.permissions) {
    //   throw new Error('unimplemented')
    // }

    const existing_registry_entry = this.registry.get(grobber_definition.name)
    if (existing_registry_entry && existing_registry_entry.registration_identifier !== registration_identifier) {
      throw new Error(`Duplicate grob.yml name '${grobber_definition.name}' detected. Names are required to be unique. This name is already claimed by source ${existing_registry_entry.registration_identifier}`)
    }


    let program: GrobEntrypoint
    if (this.is_valid_url(grobber_definition.main)) {
      const filepath = await this.registry_grob.fetch_file(grobber_definition.main)
      program = (await import(filepath)).default as GrobEntrypoint
    } else {
      if (registration_type === 'url') {
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

    this.registry.set(grobber_definition.name, {
      registration_identifier,
      definition: grobber_definition,
      main: program
    })
  }

  public async start(input: string) {
    for (const grobber of this.registry.values()) {
      const is_match = new RegExp(grobber.definition.match).test(input)
      if (is_match) {
        return this.launch_grobber(input, grobber)
      }
    }
  }

  public close() {
    this.registry_grob.close()
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
