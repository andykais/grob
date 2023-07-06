interface RateLimitQueueConfig {
  rate_per_second?: number
  concurrent_limit?: number
  debug?: boolean
}

const passthrough_config: RateLimitQueueConfig = Object.freeze({ rate_per_second: Infinity, concurrent_limit: Infinity })


type Task<T> = () => Promise<T>

interface TaskObject<T> {
  task: Task<T>
  promise_controller: PromiseController<T>
  task_index: number
}

interface TimeRateData {
  second: number
  rate: number
}


class PromiseController<T> {
  promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (error: Error) => void

  public constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.resolve.bind(this)
      this.reject = reject
      this.reject.bind(this)
    })
  }
}

class RateLimitQueue<T> {
  private config: RateLimitQueueConfig
  private concurrent_limit: number
  private rate_per_second: number
  private queue: TaskObject<T>[]
  private active_tasks: number
  private enqueued_task_count: number
  private last_enqueue: TimeRateData
  private start_time: number
  private next_scheduled_second: number
  private interval_id: number

  public constructor(config?: RateLimitQueueConfig) {
    this.config = config ?? {}
    this.concurrent_limit = config?.concurrent_limit ?? Infinity
    this.rate_per_second = config?.rate_per_second ?? Infinity
    this.queue = []
    this.active_tasks = 0
    this.enqueued_task_count = 0
    this.last_enqueue = { second: 0, rate: 0 }
    this.start_time = performance.now()
    this.next_scheduled_second = 0
    // for rate limited tasks, we run the scheduler once a second
    this.interval_id = setInterval(this.schedule, 1000)
  }

  public close() {
    if (this.queue.length) {
      throw new Error(`queue was stopped with ${this.queue.length} remaining tasks`)
    }
    clearInterval(this.interval_id)
  }

  public async enqueue(task: Task<T>): Promise<T> {
    const task_index = this.enqueued_task_count ++
    const promise_controller = new PromiseController<T>()
    const task_object = {
      promise_controller,
      task,
      task_index
    }

    this.queue.push(task_object)
    this.schedule()
    return promise_controller.promise
  }

  private schedule = () => {
    if (this.queue.length === 0) return

    const current_second = this.current_second()

    const acceptable_concurrency = this.active_tasks < this.concurrent_limit
    const acceptable_rate = this.last_enqueue.second !== current_second || this.last_enqueue.rate < this.rate_per_second
    if (acceptable_concurrency && acceptable_rate) {
      const task_object = this.queue.shift()
      if (!task_object) return
      const { task, task_index, promise_controller } = task_object
      this.active_tasks ++
      if (current_second === this.last_enqueue.second) {
        this.last_enqueue.rate++
      } else {
        this.last_enqueue = { rate: 1, second: current_second }
      }
      task()
        .then(v => {
          this.active_tasks --
          if (this.config.debug) console.log(`Task #${task_index} completed`)
          promise_controller.resolve(v)
        })
        .catch(e => {
          this.active_tasks --
          if (this.config.debug) console.log(`Task #${task_index} failed`)
          promise_controller.reject(e)
        })
        .finally(() => {
          this.schedule()
        })
    }
    // if (!acceptable_rate && this.queue.length > 0) {
    //   const next_scheduled_second = current_second + 1
    //   if (this.next_scheduled_second < next_scheduled_second) {
    //     this.next_scheduled_second = next_scheduled_second
    //     setTimeout(() => {
    //       this.schedule()
    //     }, 1000)
    //   }
    // }
  }

  private current_second() {
    const current_millis = performance.now() - this.start_time
    return Math.floor(current_millis / 1000)
  }
}


export { RateLimitQueue }
export type { RateLimitQueueConfig }
