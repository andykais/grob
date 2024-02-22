import { sqlite, datetime } from './deps.ts';
import { GrobResponse } from './grob.ts'

const datetime_format_string = 'yyyy/MM/dd HH:mm'

interface RequestCreate {
  url: string
  headers?: HeadersInit
  body?: any
}

interface RequestsTR {
  id: number
  request: string
  response_status: number
  response_headers: string
  response_body: string
  response_body_filepath: string
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
  private db: sqlite.DB

  private insert_request_stmt: sqlite.PreparedQuery
  private select_request_stmt: sqlite.PreparedQuery

  public constructor(download_folder: string) {
    this.download_folder = download_folder
    this.database_filepath = `${download_folder}/requests.db`
    console.log('Opening', this.database_filepath)
    this.db = new sqlite.DB(this.database_filepath)
    this.db.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER NOT NULL PRIMARY KEY,
        request TEXT NOT NULL,
        request_non_unique_params TEXT,
        response_status INTEGER, -- not null after we migrate this and make an assumption here
        response_headers TEXT NOT NULL,
        response_body TEXT,
        response_body_filepath TEXT,
        expires_on DATETIME,
        created_at TIMESTAMP DATETIME DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );`)
    // NOTE to self: this was a bad design. We should have two indexes. One thats the unique request
    //               and one thats the request + created_at. The lookup should infer the TTL cutoff at runtime
    this.db.query(`CREATE UNIQUE INDEX IF NOT EXISTS request_params ON requests(request, expires_on);`)
    this.insert_request_stmt = this.db.prepareQuery(`INSERT INTO requests (request, response_status, response_headers, response_body, response_body_filepath, expires_on) VALUES (:request, :response_status, :response_headers, :response_body, :response_body_filepath, :expires_on)`)
    this.select_request_stmt = this.db.prepareQuery(`SELECT * FROM requests WHERE request = :request AND (expires_on IS NULL OR expires_on >= :now)`)
  }

  public close() {
    this.insert_request_stmt.finalize()
    this.select_request_stmt.finalize()
    this.db.close()
  }

  public select_request(request: RequestCreate): GrobResponse | undefined {
    const serialized_request = JSON.stringify(request)
    const now = datetime.format(new Date(), datetime_format_string)
    const ret = this.select_request_stmt.firstEntry({ request: serialized_request, now }) as RequestsTR | undefined
    if (ret) {
      const response = new GrobResponse(ret.response_body, {
        status: ret.response_status,
        headers: JSON.parse(ret.response_headers),
      })
      response.filepath = ret.response_body_filepath
      return response
    }
  }

  public insert_response(request: RequestCreate, response_status: number, response_headers: Headers, response_body: any, response_body_filepath: string | undefined, cache_control: { expires_on?: Date}) {
    const serialized_request = JSON.stringify(request)
    const serialized_headers = JSON.stringify(Object.fromEntries(response_headers.entries()))
    const expires_on = cache_control?.expires_on ? datetime.format(cache_control.expires_on, datetime_format_string) : null
    this.insert_request_stmt.execute({ request: serialized_request, response_status, response_headers: serialized_headers, response_body, response_body_filepath, expires_on })
  }

  private serialize_request(url: string, fetch_options: RequestInit) {

  }
}


export { GrobDatabase }
