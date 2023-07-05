import * as path from 'https://deno.land/std@0.192.0/path/mod.ts'
import { GrobDatabase } from './database.ts'
import { RateLimitQueue, type RateLimitQueueConfig } from './queue.ts'


interface GrobConfig {
  download_folder?: string
  throttle?: RateLimitQueueConfig
}
interface GrobOptions {
  cache?: boolean
  expires_on?: Date
}

interface GrobOptionsInternal extends GrobOptions {
  read: boolean
  write: boolean
}

interface GrobbedResponse {
  response: Response
  fetched: boolean
}


class Grob {
  public config: GrobConfig
  private db: GrobDatabase
  private queue: RateLimitQueue<Response>
  private runtime_cache = new Map<string, Promise<Response>>()

  public constructor(config?: GrobConfig) {
    this.config = config ?? {}
    this.config.download_folder = this.config.download_folder ?? path.join(Deno.cwd(), 'grobber')
    Deno.mkdirSync(this.config.download_folder, { recursive: true })
    this.db = new GrobDatabase(this.config.download_folder)
    this.queue = new RateLimitQueue(this.config.throttle)
    this.runtime_cache = new Map()
  }

  public async fetch_headers(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: false},
      (response: Response) => {
        return {
          response_headers: response.headers
        }
      }
    )

    return response.headers
  }

  public async fetch_cookies(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response_headers = await this.fetch_headers(url, fetch_options, grob_options)
    return this.parse_response_cookies(response_headers)
  }

  public async fetch_json(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    return await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: false},
      async (response: Response) => {
        return {
          response_headers: response.headers,
          response_body: await response.json(),
        }
      }
    )
  }

  public async fetch_text(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
    const response = await this.fetch_internal(
      url,
      fetch_options,
      {...grob_options, read: true, write: false},
      async (response: Response) => {
        console.log('fetch_text parse_response')
        return {
          response_headers: response.headers,
          response_body: await response.text(),
        }
      }
    )
    return await response.text()
  }

  public async fetch_file(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {

  }

  private async fetch_internal<T>(
    url: string,
    fetch_options: RequestInit | undefined,
    grob_options: GrobOptionsInternal,
    parse_response: (res: Response) => T): Promise<Response> {
    const cache = grob_options.cache ?? true
    const expires_on = grob_options.expires_on ?? null
    const read = grob_options.read ?? true
    const write = grob_options.write ?? false

    const request = { url, headers: fetch_options?.headers, body: fetch_options?.body }
    const serialized_request = JSON.stringify(request)

    if (cache) {
      const persistent_response = this.db.select_request(request)
      if (persistent_response) {
        throw new Error('unimplemented')
      }

      if (this.runtime_cache.has(serialized_request)) {
        return await this.runtime_cache.get(serialized_request)!
      }
    }

    const fetch_promise = fetch(url, { headers: request.headers, body: request.body })
    this.runtime_cache.set(serialized_request, fetch_promise)

    const response = await fetch_promise
    const parsed_response = await parse_response(response)

    if (cache)  {
      // insert into db
      throw new Error('unimplemented')

      this.runtime_cache.delete(serialized_request)
    }
    // if (cache) this.cache_request_stmt.execute({ request: serialized_request, response: parsed_response })

    return await fetch_promise
  }

  private parse_response_cookies(response_headers: Headers) {
    const cookies: {[key:string]: string} = {}
    for (const [key, value] of response_headers.entries()) {
      if (key === 'set-cookie') {
        const kv_pairs = value
          .split(/;[ ]*/)
          .map(cookie_str => {
            return cookie_str.split('=', 2)
          })
        Object.assign(cookies, Object.fromEntries(kv_pairs))
      }
    }
    return cookies
  }

  private complete_request(response: Response) {

  }

  private serialize_request(url: string, fetch_options: RequestInit) {

  }
}

export { Grob }
