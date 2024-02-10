import { PromiseController } from "./promise_controller.ts";
import { CompiledGrobber } from "./registry.ts";
import * as worker from './worker.ts'

const accept_fetch_symbol = Symbol.for('accept_fetch')

interface WorkerControllerOptions {
  [accept_fetch_symbol]?: boolean
  vars?: Record<string, string>
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
    // console.log('WorkerController::', download_folder)
    this.download_folder = download_folder
    this.grobber = grobber
    const permissions: Deno.PermissionOptions = {
      // download_folder must be an absolute path to work when this module is imported remotely
      read: [download_folder],
      write: [download_folder],
    }
    if (grobber.definition.permissions) {
      // there is possibly a better pattern to explicitly say ANY network access is allowed
      permissions.net = grobber.definition.permissions
    } else {
      permissions.net = 'inherit'
    }
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      deno: {
        permissions: permissions,
        // permissions: {
        //   read: [download_folder],
        //   write: [download_folder],
        //   net: grobber.definition.permissions,
        // }
      }
    })
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
    // TODO FIXME: this is a shim to be able to run the worker with back to back launches
    // the real solution involves passing a `launch_id` along with every message,
    // and tying a worker_complete_controller to a map of launch ids
    this.worker_complete_controller = new PromiseController()

    // console.log('WorkerController::start this.download_folder', this.download_folder)
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

    // console.log('awaiting worer complete promise...')
    await this.worker_complete_controller.promise
    // console.log('completed')
  }

  public stop() {
    this.worker.terminate()
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
            console.error(message.stacktrace)
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
