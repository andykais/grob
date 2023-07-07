import { PromiseController } from "./promise_controller.ts";
import { CompiledGrobber } from "./registry.ts";
import * as worker from './worker.ts'

class WorkerController {
  worker: Worker
  worker_complete_controller: PromiseController<void>
  grobber: CompiledGrobber
  download_folder: string

  public constructor(download_folder: string, grobber: CompiledGrobber) {
    this.download_folder = download_folder
    this.grobber = grobber
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
    this.worker.onmessage = async (e: MessageEvent<worker.WorkerMessage>) => {
      return this.handle_worker_message(e.data)
    }
    this.worker_complete_controller = new PromiseController()
  }

  public async start(input: string) {

    const launch_message: worker.MasterMessageLaunch = {
      command: 'launch',
      grobber_definition: this.grobber.definition,
      grobber_folder: this.download_folder,
      grobber_name: this.grobber.definition.name,
      main_filepath: this.grobber.main_filepath,
      input,
    }
    this.send_message(launch_message)

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
      default: {
        throw new Error(`master received unexpected worker message ${JSON.stringify(message)}`)
      }
    }
  }
}

export { WorkerController }
