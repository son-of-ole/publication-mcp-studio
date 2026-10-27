declare module '@citation-js/core' {
  type CiteFormatOptions = {
    format?: string
    template?: string
    lang?: string
  }

  export class Cite {
    constructor(input?: unknown)
    format(name: string, options?: CiteFormatOptions): string
  }

}
