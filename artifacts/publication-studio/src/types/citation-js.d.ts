declare module '@citation-js/core' {
  export class Cite {
    constructor(input?: unknown)
    format(type: string, options?: Record<string, unknown>): string
  }

}
