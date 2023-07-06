import { Grob } from 'https://deno.land/x/grob/mod.ts'
import { PromiseController } from './tools/promise_controller.ts'
import { test } from './tools/test.ts'

const timeout = (millis: number) => new Promise(resolve => setTimeout(resolve, millis))

test('queue concurrent limit', async t => {
  const grob = new Grob({
    download_folder: t.artifacts_folder,
    throttle: { concurrent_limit: 2 }
  })

  const fetch_controller_1 = new PromiseController<Response>()
  const fetch_controller_2 = new PromiseController<Response>()
  const fetch_controller_3 = new PromiseController<Response>()

  const fetch_1 = t.assert.fetch({request: {}, response: fetch_controller_1.promise })
  const fetch_2 = t.assert.fetch({request: {}, response: fetch_controller_2.promise })
  const fetch_3 = t.assert.fetch({request: {}, response: fetch_controller_3.promise })

  const response_promise_1 = grob.fetch_text('https://example.com', undefined, { cache: false })
  const response_promise_2 = grob.fetch_text('https://example.com', undefined, { cache: false })
  const response_promise_3 = grob.fetch_text('https://example.com', undefined, { cache: false })

  t.assert.equals(fetch_1.status, 'RESPONDING')
  t.assert.equals(fetch_2.status, 'RESPONDING')
  t.assert.equals(fetch_3.status, 'UNFULFILLED')

  fetch_controller_1.resolve(new Response('one'))
  fetch_controller_2.resolve(new Response('two'))
  const text_1 = await response_promise_1
  const text_2 = await response_promise_2
  t.assert.equals(text_1, 'one')
  t.assert.equals(text_2, 'two')
  t.assert.equals(fetch_3.status, 'RESPONDING')

  fetch_controller_3.resolve(new Response('three'))
  const text_3 = await response_promise_3
  t.assert.equals(text_3, 'three')

  grob.close()
})

test('queue rate limit', async t => {
  const grob = new Grob({
    download_folder: t.artifacts_folder,
    throttle: { concurrent_limit: 2 }
  })

  const fetch_1 = t.assert.fetch({request: {}, response: { body: 'one' } })
  const fetch_2 = t.assert.fetch({request: {}, response: { body: 'two' } })
  const fetch_3 = t.assert.fetch({request: {}, response: { body: 'three' } })

  const response_promise_1 = grob.fetch_text('https://example.com', undefined, { cache: false })
  const response_promise_2 = grob.fetch_text('https://example.com', undefined, { cache: false })
  const response_promise_3 = grob.fetch_text('https://example.com', undefined, { cache: false })

  t.assert.equals(fetch_1.status, 'FULFILLED')
  t.assert.equals(fetch_2.status, 'FULFILLED')
  t.assert.equals(fetch_3.status, 'UNFULFILLED')

  await timeout(1000)

  t.assert.equals(fetch_3.status, 'FULFILLED')
  t.assert.equals(await response_promise_1, 'one')
  t.assert.equals(await response_promise_2, 'two')
  t.assert.equals(await response_promise_3, 'three')

  grob.close()
})
