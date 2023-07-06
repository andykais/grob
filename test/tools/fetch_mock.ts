import { mock } from './deps.ts'

interface MockFetchInstructions {
  request: {
    method?: string
    url?: string
    body?: any
    headers?: Record<string, string>
  },
  response: {
    status_code?: number
    body?: any
    headers?: Record<string, string>
  }
}

interface MockExpectation {
  promise_controller: PromiseController<Request>
  instructions: MockFetchInstructions
}


class FetchMockNotFound extends Error {}


class PromiseController<T> {
  public promise: Promise<T>
  public resolve!: (value: T) => void
  public reject!: (error: Error) => void
  public constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })

  }
}

class FetchMock {
  private fetch_stub: mock.Stub<Window & typeof globalThis, Parameters<typeof fetch>> | undefined
  private expectations: MockExpectation[]
  public constructor() {
    this.expectations = []
  }

  public start() {
    this.fetch_stub = mock.stub(window, 'fetch', this.responder)
  }

  public clean() {
    if (this.fetch_stub === undefined) throw new Error('FetchMock.start() must be called before calling FetchMock.clean()')
    if (this.expectations.length > 0) {
      throw new Error(`Fetch contains ${this.expectations.length} remaining expectations that went unfetched`)
    }
    this.expectations = []
    this.fetch_stub.restore()
  }

  public expector = (instructions: MockFetchInstructions): Promise<Request> => {
    const promise_controller = new PromiseController<Request>()
    // push to the front of the array, so that when we respond, we look at the newest mocks first
    this.expectations.unshift({
      instructions,
      promise_controller
    })
    return promise_controller.promise
  }

  private responder = (input: string | Request | URL, init?: RequestInit) => {

    let url = input.toString()
    let method = 'GET'
    let headers = init?.headers
    if (input instanceof Request) {
      url = input.url
      method = input.method ?? method
      headers ??= input.headers
    }
    if (init?.method) {
      method = init.method
    }

    const identifier = `${method} ${url}`
    if (this.expectations.length === 0) {
      throw new FetchMockNotFound(`No expectations set up, request for ${identifier} was rejected`)
    }

    for (const [index, expectation] of this.expectations.entries()) {
      const { request, response } = expectation.instructions
      if (request.url && request.url !== url) {
        continue
      }
      if (request.method && request.method !== method) {
        continue
      }
      if (request.headers) {
        if (headers === undefined) continue
        for (const [key, val] of Object.entries(request.headers)) {
          const input_header = Object.entries(headers).find(([k, v]) => k === key && v === val)
          if (input_header === undefined) continue
        }
      }
      if (request.body) {
        throw new Error('unimplemented')
      }
      const fetch_response = new Response(response.body, { headers: response.headers, status: response.status_code })
      this.expectations.splice(index)
      return Promise.resolve(fetch_response)
    }
    throw new FetchMockNotFound(`No expectation found for ${identifier} out of ${this.expectations.length} set up expectations`)
  }
}

export { FetchMock, FetchMockNotFound }
