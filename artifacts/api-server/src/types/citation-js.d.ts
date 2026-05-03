declare module 'citation-js' {
  type CiteFormatOptions = {
    format?: string
    template?: string
    lang?: string
  }

  class Cite {
    constructor(input?: unknown)
    format(name: string, options?: CiteFormatOptions): string
  }

  export default Cite
}
