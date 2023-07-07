import { PromiseController } from "./promise_controller.ts";
import { CompiledGrobber } from "./registry.ts";
import * as worker from './worker.ts'

const accept_fetch_symbol = Symbol.for('accept_fetch')

interface WorkerControllerOptions {
  [accept_fetch_symbol]?: boolean
}

class InvalidPermissions extends Error {}

class WorkerController {
  worker: Worker
  worker_complete_controller: PromiseController<void>
  grobber: CompiledGrobber
  download_folder: string
  accept_fetch: boolean

  public constructor(download_folder: string, grobber: CompiledGrobber, options?: WorkerControllerOptions) {
    this.accept_fetch = options?.[accept_fetch_symbol] ?? false
    this.download_folder = download_folder
    this.grobber = grobber
    console.log('creating worker')
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      deno: {
        permissions: {
          // download_folder must be an absolute path to work when this module is imported remotely
          read: [download_folder],
          write: [download_folder],
          net: grobber.definition.permissions,
        }
      }
    })
    console.log('created worker')
    this.worker_complete_controller = new PromiseController()
    this.worker.onmessage = async (event: MessageEvent<worker.WorkerMessage>) => {
      try {
        await this.handle_worker_message(event.data)
      } catch (error) {
        this.worker_complete_controller.reject(error)
        this.worker.terminate()
      }
    }
    this.worker.onerror = error => {
      const message = `${error.filename}:${error.lineno} ${error.message}`
      this.worker_complete_controller.reject(new Error(message))
    }
  }

  public async start(input: string) {

    console.log('sending launch message to worker...')
    const launch_message: worker.MasterMessageLaunch = {
      command: 'launch',
      fetch_piping: this.accept_fetch,
      grobber_definition: this.grobber.definition,
      grobber_folder: this.download_folder,
      grobber_name: this.grobber.definition.name,
      main_filepath: this.grobber.main_filepath,
      input,
    }
    this.send_message(launch_message)
    console.log('launch message sent')

    await this.worker_complete_controller.promise
    this.worker.terminate()
  }

  public stop() {
    throw new Error('unimplemented')
  }

  private send_message(message: worker.MasterMessage) {
    this.worker.postMessage(message)
  }

  private handle_worker_message = async (message: worker.WorkerMessage) => {
    switch(message.command) {
      case 'complete': {
        this.worker_complete_controller.resolve()
        break
      }
      case 'fetch': {
        if (!this.accept_fetch) throw new Error('Fetch piping not allowed from this worker')
        const { fetch_id, url, method, body } = message
        const response = await fetch(url, { method, body })
        const response_body = await response.arrayBuffer()
        this.send_message({
          command: 'fetch_response',
          fetch_id: message.fetch_id,
          response_headers: Object.fromEntries(response.headers.entries()),
          response_body: response_body,
        })
        break
      }
      case 'error': {
        switch (message.type) {
          case 'permission_denied': {
            const worker_error = new Error(message.message)
            worker_error.stack = message.stacktrace
            throw new InvalidPermissions(`Invalid permissions within '${this.grobber.definition.name}'`, { cause: worker_error })
            break
          }
          default: {
            throw new Error(`master received unexpected worker error ${JSON.stringify(message)}`)
          }
        }
      }
      default: {
        throw new Error(`master received unexpected worker message ${JSON.stringify(message)}`)
      }
    }
  }
}

export { WorkerController, InvalidPermissions }
export type { WorkerControllerOptions }
