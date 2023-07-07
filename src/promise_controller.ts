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


export { PromiseController }
