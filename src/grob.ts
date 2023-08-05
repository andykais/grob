import { path, getSetCookies } from './deps.ts'
import { GrobDatabase } from './database.ts'
import { RateLimitQueue, type RateLimitQueueConfig } from './queue.ts'
import { Htmlq } from './htmlq.ts'


type Filepath = string

interface GrobConfig {
  download_folder?: Filepath
  headers?: Record<string, string>
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

interface GrobStats {
  fetch_count: number
  cache_count: number
}


const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:102.0) Gecko/20100101 Firefox/102.0'
}

class GrobResponse extends Response {
  filepath?: string
}

class Grob {
  public config: GrobConfig
  public download_folder: string
  public files_folder: string
  public files_temp_folder: string
  public stats: GrobStats
  private db: GrobDatabase
  private queue: RateLimitQueue<Response>
  private runtime_cache: Map<string, Promise<Response>>
  private default_headers: Record<string, string>

  public constructor(config?: GrobConfig) {
    this.config = config ?? {}
    this.default_headers = {...config?.headers, ...DEFAULT_HEADERS}
    this.download_folder = this.config.download_folder ?? path.join(Deno.cwd(), 'grobber')
    this.files_folder = path.join(this.download_folder, 'files')
    this.files_temp_folder = path.join(this.download_folder, '.files_temp')
    Deno.mkdirSync(this.download_folder, { recursive: true })
    Deno.mkdirSync(this.files_folder, { recursive: true })
    try {
      Deno.removeSync(this.files_temp_folder, { recursive: true })
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {}
      else throw e
    }
    Deno.mkdirSync(this.files_temp_folder, { recursive: true })
    this.db = new GrobDatabase(this.download_folder)
    this.queue = new RateLimitQueue(this.config.throttle)
    this.runtime_cache = new Map()
    this.stats = { fetch_count: 0, cache_count: 0 }
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

  public async fetch_html(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )
    const html_text = await response.text()
    return new Htmlq(html_text)
  }

  public async fetch_file(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions & { filepath?: string }): Promise<string> {
    const filename = path.basename(url).replace(/\?.*/, '')
    const generated_filepath = path.join(this.files_folder, crypto.randomUUID(), filename)
    const filepath = grob_options?.filepath ?? generated_filepath
    const response = await this.fetch_internal(url, fetch_options, {read: false, write: filepath}) as { filepath: string } & GrobResponse
    return response.filepath
  }

  private async fetch_internal<T>(
    url: string,
    fetch_options: RequestInit | undefined,
    grob_options: GrobOptionsInternal): Promise<GrobResponse> {
    const cache = grob_options.cache ?? true
    const expires_on = grob_options.expires_on
    const read = grob_options.read ?? true
    const write = grob_options.write ?? undefined


    const headers = {...this.default_headers}
    for (const [name, value] of Object.entries(fetch_options?.headers ?? {})) {
      headers[name] = value
    }

    const request = { url, headers, body: fetch_options?.body }
    const serialized_request = JSON.stringify(request)

    if (cache) {
      const persistent_response = this.db.select_request(request)
      if (persistent_response) {
        this.stats.cache_count++
        return persistent_response
      }

      if (this.runtime_cache.has(serialized_request)) {
        return await this.runtime_cache.get(serialized_request)!
      }
    }

    const fetch_promise = this.queue.enqueue(() => fetch(url, { headers, body: request.body }))
    this.runtime_cache.set(serialized_request, fetch_promise)

    this.stats.fetch_count++
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
      const response_body_folder = path.dirname(response_body_filepath)
      const response_body_folder_temp = path.join(this.files_temp_folder, crypto.randomUUID())
      const response_body_filepath_temp = path.join(response_body_folder_temp, path.basename(response_body_filepath) + '.down')
      await Deno.mkdir(response_body_folder_temp)
      // we _may_ error here on a file name clash, but thats more of a user error than anything
      const file = await Deno.open(response_body_filepath_temp, { write: true, createNew: true })
      await response.body?.pipeTo(file.writable)
      await Deno.mkdir(response_body_folder, { recursive: true })
      await Deno.rename(response_body_folder_temp, response_body_folder)
      await Deno.rename(path.join(response_body_folder, path.basename(response_body_filepath_temp)), response_body_filepath)
    }

    if (cache)  {
      this.db.insert_response(request, response_headers, response_body, response_body_filepath, { expires_on })
      this.runtime_cache.delete(serialized_request)
    }

    const grob_response = new GrobResponse(response_body, response)
    grob_response.filepath = write
    return grob_response
  }
}

export { Grob, GrobResponse }
