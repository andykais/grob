import { path, getSetCookies } from './deps.ts'
import { GrobDatabase } from './database.ts'
import { RateLimitQueue, type RateLimitQueueConfig } from './queue.ts'


type Filepath = string

interface GrobConfig {
  download_folder?: Filepath
  throttle?: RateLimitQueueConfig
}
interface GrobOptions {
  cache?: boolean
  expires_on?: Date
}

interface GrobOptionsInternal extends GrobOptions {
  read: boolean
  write: Filepath | undefined
}

interface GrobbedResponse {
  response: Response
  fetched: boolean
}

class GrobResponse extends Response {
  filepath?: string
}


class Grob {
  public config: GrobConfig
  public download_folder: string
  private db: GrobDatabase
  private queue: RateLimitQueue<Response>
  private runtime_cache = new Map<string, Promise<Response>>()

  public constructor(config?: GrobConfig) {
    this.config = config ?? {}
    this.download_folder = this.config.download_folder ?? path.join(Deno.cwd(), 'grobber')
    Deno.mkdirSync(this.download_folder, { recursive: true })
    this.db = new GrobDatabase(this.download_folder)
    this.queue = new RateLimitQueue(this.config.throttle)
    this.runtime_cache = new Map()
  }

  public close() {
    this.queue.close()
    this.db.close()
  }

  public async fetch_headers(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )

    return response.headers
  }

  public async fetch_cookies(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response_headers = await this.fetch_headers(url, fetch_options, grob_options)
    return getSetCookies(response_headers)
  }

  public async fetch_json(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )
    return await response.json()
  }

  public async fetch_text(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )
    return await response.text()
  }

  public async fetch_file(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions & { filepath?: string }): Promise<{ filepath: string } & GrobResponse> {
    const generated_filepath = path.join(this.download_folder, crypto.randomUUID(), path.basename(url))
    const filepath = grob_options?.filepath ?? generated_filepath
    await Deno.mkdir(path.dirname(filepath))
    return this.fetch_internal(url, fetch_options, {read: false, write: filepath}) as Promise<{ filepath: string } & GrobResponse>
  }

  private async fetch_internal<T>(
    url: string,
    fetch_options: RequestInit | undefined,
    grob_options: GrobOptionsInternal): Promise<GrobResponse> {
    const cache = grob_options.cache ?? true
    const expires_on = grob_options.expires_on ?? null
    const read = grob_options.read ?? true
    const write = grob_options.write ?? undefined


    const request = { url, headers: fetch_options?.headers, body: fetch_options?.body }
    const serialized_request = JSON.stringify(request)

    if (cache) {
      const persistent_response = this.db.select_request(request)
      if (persistent_response) {
        return persistent_response
      }

      if (this.runtime_cache.has(serialized_request)) {
        return await this.runtime_cache.get(serialized_request)!
      }
    }

    const fetch_promise = this.queue.enqueue(() => fetch(url, { headers: request.headers, body: request.body }))
    this.runtime_cache.set(serialized_request, fetch_promise)

    const response = await fetch_promise

    const response_headers = response.headers
    let response_body
    let response_body_filepath: string | undefined = undefined
    if (read && write) {
      throw new Error('unimplemented')
    } if (read) {
      response_body = await response.text()
    } else if (write) {
      response_body_filepath = write
      const response_body_filepath_temp = `${response_body_filepath}.down`
      // we _may_ error here on a file name clash, but thats more of a user error than anything
      // potentially we should make filenames fully generated (with something like write: true) to make this more ergonomic
      const file = await Deno.open(response_body_filepath_temp, { write: true, createNew: true })
      await response.body?.pipeTo(file.writable)
      await Deno.rename(response_body_filepath_temp, response_body_filepath)
    }

    if (cache)  {
      this.db.insert_response(request, response_headers, response_body, response_body_filepath)
      this.runtime_cache.delete(serialized_request)
    }

    const grob_response = new GrobResponse(response_body, response)
    grob_response.filepath = write
    return grob_response
  }

  private complete_request(response: Response) {

  }

  private serialize_request(url: string, fetch_options: RequestInit) {

  }
}

export { Grob, GrobResponse }
