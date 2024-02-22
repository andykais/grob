import { path, getSetCookies } from './deps.ts'
import { GrobDatabase } from './database.ts'
import { RateLimitQueue, type RateLimitQueueConfig } from './queue.ts'
import { Htmlq } from './htmlq.ts'


type Filepath = string

interface GrobConfig {
  download_folder?: Filepath
  headers?: Record<string, string>
  throttle?: RateLimitQueueConfig
  database?: GrobDatabase
}
interface GrobOptions {
  cache?: boolean
  ignore?: {
    headers?: string[]
  }
  expires_on?: Date
  validate?: {
    status?: number[]
  }
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

interface FetchOptions extends RequestInit {
  client?: Deno.HttpClient
}


const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:102.0) Gecko/20100101 Firefox/102.0'
}

class GrobResponse extends Response {
  filepath?: string
}

class HttpError extends Error {
  public constructor(public request: Request, public response: Response, message?: string) {
    super(message)
  }
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
    this.db = config?.database ?? new GrobDatabase(this.download_folder)
    this.queue = new RateLimitQueue(this.config.throttle)
    this.runtime_cache = new Map()
    this.stats = { fetch_count: 0, cache_count: 0 }
  }

  public close() {
    // console.log('Grob::close')
    this.queue.close()
    if (!this.config.database) {
      // if the database was supplied from outside this class instance, we shouldnt close it
      this.db.close()
    }
  }

  public async fetch_headers(url: string, fetch_options?: FetchOptions, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )

    return response.headers
  }

  public async fetch_cookies(url: string, fetch_options?: FetchOptions, grob_options?: GrobOptions) {
    const response_headers = await this.fetch_headers(url, fetch_options, grob_options)
    return getSetCookies(response_headers)
  }

  public async fetch_json(url: string, fetch_options?: FetchOptions, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )
    return await response.json()
  }

  public async fetch_text(url: string, fetch_options?: FetchOptions, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )
    return await response.text()
  }

  public async fetch_html(url: string, fetch_options?: FetchOptions, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: undefined},
    )
    const html_text = await response.text()
    return new Htmlq(html_text)
  }

  public async fetch_file(url: string, fetch_options?: FetchOptions, grob_options?: GrobOptions & { filepath?: string; folder_prefix?: string; }): Promise<string> {
    if (grob_options?.folder_prefix && grob_options.filepath) {
      throw new Error('Cannot specify both `filepath` and `folder_prefix` options')
    }
    const filename = path.basename(url).replace(/\?.*/, '')
    const folder_prefix = grob_options?.folder_prefix ?? ''
    // use date times so the folders contain some semblence of order by download
    const folder_name = `${folder_prefix}${Date.now()}-${crypto.randomUUID().replace(/-.*/, '')}`
    const generated_filepath = path.join(this.files_folder, folder_name, filename)
    const filepath = grob_options?.filepath ?? generated_filepath
    const response = await this.fetch_internal(url, fetch_options, {read: false, write: filepath}) as { filepath: string } & GrobResponse
    return response.filepath
  }

  private async fetch_internal<T>(
    url: string,
    fetch_options: FetchOptions | undefined,
    grob_options: GrobOptionsInternal): Promise<GrobResponse> {
    const cache = grob_options.cache ?? true
    const expires_on = grob_options.expires_on
    const read = grob_options.read ?? true
    const write = grob_options.write ?? undefined


    const headers = {...this.default_headers}
    const headers_iterable =
      fetch_options?.headers instanceof Headers
        ? fetch_options.headers.entries()
        : fetch_options?.headers !== undefined
          ? Object.entries(fetch_options.headers)
          : []
    for (const [name, value] of headers_iterable) {
      headers[name] = value
    }

    const request_record = { url, headers, body: fetch_options?.body }
    if (grob_options.ignore?.headers) {
      request_record.headers = {...request_record.headers}
      for (const header_name of grob_options.ignore.headers) {
        delete request_record.headers[header_name]
      }
    }
    const serialized_request = JSON.stringify(request_record)
    const request = new Request(url, { ...fetch_options, headers, body: fetch_options?.body })

    if (cache) {
      const persistent_response = this.db.select_request(request_record)
      if (persistent_response) {
        this.stats.cache_count++
        return this.validate_response(grob_options, request, persistent_response)
      }

      const runtime_cache_response = this.runtime_cache.get(serialized_request)
      if (runtime_cache_response) {
        const response = await runtime_cache_response
        return this.validate_response(grob_options, request, response)
      }
    }

    const fetch_promise = this.queue.enqueue(() => fetch(request))
    this.runtime_cache.set(serialized_request, fetch_promise)

    this.stats.fetch_count++
    // console.log('Grob::fetch_internal await fetch_promise', url)
    const response = await fetch_promise

    // console.log('Grob::fetch_internal await fetch_promise', url, 'complete')

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
      // console.log('Grob::fetch_internal write', response_body_folder_temp)
      await Deno.mkdir(response_body_folder_temp)
      // we _may_ error here on a file name clash, but thats more of a user error than anything
      const file = await Deno.open(response_body_filepath_temp, { write: true, createNew: true })
      // console.log('Grob::fetch_internal write', response_body_folder_temp, 'complete')

      // const content_length = parseInt(response.headers.get('content-length')!)
      // let progress = 0
      // for await (const chunk of response.body!) {
      //   progress += chunk.length
      //   await file.write(chunk)
      //   console.log(`progress ${progress}/${content_length} (${(progress / content_length).toFixed(2)}%)`)
      // }
      await response.body?.pipeTo(file.writable)
      await Deno.mkdir(response_body_folder, { recursive: true })
      await Deno.rename(response_body_folder_temp, response_body_folder)
      await Deno.rename(path.join(response_body_folder, path.basename(response_body_filepath_temp)), response_body_filepath)
    }

    if (cache)  {
      // console.log('Grob::fetch_internal db.insert_response', url)
      // console.log('Grob::fetch_internal db.insert_response db path', this.db.database_filepath)
      this.db.insert_response(request_record, response.status, response_headers, response_body, response_body_filepath, { expires_on })
      this.runtime_cache.delete(serialized_request)
      // console.log('Grob::fetch_internal db.insert_response', url, 'complete')
    }

    this.validate_response(grob_options, request, response)
    const grob_response = new GrobResponse(response_body, response)
    grob_response.filepath = write
    // TODO attach cache/fetch stats to GrobResponse. This will become important when we have multiple scoped grobs built off the same grob base
    // we still want them to share the same queue so this is how we will track stats differently
    return grob_response
  }

  private validate_response(grob_options: GrobOptions, request: Request, response: Response): Response {
    if (grob_options.validate?.status) {
      if (!grob_options.validate.status.includes(response.status)) {
        throw new HttpError(request, response, `request ${request.url} failed. Response status ${response.status} not in expected statuses: [${grob_options.validate.status}]`)
      }
    }
    return response
  }
}

export { Grob, GrobResponse }
