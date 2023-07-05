import { DB, type PreparedQuery } from 'https://deno.land/x/sqlite@v3.7.2/mod.ts';

// interface GrobOptions {
//   cache?: boolean
//   expires_on?: Date
// }

// interface GrobOptionsInternal extends GrobOptions {
//   read: boolean
//   write: boolean
// }

// interface GrobbedResponse {
//   response: Response
//   fetched: boolean
// }


// type ValueOf<T> = T[keyof T];
// type TableRow = { id: number; name: string }
// type Statement<TR> = PreparedQuery<ValueOf<TR>, TR>

interface RequestsTR {
  id: number
  request: string
  response_headers: string
  response_body: string
  expires_on: string | null
  created_at: string
}

interface GrobParsedResponseInternal {
  response_headers: string
  response_body: string
}


class GrobDatabase {
  public download_folder: string
  public database_filepath: string
  private db: DB

  private insert_request_stmt: PreparedQuery
  private select_request_stmt: PreparedQuery

  public constructor(download_folder: string) {
    this.download_folder = download_folder
    this.database_filepath = `${download_folder}/requests.db`
    this.db = new DB(this.database_filepath)
    this.db.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER NOT NULL PRIMARY KEY,
        request TEXT NOT NULL,
        request_non_unique_params TEXT,
        response_headers TEXT NOT NULL,
        response_body TEXT,
        response_body_filepath TEXT,
        expires_on DATETIME,
        created_at TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );`)
    this.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS request_params ON requests(request);`)
    this.insert_request_stmt = this.db.prepareQuery(`INSERT INTO requests (request, response_headers, response_body, response_body_filepath) VALUES (:request, :response_headers, :response_body, :response_body_filepath)`)
    this.select_request_stmt = this.db.prepareQuery(`SELECT * FROM requests WHERE request = :request`)
  }

  public select_request(request: { url: string; headers?: HeadersInit; body?: any }) {
    const serialized_request = JSON.stringify(request)
    return this.select_request_stmt.firstEntry({ request: serialized_request })
  }

  // public fetch_headers(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
  //   const response = this.fetch_internal(
  //     url,
  //     fetch_options,
  //     {...grob_options, read: true, write: false},
  //     (response: Response) => {
  //       return {
  //         response_headers: response.headers
  //       }
  //     }
  //   )

  //   return response.headers
  // }

  // public fetch_cookies(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
  //   const response_headers = this.fetch_headers(url, fetch_options, {...grob_options, read: true, write: false})
  //   return this.parse_resonse_cookies(response_headers)
  // }

  // public fetch_json(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
  //   const response = this.fetch_internal(
  //     url,
  //     fetch_options,
  //     {...grob_options, read: true, write: false},
  //     (response: Response) => {
  //       return {
  //         response_headers: response.headers,
  //         response_body: await response.json(),
  //       }
  //     }
  //   )
  //   return await response.json()
  // }

  // public fetch_text(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {
  //   const response = this.fetch_internal(
  //     url,
  //     fetch_options,
  //     {...grob_options, read: true, write: false},
  //     (response: Response) => {
  //       return {
  //         response_headers: response.headers,
  //         response_body: await response.text(),
  //       }
  //     }
  //   )
  //   return await response.text()
  // }

  // public fetch_file(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {

  // }

  // private fetch_internal<T>(
  //   url: string,
  //   fetch_options?: RequestInit,
  //   grob_options: GrobOptionsInternal,
  //   parse_response: (res: Response) => T): Response {
  //   const cache = grob_options.cache ?? true
  //   const expires_on = grob_options.expires_on ?? null
  //   const read = grob_options.read ?? true
  //   const write = grob_options.write ?? false

  //   // const serialized_request = JSON.stringify({ url, headers: fetch_options?.headers, body: fetch_options?.body })
  //   // if (cache) {
  //   //   const db_cached = this.select_request_stmt.oneEntry({ request: serialized_request })
  //   //   if (db_cached) return new Response()
  //   // }
  // }

  // private parse_resonse_cookies(response: Response) {
  //   const cookies: {[key:string]: string} = {}
  //   for (const [key, value] of response.headers.entries()) {
  //     if (key === 'set-cookie') {
  //       const kv_pairs = value
  //         .split(/;[ ]*/)
  //         .map(cookie_str => {
  //           return cookie_str.split('=', 2)
  //         })
  //       Object.assign(cookies, Object.fromEntries(kv_pairs))
  //     }
  //   }
  //   return cookies
  // }

  // private complete_request(response: Response) {

  // }

  private serialize_request(url: string, fetch_options: RequestInit) {

  }
}


export { GrobDatabase }






// class Grob {
//   public constructor(private db_filepath: string) {
//     const db = new DB(`${download_folder}/requests.db`)
//     db.query(`
//       CREATE TABLE IF NOT EXISTS requests (
//         id INTEGER NOT NULL PRIMARY KEY,
//         request TEXT NOT NULL,
//         response TEXT
//       );`)
//     db.query(`CREATE INDEX IF NOT EXISTS request_params ON requests(request);`)
//     this.cache_request_stmt = db.prepareQuery(`INSERT INTO requests (request, response) VALUES (:request, :response)`)
//     this.select_request_stmt = db.prepareQuery(`SELECT * FROM requests WHERE request = :request`)
//   }

//   public fetch_headers(url: string, fetch_options?: RequestInit, grop_options?: GrobOptions) {
//     const response = this.fetch_internal(url, fetch_options, {...grob_options})
//     return response.headers
//   }

//   public fetch_cookies(url: string, fetch_options?: RequestInit, grop_options?: GrobOptions) {
//     const response = this.fetch_internal(url, fetch_options, {...grob_options})
//     return this.parse_resonse_cookies(response)
//   }

//   public fetch_json(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {

//   }

//   public fetch_text(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {

//   }

//   public fetch_file(url: string, fetch_options?: RequestInit, grob_options?: GrobOptions) {

//   }

//   private fetch_internal(url: string, fetch_options?: RequestInit, grob_options: GrobOptionsInternal): Response {
//     const cache = grop_options.cache ?? true
//     const expires_on = grop_options.expires_on
//     const read = grob_options.read ?? true
//     const write = grob_options.write ?? false
//   }

//   private parse_resonse_cookies(response: Response) {
//     const cookies: {[key:string]: string} = {}
//     for (const [key, value] of response.headers.entries()) {
//       if (key === 'set-cookie') {
//         const kv_pairs = value
//           .split(/;[ ]*/)
//           .map(cookie_str => {
//             return cookie_str.split('=', 2)
//           })
//         Object.assign(cookies, Object.fromEntries(kv_pairs))
//       }
//     }
//     return cookies
//   }
// }
