import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vue': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const resolveStatic = (urlPath: string): string | null => {
  if (urlPath.startsWith('/dist/')) {
    return path.join(rootDir, 'dist', urlPath.slice('/dist/'.length))
  }
  if (urlPath.startsWith('/fixtures/')) {
    return path.join(rootDir, 'test/fixtures', urlPath.slice('/fixtures/'.length))
  }
  if (urlPath.startsWith('/vue/')) {
    return path.join(rootDir, 'node_modules/vue/dist', urlPath.slice('/vue/'.length))
  }
  if (urlPath === '/favicon.ico') return null
  return null
}

export type TestServer = {
  url: string
  close: () => Promise<void>
}

export async function startTestServer(): Promise<TestServer> {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const filePath = resolveStatic(decodeURIComponent(url.pathname))

      if (!filePath) {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('not found')
        return
      }

      const resolved = path.resolve(filePath)
      const root = path.resolve(rootDir)
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        response.writeHead(403, { 'content-type': 'text/plain' })
        response.end('forbidden')
        return
      }

      const body = await readFile(resolved)
      response.writeHead(200, {
        'content-type': mimeTypes[path.extname(resolved)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      response.end(body)
    } catch (error: any) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500, {
        'content-type': 'text/plain',
      })
      response.end(String(error?.message ?? error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('failed to start test server')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
