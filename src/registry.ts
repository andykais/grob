import { PromiseController } from './promise_controller.ts'
import { path, yaml, z } from './deps.ts'
import { Grob } from './grob.ts'
import { type RateLimitQueueConfig } from './queue.ts'
import * as worker from './worker.ts'
import { WorkerController, type WorkerControllerOptions } from './worker_controller.ts'
import * as input from './input.ts'
import type { Grobber } from './grobber.ts'

type InputTypes = { [K in keyof typeof input]: z.infer<(typeof input)[K]> }

type GrobMain = InputTypes['GrobMain']
type GrobberDefinition = InputTypes['GrobberDefinition']

interface GrobberRegistryConfig {
  download_folder?: string
}

interface CompiledGrobber {
  registration_identifier: string
  definition: InputTypes['GrobberDefinition']
  main_filepath: InputTypes['Filepath']
  main: GrobMain
  worker_controller?: WorkerController
}

type PersistentRegistry = Record<InputTypes['GrobName'], {
  grobber_definition_filepath: string
}>


class GrobberRegistry {
  public download_folder: string
  public registry_folder: string
  private config: GrobberRegistryConfig | undefined
  private registry: Map<InputTypes['GrobName'], CompiledGrobber>
  private registry_grob: Grob
  private force_dynamic_import_cache_reload: boolean

  public constructor(config?: GrobberRegistryConfig) {
    this.config = config
    this.download_folder = config?.download_folder ?? Deno.cwd()
    this.registry = new Map()
    this.registry_folder = path.join(this.download_folder, '.registry')
    this.registry_grob = new Grob({ download_folder: this.registry_folder })
    this.force_dynamic_import_cache_reload = false
  }

  public async register(registration: InputTypes['GrobberRegistration']) {
    let local_grobber_definition_filepath: string
    let grobber_program_source: string
    let registration_identifier: string
    let registration_type: 'url' | 'filepath'
    let grobber_definition: InputTypes['GrobberDefinition']

    if (this.is_valid_url(registration)) {
      registration_type = 'url'
      registration_identifier = registration
      local_grobber_definition_filepath = await this.registry_grob.fetch_file(registration)
    } else {
      registration_type = 'filepath'
      registration_identifier = registration
      local_grobber_definition_filepath = path.isAbsolute(registration) ? registration : path.join(Deno.cwd(), registration)
    }
    const content = await Deno.readTextFile(local_grobber_definition_filepath)
    const decoded = yaml.parse(content)
    grobber_definition = input.GrobberDefinition.parse(decoded)

    if (grobber_definition.depends_on) {
      throw new Error('unimplemented')
    }

    const existing_registry_entry = this.registry.get(grobber_definition.name)
    if (existing_registry_entry && existing_registry_entry.registration_identifier !== registration) {
      throw new Error(`Duplicate grob.yml name '${grobber_definition.name}' detected. Names are required to be unique. This name is already claimed by source ${existing_registry_entry.registration_identifier}`)
    }


    let program: GrobMain
    if (this.is_valid_url(grobber_definition.main)) {
      grobber_program_source = await this.registry_grob.fetch_file(grobber_definition.main)
      program = (await import(grobber_program_source))
    } else {
      if (registration_type === 'url') {
        const registration_url = new URL(registration as string)

        const resolved_path = path.join(path.dirname(registration_url.pathname), grobber_definition.main)
        let resolved_url = registration_url.origin + resolved_path
        // a testing flag that adds a unique query param to the dependency to force a cache reload
        if (this.force_dynamic_import_cache_reload) resolved_url += `?reload=${Date.now()}`
        program = (await import(resolved_url))
        grobber_program_source = resolved_url
      } else if (registration_type === 'filepath') {
        // a filepath here must be relative to the grob.yml folder
        const definition_folder = path.dirname(registration as string)
        const parent_folder = path.isAbsolute(definition_folder) ? definition_folder : path.join(Deno.cwd(), definition_folder)
        grobber_program_source = `file://${path.join(parent_folder, grobber_definition.main)}`
        program = (await import(grobber_program_source))
      } else {
        throw new Error(`unexpected registration type ${registration_type}`)
      }
    }

    // validate grobber program
    try {
      input.GrobMain.parse(program)
    } catch (e) {
      throw new Error(`Invalid grobber ${grobber_definition.name}:`, { cause: e })
    }

    this.registry.set(grobber_definition.name, {
      registration_identifier,
      definition: grobber_definition,
      main_filepath: grobber_program_source,
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

  public async start(input: string, options?: WorkerControllerOptions) {
    for (const grobber of this.registry.values()) {
      const matched_input = grobber.main.grobber.match(input)
      if (matched_input) {
        const vars = {...options?.vars, ...matched_input.vars}
        return this.launch_grobber(input, grobber, {...options, vars})
      }
    }
    throw new Error(`No grob.yml found for input '${input}'`)
  }

  public async close() {
    for (const grobber of this.registry.values()) {
      await grobber.worker_controller?.stop()
    }
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

  private async launch_grobber(input: string, grobber: CompiledGrobber, options: WorkerControllerOptions | undefined) {
    const sanitized_folder_name = input.replaceAll('/', '_')

    const download_folder = grobber.definition.folder
      ? path.join(this.download_folder, grobber.definition.name, grobber.definition.folder)
      : path.join(this.download_folder, grobber.definition.name, sanitized_folder_name)

    const database_folder = grobber.definition.folder
      ? path.join(this.download_folder, grobber.definition.name, grobber.definition.folder)
      : path.join(this.download_folder, grobber.definition.name)

    if (!grobber.worker_controller) {
      await Deno.mkdir(download_folder, { recursive: true })
      grobber.worker_controller = new WorkerController(download_folder, database_folder, grobber, options)
    }

    return grobber.worker_controller.start(input)
  }
}


export { GrobberRegistry }
export type { GrobberRegistryConfig, GrobberDefinition, CompiledGrobber, GrobMain }
