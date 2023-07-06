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


export { PromiseController }
