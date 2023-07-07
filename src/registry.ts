import { PromiseController } from '../test/tools/promise_controller.ts'
import { path, yaml } from './deps.ts'
import { Grob } from './grob.ts'
import { type RateLimitQueueConfig } from './queue.ts'
import * as worker from './worker.ts'
import { WorkerController } from './worker_controller.ts'


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
  main_filepath: FilepathString
  main: GrobEntrypoint
}

interface PersistentRegistry {
  [name: string]: {
    grobber_definition_filepath: string
  }
}


class GrobberRegistry {
  public download_folder: string
  public registry_folder: string
  private config: GrobberRegistryConfig | undefined
  private registry: Map<GrobName, CompiledGrobber>
  private registry_grob: Grob

  public constructor(config?: GrobberRegistryConfig) {
    this.config = config
    this.download_folder = config?.download_folder ?? Deno.cwd()
    this.registry = new Map()
    this.registry_folder = path.join(this.download_folder, '.registry')
    this.registry_grob = new Grob({ download_folder: this.registry_folder })
  }

  public async register(registration: GrobberRegistration) {
    let local_grobber_definition_filepath: string
    let local_grobber_program_filepath: string
    let registration_identifier: string
    let registration_type: 'url' | 'filepath'
    let grobber_definition: GrobberDefinition

    if (this.is_valid_url(registration)) {
      registration_type = 'url'
      registration_identifier = registration
      local_grobber_definition_filepath = await this.registry_grob.fetch_file(registration)
    } else {
      registration_type = 'filepath'
      registration_identifier = registration
      local_grobber_definition_filepath = path.resolve(registration)
    }
    const content = await Deno.readTextFile(local_grobber_definition_filepath)
    grobber_definition = yaml.parse(content) as GrobberDefinition

    if (grobber_definition.depends_on) {
      throw new Error('unimplemented')
    }
    // if (grobber_definition.permissions) {
    //   throw new Error('unimplemented')
    // }

    const existing_registry_entry = this.registry.get(grobber_definition.name)
    if (existing_registry_entry && existing_registry_entry.registration_identifier !== registration) {
      throw new Error(`Duplicate grob.yml name '${grobber_definition.name}' detected. Names are required to be unique. This name is already claimed by source ${existing_registry_entry.registration_identifier}`)
    }


    let program: GrobEntrypoint
    if (this.is_valid_url(grobber_definition.main)) {
      local_grobber_program_filepath = await this.registry_grob.fetch_file(grobber_definition.main)
      program = (await import(local_grobber_program_filepath)).default as GrobEntrypoint
    } else {
      if (registration_type === 'url') {
        const registration_url = new URL(registration as string)

        const resolved_path = path.join(path.dirname(registration_url.pathname), grobber_definition.main)
        const resolved_url = registration_url.origin + resolved_path
        local_grobber_program_filepath = await this.registry_grob.fetch_file(resolved_url)
        program = (await import(local_grobber_program_filepath)).default as GrobEntrypoint
      } else if (registration_type === 'filepath') {
        // a filepath here must be relative to the grob.yml folder
        const definition_folder = path.dirname(registration as string)
        local_grobber_program_filepath = path.resolve(definition_folder, grobber_definition.main)
        program = (await import(local_grobber_program_filepath)).default as GrobEntrypoint
      } else {
        throw new Error(`unexpected registration type ${registration_type}`)
      }
    }

    this.registry.set(grobber_definition.name, {
      registration_identifier,
      definition: grobber_definition,
      main_filepath: local_grobber_program_filepath,
      main: program
    })

    // store everything we need to reconstitute the registry from a file for the worker
    const peristent_registry_filepath = path.join(this.registry_folder, 'registry.json')
    await Deno.writeTextFile(peristent_registry_filepath, JSON.stringify({}), { createNew: true })
      .catch(e => {
        if (e instanceof Deno.errors.AlreadyExists) {}
        else throw e
      })
    const persistent_registry: PersistentRegistry = JSON.parse(await Deno.readTextFile(peristent_registry_filepath))
    persistent_registry[grobber_definition.name] = {
      grobber_definition_filepath: local_grobber_definition_filepath
    }
    await Deno.writeTextFile(peristent_registry_filepath, JSON.stringify(persistent_registry))
  }

  public async start(input: string) {
    for (const grobber of this.registry.values()) {
      const is_match = new RegExp(grobber.definition.match).test(input)
      if (is_match) {
        return this.launch_grobber(input, grobber)
      }
    }
    throw new Error(`No grob.yml found for input '${input}'`)
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

  protected async launch_grobber(input: string, grobber: CompiledGrobber) {
    const sanitized_folder_name = input.replaceAll('/', '_')
    const download_folder = path.join(this.download_folder, grobber.definition.name, sanitized_folder_name)
    await Deno.mkdir(download_folder, { recursive: true })
    const worker_controller = new WorkerController(download_folder, grobber)

    return worker_controller.start(input)

  }
}


export { GrobberRegistry }
export type { GrobberRegistryConfig, GrobberDefinition, CompiledGrobber }
