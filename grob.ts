import * as fs from "https://deno.land/std@0.127.0/fs/mod.ts";
import { copy } from 'https://deno.land/std@0.127.0/fs/copy.ts'
import { move } from 'https://deno.land/std@0.127.0/fs/move.ts'
import { writableStreamFromWriter } from "https://deno.land/std@0.127.0/streams/mod.ts";
import { DB, type PreparedQuery } from 'https://deno.land/x/sqlite/mod.ts';

// RIF: requests in flight
// CRR: cached requests retrieved
// NRM: new requests made
// RDD: redacted videos

interface GrobOptions extends RequestInit {
  /** whether this request should be cached or not */
  cache_to_disk?: boolean
  /** whether the response should be read into memory */
  read?: boolean
  /** name of file to write to, if specified */
  write?: string
}

class Grob {
  // NOTE that grob is only able to cache requests given a single process running this script.
  private runtime_cache = new Map<string, Promise<any>>()

  private stats = {
    cached_fetch_count: 0,
    fetch_count: 0,
    request_in_flight: 0,
  }

  private cache_request_stmt: PreparedQuery
  private select_request_stmt: PreparedQuery

  constructor(private download_folder: string) {
    const db = new DB(`${download_folder}/requests.db`)
    db.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER NOT NULL PRIMARY KEY,
        request TEXT NOT NULL,
        response TEXT
      );`)
    db.query(`CREATE INDEX IF NOT EXISTS request_params ON requests(request);`)
    this.cache_request_stmt = db.prepareQuery(`INSERT INTO requests (request, response) VALUES (:request, :response)`)
    this.select_request_stmt = db.prepareQuery(`SELECT * FROM requests WHERE request = :request`)
  }

  private async fetch_internal(url: string, options?: GrobOptions) {
    const { cache_to_disk: cache = true, read = true, write, ...fetch_init } = options ?? {}
    const request_params = JSON.stringify({ url, ...options })

    try {
      if (cache) {
        const persisted_request = this.select_request_stmt.oneEntry({ request: request_params })
        if (persisted_request) {
          this.stats.cached_fetch_count ++
          return Promise.resolve(persisted_request.response as string)
        } else {
          // console.log('UNCACHED', url)
        }
      }
    } catch(e) {
      if (e.name === 'SqliteError' && e.message === 'The query did not return any rows.') {}
      else throw e
    }
    if (this.runtime_cache.has(request_params)) return await this.runtime_cache.get(request_params)! as string
    const temp_write = `${write}.down`
    if (write) {
      // console.log('written:', await fs.exists(write))
      // console.log('writing:', await fs.exists(temp_write))
      if (await fs.exists(write) && (await fs.exists(temp_write)) === false) {
        this.stats.cached_fetch_count++
        // written files are considered existing if their file is already there
        return ''
      } else {
      }
    }
    this.stats.request_in_flight ++
    const fetch_promise = fetch(url, options).then(async res => {
      this.stats.fetch_count ++
      if (read && write) throw new Error('unimplemented')
      else if (read) return res.text()
      else if (write) {
        if (res.body) {
          const file = await Deno.open(temp_write, { write: true, create: true })
          const writableStream = writableStreamFromWriter(file);
          await res.body.pipeTo(writableStream);
          await move(temp_write, write)
        }
        return ''
      } else throw new Error('unexpected')
    })
    this.runtime_cache.set(request_params, fetch_promise)
    const data = await fetch_promise
    this.stats.request_in_flight --
    if (cache) this.cache_request_stmt.execute({ request: request_params, response: data })
    return data
  }

  public async fetch_text(url: string, options?: GrobOptions) {
    return this.fetch_internal(url, options)
  }

  public async fetch_json<T = object>(url: string, options?: GrobOptions) {
    const text = await this.fetch_internal(url, options)
    return JSON.parse(text) as T
  }

  public async fetch_file(url: string, filepath: string, options?: GrobOptions) {
    return this.fetch_internal(url, {...options, write: filepath, read: false })
  }

  public get_stats() {
    function pad(strings: TemplateStringsArray, ...vals: number[]) {
      let result = ''
      for (let i = 0; i < strings.length; i++) {
        result += strings[i]
        if (vals.length > i) result += vals[i].toString().padStart(3)
      }
      return result
    }
    return pad`RIF: ${this.stats.request_in_flight} NRM: ${this.stats.fetch_count} CRR: ${this.stats.cached_fetch_count}`
  }

  public static parse_resonse_cookies(response: Response) {
    const cookies: {[key:string]: string} = {}
    for (const [key, value] of response.headers.entries()) {
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
}

export { Grob }
