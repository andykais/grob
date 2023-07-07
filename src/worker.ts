import { PromiseController } from './promise_controller.ts'
import { path } from './deps.ts'
import { Grob } from './grob.ts'
import { GrobberRegistry, type GrobberRegistryConfig, type CompiledGrobber, type GrobberDefinition } from './registry.ts'

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

type MasterMessage = MasterMessageLaunch | MasterMessageFetchResponse

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

type WorkerMessage = WorkerMessageFetch | WorkerMessageComplete | WorkerMessageError


class GrobberRegistryWorker {
  public async start(input: string) {
    // this is the composability piece of grobbers
    throw new Error('unimplemented')
  }
}


const worker_self = self as typeof self & Worker
function send_message(message: WorkerMessage) {
  worker_self.postMessage(message)
}

function pipe_fetch() {
  self.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const fetch_id = crypto.randomUUID()
    if (input instanceof Request) {
      throw new Error('unimplemented')
    }
    send_message({
      command: 'fetch',
      fetch_id,
      url: input.toString(),
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: init?.headers
    })
    const promise_controller = new PromiseController<Response>()
    fetch_response_controllers[fetch_id] = promise_controller
    return promise_controller.promise
  }
}

console.log('executing worker...')
const fetch_response_controllers: Record<string, PromiseController<Response>> = {}
worker_self.onmessage = async (e: MessageEvent<MasterMessage>) => {
  console.log('worker received message', e.data)
  switch(e.data.command) {
    case 'launch': {
      if (e.data.fetch_piping) {
        pipe_fetch()
      }
      const { grobber_definition, grobber_folder, main_filepath, input } = e.data
      const program = (await import(main_filepath)).default
      const grob = new Grob({ download_folder: grobber_folder, throttle: grobber_definition.throttle })

      try {
        await program(grob, input)
      } catch (e) {
        if (e instanceof Deno.errors.PermissionDenied) {
          send_message({
            command: 'error',
            type: 'permission_denied',
            message: e.message,
            stacktrace: e.stack
          })
          worker_self.close()
        } else {
          throw e
        }
      }

      send_message({ command: 'complete' })
      break
    }
    case 'fetch_response': {
      const { fetch_id } = e.data
      const response = new Response(e.data.response_body, { headers: e.data.response_headers })
      fetch_response_controllers[fetch_id].resolve(response)
      break
    }
    default: {
      throw new Error(`worker received unexpected message ${JSON.stringify(e.data)}`)
    }
  }
}

export type { MasterMessageLaunch, MasterMessage, WorkerMessageFetch, WorkerMessage }
