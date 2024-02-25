import { path, getSetCookies, fs } from './deps.ts'
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

interface FetchFileGrobOptions extends GrobOptions {
  filepath?: string
  folder_prefix?: string;
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
  fetch: {
    count: number
    total_bytes: number
  }
  cache: {
    count: number
    total_bytes: number
  }
}

interface FetchOptions extends RequestInit {
  client?: Deno.HttpClient
}


const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:102.0) Gecko/20100101 Firefox/102.0'
}

class GrobResponse extends Response {
  filepath: string | undefined

  content_length() {
    const content_length = this.headers.get('content-length')

    if (content_length) {
      const content_length_bytes = parseInt(content_length)
      return content_length_bytes
    }
    return 0
//     return content_length
//       ? parseInt(content_length)
//       : 0
  }
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
  private queue: RateLimitQueue<GrobResponse>
  private runtime_cache: Map<string, Promise<GrobResponse>>
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
    this.stats = { fetch: {count: 0, total_bytes: 0}, cache: {count: 0, total_bytes: 0} }
  }

  public close() {
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

  public async fetch_file(url: string, fetch_options?: FetchOptions, grob_options?: FetchFileGrobOptions): Promise<string> {
    if (grob_options?.folder_prefix && grob_options.filepath) {
      throw new Error('Cannot specify both `filepath` and `folder_prefix` options')
    }
    let filepath = grob_options?.filepath
    if (!filepath) {
      const filename = path.basename(url).replace(/\?.*/, '')
      const folder_prefix = grob_options?.folder_prefix ?? ''
      // use date times so the folders contain some semblence of order by download
      const folder_name = `${folder_prefix}${Date.now()}-${crypto.randomUUID().replace(/-.*/, '')}`
      const generated_filepath = path.join(this.files_folder, folder_name, filename)
      filepath = generated_filepath
    }

    const response = await this.fetch_internal(url, fetch_options, {read: false, write: filepath}) as { filepath: string } & GrobResponse
    return response.filepath

    // // shoot. I dont think this works. The cache is going to keep returning the cached thing, but we wont know that the updated thing has been copied
    // // this is especially true for auto-generated filepaths
    // // // NOTE: we make an assumption that if there was a cache hit, and we specified a destination folder/filepath, that we want to duplicate the original file to the new destination
    // if ((grob_options?.filepath || grob_options?.folder_prefix) && response.filepath != filepath) {
    //   throw new Error(`duplicating a cache hit from ${response.filepath} to folder prefix ${grob_options.folder_prefix} is currently unsupported`)

    //   if (grob_options?.filepath && response.filepath != filepath) {
    //     const cached_response = await Deno.open(response.filepath, { read: true })
    //     if (true) throw new Error('copying file...')
    //     await this.write_file(cached_response.readable, filepath)
    //     return filepath
    //   } else if (grob_options.folder_prefix) {
    //     if (response.filepath.includes(grob_options.folder_prefix)) {
    //       // this cache hit meets the requirements of the folder prefix, so lets just return it
    //       return response.filepath
    //     } else {
    //       const cached_response = await Deno.open(response.filepath, { read: true })
    //       await this.write_file(cached_response.readable, filepath)
    //       throw new Error(`duplicating a cache hit from ${response.filepath} to folder prefix ${grob_options.folder_prefix} is currently unsupported`)
    //     }
    //   }
    // }
    // return response.filepath
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

    const request_record = { url, headers: {} as typeof headers, body: fetch_options?.body }
    for (const [header_name, header_value] of Object.entries(headers)) {
      if (grob_options.ignore?.headers?.includes(header_name)) continue
      request_record.headers[header_name] = header_value
    }
    const serialized_request = JSON.stringify(request_record)
    const request = new Request(url, { ...fetch_options, headers, body: fetch_options?.body })

    if (cache) {
      const runtime_cache_response = this.runtime_cache.get(serialized_request)
      if (runtime_cache_response) {
        const grob_response = await runtime_cache_response
        this.stats.cache.total_bytes += grob_response.content_length()
        this.stats.cache.count++
        return grob_response
      }

      const persistent_response = this.db.select_request(request_record)
      if (persistent_response) {
        this.stats.cache.total_bytes += persistent_response.content_length()
        this.stats.cache.count++
        this.validate_response(grob_options, request, persistent_response)
        return persistent_response
      }
    }

    const fetch_promise = this.queue.enqueue(async () => {
      const response = await fetch(request)
      this.validate_response(grob_options, request, response)

      let response_body: string | undefined
      let response_body_filepath: string | undefined
      if (read && write) {
        throw new Error('unimplemented')
      } if (read) {
        response_body = await response.text()
      } else if (write) {
        response_body_filepath = write
        if (!response.body) throw new Error('unexpected response: cannot write file from a null Response::body')
        await this.write_file(response.body, response_body_filepath)
      }

      if (cache)  {
        this.db.insert_response(request_record, response.status, response.headers, response_body, response_body_filepath, { expires_on })
      }

      const grob_response = new GrobResponse(response_body, response)
      this.stats.fetch.total_bytes += grob_response.content_length()
      grob_response.filepath = response_body_filepath
      return grob_response
    })
      .finally(() => {
        if (cache) {
          this.runtime_cache.delete(serialized_request)
        }
      })

    this.stats.fetch.count++
    this.runtime_cache.set(serialized_request, fetch_promise)

    // // TODO attach cache/fetch stats to GrobResponse. This will become important when we have multiple scoped grobs built off the same grob base
    // // we still want them to share the same queue so this is how we will track stats differently
    const result = await fetch_promise
    return result
  }

  private async write_file(data_stream: ReadableStream<Uint8Array>, dest_filepath: string) {
    const dest_folder = path.dirname(dest_filepath)
    const dest_folder_temp = path.join(this.files_temp_folder, crypto.randomUUID())
    const dest_filepath_temp = path.join(dest_folder_temp, path.basename(dest_filepath) + '.down')
    await Deno.mkdir(dest_folder_temp)
    // we _may_ error here on a file name clash, but thats more of a user error than anything
    const file = await Deno.open(dest_filepath_temp, { write: true, createNew: true })

    await data_stream.pipeTo(file.writable)
    await Deno.mkdir(dest_folder, { recursive: true })
    await Deno.rename(dest_folder_temp, dest_folder)
    await Deno.rename(path.join(dest_folder, path.basename(dest_filepath_temp)), dest_filepath)
  }

  private validate_response(grob_options: GrobOptions, request: Request, response: Response): Response {
    if (grob_options.validate?.status) {
      if (!grob_options.validate.status.includes(response.status)) {
        throw new HttpError(request, response, `request ${request.url} failed. Response status ${response.status} not in expected statuses: [${grob_options.validate.status}]`)
      }
    }
    return response
  }

  [Symbol.dispose]() {
    this.close()
  }
}

export { Grob, GrobResponse }
