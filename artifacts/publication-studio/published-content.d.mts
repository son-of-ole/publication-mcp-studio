export function createPublishedContentReader(origin: string): (path: string) => Promise<Response>
export function createReaderMiddleware(options: { publishedOrigin: string }): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => Promise<void>
