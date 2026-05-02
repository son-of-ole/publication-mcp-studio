declare module 'citation-js' {
  class Cite {
    constructor(input?: unknown)
    format(type: string, options?: Record<string, unknown>): string
  }

  export default Cite
}
