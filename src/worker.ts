import { PromiseController } from './promise_controller.ts'
import { path } from './deps.ts'
import { Grob } from './grob.ts'
import { GrobberRegistry, type GrobberRegistryConfig, type CompiledGrobber, type GrobberDefinition, type GrobMain } from './registry.ts'
import { GrobDatabase } from "./database.ts";

// reconsitution failed. We cant really do this because the sandbox is broken because we have to load files from random sources
// we could try to copy every registerred bit of code and grob.yml into a particular folder on every run, but that feels bad

// an alternative is to spin up a worker per each grob.yml, then calling `grobber.start(...)` from inside a worker
// will communicate back up to the registry and pass it to the proper worker.
// There is still a problem with permissions here though. We have to dynamically import something outside the read permissions

interface MasterMessageLaunch {
  command: 'launch'
  fetch_piping: boolean
  grobber_definition: GrobberDefinition
  grobber_folder: string
  database_folder: string
  grobber_name: string
  main_filepath: string
  input: string
}

interface MasterMessageFetchResponse {
  command: 'fetch_response'
  fetch_id: string
  response_headers: Record<string, string>
  response_body: any
}

interface MasterMessageShutdown {
  command: 'shutdown'
}

type MasterMessage =
  | MasterMessageLaunch
  | MasterMessageFetchResponse
  | MasterMessageShutdown

interface WorkerMessageFetch {
  command: 'fetch'
  fetch_id: string
  method: string
  url: string
  body: any | undefined
  headers: HeadersInit | undefined
}

interface WorkerMessageError {
  command: 'error'
  type: 'permission_denied'
  message: string
  stacktrace?: string
}
interface WorkerMessageComplete {
  command: 'complete'
}

type WorkerMessage =
  | WorkerMessageFetch
  | WorkerMessageComplete
  | WorkerMessageError


class GrobberRegistryWorker {
  public async start(input: string) {
    // this is the composability piece of grobbers
    throw new Error('unimplemented')
  }
}

class WorkerSingleton {
  worker_self = self as typeof self & Worker
  fetch_response_controllers: Record<string, PromiseController<Response>> = {}
  database_map: Map<string, GrobDatabase> = new Map()

  constructor() {
    this.worker_self = self as typeof self & Worker

    this.worker_self.onmessage = async (e: MessageEvent<MasterMessage>) => {
      switch(e.data.command) {
        case 'launch': {
          await this.handle_launch_command(e.data)
          break
        }
        case 'fetch_response': {
          this.handle_fetch_response_command(e.data)
          break
        }
        case 'shutdown': {
          this.handle_shutdown(e.data)
          break
        }
        default: {
          throw new Error(`worker received unexpected message ${JSON.stringify(e.data)}`)
        }
      }
    }
  }

  async handle_launch_command(data: MasterMessageLaunch) {
    if (data.fetch_piping) {
      this.pipe_fetch()
    }

    const { grobber_definition, grobber_folder, main_filepath, input } = data
    const program = (await import(main_filepath)) as GrobMain
    const grob_database = this.database_map.get(data.database_folder) ?? new GrobDatabase(data.database_folder)
    this.database_map.set(data.database_folder, grob_database)
    const grob = new Grob({ download_folder: grobber_folder, throttle: grobber_definition.throttle, headers: grobber_definition.headers, database: grob_database })

    const entrypoint = program.grobber.match(input)
    if (!entrypoint) {
      throw new Error(`unexpected code path. Matched '${input}' on ${grobber_definition.name} in main process but failed to match in worker`)
    }

    try {
      // console.log('Worker::onmessage entrypoint.fn:', input)
      // console.log('                                ', grob.download_folder)
      await entrypoint.fn(grob, input, entrypoint.vars)
      // console.log('Worker::onmessage entrypoint.fn:', input, 'complete')
    } catch (e) {
      if (e instanceof Deno.errors.PermissionDenied) {
        this.send_message({
          command: 'error',
          type: 'permission_denied',
          message: e.message,
          stacktrace: e.stack
        })
        // worker_self.close()
      } else {
        throw e
      }
    }

    grob.close()
    this.send_message({ command: 'complete' })
  }

  handle_fetch_response_command(data: MasterMessageFetchResponse) {
    const { fetch_id } = data
    const response = new Response(data.response_body, { headers: data.response_headers })
    this.fetch_response_controllers[fetch_id].resolve(response)
  }

  handle_shutdown(data: MasterMessageShutdown) {
    for (const database of this.database_map.values()) {
      database.close()
    }
  }

  send_message(message: WorkerMessage) {
    this.worker_self.postMessage(message)
  }

  pipe_fetch() {
    self.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const fetch_id = crypto.randomUUID()
      if (input instanceof Request) {
        throw new Error('unimplemented')
      }
      this.send_message({
        command: 'fetch',
        fetch_id,
        url: input.toString(),
        method: init?.method ?? 'GET',
        body: init?.body,
        headers: init?.headers
      })
      const promise_controller = new PromiseController<Response>()
      this.fetch_response_controllers[fetch_id] = promise_controller
      return promise_controller.promise
    }
  }

}
const instance = new WorkerSingleton()


export type { MasterMessageLaunch, MasterMessage, WorkerMessageFetch, WorkerMessage }
